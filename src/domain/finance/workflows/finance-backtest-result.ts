export interface StrategyBacktestMetrics {
  totalReturnPct: number
  maxDrawdownPct: number
  sharpeRatio: number
  winRatePct: number
  tradeCount: number
}

export interface StrategyBacktestResult {
  code: string
  strategy: string
  metrics: StrategyBacktestMetrics
}

export function parseStrategyBacktestResult(value: string): StrategyBacktestResult | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.contract !== 'strategy-backtest-result-v1' || parsed.action !== 'backtest') {
    return null
  }
  if (typeof parsed.code !== 'string' || typeof parsed.strategy !== 'string' || !isRecord(parsed.metrics)) {
    return null
  }
  const totalReturnPct = finiteNumber(parsed.metrics.totalReturnPct)
  const maxDrawdownPct = finiteNumber(parsed.metrics.maxDrawdownPct)
  const sharpeRatio = finiteNumber(parsed.metrics.sharpeRatio)
  const winRatePct = finiteNumber(parsed.metrics.winRatePct)
  const tradeCount = finiteNumber(parsed.metrics.tradeCount)
  if ([totalReturnPct, maxDrawdownPct, sharpeRatio, winRatePct, tradeCount].some((metric) => metric == null)) {
    return null
  }
  return {
    code: parsed.code,
    strategy: parsed.strategy,
    metrics: {
      totalReturnPct: totalReturnPct!,
      maxDrawdownPct: maxDrawdownPct!,
      sharpeRatio: sharpeRatio!,
      winRatePct: winRatePct!,
      tradeCount: tradeCount!,
    },
  }
}

export function summarizeStrategyBacktestResult(value: string): string | null {
  const parsed = parseStrategyBacktestResult(value)
  if (!parsed) return null
  return [
    `Strategy: ${parsed.strategy}`,
    `Total Return: ${parsed.metrics.totalReturnPct}`,
    `Max Drawdown: ${parsed.metrics.maxDrawdownPct}`,
    `Sharpe Ratio: ${parsed.metrics.sharpeRatio}`,
    `Trades: ${parsed.metrics.tradeCount}`,
  ].join('; ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
