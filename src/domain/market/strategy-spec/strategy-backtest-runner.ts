import type { KlineBar } from '../../../agent/data/data-manager'
import { computeStrategyIndicators } from './strategy-indicator-calculators'
import type { StrategySpec, StrategyValidation } from './strategy-spec-engine'

type RuleGroup = { all?: Rule[]; any?: Rule[] }
type Rule =
  | { left: string; op: string; right: unknown }
  | { type: 'stop_loss_pct' | 'take_profit_pct' | 'trailing_stop_pct' | 'max_drawdown_stop_pct' | 'atr_stop_loss' | 'time_stop_bars'; value: number; period?: number }

export function runValidatedStrategySpecBacktest(
  validation: StrategyValidation,
  spec: StrategySpec,
  bars: KlineBar[],
  code: string,
  options: { outOfSampleRatio?: number; walkForwardFolds?: number } = {},
): Record<string, unknown> {
  const result = runValidatedStrategySpecBacktestCore(validation, spec, bars, code)
  if (options.outOfSampleRatio != null && Number.isFinite(options.outOfSampleRatio)) {
    result.outOfSample = outOfSampleEvidence(validation, spec, bars, code, options.outOfSampleRatio)
  }
  if (options.walkForwardFolds != null && Number.isFinite(options.walkForwardFolds)) {
    result.walkForward = walkForwardEvidence(validation, spec, bars, code, options.walkForwardFolds)
  }
  return result
}

function runValidatedStrategySpecBacktestCore(
  validation: StrategyValidation,
  spec: StrategySpec,
  bars: KlineBar[],
  code: string,
): Record<string, unknown> {
  const minBars = spec.dataRequirements?.minBars ?? 120
  if (bars.length < minBars) {
    throw new Error(`insufficient data for custom strategy: got ${bars.length} bars, need ${minBars}`)
  }
  const indicatorValues = computeStrategyIndicators(spec, bars)
  const atrStopValues = hasExitType(spec.exit, 'atr_stop_loss') ? atrValues(bars, atrStopPeriod(spec.exit)) : []
  const trades: Array<Record<string, unknown>> = []
  const capital = 100_000
  let cash = capital
  let shares = 0
  let entryPrice = 0
  let entryDate = ''
  let entryIndex = -1
  let entryAtrStopDistance: number | null = null
  let highWaterPrice = 0
  let peakEquity = capital
  let maxDrawdown = 0
  const returns: number[] = []
  let entrySignalCount = 0
  let exitSignalCount = 0
  let stopExitCount = 0
  const commissionPct = (spec.cost?.commissionPct ?? 0.1) / 100
  const slippagePct = (spec.cost?.slippagePct ?? 0.05) / 100
  for (let i = 1; i < bars.length; i++) {
    const price = bars[i].close
    const entrySignal = evaluateRuleGroup(spec.entry, indicatorValues, i)
    if (shares === 0 && entrySignal) {
      entrySignalCount += 1
      const budget = entryBudget(cash, spec.positionSizing, returns)
      shares = Math.floor(budget / price / 100) * 100
      if (shares > 0) {
        entryPrice = price
        entryDate = bars[i].date
        entryIndex = i
        entryAtrStopDistance = atrStopDistance(spec.exit, atrStopValues, i)
        highWaterPrice = price
        cash -= shares * price * (1 + commissionPct + slippagePct)
      }
    } else if (shares > 0) {
      highWaterPrice = Math.max(highWaterPrice, price)
      const stop = stopExit(spec.exit, entryPrice, price, highWaterPrice, entryIndex >= 0 ? i - entryIndex : 0, entryAtrStopDistance)
      const exitSignal = evaluateRuleGroup(spec.exit, indicatorValues, i)
      if (stop || exitSignal) {
        if (stop) stopExitCount += 1
        else exitSignalCount += 1
        const proceeds = shares * price * (1 - commissionPct - slippagePct)
        cash += proceeds
        const returnPct = (price - entryPrice) / entryPrice
        returns.push(returnPct)
        trades.push({
          entryDate,
          entryPrice,
          exitDate: bars[i].date,
          exitPrice: price,
          shares,
          returnPct: round(returnPct * 100),
          reason: stop ?? 'rule_exit',
        })
        shares = 0
        entryIndex = -1
        entryAtrStopDistance = null
        highWaterPrice = 0
      }
    }
    const equity = cash + shares * price
    peakEquity = Math.max(peakEquity, equity)
    maxDrawdown = Math.max(maxDrawdown, peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0)
  }

  const finalEquity = cash + shares * bars[bars.length - 1].close
  const totalReturn = (finalEquity - capital) / capital
  const wins = returns.filter((value) => value > 0).length
  const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0
  const std = returns.length > 1 ? Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1)) : 0
  const assumptions = { commissionPct: spec.cost?.commissionPct ?? 0.1, slippagePct: spec.cost?.slippagePct ?? 0.05, positionSizing: spec.positionSizing ?? { type: 'full_capital' } }
  const riskRewardEvidence = riskRewardEvidenceFor(returns)
  const metrics = {
    totalReturnPct: round(totalReturn * 100),
    maxDrawdownPct: round(maxDrawdown * 100),
    winRatePct: returns.length ? round((wins / returns.length) * 100) : 0,
    sharpeRatio: std > 0 ? round((mean / std) * Math.sqrt(252)) : 0,
    tradeCount: trades.length,
    profitFactor: riskRewardEvidence['profitFactor'],
    payoffRatio: riskRewardEvidence['payoffRatio'],
    expectancyPct: riskRewardEvidence['expectancyPct'],
  }
  const benchmarkEvidence = benchmarkEvidenceFor(bars, Number(metrics.totalReturnPct ?? 0))
  const signals = {
    entrySignalCount,
    exitSignalCount,
    stopExitCount,
    completedTradeCount: trades.length,
    openPosition: shares > 0,
    openPositionShares: shares,
    noSignalReason: noSignalReason({
      entrySignalCount,
      exitSignalCount,
      stopExitCount,
      tradeCount: trades.length,
      openPosition: shares > 0,
    }),
  }
  return {
    action: 'custom_strategy_backtest',
    code,
    strategyId: validation.strategyId,
    version: validation.version,
    status: 'backtested',
    actualStartDate: bars[0]?.date,
    actualEndDate: bars[bars.length - 1]?.date,
    bars: bars.length,
    validationSummary: validation.validationSummary,
    validationIssues: validation.validationIssues ?? [],
    unsupportedDetails: validation.unsupportedDetails ?? [],
    dataRequirements: validation.dataRequirements,
    assumptions,
    validation,
    metrics,
    benchmarkEvidence,
    signals,
    lifecycleAdvice: backtestLifecycleAdvice(metrics, signals),
    riskEvidence: riskEvidence(metrics, signals, riskRewardEvidence, assumptions),
    riskRewardEvidence,
    recentTrades: trades.slice(-5),
  }
}

function backtestLifecycleAdvice(
  metrics: Record<string, unknown>,
  signals: Record<string, unknown>,
): Record<string, unknown> {
  const tradeCount = Number(metrics.tradeCount ?? 0)
  return {
    status: 'saveable_backtest_evidence',
    saveable: true,
    runnableAfterSave: true,
    evidenceStatus: 'backtested',
    nextActions: ['custom_strategy_save', 'custom_strategy_run'],
    zeroTradeStillSaveable: tradeCount === 0,
    boundary: tradeCount === 0
      ? 'Zero completed trades is a backtest result, not a validation failure. Save/rerun is valid when the user requested lifecycle verification; report zero trades as an evidence boundary.'
      : 'Backtested evidence can be saved and rerun by strategyId when the user requested lifecycle verification.',
    signals,
  }
}

function benchmarkEvidenceFor(bars: KlineBar[], strategyReturnPct: number): Record<string, unknown> {
  const startPrice = Number(bars[0]?.close ?? 0)
  const endPrice = Number(bars[bars.length - 1]?.close ?? 0)
  const benchmarkReturnPct = startPrice > 0 ? round(((endPrice - startPrice) / startPrice) * 100) : 0
  return {
    mode: 'buy_and_hold_close_to_close',
    startDate: bars[0]?.date,
    endDate: bars[bars.length - 1]?.date,
    startPrice: round(startPrice),
    endPrice: round(endPrice),
    benchmarkReturnPct,
    strategyReturnPct,
    excessReturnPct: round(strategyReturnPct - benchmarkReturnPct),
    assumption: 'Benchmark uses first/last close over the same data window; it is reference evidence, not an investable execution simulation.',
  }
}

function riskEvidence(
  metrics: Record<string, unknown>,
  signals: Record<string, unknown>,
  riskRewardEvidence: Record<string, unknown>,
  assumptions: Record<string, unknown>,
): Record<string, unknown> {
  const maxDrawdownPct = Number(metrics.maxDrawdownPct ?? 0)
  const tradeCount = Number(metrics.tradeCount ?? 0)
  const stopExitCount = Number(signals.stopExitCount ?? 0)
  const openPosition = signals.openPosition === true
  return {
    status: 'evaluated',
    maxDrawdownPct: metrics.maxDrawdownPct,
    riskLevel: riskLevel(maxDrawdownPct),
    tradeCount,
    stopExitCount,
    openPosition,
    noSignalReason: signals.noSignalReason ?? null,
    feesAndSlippage: {
      commissionPct: assumptions.commissionPct,
      slippagePct: assumptions.slippagePct,
      applied: true,
    },
    positionSizing: assumptions.positionSizing,
    riskRewardEvidence,
    warnings: [
      ...(tradeCount === 0 ? ['no completed trades; do not infer strategy profitability'] : []),
      ...(tradeCount > 0 && riskRewardEvidence['payoffRatio'] == null
        ? ['no losing trades in this window; payoff ratio is undefined and should not be treated as guaranteed risk/reward']
        : []),
      ...(tradeCount > 0 && Number(riskRewardEvidence['expectancyPct'] ?? 0) <= 0
        ? ['average trade expectancy is non-positive in this backtest window']
        : []),
      ...(openPosition ? ['backtest ended with an open position; final risk is mark-to-market only'] : []),
      ...(maxDrawdownPct >= 20 ? ['historical drawdown is high; require stronger risk controls before trade preparation'] : []),
    ],
    tradeBoundary: 'Risk evidence is backtest-only. Trade sizing or simulated orders require explicit user confirmation and post-action readback.',
  }
}

function riskLevel(maxDrawdownPct: number): 'low' | 'medium' | 'high' {
  if (maxDrawdownPct >= 20) return 'high'
  if (maxDrawdownPct >= 10) return 'medium'
  return 'low'
}

function riskRewardEvidenceFor(returns: number[]): Record<string, unknown> {
  const wins = returns.filter((value) => value > 0)
  const losses = returns.filter((value) => value < 0)
  const grossWin = wins.reduce((sum, value) => sum + value, 0)
  const grossLoss = losses.reduce((sum, value) => sum + Math.abs(value), 0)
  const avgWin = wins.length ? grossWin / wins.length : null
  const avgLoss = losses.length ? grossLoss / losses.length : null
  const expectancy = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0
  return {
    status: returns.length ? 'evaluated' : 'no_completed_trades',
    tradeCount: returns.length,
    winningTradeCount: wins.length,
    losingTradeCount: losses.length,
    grossWinPct: round(grossWin * 100),
    grossLossPct: round(grossLoss * 100),
    averageWinPct: avgWin == null ? null : round(avgWin * 100),
    averageLossPct: avgLoss == null ? null : round(avgLoss * 100),
    payoffRatio: avgWin != null && avgLoss != null && avgLoss > 0 ? round(avgWin / avgLoss) : null,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : null,
    expectancyPct: round(expectancy * 100),
    bestTradePct: returns.length ? round(Math.max(...returns) * 100) : null,
    worstTradePct: returns.length ? round(Math.min(...returns) * 100) : null,
    interpretation:
      'Risk/reward evidence is computed from completed backtest trades only; it excludes open-position future outcomes and is not a trade guarantee.',
  }
}

function outOfSampleEvidence(
  validation: StrategyValidation,
  spec: StrategySpec,
  bars: KlineBar[],
  code: string,
  ratio: number,
): Record<string, unknown> {
  const effectiveRatio = Math.max(0.1, Math.min(ratio, 0.5))
  const splitIndex = Math.floor(bars.length * (1 - effectiveRatio))
  const minBars = spec.dataRequirements?.minBars ?? 120
  const minHoldoutBars = minBars
  if (splitIndex < minBars || bars.length - splitIndex < minHoldoutBars) {
    return {
      mode: 'chronological_holdout',
      status: 'skipped',
      requestedRatio: round(ratio),
      effectiveRatio: round(effectiveRatio),
      bars: bars.length,
      minTrainBars: minBars,
      minHoldoutBars,
      warning: 'insufficient bars for chronological out-of-sample validation; keep the single-window backtest as in-sample evidence only',
    }
  }
  const train = runValidatedStrategySpecBacktestCore(validation, spec, bars.slice(0, splitIndex), code)
  const test = runValidatedStrategySpecBacktestCore(validation, spec, bars.slice(splitIndex), code)
  return {
    mode: 'chronological_holdout',
    status: 'evaluated',
    requestedRatio: round(ratio),
    effectiveRatio: round(effectiveRatio),
    train: sliceSummary(train),
    test: sliceSummary(test),
    warning: 'out-of-sample evidence reuses the same StrategySpec on a later chronological holdout; it is not a guarantee of future performance',
  }
}

function walkForwardEvidence(
  validation: StrategyValidation,
  spec: StrategySpec,
  bars: KlineBar[],
  code: string,
  requestedFolds: number,
): Record<string, unknown> {
  const effectiveFolds = Math.max(2, Math.min(Math.floor(requestedFolds), 8))
  const minBars = spec.dataRequirements?.minBars ?? 120
  const foldSize = Math.floor(bars.length / effectiveFolds)
  if (foldSize < minBars) {
    return {
      mode: 'chronological_walk_forward',
      status: 'skipped',
      requestedFolds,
      effectiveFolds,
      bars: bars.length,
      minBarsPerFold: minBars,
      warning: 'insufficient bars for walk-forward evidence; each chronological fold must satisfy the StrategySpec minBars requirement',
    }
  }

  const folds: Array<Record<string, unknown>> = Array.from({ length: effectiveFolds }, (_, index) => {
    const start = index * foldSize
    const end = index === effectiveFolds - 1 ? bars.length : start + foldSize
    const result = runValidatedStrategySpecBacktestCore(validation, spec, bars.slice(start, end), code)
    return { fold: index + 1, ...sliceSummary(result) }
  })
  const returns = folds.map((fold) => Number((fold.metrics as Record<string, unknown>)?.totalReturnPct ?? 0))
  const drawdowns = folds.map((fold) => Number((fold.metrics as Record<string, unknown>)?.maxDrawdownPct ?? 0))
  const tradeCounts = folds.map((fold) => Number((fold.metrics as Record<string, unknown>)?.tradeCount ?? 0))
  const averageReturn = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.length <= 1
    ? 0
    : returns.reduce((sum, value) => sum + (value - averageReturn) ** 2, 0) / (returns.length - 1)

  return {
    mode: 'chronological_walk_forward',
    status: 'evaluated',
    requestedFolds,
    effectiveFolds,
    folds,
    stability: {
      positiveReturnFoldCount: returns.filter((value) => value > 0).length,
      averageReturnPct: round(averageReturn),
      returnStdDevPct: round(Math.sqrt(variance)),
      worstFoldDrawdownPct: round(Math.max(...drawdowns)),
      completedTradeCount: tradeCounts.reduce((a, b) => a + b, 0),
    },
    warning: 'walk-forward evidence reruns the same StrategySpec on sequential historical folds; it checks stability, not future profitability',
  }
}

function sliceSummary(result: Record<string, unknown>): Record<string, unknown> {
  return {
    actualStartDate: result.actualStartDate,
    actualEndDate: result.actualEndDate,
    bars: result.bars,
    metrics: result.metrics,
    signals: result.signals,
  }
}

function evaluateRuleGroup(group: RuleGroup | undefined, values: Record<string, Array<number | null>>, index: number): boolean {
  if (!group) return false
  const rules = (group.all ?? group.any ?? []).filter((rule) => !('type' in rule))
  const checks = rules.map((rule) => evaluateRule(rule as Extract<Rule, { left: string }>, values, index))
  return group.any ? checks.some(Boolean) : checks.length > 0 && checks.every(Boolean)
}

function evaluateRule(rule: Extract<Rule, { left: string }>, values: Record<string, Array<number | null>>, index: number): boolean {
  const left = valueOf(rule.left, values, index)
  const right = resolveRight(rule.right, values, index)
  if (left == null || right == null) return false
  const prevLeft = valueOf(rule.left, values, index - 1)
  const prevRight = resolveRight(rule.right, values, index - 1)
  switch (rule.op) {
    case '>': return left > right
    case '>=': return left >= right
    case '<': return left < right
    case '<=': return left <= right
    case '==': return left === right
    case '!=': return left !== right
    case 'crosses_above': return prevLeft != null && prevRight != null && prevLeft <= prevRight && left > right
    case 'crosses_below': return prevLeft != null && prevRight != null && prevLeft >= prevRight && left < right
    default: return false
  }
}

function valueOf(key: string, values: Record<string, Array<number | null>>, index: number): number | null {
  return values[key]?.[index] ?? null
}

function resolveRight(raw: unknown, values: Record<string, Array<number | null>>, index: number): number | null {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') return valueOf(raw, values, index)
  if (raw && typeof raw === 'object' && 'mul' in raw) {
    const [left, right] = (raw as { mul: unknown[] }).mul
    const lv = typeof left === 'string' ? valueOf(left, values, index) : Number(left)
    const rv = typeof right === 'string' ? valueOf(right, values, index) : Number(right)
    if (lv == null || rv == null || !Number.isFinite(rv)) return null
    return lv * rv
  }
  return null
}

function stopExit(group: RuleGroup | undefined, entryPrice: number, price: number, highWaterPrice: number, barsSinceEntry: number, entryAtrStopDistance: number | null): string | null {
  for (const rule of [...(group?.all ?? []), ...(group?.any ?? [])]) {
    if (!('type' in rule)) continue
    if (rule.type === 'stop_loss_pct' && price <= entryPrice * (1 - rule.value / 100)) return 'stop_loss_pct'
    if (rule.type === 'take_profit_pct' && price >= entryPrice * (1 + rule.value / 100)) return 'take_profit_pct'
    if (rule.type === 'trailing_stop_pct' && highWaterPrice > 0 && price <= highWaterPrice * (1 - rule.value / 100)) return 'trailing_stop_pct'
    if (rule.type === 'max_drawdown_stop_pct' && highWaterPrice > 0 && price <= highWaterPrice * (1 - rule.value / 100)) return 'max_drawdown_stop_pct'
    if (rule.type === 'atr_stop_loss' && entryAtrStopDistance != null && price <= entryPrice - entryAtrStopDistance) return 'atr_stop_loss'
    if (rule.type === 'time_stop_bars' && barsSinceEntry >= Math.ceil(rule.value)) return 'time_stop_bars'
  }
  return null
}

function hasExitType(group: RuleGroup | undefined, type: string): boolean {
  return [...(group?.all ?? []), ...(group?.any ?? [])].some((rule) => 'type' in rule && rule.type === type)
}

function atrStopPeriod(group: RuleGroup | undefined): number {
  for (const rule of [...(group?.all ?? []), ...(group?.any ?? [])]) {
    if (!('type' in rule) || rule.type !== 'atr_stop_loss') continue
    const period = Number(rule.period ?? 14)
    if (Number.isFinite(period) && period >= 1) return Math.round(period)
  }
  return 14
}

function atrStopDistance(group: RuleGroup | undefined, values: Array<number | null>, index: number): number | null {
  const atr = values[index]
  if (atr == null || atr <= 0) return null
  for (const rule of [...(group?.all ?? []), ...(group?.any ?? [])]) {
    if (!('type' in rule) || rule.type !== 'atr_stop_loss') continue
    const multiplier = Number(rule.value)
    if (!Number.isFinite(multiplier) || multiplier <= 0) continue
    return atr * multiplier
  }
  return null
}

function atrValues(bars: KlineBar[], period: number): Array<number | null> {
  const trueRanges = bars.map((bar, index) => {
    if (index === 0) return bar.high - bar.low
    const previousClose = bars[index - 1].close
    return Math.max(
      bar.high - bar.low,
      Math.max(Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose)),
    )
  })
  return trueRanges.map((_, index) => {
    if (index + 1 < period) return null
    const window = trueRanges.slice(index + 1 - period, index + 1)
    return window.reduce((sum, value) => sum + value, 0) / period
  })
}

function noSignalReason(input: {
  entrySignalCount: number
  exitSignalCount: number
  stopExitCount: number
  tradeCount: number
  openPosition: boolean
}): string | null {
  if (input.tradeCount > 0) return null
  if (input.entrySignalCount === 0) return 'entry rules never triggered in the tested data window'
  if (input.openPosition) return 'entry triggered but no exit or stop condition completed before the end of the tested data window'
  if (input.exitSignalCount === 0 && input.stopExitCount === 0) {
    return 'entry rules triggered but no completed trade was produced by the executable exit rules'
  }
  return 'no completed trade was produced in the tested data window'
}

function round(value: number): number {
  return Number(value.toFixed(4))
}

function entryBudget(cash: number, sizing: StrategySpec['positionSizing'] | undefined, completedReturns: number[]): number {
  if (sizing?.type === 'fixed_fraction') {
    return cash * Math.max(0.01, Math.min(sizing.value ?? 0.1, 1))
  }
  if (sizing?.type === 'risk_per_trade') {
    const riskPct = sizing.riskPct ?? 0.01
    const stopLossPct = sizing.stopLossPct ?? 8
    const maxPositionPct = sizing.maxPositionPct ?? 1
    const riskBudget = cash * riskPct
    const positionBudget = stopLossPct > 0 ? riskBudget / (stopLossPct / 100) : cash
    return Math.min(cash * maxPositionPct, positionBudget)
  }
  if (sizing?.type === 'kelly_fraction') {
    const initialFraction = Math.max(0.01, Math.min(sizing.initialFraction ?? 0.1, 1))
    const maxPositionPct = Math.max(0.01, Math.min(sizing.maxPositionPct ?? 0.25, 1))
    const minTrades = Math.max(1, Math.round(sizing.minTrades ?? 5))
    const kellyScale = Math.max(0.01, Math.min(sizing.kellyScale ?? 0.5, 1))
    if (completedReturns.length < minTrades) return cash * Math.min(initialFraction, maxPositionPct)
    const fraction = kellyFraction(completedReturns) * kellyScale
    return cash * Math.min(Math.max(0, fraction), maxPositionPct)
  }
  return cash
}

function kellyFraction(returns: number[]): number {
  const wins = returns.filter((value) => value > 0)
  const losses = returns.filter((value) => value < 0)
  if (!wins.length || !losses.length) return 0
  const winRate = wins.length / returns.length
  const lossRate = 1 - winRate
  const avgWin = wins.reduce((sum, value) => sum + value, 0) / wins.length
  const avgLoss = losses.reduce((sum, value) => sum + Math.abs(value), 0) / losses.length
  if (avgLoss <= 0) return 0
  const payoffRatio = avgWin / avgLoss
  if (payoffRatio <= 0) return 0
  return winRate - lossRate / payoffRatio
}
