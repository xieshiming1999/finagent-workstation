import type { KlineBar } from './data-manager'

export interface PortfolioWeight {
  code: string
  weight: number
}

export interface OptimizeResult {
  method: string
  weights: PortfolioWeight[]
  metrics: {
    expectedReturn: number
    volatility: number
    sharpe: number
  }
}

export function equalWeight(codes: string[]): OptimizeResult {
  const w = 1 / codes.length
  return {
    method: 'equal_weight',
    weights: codes.map((c) => ({ code: c, weight: w })),
    metrics: { expectedReturn: 0, volatility: 0, sharpe: 0 },
  }
}

export function riskParity(barsMap: Map<string, KlineBar[]>, maxWeight = 0.3): OptimizeResult {
  const vols: Map<string, number> = new Map()
  for (const [code, bars] of barsMap) {
    const returns: number[] = []
    for (let i = 1; i < bars.length; i++) {
      returns.push((bars[i].close - bars[i - 1].close) / bars[i - 1].close)
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length
    vols.set(code, Math.sqrt(variance))
  }

  const totalInvVol = Array.from(vols.values()).reduce((s, v) => s + (v > 0 ? 1 / v : 0), 0)
  const weights: PortfolioWeight[] = []
  for (const [code, vol] of vols) {
    let w = vol > 0 && totalInvVol > 0 ? (1 / vol) / totalInvVol : 1 / vols.size
    w = Math.min(w, maxWeight)
    weights.push({ code, weight: w })
  }

  const sum = weights.reduce((s, w) => s + w.weight, 0)
  weights.forEach((w) => (w.weight /= sum))

  return {
    method: 'risk_parity',
    weights,
    metrics: { expectedReturn: 0, volatility: 0, sharpe: 0 },
  }
}

export function momentumWeight(barsMap: Map<string, KlineBar[]>, lookback = 60, maxWeight = 0.3): OptimizeResult {
  const returns: Map<string, number> = new Map()
  for (const [code, bars] of barsMap) {
    if (bars.length < lookback) {
      returns.set(code, 0)
      continue
    }
    const startPrice = bars[bars.length - lookback].close
    const endPrice = bars[bars.length - 1].close
    returns.set(code, (endPrice - startPrice) / startPrice)
  }

  const positiveReturns = Array.from(returns.entries()).filter(([, r]) => r > 0)
  if (positiveReturns.length === 0) return equalWeight(Array.from(barsMap.keys()))

  const totalReturn = positiveReturns.reduce((s, [, r]) => s + r, 0)
  const weights: PortfolioWeight[] = Array.from(returns.entries()).map(([code, r]) => ({
    code,
    weight: r > 0 ? Math.min((r / totalReturn), maxWeight) : 0,
  }))

  const sum = weights.reduce((s, w) => s + w.weight, 0)
  if (sum > 0) weights.forEach((w) => (w.weight /= sum))

  return {
    method: 'momentum',
    weights,
    metrics: { expectedReturn: 0, volatility: 0, sharpe: 0 },
  }
}
