export type StrategyType =
  | 'stock_strategy'
  | 'fund_strategy'
  | 'portfolio_strategy'
  | 'etf_market_strategy'
  | 'unknown_strategy'

export interface StrategyLibraryItem {
  strategyId: string
  name: string
  status: string
  assetClass: string
  strategyType: StrategyType
  symbols: string[]
  updatedAt: string
  evidenceAction: string
  evidenceSummary: string
  dataSummary: string
  riskRewardSummary: string
  assumptionSummary: string
  runnable: boolean
}

export interface StrategyLibraryState {
  ok: boolean
  path: string
  artifactContract: string
  paths: Record<string, string>
  count: number
  modified?: string
  strategies: StrategyLibraryItem[]
  error?: string
}

export function normalizeStrategyLibrary(payload: unknown): StrategyLibraryState {
  const source = asRecord(payload)
  const rows = Array.isArray(source.strategies) ? source.strategies : []
  const strategies = rows.map(normalizeStrategyRecord).filter((row): row is StrategyLibraryItem => Boolean(row))
  return {
    ok: source.ok !== false,
    path: stringValue(source.path),
    artifactContract: stringValue(source.artifactContract) || 'strategy-library-v1',
    paths: stringRecord(source.paths),
    count: typeof source.count === 'number' ? source.count : strategies.length,
    modified: stringValue(source.modified),
    strategies,
    error: stringValue(source.error),
  }
}

function normalizeStrategyRecord(value: unknown): StrategyLibraryItem | null {
  const row = asRecord(value)
  const spec = firstRecord(row.strategySpec, row.spec)
  const evidence = firstRecord(row.backtestEvidence, row.evidence)
  const summary = asRecord(row.dataAndAssumptionSummary)
  const lifecycle = asRecord(row.lifecycle)
  const strategyId = stringValue(row.strategyId) || stringValue(spec.id)
  if (!strategyId) return null
  const symbols = extractSymbols(spec, row)
  const status = stringValue(row.status) || 'unknown'
  const assetClass = stringValue(row.assetClass) || stringValue(spec.assetClass) || stringValue(spec.market) || inferAssetClass(symbols)
  const evidenceAction = stringValue(row.evidenceAction) || stringValue(evidence.action)
  return {
    strategyId,
    name: stringValue(row.name) || stringValue(spec.name) || strategyId,
    status,
    assetClass,
    strategyType: normalizeStrategyType(row.strategyType) ?? inferStrategyType({
      row,
      spec,
      evidence,
      summary,
      status,
      assetClass,
      evidenceAction,
      symbols,
    }),
    symbols,
    updatedAt: stringValue(row.updatedAt),
    evidenceAction,
    evidenceSummary: summarizeEvidence(evidence, summary),
    dataSummary: summarizeDataEvidence(evidence, summary),
    riskRewardSummary: summarizeRiskReward(evidence, summary),
    assumptionSummary: summarizeAssumptions(spec, summary),
    runnable: lifecycle.runnable === true || status === 'backtested',
  }
}

function normalizeStrategyType(value: unknown): StrategyType | null {
  const text = stringValue(value)
  if (
    text === 'stock_strategy' ||
    text === 'fund_strategy' ||
    text === 'portfolio_strategy' ||
    text === 'etf_market_strategy' ||
    text === 'unknown_strategy'
  ) {
    return text
  }
  return null
}

function inferStrategyType(input: {
  row: Record<string, unknown>
  spec: Record<string, unknown>
  evidence: Record<string, unknown>
  summary: Record<string, unknown>
  status: string
  assetClass: string
  evidenceAction: string
  symbols: string[]
}): StrategyType {
  const assetClass = input.assetClass.toLowerCase()
  const evidenceAction = input.evidenceAction
  if (
    input.status === 'ranked' ||
    evidenceAction === 'custom_strategy_rank' ||
    hasAnyRecord(input.summary, ['portfolioEvidence', 'rebalanceDraft', 'portfolioValidation']) ||
    hasAnyRecord(input.evidence, ['portfolioEvidence', 'rebalanceDraft', 'portfolioValidation'])
  ) {
    return 'portfolio_strategy'
  }
  const pricingBasis = stringValue(asRecord(input.summary.fundRiskEvidence).pricingBasis).toLowerCase()
  const specType = stringValue(input.spec.type).toLowerCase()
  if (
    assetClass === 'etf' ||
    assetClass === 'listed_fund' ||
    pricingBasis === 'listed_fund' ||
    pricingBasis === 'etf' ||
    specType === 'etf_market_strategy'
  ) {
    return 'etf_market_strategy'
  }
  if (
    assetClass === 'fund' ||
    evidenceAction === 'custom_strategy_observe' ||
    evidenceAction === 'custom_strategy_fund_backtest' ||
    hasAnyRecord(input.summary, ['fundCoverageEvidence', 'fundRiskEvidence'])
  ) {
    return 'fund_strategy'
  }
  if (assetClass === 'stock' || input.symbols.some((symbol) => /^[0-9]{6}$/.test(symbol))) {
    return 'stock_strategy'
  }
  return 'unknown_strategy'
}

function hasAnyRecord(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => Object.keys(asRecord(record[key])).length > 0)
}

function summarizeEvidence(evidence: Record<string, unknown>, summary: Record<string, unknown> = {}): string {
  const parts: string[] = []
  const metrics = asRecord(evidence.metrics)
  addNumberPart(parts, 'return', metrics.totalReturnPct, '%')
  addNumberPart(parts, 'maxDD', metrics.maxDrawdownPct, '%')
  addNumberPart(parts, 'sharpe', metrics.sharpe)
  const fundRisk = asRecord(summary.fundRiskEvidence)
  addNumberPart(parts, 'fundMaxDD', fundRisk.worstDrawdownPct, '%')
  addNumberPart(parts, 'fundVol', fundRisk.maxVolatilityPct, '%')
  addNumberPart(parts, 'sevenDayYield', fundRisk.averageSevenDayYield, '%')
  addNumberPart(parts, 'fundGTP', fundRisk.gainToPainRatio ?? fundRisk.averageGainToPainRatio)
  addNumberPart(parts, 'fundOmega', fundRisk.omegaRatio ?? fundRisk.averageOmegaRatio)
  addNumberPart(parts, 'fundTail', fundRisk.tailRatio ?? fundRisk.averageTailRatio)
  const signal = stringValue(evidence.signal)
  if (signal) parts.push(`signal=${signal}`)
  const status = stringValue(evidence.status)
  if (status) parts.push(`status=${status}`)
  return parts.join(' · ')
}

function summarizeDataEvidence(evidence: Record<string, unknown>, summary: Record<string, unknown> = {}): string {
  const dataEvidence = asRecord(evidence.dataEvidence)
  const fundCoverage = asRecord(summary.fundCoverageEvidence)
  const fundRisk = asRecord(summary.fundRiskEvidence)
  const parts: string[] = []
  for (const key of ['source', 'provider', 'cacheStatus', 'sourceDataTime', 'fetchedAt']) {
    const value = stringValue(dataEvidence[key]) || stringValue(evidence[key])
    if (value) parts.push(`${key}=${value}`)
  }
  const bars = numberValue(dataEvidence.bars) ?? numberValue(evidence.bars)
  if (bars !== undefined) parts.push(`bars=${bars}`)
  const coverage = stringValue(fundCoverage.status)
  if (coverage) parts.push(`fundCoverage=${coverage}`)
  const pricingBasis = stringValue(fundRisk.pricingBasis)
  if (pricingBasis) parts.push(`pricingBasis=${pricingBasis}`)
  return parts.join(' · ')
}

function summarizeRiskReward(evidence: Record<string, unknown>, summary: Record<string, unknown> = {}): string {
  const riskReward = firstRecord(evidence.riskRewardEvidence, summary.riskRewardEvidence)
  const portfolioQuality = firstRecord(
    evidence.portfolioReturnQualityEvidence,
    summary.portfolioReturnQualityEvidence,
    asRecord(evidence.portfolioEvidence).portfolioReturnQualityEvidence,
    asRecord(summary.portfolioEvidence).portfolioReturnQualityEvidence,
  )
  const parts: string[] = []
  addNumberPart(parts, 'trades', riskReward.completedTrades)
  addNumberPart(parts, 'wins', riskReward.winningTrades)
  addNumberPart(parts, 'losses', riskReward.losingTrades)
  addNumberPart(parts, 'payoff', riskReward.payoffRatio)
  addNumberPart(parts, 'profitFactor', riskReward.profitFactor)
  addNumberPart(parts, 'expectancy', riskReward.expectancyPct, '%')
  addNumberPart(parts, 'portfolioReturn', portfolioQuality.annualizedReturnPct, '%')
  addNumberPart(parts, 'portfolioVol', portfolioQuality.annualizedVolatilityPct, '%')
  addNumberPart(parts, 'portfolioSharpe', portfolioQuality.sharpeRatio)
  addNumberPart(parts, 'portfolioSortino', portfolioQuality.sortinoRatio)
  addNumberPart(parts, 'portfolioCalmar', portfolioQuality.calmarRatio)
  addNumberPart(parts, 'portfolioGTP', portfolioQuality.gainToPainRatio)
  return parts.join(' · ')
}

function summarizeAssumptions(spec: Record<string, unknown>, summary: Record<string, unknown> = {}): string {
  const positionSizing = firstRecord(summary.positionSizing, spec.positionSizing)
  const fees = asRecord(summary.feesAndSlippage)
  const parts: string[] = []
  const sizingType = stringValue(positionSizing.type)
  if (sizingType) parts.push(`sizing=${sizingType}`)
  addNumberPart(parts, 'fraction', positionSizing.value)
  addNumberPart(parts, 'riskPct', positionSizing.riskPct)
  addNumberPart(parts, 'maxPosition', positionSizing.maxPositionPct)
  addNumberPart(parts, 'kellyScale', positionSizing.kellyScale)
  addNumberPart(parts, 'commission', fees.commissionPct, '%')
  addNumberPart(parts, 'slippage', fees.slippagePct, '%')
  return parts.join(' · ')
}

function addNumberPart(parts: string[], label: string, value: unknown, suffix = '') {
  const number = numberValue(value)
  if (number === undefined) return
  parts.push(`${label}=${Number.isInteger(number) ? number : number.toFixed(2)}${suffix}`)
}

function extractSymbols(spec: Record<string, unknown>, row: Record<string, unknown> = {}): string[] {
  const values: string[] = []
  if (Array.isArray(row.symbols)) values.push(...row.symbols.map(stringValue).filter(Boolean))
  for (const key of ['symbol', 'code']) {
    const value = stringValue(spec[key])
    if (value) values.push(value)
  }
  for (const key of ['symbols', 'codes']) {
    const list = spec[key]
    if (Array.isArray(list)) values.push(...list.map(stringValue).filter(Boolean))
  }
  const universe = asRecord(spec.universe)
  if (Array.isArray(universe.symbols)) values.push(...universe.symbols.map(stringValue).filter(Boolean))
  return Array.from(new Set(values))
}

function inferAssetClass(symbols: string[]): string {
  if (symbols.some((symbol) => /^[0-9]{6}$/.test(symbol))) return 'stock'
  return 'unknown'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value)
  return Object.fromEntries(
    Object.entries(record)
      .map(([key, raw]) => [key, stringValue(raw)] as const)
      .filter(([, raw]) => raw),
  )
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    const record = asRecord(value)
    if (Object.keys(record).length > 0) return record
  }
  return {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
