import * as ind from '../data/indicators'

export function lastValue(r: ind.IndicatorResult): number | null {
  for (let i = r.values.length - 1; i >= 0; i--) {
    if (r.values[i].value != null) return r.values[i].value
  }
  return null
}

export function fmtN(v: number | null): string {
  return v != null ? v.toFixed(2) : '-'
}

export function fmtLast(r: ind.IndicatorResult): string {
  return `${r.name}: ${fmtN(lastValue(r))}`
}

export function computeHurst(series: number[]): number {
  const n = series.length
  const returns: number[] = []
  for (let i = 1; i < n; i++) returns.push(Math.log(series[i] / series[i - 1]))

  const sizes = [8, 16, 32, 64].filter((s) => s < returns.length / 2)
  if (sizes.length < 2) return 0.5

  const logRS: number[] = []
  const logN: number[] = []

  for (const size of sizes) {
    const chunks = Math.floor(returns.length / size)
    let rsSum = 0
    for (let c = 0; c < chunks; c++) {
      const chunk = returns.slice(c * size, (c + 1) * size)
      const mean = chunk.reduce((a, b) => a + b, 0) / chunk.length
      const cumDev: number[] = []
      let sum = 0
      for (const r of chunk) { sum += r - mean; cumDev.push(sum) }
      const range = Math.max(...cumDev) - Math.min(...cumDev)
      const std = Math.sqrt(chunk.reduce((a, b) => a + (b - mean) ** 2, 0) / chunk.length)
      if (std > 0) rsSum += range / std
    }
    logRS.push(Math.log(rsSum / chunks))
    logN.push(Math.log(size))
  }

  const n2 = logN.length
  const sumX = logN.reduce((a, b) => a + b, 0)
  const sumY = logRS.reduce((a, b) => a + b, 0)
  const sumXY = logN.reduce((a, x, i) => a + x * logRS[i], 0)
  const sumX2 = logN.reduce((a, x) => a + x * x, 0)
  return (n2 * sumXY - sumX * sumY) / (n2 * sumX2 - sumX * sumX)
}

export const DP_HELP_TEXT = `DataProcess actions:

BASIC INDICATORS:
  indicators     — SMA/EMA/RSI/MACD/BOLL/KDJ/ATR. code, indicators[]
  trend          — Trend analysis with MA alignment and S/R
  stats          — Return statistics, volatility, Sharpe, max drawdown
  hurst          — Hurst exponent (trend vs mean-reversion regime)

ADVANCED:
  advanced       — VWAP, OBV, Williams %R
  ichimoku       — Ichimoku Cloud (tenkan/kijun/senkou/chikou)
  pivot          — Pivot points (Standard/Fibonacci)
  support        — Support and resistance levels
  support_summary— One-call support/resistance synthesis with pivots and indicators
  volume         — Volume analysis (ratio, trend, OBV, VWAP)

SIGNALS & SCORING:
  patterns       — Candlestick pattern recognition
  signals        — Multi-indicator buy/sell signals
  summary        — Comprehensive technical summary
  score          — Fundamental scoring (PE/PB/ROE/growth)
  score_technical— Technical scoring (0-100 grade A-D)
  breakout_summary — Batch breakout validation for a bounded comma-separated shortlist
  watch_signal_check — Evaluate structured watchlist signal rules from watchlist state + canonical data rows

SCREENING:
  screen         — Filter and sort stocks. code: "600519,000858,601318"
  optimize       — Portfolio optimization. code: "600519,000858", method: equalWeight/riskParity/momentum

AI TRACKING:
  ai_record      — Record a prediction. symbol, prediction(up/down/neutral), targetPrice, reasoning
  ai_validate    — Validate past predictions against actual prices

OTHER:
  calendar       — Trading day and market hours check
  help           — This help text`
