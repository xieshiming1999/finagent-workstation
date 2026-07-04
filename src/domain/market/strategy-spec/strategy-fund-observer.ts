import { normalizeStrategySpec } from './strategy-spec-normalizer'
import { fundIndicatorDefinition } from './strategy-spec-registry'
import {
  isFundStrategySpec,
  validateFundStrategySpec,
  type StrategySpecContract,
} from './strategy-spec-validator'

type FundRow = Record<string, unknown>

export function observeFundStrategySpec(raw: unknown, fundRows: unknown): Record<string, unknown> {
  if (!isRecord(raw)) throw new Error('strategySpec object is required for custom_strategy_observe')
  const spec = normalizeStrategySpec(raw as unknown as StrategySpecContract) as StrategySpecContract
  if (!isFundStrategySpec(spec)) {
    throw new Error('custom_strategy_observe is fund-only. Correct the StrategySpec by setting assetClass:"fund" or market:"fund" and using fund indicators such as nav_trend, rolling_return, fund_drawdown, fund_volatility, fund_sharpe, fund_sortino, fund_calmar, money_yield, seven_day_yield, or dca_interval; use custom_strategy_backtest only for stock StrategySpec.')
  }
  const validation = validateFundStrategySpec(spec)
  if (validation.status !== 'validated') {
    throw new Error(`custom strategy validation failed: ${validation.errors.join('; ')}`)
  }
  const rows = Array.isArray(fundRows) ? fundRows.filter(isRecord).map(normalizeFundRow) : []
  if (rows.length === 0) {
    return fundRowsNeededResult('custom_strategy_observe', spec, validation.strategyId, validation.version)
  }
  rows.sort((left, right) => String(left.date).localeCompare(String(right.date)))
  const categoryEvidence = fundCategoryEvidence(spec, rows)
  const coverageEvidence = fundCoverageEvidence(spec, rows, categoryEvidence)
  const indicators = computeFundIndicators(spec, rows)
  const comparisonEvidence = fundComparisonEvidence(spec, rows)
  const entry = evaluateRuleGroup(spec.entry, indicators)
  const exit = evaluateRuleGroup(spec.exit, indicators)
  const signal = {
    entrySatisfied: entry.satisfied,
    exitSatisfied: exit.satisfied,
    suggestion: exit.satisfied ? 'review_or_pause' : entry.satisfied ? 'observe_or_prepare' : 'wait',
  }
  return {
    action: 'custom_strategy_observe',
    status: 'observed',
    assetClass: 'fund',
    backtestable: false,
    strategyId: validation.strategyId,
    version: validation.version,
    spec,
    rows: rows.length,
    sourceDataTime: rows.at(-1)?.date ?? null,
    fundCategoryEvidence: categoryEvidence,
    fundCoverageEvidence: coverageEvidence,
    indicators,
    ...(comparisonEvidence ? { comparisonEvidence } : {}),
    entry,
    exit,
    signal,
    dcaObservation: dcaObservation(spec, indicators, signal),
    monitorDraft: monitorDraft(spec, entry, exit, signal),
    workflowAdvice: 'This is fund observation evidence, not a stock K-line backtest. Use it for fund-specific monitoring or trade preparation; do not report stock trades, Sharpe, or K-line signals from this result.',
  }
}

export function backtestFundStrategySpec(raw: unknown, fundRows: unknown): Record<string, unknown> {
  if (!isRecord(raw)) throw new Error('strategySpec object is required for custom_strategy_fund_backtest')
  const spec = normalizeStrategySpec(raw as unknown as StrategySpecContract) as StrategySpecContract
  if (!isFundStrategySpec(spec)) {
    throw new Error('custom_strategy_fund_backtest is fund-only. Correct the StrategySpec by setting assetClass:"fund" or market:"fund" and using fund indicators such as nav_trend, rolling_return, fund_drawdown, fund_volatility, fund_sharpe, fund_sortino, fund_calmar, money_yield, seven_day_yield, or dca_interval; use custom_strategy_backtest only for stock StrategySpec.')
  }
  const validation = validateFundStrategySpec(spec)
  if (validation.status !== 'validated') {
    throw new Error(`custom strategy validation failed: ${validation.errors.join('; ')}`)
  }
  const rows = Array.isArray(fundRows) ? fundRows.filter(isRecord).map(normalizeFundRow) : []
  if (rows.length === 0) {
    return fundRowsNeededResult('custom_strategy_fund_backtest', spec, validation.strategyId, validation.version)
  }
  rows.sort((left, right) => String(left.date).localeCompare(String(right.date)))
  const categoryEvidence = fundCategoryEvidence(spec, rows)
  const coverageEvidence = fundCoverageEvidence(spec, rows, categoryEvidence)
  const groups = new Map<string, Array<Record<string, unknown>>>()
  const names = new Map<string, string>()
  for (const row of rows) {
    const code = String(row.code ?? '').trim()
    const key = code || 'fund'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
    const name = String(row.name ?? '').trim()
    if (name) names.set(key, name)
  }
  const fundResults: Array<Record<string, unknown>> = [...groups.entries()].map(([code, groupRows]) => {
    groupRows.sort((left, right) => String(left.date).localeCompare(String(right.date)))
    const indicators = computeFundIndicators(spec, groupRows)
    const entry = evaluateRuleGroup(spec.entry, indicators)
    const exit = evaluateRuleGroup(spec.exit, indicators)
    const resultCategoryEvidence = fundCategoryEvidence(spec, groupRows)
    const resultCoverageEvidence = fundCoverageEvidence(spec, groupRows, resultCategoryEvidence)
    const metrics = fundPeriodMetrics(groupRows)
    const resultRiskEvidence = fundRiskEvidence(metrics, resultCategoryEvidence, resultCoverageEvidence)
    return {
      code,
      ...(names.get(code) ? { name: names.get(code) } : {}),
      actualStartDate: groupRows[0]?.date ?? null,
      actualEndDate: groupRows.at(-1)?.date ?? null,
      rows: groupRows.length,
      fundCategoryEvidence: resultCategoryEvidence,
      fundCoverageEvidence: resultCoverageEvidence,
      fundRiskEvidence: resultRiskEvidence,
      metrics,
      indicators,
      entry,
      exit,
      signal: {
        entrySatisfied: entry.satisfied,
        exitSatisfied: exit.satisfied,
        suggestion: exit.satisfied ? 'review_or_pause' : entry.satisfied ? 'observe_or_prepare' : 'wait',
      },
    }
  })
  fundResults.sort((left, right) => {
    const rightMetrics = isRecord(right.metrics) ? right.metrics : {}
    const leftMetrics = isRecord(left.metrics) ? left.metrics : {}
    return Number(rightMetrics.periodReturnPct ?? 0) - Number(leftMetrics.periodReturnPct ?? 0)
  })
  fundResults.forEach((row, index) => { row.rank = index + 1 })
  const aggregateRiskEvidence = aggregateFundRiskEvidence(fundResults, categoryEvidence, coverageEvidence)
  const periodEvidence = aggregateFundPeriodEvidence(fundResults, categoryEvidence, coverageEvidence)
  const ruleEvidence = aggregateFundRuleEvidence(fundResults)
  return {
    action: 'custom_strategy_fund_backtest',
    status: 'fund_backtested',
    assetClass: 'fund',
    mode: 'fund_period_evidence',
    stockBacktestable: false,
    strategyId: validation.strategyId,
    version: validation.version,
    spec,
    fundCount: fundResults.length,
    rows: rows.length,
    sourceDataTime: rows.at(-1)?.date ?? null,
    fundCategoryEvidence: categoryEvidence,
    fundCoverageEvidence: coverageEvidence,
    fundRiskEvidence: aggregateRiskEvidence,
    periodEvidence,
    ruleEvidence,
    fundResults,
    tradeBoundary: 'Fund backtest evidence is research/observation only. Do not subscribe, redeem, rebalance, or create simulated trades without explicit user confirmation.',
    workflowAdvice: 'Use this evidence for fund-specific strategy validation. It is not a stock K-line backtest and does not produce executable stock trades, Sharpe, or broker orders.',
  }
}

function aggregateFundPeriodEvidence(
  fundResults: Array<Record<string, unknown>>,
  categoryEvidence: Record<string, unknown>,
  coverageEvidence: Record<string, unknown>,
): Record<string, unknown> {
  const returns = fundResults
    .map((row) => isRecord(row.metrics) ? numberOf(row.metrics.periodReturnPct) : null)
    .filter((value): value is number => value != null)
  const sortedReturns = [...returns].sort((left, right) => left - right)
  const best = returns.length ? Math.max(...returns) : null
  const worst = returns.length ? Math.min(...returns) : null
  return {
    mode: 'fund_period_evidence',
    assetClass: 'fund',
    status: coverageEvidence.status ?? null,
    fundCount: fundResults.length,
    pricingBasis: categoryEvidence.pricingBasis ?? null,
    actualStartDate: coverageEvidence.actualStartDate ?? null,
    actualEndDate: coverageEvidence.actualEndDate ?? null,
    rows: coverageEvidence.actualRows ?? null,
    bestPeriodReturnPct: best == null ? null : round(best),
    worstPeriodReturnPct: worst == null ? null : round(worst),
    medianPeriodReturnPct: sortedReturns.length ? round(sortedReturns[Math.floor(sortedReturns.length / 2)]) : null,
    perFund: fundResults.map((row) => ({
      code: row.code ?? null,
      ...(row.name ? { name: row.name } : {}),
      rank: row.rank ?? null,
      actualStartDate: row.actualStartDate ?? null,
      actualEndDate: row.actualEndDate ?? null,
      rows: row.rows ?? null,
      metrics: row.metrics ?? null,
      coverageStatus: isRecord(row.fundCoverageEvidence) ? row.fundCoverageEvidence.status ?? null : null,
    })),
    boundary: 'Fund period evidence is NAV/yield period evidence, not an executable stock backtest or broker order.',
  }
}

function aggregateFundRuleEvidence(fundResults: Array<Record<string, unknown>>): Record<string, unknown> {
  const entrySatisfied = fundResults.filter((row) => isRecord(row.entry) && row.entry.satisfied === true).length
  const exitSatisfied = fundResults.filter((row) => isRecord(row.exit) && row.exit.satisfied === true).length
  return {
    mode: 'fund_rule_evidence',
    assetClass: 'fund',
    fundCount: fundResults.length,
    entrySatisfiedCount: entrySatisfied,
    exitSatisfiedCount: exitSatisfied,
    entryUnsatisfiedCount: fundResults.length - entrySatisfied,
    exitUnsatisfiedCount: fundResults.length - exitSatisfied,
    perFund: fundResults.map((row) => ({
      code: row.code ?? null,
      ...(row.name ? { name: row.name } : {}),
      rank: row.rank ?? null,
      entry: row.entry ?? null,
      exit: row.exit ?? null,
      signal: row.signal ?? null,
    })),
    tradeBoundary: 'Fund rule evidence can guide observation or preparation only. It does not authorize subscription, redemption, rebalance, or simulated trading.',
  }
}

function fundRowsNeededResult(action: string, spec: StrategySpecContract, strategyId: string, version: number): Record<string, unknown> {
  return {
    action,
    status: 'needs_data',
    assetClass: 'fund',
    strategyId,
    version,
    spec,
    missing: ['fundRows'],
    requiredReadbacks: ['query_fund_nav', 'query_fund_money_yield'],
    workflowAdvice: 'No structured fundRows were supplied. Read governed fund NAV or money-yield rows for a selected fund code, then call this action again with code/fundCode/symbol or structured fundRows. This is not executable evidence yet.',
  }
}

function normalizeFundRow(row: FundRow): Record<string, unknown> {
  return {
    code: String(row.code ?? row.symbol ?? row.fundCode ?? '').trim(),
    name: String(row.name ?? row.fundName ?? '').trim(),
    date: String(row.date ?? row.navDate ?? row.tradeDate ?? '').trim(),
    nav: numberOf(row.nav ?? row.unitNav ?? row.netValue),
    fundType: String(row.fundType ?? row.type ?? row.category ?? '').trim(),
    dataClass: String(row.dataClass ?? row.canonicalSchema ?? '').trim(),
    listedPrice: numberOf(row.listedPrice ?? row.marketPrice ?? row.price ?? row.close ?? row.quotePrice),
    underlyingIndex: String(row.underlyingIndex ?? row.indexCode ?? '').trim(),
    moneyYield: numberOf(row.moneyYield ?? row.millionCopiesIncome ?? row.per10kIncome ?? row['万份收益']),
    sevenDayYield: numberOf(row.sevenDayYield ?? row.sevenDayAnnualized ?? row['七日年化']),
  }
}

function fundCoverageEvidence(
  spec: StrategySpecContract,
  rows: Array<Record<string, unknown>>,
  categoryEvidence: Record<string, unknown>,
): Record<string, unknown> {
  const specRecord = spec as unknown as Record<string, unknown>
  const requirements = isRecord(specRecord.dataRequirements) ? specRecord.dataRequirements : {}
  const minBars = numberOf(requirements.minBars) ?? 1
  const explicitFields = Array.isArray(requirements.requiredFields)
    ? requirements.requiredFields.map((field) => String(field).trim()).filter(Boolean)
    : []
  const requiredFields = explicitFields.length ? explicitFields : defaultFundRequiredFields(categoryEvidence)
  const missingFields = requiredFields.filter((field) => !hasUsableFundField(rows, field))
  const enoughRows = rows.length >= minBars
  return {
    status: enoughRows && missingFields.length === 0 ? 'sufficient' : 'insufficient',
    requestedMinRows: minBars,
    actualRows: rows.length,
    requiredFields,
    missingFields,
    actualStartDate: rows[0]?.date ?? null,
    actualEndDate: rows.at(-1)?.date ?? null,
    pricingBasis: categoryEvidence.pricingBasis,
    dataClass: categoryEvidence.dataClass,
    warnings: [
      ...(!enoughRows ? ['fund rows below requested minBars; period evidence is partial.'] : []),
      ...(missingFields.length ? [`fund rows are missing required fields: ${missingFields.join(', ')}.`] : []),
    ],
  }
}

function defaultFundRequiredFields(categoryEvidence: Record<string, unknown>): string[] {
  const pricingBasis = String(categoryEvidence.pricingBasis ?? '')
  if (pricingBasis === 'money_yield') return ['date', 'moneyYield']
  if (pricingBasis === 'listed_market_price') return ['date', 'listedPrice']
  if (pricingBasis === 'underlying_index') return ['date', 'underlyingIndex']
  return ['date', 'nav']
}

function hasUsableFundField(rows: Array<Record<string, unknown>>, field: string): boolean {
  return rows.some((row) => {
    const value = row[field]
    if (value == null) return false
    if (typeof value === 'string') return value.trim().length > 0
    return true
  })
}

function fundCategoryEvidence(
  spec: StrategySpecContract,
  rows: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const specRecord = spec as unknown as Record<string, unknown>
  const dataRequirements = isRecord(specRecord.dataRequirements) ? specRecord.dataRequirements : {}
  const dataClass = String(dataRequirements.dataClass ?? '').trim().toLowerCase()
  const specFundCategory = normalizeFundCategoryValue(specRecord.fundCategory ?? specRecord.fundType)
  const rowCategories = rows.map((row) => normalizeFundCategoryValue(row.fundCategory ?? row.fund_category))
  const rowDataClasses = rows.map((row) => String(row.dataClass ?? '').trim().toLowerCase())
  const hasNav = rows.some((row) => typeof row.nav === 'number')
  const hasListedPrice = rows.some((row) => typeof row.listedPrice === 'number')
  const hasUnderlyingIndex = rows.some((row) => String(row.underlyingIndex ?? '').trim().length > 0)
  const hasMoneyYield = rows.some((row) => typeof row.moneyYield === 'number' || typeof row.sevenDayYield === 'number')
  const isMoney = specFundCategory === 'money' || dataClass === 'money_fund_yield' || rowCategories.includes('money') || rowDataClasses.includes('money_fund_yield')
  const isEtf = specFundCategory === 'etf' || dataClass === 'etf_nav' || dataClass === 'etf_fund_nav' || rowCategories.includes('etf') || rowDataClasses.includes('etf_nav') || rowDataClasses.includes('etf_fund_nav')
  const pricingBasis = isMoney
    ? 'money_yield'
    : dataClass.includes('listed_fund_quote') || hasListedPrice
      ? 'listed_market_price'
      : dataClass.includes('underlying_index') || hasUnderlyingIndex
        ? 'underlying_index'
      : isEtf
        ? hasNav ? 'fund_nav' : 'fund_nav_or_listed_quote_required'
        : hasNav
          ? 'fund_nav'
          : hasMoneyYield
            ? 'money_yield'
            : 'unknown'
  const requiredReadbacks = isMoney
    ? ['query_fund_money_yield']
    : isEtf
      ? ['query_fund_nav', 'query_quote', 'query_index_quote']
      : ['query_fund_nav']
  const observedPricingBases = [
    ...(hasNav ? ['fund_nav'] : []),
    ...(hasListedPrice || dataClass.includes('listed_fund_quote') ? ['listed_market_price'] : []),
    ...(hasUnderlyingIndex || dataClass.includes('underlying_index') ? ['underlying_index'] : []),
    ...(hasMoneyYield ? ['money_yield'] : []),
  ]
  const etfAllowedPricingBases = ['fund_nav', 'listed_market_price', 'underlying_index']
  const warnings = [
    ...(isMoney && hasNav ? ['money fund evidence should prioritize money_yield/seven_day_yield over ordinary NAV.'] : []),
    ...(isEtf && !observedPricingBases.some((basis) => etfAllowedPricingBases.includes(basis))
      ? ['ETF evidence must disclose whether it uses fund NAV, listed market price, or underlying index data.']
      : []),
    ...(!hasNav && !hasMoneyYield ? ['fund rows do not contain NAV or money-yield values.'] : []),
  ]
  return {
    category: isMoney ? 'money_fund' : isEtf ? 'etf_or_etf_link' : 'ordinary_fund',
    pricingBasis,
    dataClass: dataClass || null,
    fundType: specFundCategory || null,
    hasNav,
    hasListedPrice,
    hasUnderlyingIndex,
    hasMoneyYield,
    requiredReadbacks,
    ...(isEtf ? {
      etfPricingEvidence: {
        allowedPricingBases: etfAllowedPricingBases,
        observedPricingBases: observedPricingBases.filter((basis) => etfAllowedPricingBases.includes(basis)),
        missingPricingBases: etfAllowedPricingBases.filter((basis) => !observedPricingBases.includes(basis)),
      },
    } : {}),
    warnings,
  }
}

function fundPeriodMetrics(rows: Array<Record<string, unknown>>): Record<string, unknown> {
  const navs = rows.map((row) => numberOf(row.nav)).filter((value): value is number => value != null)
  const moneyYields = rows.map((row) => numberOf(row.moneyYield)).filter((value): value is number => value != null)
  const sevenDayYields = rows.map((row) => numberOf(row.sevenDayYield)).filter((value): value is number => value != null)
  const navReturn = navs.length >= 2 && navs[0] !== 0 ? ((navs.at(-1)! - navs[0]) / navs[0]) * 100 : null
  const hasNav = navs.length >= 2
  const riskPeriod = hasNav ? Math.min(60, navs.length - 1) : 0
  return {
    periodReturnPct: navReturn == null ? null : round(navReturn),
    maxDrawdownPct: hasNav ? round(drawdown(navs, navs.length) ?? 0) : null,
    averageDrawdownPct: hasNav ? round(averageDrawdown(navs, riskPeriod) ?? 0) : null,
    ulcerIndex: hasNav ? round(ulcerIndex(navs, riskPeriod) ?? 0) : null,
    drawdownDurationBars: hasNav ? drawdownDurationBars(navs, riskPeriod) ?? 0 : null,
    volatilityPct: hasNav ? round(volatility(navs, Math.min(20, navs.length - 1)) ?? 0) : null,
    gainToPainRatio: hasNav ? round(gainToPain(navs, riskPeriod) ?? 0) : null,
    recoveryRatio: hasNav ? round(recoveryRatio(navs, riskPeriod) ?? 0) : null,
    omegaRatio: hasNav ? round(omega(navs, { period: riskPeriod }) ?? 0) : null,
    tailRatio: hasNav ? round(tailRatio(navs, { period: riskPeriod }) ?? 0) : null,
    positivePeriodRatioPct: hasNav ? round(positivePeriodRatio(navs, { period: riskPeriod }) ?? 0) : null,
    negativePeriodRatioPct: hasNav ? round(negativePeriodRatio(navs, { period: riskPeriod }) ?? 0) : null,
    returnSkewness: hasNav ? round(returnSkewness(navs, { period: riskPeriod }) ?? 0) : null,
    returnKurtosis: hasNav ? round(returnKurtosis(navs, { period: riskPeriod }) ?? 0) : null,
    valueAtRiskPct: hasNav ? round(valueAtRisk(navs, { period: riskPeriod }) ?? 0) : null,
    conditionalValueAtRiskPct: hasNav ? round(conditionalValueAtRisk(navs, { period: riskPeriod }) ?? 0) : null,
    moneyYieldTotal: moneyYields.length ? round(moneyYields.reduce((sum, value) => sum + value, 0)) : null,
    averageSevenDayYield: sevenDayYields.length ? round(sevenDayYields.reduce((sum, value) => sum + value, 0) / sevenDayYields.length) : null,
    dataClass: navs.length >= 2
      ? 'ordinary_fund_nav'
      : moneyYields.length || sevenDayYields.length
        ? 'money_fund_yield'
        : 'unknown_fund_rows',
  }
}

function fundRiskEvidence(
  metrics: Record<string, unknown>,
  categoryEvidence: Record<string, unknown>,
  coverageEvidence: Record<string, unknown>,
): Record<string, unknown> {
  const drawdown = numberOf(metrics.maxDrawdownPct)
  const averageDrawdown = numberOf(metrics.averageDrawdownPct)
  const ulcerIndexValue = numberOf(metrics.ulcerIndex)
  const drawdownDuration = numberOf(metrics.drawdownDurationBars)
  const volatility = numberOf(metrics.volatilityPct)
  const gainToPainValue = numberOf(metrics.gainToPainRatio)
  const recoveryRatioValue = numberOf(metrics.recoveryRatio)
  const omegaValue = numberOf(metrics.omegaRatio)
  const tailRatioValue = numberOf(metrics.tailRatio)
  const positivePeriodRatio = numberOf(metrics.positivePeriodRatioPct)
  const negativePeriodRatio = numberOf(metrics.negativePeriodRatioPct)
  const returnSkewnessValue = numberOf(metrics.returnSkewness)
  const returnKurtosisValue = numberOf(metrics.returnKurtosis)
  const valueAtRiskValue = numberOf(metrics.valueAtRiskPct)
  const conditionalValueAtRiskValue = numberOf(metrics.conditionalValueAtRiskPct)
  const averageSevenDayYield = numberOf(metrics.averageSevenDayYield)
  const pricingBasis = String(categoryEvidence.pricingBasis ?? '')
  const coverageStatus = String(coverageEvidence.status ?? '')
  const warnings = [
    ...(coverageStatus !== 'sufficient' ? ['fund risk evidence is partial because fund data coverage is insufficient.'] : []),
    ...(drawdown != null && drawdown >= 20 ? ['fund historical drawdown is high for this period.'] : []),
    ...(volatility != null && volatility >= 25 ? ['fund historical volatility is high for this period.'] : []),
    ...(pricingBasis === 'money_yield' && averageSevenDayYield == null ? ['money-fund risk evidence is missing average seven-day yield.'] : []),
    ...(Array.isArray(categoryEvidence.warnings) ? categoryEvidence.warnings.map(String) : []),
    ...(Array.isArray(coverageEvidence.warnings) ? coverageEvidence.warnings.map(String) : []),
  ].filter(Boolean)
  const riskLevel = coverageStatus !== 'sufficient'
    ? 'unknown'
    : drawdown != null && drawdown >= 20
      ? 'high'
      : volatility != null && volatility >= 25
        ? 'high'
        : drawdown != null && drawdown >= 10
          ? 'medium'
          : pricingBasis === 'money_yield'
            ? 'income_stability'
            : 'low'
  return {
    assetClass: 'fund',
    status: coverageStatus === 'sufficient' ? 'evaluated' : 'partial',
    riskLevel,
    coverageStatus,
    pricingBasis,
    maxDrawdownPct: drawdown,
    averageDrawdownPct: averageDrawdown,
    ulcerIndex: ulcerIndexValue,
    drawdownDurationBars: drawdownDuration,
    volatilityPct: volatility,
    gainToPainRatio: gainToPainValue,
    recoveryRatio: recoveryRatioValue,
    omegaRatio: omegaValue,
    tailRatio: tailRatioValue,
    positivePeriodRatioPct: positivePeriodRatio,
    negativePeriodRatioPct: negativePeriodRatio,
    returnSkewness: returnSkewnessValue,
    returnKurtosis: returnKurtosisValue,
    valueAtRiskPct: valueAtRiskValue,
    conditionalValueAtRiskPct: conditionalValueAtRiskValue,
    averageSevenDayYield,
    moneyYieldTotal: metrics.moneyYieldTotal ?? null,
    warnings: [...new Set(warnings)],
    tradeBoundary: 'Fund risk evidence is research-only. Explicit user confirmation is required before subscription, redemption, rebalance, or simulated trading.',
  }
}

function aggregateFundRiskEvidence(
  fundResults: Array<Record<string, unknown>>,
  categoryEvidence: Record<string, unknown>,
  coverageEvidence: Record<string, unknown>,
): Record<string, unknown> {
  const perFund = fundResults.map((row) => row.fundRiskEvidence).filter(isRecord)
  const drawdowns = perFund.map((row) => numberOf(row.maxDrawdownPct)).filter((value): value is number => value != null)
  const averageDrawdowns = perFund.map((row) => numberOf(row.averageDrawdownPct)).filter((value): value is number => value != null)
  const volatilities = perFund.map((row) => numberOf(row.volatilityPct)).filter((value): value is number => value != null)
  const ulcerIndexes = perFund.map((row) => numberOf(row.ulcerIndex)).filter((value): value is number => value != null)
  const drawdownDurations = perFund.map((row) => numberOf(row.drawdownDurationBars)).filter((value): value is number => value != null)
  const yields = perFund.map((row) => numberOf(row.averageSevenDayYield)).filter((value): value is number => value != null)
  const gainToPains = perFund.map((row) => numberOf(row.gainToPainRatio)).filter((value): value is number => value != null)
  const recoveryRatios = perFund.map((row) => numberOf(row.recoveryRatio)).filter((value): value is number => value != null)
  const omegas = perFund.map((row) => numberOf(row.omegaRatio)).filter((value): value is number => value != null)
  const tailRatios = perFund.map((row) => numberOf(row.tailRatio)).filter((value): value is number => value != null)
  const positivePeriodRatios = perFund.map((row) => numberOf(row.positivePeriodRatioPct)).filter((value): value is number => value != null)
  const negativePeriodRatios = perFund.map((row) => numberOf(row.negativePeriodRatioPct)).filter((value): value is number => value != null)
  const returnSkewnesses = perFund.map((row) => numberOf(row.returnSkewness)).filter((value): value is number => value != null)
  const returnKurtoses = perFund.map((row) => numberOf(row.returnKurtosis)).filter((value): value is number => value != null)
  const valueAtRisks = perFund.map((row) => numberOf(row.valueAtRiskPct)).filter((value): value is number => value != null)
  const conditionalValueAtRisks = perFund.map((row) => numberOf(row.conditionalValueAtRiskPct)).filter((value): value is number => value != null)
  const warnings = [...new Set(perFund.flatMap((row) => Array.isArray(row.warnings) ? row.warnings.map(String) : []).filter(Boolean))]
  const coverageStatus = String(coverageEvidence.status ?? '')
  const worstDrawdown = drawdowns.length ? Math.max(...drawdowns) : null
  const maxVolatility = volatilities.length ? Math.max(...volatilities) : null
  const worstValueAtRisk = valueAtRisks.length ? Math.max(...valueAtRisks) : null
  const worstConditionalValueAtRisk = conditionalValueAtRisks.length ? Math.max(...conditionalValueAtRisks) : null
  return {
    assetClass: 'fund',
    status: coverageStatus === 'sufficient' ? 'evaluated' : 'partial',
    fundCount: fundResults.length,
    coverageStatus,
    pricingBasis: categoryEvidence.pricingBasis ?? null,
    worstDrawdownPct: worstDrawdown == null ? null : round(worstDrawdown),
    averageDrawdownPct: averageDrawdowns.length ? round(averageDrawdowns.reduce((sum, value) => sum + value, 0) / averageDrawdowns.length) : null,
    maxVolatilityPct: maxVolatility == null ? null : round(maxVolatility),
    averageUlcerIndex: ulcerIndexes.length ? round(ulcerIndexes.reduce((sum, value) => sum + value, 0) / ulcerIndexes.length) : null,
    maxDrawdownDurationBars: drawdownDurations.length ? Math.max(...drawdownDurations) : null,
    averageDrawdownDurationBars: drawdownDurations.length ? round(drawdownDurations.reduce((sum, value) => sum + value, 0) / drawdownDurations.length) : null,
    averageSevenDayYield: yields.length ? round(yields.reduce((sum, value) => sum + value, 0) / yields.length) : null,
    averageGainToPainRatio: gainToPains.length ? round(gainToPains.reduce((sum, value) => sum + value, 0) / gainToPains.length) : null,
    averageRecoveryRatio: recoveryRatios.length ? round(recoveryRatios.reduce((sum, value) => sum + value, 0) / recoveryRatios.length) : null,
    averageOmegaRatio: omegas.length ? round(omegas.reduce((sum, value) => sum + value, 0) / omegas.length) : null,
    averageTailRatio: tailRatios.length ? round(tailRatios.reduce((sum, value) => sum + value, 0) / tailRatios.length) : null,
    averagePositivePeriodRatioPct: positivePeriodRatios.length ? round(positivePeriodRatios.reduce((sum, value) => sum + value, 0) / positivePeriodRatios.length) : null,
    averageNegativePeriodRatioPct: negativePeriodRatios.length ? round(negativePeriodRatios.reduce((sum, value) => sum + value, 0) / negativePeriodRatios.length) : null,
    averageReturnSkewness: returnSkewnesses.length ? round(returnSkewnesses.reduce((sum, value) => sum + value, 0) / returnSkewnesses.length) : null,
    averageReturnKurtosis: returnKurtoses.length ? round(returnKurtoses.reduce((sum, value) => sum + value, 0) / returnKurtoses.length) : null,
    worstValueAtRiskPct: worstValueAtRisk == null ? null : round(worstValueAtRisk),
    worstConditionalValueAtRiskPct: worstConditionalValueAtRisk == null ? null : round(worstConditionalValueAtRisk),
    averageValueAtRiskPct: valueAtRisks.length ? round(valueAtRisks.reduce((sum, value) => sum + value, 0) / valueAtRisks.length) : null,
    averageConditionalValueAtRiskPct: conditionalValueAtRisks.length ? round(conditionalValueAtRisks.reduce((sum, value) => sum + value, 0) / conditionalValueAtRisks.length) : null,
    warnings,
    tradeBoundary: 'Aggregate fund risk evidence is research-only. It cannot trigger subscription, redemption, rebalance, or simulated trading without explicit user confirmation.',
  }
}

function fundComparisonEvidence(
  spec: StrategySpecContract,
  rows: Array<Record<string, unknown>>,
): Record<string, unknown> | null {
  const groups = new Map<string, Array<Record<string, unknown>>>()
  const names = new Map<string, string>()
  for (const row of rows) {
    const code = String(row.code ?? '').trim()
    if (!code) continue
    if (!groups.has(code)) groups.set(code, [])
    groups.get(code)!.push(row)
    const name = String(row.name ?? '').trim()
    if (name) names.set(code, name)
  }
  if (groups.size < 2) return null
  const compared: Array<Record<string, unknown> & { score: number }> = [...groups.entries()].map(([code, groupRows]) => {
    groupRows.sort((left, right) => String(left.date).localeCompare(String(right.date)))
    const indicators = computeFundIndicators(spec, groupRows)
    return {
      code,
      ...(names.get(code) ? { name: names.get(code) } : {}),
      rows: groupRows.length,
      sourceDataTime: groupRows.at(-1)?.date ?? null,
      indicators,
      score: fundComparisonScore(spec, indicators),
    }
  })
  compared.sort((left, right) => right.score - left.score)
  compared.forEach((row, index) => { row.rank = index + 1 })
  return {
    mode: 'fund_indicator_comparison',
    status: 'compared',
    fundCount: compared.length,
    rankingRule: 'Higher rolling return / NAV trend and money yield are better; lower drawdown and volatility are better.',
    rows: compared,
    tradeBoundary: 'Fund comparison evidence is observation/research only. Do not subscribe, redeem, or create simulated trades without explicit user confirmation.',
  }
}

function fundComparisonScore(spec: StrategySpecContract, indicators: Record<string, number | null>): number {
  let score = 0
  const scoreDirections = fundIndicatorScoreDirectionsById(spec)
  for (const [key, value] of Object.entries(indicators)) {
    if (value == null) continue
    const direction = scoreDirections.get(key) ?? 1
    if (direction === 0) continue
    score += value * direction
  }
  return Number(score.toFixed(4))
}

function fundIndicatorScoreDirectionsById(spec: StrategySpecContract): Map<string, number> {
  const directions = new Map<string, number>()
  for (const indicator of spec.indicators ?? []) {
    const id = String(indicator.id ?? indicator.type ?? '')
    if (!id) continue
    const definition = fundIndicatorDefinition(indicator.type)
    if (definition) directions.set(id, definition.scoreDirection ?? 1)
  }
  return directions
}

function round(value: number): number {
  return Number(value.toFixed(4))
}

function computeFundIndicators(spec: StrategySpecContract, rows: Array<Record<string, unknown>>): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  const navs = rows.map((row) => numberOf(row.nav)).filter((value): value is number => value != null)
  const moneyYields = rows.map((row) => numberOf(row.moneyYield)).filter((value): value is number => value != null)
  const sevenDayYields = rows.map((row) => numberOf(row.sevenDayYield)).filter((value): value is number => value != null)
  for (const indicator of spec.indicators ?? []) {
    const period = numberOf(indicator.params?.period) ?? 20
    switch (indicator.type) {
      case 'nav_trend':
      case 'rolling_return':
        out[indicator.id] = rollingReturn(navs, period)
        break
      case 'fund_drawdown':
        out[indicator.id] = drawdown(navs, period)
        break
      case 'fund_rolling_max_drawdown':
        out[indicator.id] = rollingMaxDrawdown(navs, period)
        break
      case 'fund_average_drawdown':
        out[indicator.id] = averageDrawdown(navs, period)
        break
      case 'fund_ulcer_index':
        out[indicator.id] = ulcerIndex(navs, period)
        break
      case 'fund_drawdown_duration_bars':
        out[indicator.id] = drawdownDurationBars(navs, period)
        break
      case 'fund_volatility':
        out[indicator.id] = volatility(navs, period)
        break
      case 'fund_downside_volatility':
        out[indicator.id] = downsideVolatility(navs, period)
        break
      case 'fund_sharpe':
        out[indicator.id] = sharpe(navs, period)
        break
      case 'fund_sortino':
        out[indicator.id] = sortino(navs, period)
        break
      case 'fund_calmar':
        out[indicator.id] = calmar(navs, period)
        break
      case 'fund_recovery_ratio':
        out[indicator.id] = recoveryRatio(navs, period)
        break
      case 'fund_gain_to_pain':
        out[indicator.id] = gainToPain(navs, period)
        break
      case 'fund_momentum_acceleration':
        out[indicator.id] = momentumAcceleration(navs, indicator.params)
        break
      case 'fund_omega':
        out[indicator.id] = omega(navs, indicator.params)
        break
      case 'fund_tail_ratio':
        out[indicator.id] = tailRatio(navs, indicator.params)
        break
      case 'fund_positive_period_ratio':
        out[indicator.id] = positivePeriodRatio(navs, indicator.params)
        break
      case 'fund_negative_period_ratio':
        out[indicator.id] = negativePeriodRatio(navs, indicator.params)
        break
      case 'fund_max_consecutive_down_periods':
        out[indicator.id] = maxConsecutivePeriods(navs, indicator.params, false)
        break
      case 'fund_max_consecutive_up_periods':
        out[indicator.id] = maxConsecutivePeriods(navs, indicator.params, true)
        break
      case 'fund_return_skewness':
        out[indicator.id] = returnSkewness(navs, indicator.params)
        break
      case 'fund_return_kurtosis':
        out[indicator.id] = returnKurtosis(navs, indicator.params)
        break
      case 'fund_value_at_risk':
        out[indicator.id] = valueAtRisk(navs, indicator.params)
        break
      case 'fund_conditional_value_at_risk':
        out[indicator.id] = conditionalValueAtRisk(navs, indicator.params)
        break
      case 'money_yield':
        out[indicator.id] = moneyYields.at(-1) ?? null
        break
      case 'seven_day_yield':
        out[indicator.id] = sevenDayYields.at(-1) ?? null
        break
      case 'dca_interval':
        out[indicator.id] = period
        break
    }
  }
  return out
}

function evaluateRuleGroup(group: unknown, data: Record<string, number | null>): Record<string, unknown> {
  if (!isRecord(group)) return { satisfied: false, rules: [] }
  const mode = Array.isArray(group.all) ? 'all' : 'any'
  const rules = Array.isArray(group[mode]) ? group[mode].filter(isRecord) : []
  const evaluated = rules.map((rule) => {
    const left = String(rule.left ?? '')
    const op = String(rule.op ?? '')
    const leftValue = numberOf(data[left])
    const rightValue = numberOf(rule.right)
    return {
      left,
      op,
      right: rule.right,
      leftValue,
      satisfied: compare(leftValue, op, rightValue),
    }
  })
  return {
    mode,
    satisfied: mode === 'all'
      ? evaluated.length > 0 && evaluated.every((rule) => rule.satisfied)
      : evaluated.some((rule) => rule.satisfied),
    rules: evaluated,
  }
}

function dcaObservation(
  spec: StrategySpecContract,
  indicators: Record<string, number | null>,
  signal: Record<string, unknown>,
): Record<string, unknown> {
  const cadenceDays = dcaIntervalValue(spec, indicators)
  return {
    mode: 'fund_observation_only',
    strategyId: spec.id,
    cadenceDays,
    suggestion: signal.suggestion,
    triggerState: {
      entrySatisfied: signal.entrySatisfied,
      exitSatisfied: signal.exitSatisfied,
    },
    tradeBoundary: 'Observation only. Do not subscribe, redeem, or create simulated trades without explicit user confirmation.',
  }
}

function dcaIntervalValue(spec: StrategySpecContract, indicators: Record<string, number | null>): number | null {
  for (const indicator of spec.indicators ?? []) {
    const definition = fundIndicatorDefinition(indicator.type)
    if (definition?.category !== 'fund_observation') continue
    const value = indicators[indicator.id]
    if (typeof value === 'number') return value
  }
  return null
}

function monitorDraft(
  spec: StrategySpecContract,
  entry: Record<string, unknown>,
  exit: Record<string, unknown>,
  signal: Record<string, unknown>,
): Record<string, unknown> {
  return {
    mode: 'fund_rule_monitor',
    strategyId: spec.id,
    assetClass: 'fund',
    status: signal.suggestion,
    entryRules: entry.rules ?? [],
    exitRules: exit.rules ?? [],
    nextAction: signal.suggestion === 'review_or_pause'
      ? 'review fund risk or pause DCA after user confirmation'
      : signal.suggestion === 'observe_or_prepare'
        ? 'prepare DCA observation; confirmation required before any trade'
        : 'wait for fund-specific rules to become satisfied',
    unsupportedExecution: 'This monitor draft is not a stock backtest, watchlist mutation, subscription order, or redemption order.',
  }
}

function rollingReturn(values: number[], period: number): number | null {
  if (values.length <= period || values[values.length - period - 1] === 0) return null
  const previous = values[values.length - period - 1]
  return ((values.at(-1)! - previous) / previous) * 100
}

function momentumAcceleration(values: number[], params: Record<string, unknown> | undefined): number | null {
  const period = Math.max(1, Math.trunc(numberOf(params?.period) ?? 20))
  const lagPeriod = Math.max(1, Math.trunc(numberOf(params?.lagPeriod) ?? period))
  if (values.length <= period + lagPeriod) return null
  const currentBase = values[values.length - period - 1]
  const previousIndex = values.length - lagPeriod - 1
  const previousBaseIndex = previousIndex - period
  if (currentBase === 0 || previousBaseIndex < 0) return null
  const previousClose = values[previousIndex]
  const previousBase = values[previousBaseIndex]
  if (previousBase === 0) return null
  const currentReturn = ((values.at(-1)! - currentBase) / currentBase) * 100
  const previousReturn = ((previousClose - previousBase) / previousBase) * 100
  return currentReturn - previousReturn
}

function drawdown(values: number[], period: number): number | null {
  if (values.length === 0) return null
  const window = values.length < period ? values : values.slice(values.length - period)
  const high = Math.max(...window)
  if (high === 0) return null
  return ((high - values.at(-1)!) / high) * 100
}

function ulcerIndex(values: number[], period: number): number | null {
  if (values.length === 0) return null
  const window = values.length < period ? values : values.slice(values.length - period)
  let high = window[0]
  let squaredDrawdownSum = 0
  for (const value of window) {
    high = Math.max(high, value)
    if (high === 0) return null
    const drawdownPct = Math.min(0, ((value - high) / high) * 100)
    squaredDrawdownSum += drawdownPct * drawdownPct
  }
  return Math.sqrt(squaredDrawdownSum / window.length)
}

function drawdownDurationBars(values: number[], period: number): number | null {
  if (values.length === 0 || period <= 0) return null
  const window = values.length < period ? values : values.slice(values.length - period)
  let high = window[0]
  let duration = 0
  for (const value of window) {
    if (value >= high) {
      high = value
      duration = 0
    } else {
      duration += 1
    }
  }
  return duration
}

function averageDrawdown(values: number[], period: number): number | null {
  if (values.length === 0 || period <= 0) return null
  const window = values.length < period ? values : values.slice(values.length - period)
  let high = window[0]
  const drawdowns: number[] = []
  for (const value of window) {
    high = Math.max(high, value)
    if (high === 0) continue
    const drawdownPct = ((high - value) / high) * 100
    if (drawdownPct > 0) drawdowns.push(drawdownPct)
  }
  if (!drawdowns.length) return 0
  return drawdowns.reduce((sum, value) => sum + value, 0) / drawdowns.length
}

function volatility(values: number[], period: number): number | null {
  if (values.length <= period) return null
  const window = values.slice(values.length - period - 1)
  const returns: number[] = []
  for (let index = 1; index < window.length; index++) {
    if (window[index - 1] === 0) return null
    returns.push((window[index] - window[index - 1]) / window[index - 1])
  }
  if (returns.length === 0) return null
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length
  return Math.sqrt(variance) * Math.sqrt(252) * 100
}

function sharpe(values: number[], period: number): number | null {
  const returns = windowReturns(values, period)
  if (!returns.length) return null
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length
  const stdev = Math.sqrt(variance)
  if (stdev === 0) return null
  return (mean / stdev) * Math.sqrt(252)
}

function sortino(values: number[], period: number): number | null {
  const returns = windowReturns(values, period)
  if (!returns.length) return null
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const downsideDeviation = downsideDeviationOf(returns)
  if (downsideDeviation == null) return null
  if (downsideDeviation === 0) return null
  return (mean / downsideDeviation) * Math.sqrt(252)
}

function downsideVolatility(values: number[], period: number): number | null {
  const returns = windowReturns(values, period)
  const downsideDeviation = downsideDeviationOf(returns)
  return downsideDeviation == null ? null : downsideDeviation * Math.sqrt(252) * 100
}

function downsideDeviationOf(returns: number[]): number | null {
  const downside = returns.filter((value) => value < 0)
  if (!downside.length) return null
  return Math.sqrt(downside.reduce((sum, value) => sum + value ** 2, 0) / downside.length)
}

function calmar(values: number[], period: number): number | null {
  const periodReturn = rollingReturn(values, period)
  const maxDrawdown = rollingMaxDrawdown(values, period)
  if (periodReturn == null || maxDrawdown == null || maxDrawdown === 0) return null
  return periodReturn / Math.abs(maxDrawdown)
}

function recoveryRatio(values: number[], period: number): number | null {
  const periodReturn = rollingReturn(values, period)
  const average = averageDrawdown(values, period)
  if (periodReturn == null || average == null || average === 0) return null
  return periodReturn / Math.abs(average)
}

function gainToPain(values: number[], period: number): number | null {
  const returns = windowReturns(values, period)
  if (!returns.length) return null
  const gains = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
  const pains = returns.filter((value) => value < 0).reduce((sum, value) => sum + Math.abs(value), 0)
  if (pains === 0) return null
  return gains / pains
}

function omega(values: number[], params: Record<string, unknown> | undefined): number | null {
  const period = numberOf(params?.period) ?? 60
  const threshold = numberOf(params?.thresholdReturn) ?? 0
  const returns = windowReturns(values, period)
  if (!returns.length) return null
  let gains = 0
  let shortfalls = 0
  for (const value of returns) {
    const excess = value - threshold
    if (excess >= 0) gains += excess
    else shortfalls += Math.abs(excess)
  }
  if (shortfalls === 0) return null
  return gains / shortfalls
}

function tailRatio(values: number[], params: Record<string, unknown> | undefined): number | null {
  const period = numberOf(params?.period) ?? 60
  const upperPercentile = numberOf(params?.upperPercentile) ?? 95
  const lowerPercentile = numberOf(params?.lowerPercentile) ?? 5
  const returns = windowReturns(values, period)
  if (returns.length < 5) return null
  const sorted = [...returns].sort((left, right) => left - right)
  const upper = percentile(sorted, upperPercentile)
  const lower = percentile(sorted, lowerPercentile)
  if (upper == null || lower == null || lower === 0) return null
  return upper / Math.abs(lower)
}

function positivePeriodRatio(values: number[], params: Record<string, unknown> | undefined): number | null {
  const period = numberOf(params?.period) ?? 60
  const returns = windowReturns(values, period)
  if (!returns.length) return null
  const positives = returns.filter((value) => value > 0).length
  return (positives / returns.length) * 100
}

function negativePeriodRatio(values: number[], params: Record<string, unknown> | undefined): number | null {
  const period = numberOf(params?.period) ?? 60
  const returns = windowReturns(values, period)
  if (!returns.length) return null
  const negatives = returns.filter((value) => value < 0).length
  return (negatives / returns.length) * 100
}

function maxConsecutivePeriods(values: number[], params: Record<string, unknown> | undefined, positive: boolean): number | null {
  const period = numberOf(params?.period) ?? 60
  const returns = windowReturns(values, period)
  if (!returns.length) return null
  let currentStreak = 0
  let maxStreak = 0
  for (const item of returns) {
    const inStreak = positive ? item > 0 : item < 0
    if (inStreak) {
      currentStreak += 1
      maxStreak = Math.max(maxStreak, currentStreak)
    } else {
      currentStreak = 0
    }
  }
  return maxStreak
}

function returnSkewness(values: number[], params: Record<string, unknown> | undefined): number | null {
  const period = numberOf(params?.period) ?? 60
  const returns = windowReturns(values, period)
  if (returns.length < 3) return null
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / returns.length
  if (variance === 0) return 0
  const stdev = Math.sqrt(variance)
  const skew = returns.reduce((sum, value) => sum + Math.pow((value - mean) / stdev, 3), 0)
  return skew / returns.length
}

function returnKurtosis(values: number[], params: Record<string, unknown> | undefined): number | null {
  const period = numberOf(params?.period) ?? 60
  const returns = windowReturns(values, period)
  if (returns.length < 4) return null
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance = returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / returns.length
  if (variance === 0) return 0
  const stdev = Math.sqrt(variance)
  const kurtosis = returns.reduce((sum, value) => sum + Math.pow((value - mean) / stdev, 4), 0)
  return kurtosis / returns.length - 3
}

function valueAtRisk(values: number[], params: Record<string, unknown> | undefined): number | null {
  const period = numberOf(params?.period) ?? 60
  const confidence = Math.max(50, Math.min(99.9, numberOf(params?.confidence) ?? 95))
  const returns = windowReturns(values, period)
  if (returns.length < 5) return null
  const sorted = [...returns].sort((left, right) => left - right)
  const cutoff = percentile(sorted, 100 - confidence)
  if (cutoff == null) return null
  return Math.max(0, -cutoff * 100)
}

function conditionalValueAtRisk(values: number[], params: Record<string, unknown> | undefined): number | null {
  const period = numberOf(params?.period) ?? 60
  const confidence = Math.max(50, Math.min(99.9, numberOf(params?.confidence) ?? 95))
  const returns = windowReturns(values, period)
  if (returns.length < 5) return null
  const sorted = [...returns].sort((left, right) => left - right)
  const cutoff = percentile(sorted, 100 - confidence)
  if (cutoff == null) return null
  const losses = returns.filter((value) => value <= cutoff)
  if (!losses.length) return valueAtRisk(values, params)
  const meanTail = losses.reduce((sum, value) => sum + value, 0) / losses.length
  return Math.max(0, -meanTail * 100)
}

function windowReturns(values: number[], period: number): number[] {
  if (values.length <= period) return []
  const window = values.slice(values.length - period - 1)
  const returns: number[] = []
  for (let index = 1; index < window.length; index++) {
    if (window[index - 1] === 0) return []
    returns.push((window[index] - window[index - 1]) / window[index - 1])
  }
  return returns
}

function percentile(sortedValues: number[], percentileValue: number): number | null {
  if (!sortedValues.length) return null
  const bounded = Math.max(0, Math.min(100, percentileValue))
  const position = (bounded / 100) * (sortedValues.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sortedValues[lower]
  const weight = position - lower
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
}

function rollingMaxDrawdown(values: number[], period: number): number | null {
  if (!values.length) return null
  const window = values.length < period ? values : values.slice(values.length - period)
  let peak = window[0]
  let worst = 0
  for (const value of window) {
    if (value > peak) peak = value
    if (peak === 0) continue
    const drawdownPct = ((peak - value) / peak) * 100
    if (drawdownPct > worst) worst = drawdownPct
  }
  return worst
}

function compare(left: number | null, op: string, right: number | null): boolean {
  if (left == null || right == null) return false
  if (op === '>') return left > right
  if (op === '>=') return left >= right
  if (op === '<') return left < right
  if (op === '<=') return left <= right
  return false
}

function numberOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace('%', ''))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeFundCategoryValue(raw: unknown): string {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return ''
  if (value === 'money' || value.includes('货币') || value.includes('money') || value.includes('monetary') || value.includes('现金')) return 'money'
  if (value === 'etf' || value.includes('etf')) return 'etf'
  if (value === 'backend' || value.includes('后端')) return 'backend'
  if (value === 'bond' || value.includes('债')) return 'bond'
  if (value === 'index' || value.includes('指数')) return 'index'
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
