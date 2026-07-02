import type { KlineBar } from './data-manager'

export interface Trade {
  date: string
  side: 'buy' | 'sell'
  price: number
  shares: number
  reason: string
}

export interface BacktestResult {
  strategy: string
  trades: Trade[]
  totalReturn: number
  annualizedReturn: number
  maxDrawdown: number
  winRate: number
  sharpeRatio: number
  tradeCount: number
  profitFactor: number
}

export type StrategyFn = (bars: KlineBar[], index: number, position: number) => 'buy' | 'sell' | 'hold'

export function runBacktest(bars: KlineBar[], strategy: StrategyFn, strategyName: string, capital = 100_000): BacktestResult {
  const trades: Trade[] = []
  let position = 0
  let entryPrice = 0
  let cash = capital
  let shares = 0
  let peakEquity = capital
  let maxDrawdown = 0
  const returns: number[] = []

  for (let i = 1; i < bars.length; i++) {
    const signal = strategy(bars, i, position)
    const price = bars[i].close

    if (signal === 'buy' && position === 0) {
      shares = Math.floor(cash / price / 100) * 100
      if (shares > 0) {
        entryPrice = price
        cash -= shares * price
        position = 1
        trades.push({ date: bars[i].date, side: 'buy', price, shares, reason: strategyName })
      }
    } else if (signal === 'sell' && position === 1) {
      cash += shares * price
      trades.push({ date: bars[i].date, side: 'sell', price, shares, reason: strategyName })
      returns.push((price - entryPrice) / entryPrice)
      position = 0
      shares = 0
    }

    const equity = cash + shares * price
    peakEquity = Math.max(peakEquity, equity)
    const dd = (peakEquity - equity) / peakEquity
    maxDrawdown = Math.max(maxDrawdown, dd)
  }

  const finalEquity = cash + shares * bars[bars.length - 1].close
  const totalReturn = (finalEquity - capital) / capital
  const days = bars.length
  const annualizedReturn = Math.pow(1 + totalReturn, 252 / days) - 1
  const wins = returns.filter((r) => r > 0)
  const losses = returns.filter((r) => r < 0)
  const winRate = returns.length > 0 ? wins.length / returns.length : 0
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 1
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 0
  const mean = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0
  const std = returns.length > 1 ? Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1)) : 1
  const sharpeRatio = std > 0 ? (mean / std) * Math.sqrt(252) : 0

  return {
    strategy: strategyName, trades, totalReturn, annualizedReturn,
    maxDrawdown, winRate, sharpeRatio, tradeCount: trades.length, profitFactor,
  }
}

// --- Built-in strategies ---

export function rsiStrategy(oversold = 30, overbought = 70, period = 14): StrategyFn {
  return (bars, index, position) => {
    if (index < period) return 'hold'
    let avgGain = 0, avgLoss = 0
    for (let i = index - period + 1; i <= index; i++) {
      const change = bars[i].close - bars[i - 1].close
      if (change > 0) avgGain += change / period
      else avgLoss -= change / period
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    const rsi = 100 - 100 / (1 + rs)
    if (rsi < oversold && position === 0) return 'buy'
    if (rsi > overbought && position === 1) return 'sell'
    return 'hold'
  }
}

export function macdStrategy(fast = 12, slow = 26): StrategyFn {
  const emaCalc = (bars: KlineBar[], period: number, end: number): number => {
    const k = 2 / (period + 1)
    let val = bars[end - period + 1].close
    for (let i = end - period + 2; i <= end; i++) {
      val = bars[i].close * k + val * (1 - k)
    }
    return val
  }

  return (bars, index, position) => {
    if (index < slow + 1) return 'hold'
    const difNow = emaCalc(bars, fast, index) - emaCalc(bars, slow, index)
    const difPrev = emaCalc(bars, fast, index - 1) - emaCalc(bars, slow, index - 1)
    if (difPrev < 0 && difNow > 0 && position === 0) return 'buy'
    if (difPrev > 0 && difNow < 0 && position === 1) return 'sell'
    return 'hold'
  }
}

export function bollStrategy(period = 20, mult = 2): StrategyFn {
  return (bars, index, position) => {
    if (index < period) return 'hold'
    let sum = 0
    for (let i = index - period + 1; i <= index; i++) sum += bars[i].close
    const mid = sum / period
    let sumSq = 0
    for (let i = index - period + 1; i <= index; i++) sumSq += (bars[i].close - mid) ** 2
    const std = Math.sqrt(sumSq / period)
    const lower = mid - mult * std
    const upper = mid + mult * std
    if (bars[index].close < lower && position === 0) return 'buy'
    if (bars[index].close > upper && position === 1) return 'sell'
    return 'hold'
  }
}

export function emaCrossStrategy(fast = 5, slow = 20): StrategyFn {
  const emaAt = (bars: KlineBar[], period: number, end: number): number => {
    if (end < period) return bars[end].close
    const k = 2 / (period + 1)
    let val = bars[end - period + 1].close
    for (let i = end - period + 2; i <= end; i++) val = bars[i].close * k + val * (1 - k)
    return val
  }

  return (bars, index, position) => {
    if (index < slow + 1) return 'hold'
    const fastNow = emaAt(bars, fast, index)
    const slowNow = emaAt(bars, slow, index)
    const fastPrev = emaAt(bars, fast, index - 1)
    const slowPrev = emaAt(bars, slow, index - 1)
    if (fastPrev < slowPrev && fastNow > slowNow && position === 0) return 'buy'
    if (fastPrev > slowPrev && fastNow < slowNow && position === 1) return 'sell'
    return 'hold'
  }
}

function smaAt(values: number[], period: number, end: number): number | null {
  if (period <= 0 || end + 1 < period) return null
  let sum = 0
  for (let i = end - period + 1; i <= end; i++) sum += values[i]
  return sum / period
}

function emaAt(values: number[], period: number, end: number): number | null {
  if (period <= 0 || end + 1 < period) return null
  const k = 2 / (period + 1)
  let value = values[end - period + 1]
  for (let i = end - period + 2; i <= end; i++) value = values[i] * k + value * (1 - k)
  return value
}

function highestAt(values: number[], period: number, end: number): number | null {
  if (period <= 0 || end + 1 < period) return null
  return Math.max(...values.slice(end + 1 - period, end + 1))
}

function lowestAt(values: number[], period: number, end: number): number | null {
  if (period <= 0 || end + 1 < period) return null
  return Math.min(...values.slice(end + 1 - period, end + 1))
}

function trueRange(bars: KlineBar[], index: number): number {
  if (index <= 0) return bars[index].high - bars[index].low
  return Math.max(
    bars[index].high - bars[index].low,
    Math.abs(bars[index].high - bars[index - 1].close),
    Math.abs(bars[index].low - bars[index - 1].close),
  )
}

function atrAt(bars: KlineBar[], period: number, end: number): number | null {
  if (period <= 0 || end + 1 < period) return null
  let sum = 0
  for (let i = end + 1 - period; i <= end; i++) sum += trueRange(bars, i)
  return sum / period
}

function rsiAt(bars: KlineBar[], period: number, end: number): number | null {
  if (period <= 0 || end < period) return null
  let gain = 0
  let loss = 0
  for (let i = end - period + 1; i <= end; i++) {
    const change = bars[i].close - bars[i - 1].close
    if (change >= 0) gain += change
    else loss -= change
  }
  const avgLoss = loss / period
  if (avgLoss === 0) return 100
  const rs = (gain / period) / avgLoss
  return 100 - 100 / (1 + rs)
}

function adxAt(bars: KlineBar[], period: number, end: number): number | null {
  if (period <= 0 || end < period + 1) return null
  let plusDm = 0
  let minusDm = 0
  let tr = 0
  for (let i = end - period + 1; i <= end; i++) {
    const upMove = bars[i].high - bars[i - 1].high
    const downMove = bars[i - 1].low - bars[i].low
    plusDm += upMove > downMove && upMove > 0 ? upMove : 0
    minusDm += downMove > upMove && downMove > 0 ? downMove : 0
    tr += trueRange(bars, i)
  }
  if (tr === 0) return null
  const plusDi = (plusDm / tr) * 100
  const minusDi = (minusDm / tr) * 100
  const total = plusDi + minusDi
  if (total === 0) return null
  return (Math.abs(plusDi - minusDi) / total) * 100
}

export function maGoldenCrossStrategy(shortPeriod = 5, longPeriod = 20): StrategyFn {
  return (bars, index, position) => {
    if (index < longPeriod) return 'hold'
    const closes = bars.map((bar) => bar.close)
    const shortNow = emaAt(closes, shortPeriod, index)
    const longNow = emaAt(closes, longPeriod, index)
    const shortPrev = emaAt(closes, shortPeriod, index - 1)
    const longPrev = emaAt(closes, longPeriod, index - 1)
    if (shortNow == null || longNow == null || shortPrev == null || longPrev == null) return 'hold'
    if (shortPrev <= longPrev && shortNow > longNow && position === 0) return 'buy'
    if (shortPrev >= longPrev && shortNow < longNow && position === 1) return 'sell'
    return 'hold'
  }
}

export function volumeBreakoutStrategy(lookback = 20, volMultiple = 1.5): StrategyFn {
  return (bars, index, position) => {
    if (index < lookback) return 'hold'
    const volumes = bars.map((bar) => bar.volume)
    const highs = bars.map((bar) => bar.high)
    const avgVol = smaAt(volumes, lookback, index - 1)
    const priorHigh = highestAt(highs, lookback, index - 1)
    if (avgVol == null || priorHigh == null) return 'hold'
    if (position === 0 && bars[index].volume > avgVol * volMultiple && bars[index].close > priorHigh) return 'buy'
    if (position === 1) {
      const stop = priorHigh * 0.95
      if (bars[index].close < stop) return 'sell'
    }
    return 'hold'
  }
}

export function donchianStrategy(lookback = 20): StrategyFn {
  return (bars, index, position) => {
    if (index < lookback) return 'hold'
    const highs = bars.map((bar) => bar.high)
    const lows = bars.map((bar) => bar.low)
    const upper = highestAt(highs, lookback, index - 1)
    const lower = lowestAt(lows, lookback, index - 1)
    if (upper == null || lower == null) return 'hold'
    if (position === 0 && bars[index].close > upper) return 'buy'
    if (position === 1 && bars[index].close < lower) return 'sell'
    return 'hold'
  }
}

export function turtleBreakoutStrategy(entryLookback = 55, exitLookback = 20): StrategyFn {
  return (bars, index, position) => {
    if (index < entryLookback) return 'hold'
    const highs = bars.map((bar) => bar.high)
    const lows = bars.map((bar) => bar.low)
    const entry = highestAt(highs, entryLookback, index - 1)
    const exit = lowestAt(lows, exitLookback, index - 1)
    if (entry == null || exit == null) return 'hold'
    if (position === 0 && bars[index].close > entry) return 'buy'
    if (position === 1 && bars[index].close < exit) return 'sell'
    return 'hold'
  }
}

export function dualThrustStrategy(days = 4, k1 = 0.5, k2 = 0.5): StrategyFn {
  return (bars, index, position) => {
    if (index < days) return 'hold'
    const window = bars.slice(index - days, index)
    const hh = Math.max(...window.map((bar) => bar.high))
    const hc = Math.max(...window.map((bar) => bar.close))
    const lc = Math.min(...window.map((bar) => bar.close))
    const ll = Math.min(...window.map((bar) => bar.low))
    const range = Math.max(hh - lc, hc - ll)
    const upper = bars[index].open + k1 * range
    const lower = bars[index].open - k2 * range
    if (position === 0 && bars[index].high >= upper) return 'buy'
    if (position === 1 && bars[index].low <= lower) return 'sell'
    return 'hold'
  }
}

export function meanReversionStrategy(period = 20, zScore = 1.5): StrategyFn {
  return (bars, index, position) => {
    if (index + 1 < period) return 'hold'
    const closes = bars.map((bar) => bar.close)
    const window = closes.slice(index + 1 - period, index + 1)
    const mean = window.reduce((a, b) => a + b, 0) / period
    const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period
    const std = Math.sqrt(variance)
    if (std === 0) return 'hold'
    const z = (bars[index].close - mean) / std
    if (position === 0 && z < -zScore) return 'buy'
    if (position === 1 && z > 0) return 'sell'
    return 'hold'
  }
}

export function adxEmergingStrategy(period = 14, threshold = 20): StrategyFn {
  return (bars, index, position) => {
    if (index < period + 1) return 'hold'
    const closes = bars.map((bar) => bar.close)
    const fast = emaAt(closes, 20, index)
    const slow = emaAt(closes, 50, index)
    const adx = adxAt(bars, period, index)
    if (fast == null || slow == null || adx == null) return 'hold'
    if (position === 0 && fast > slow && adx >= threshold) return 'buy'
    if (position === 1 && (fast < slow || adx < threshold * 0.8)) return 'sell'
    return 'hold'
  }
}

export function supertrendStrategy(period = 10, multiplier = 3): StrategyFn {
  return (bars, index, position) => {
    if (index < period) return 'hold'
    const atr = atrAt(bars, period, index)
    if (atr == null) return 'hold'
    const hl2 = (bars[index].high + bars[index].low) / 2
    const upper = hl2 + multiplier * atr
    const lower = hl2 - multiplier * atr
    if (position === 0 && bars[index].close > upper) return 'buy'
    if (position === 1 && bars[index].close < lower) return 'sell'
    return 'hold'
  }
}

export function kdjStrategy(period = 9): StrategyFn {
  return (bars, index, position) => {
    if (index + 1 < period) return 'hold'
    const window = bars.slice(index + 1 - period, index + 1)
    const high = Math.max(...window.map((bar) => bar.high))
    const low = Math.min(...window.map((bar) => bar.low))
    if (high === low) return 'hold'
    const rsv = ((bars[index].close - low) / (high - low)) * 100
    const prevWindow = bars.slice(index - period, index)
    if (prevWindow.length < period) return 'hold'
    const prevHigh = Math.max(...prevWindow.map((bar) => bar.high))
    const prevLow = Math.min(...prevWindow.map((bar) => bar.low))
    const prevRsv = prevHigh === prevLow ? 50 : ((bars[index - 1].close - prevLow) / (prevHigh - prevLow)) * 100
    if (position === 0 && prevRsv < 20 && rsv >= 20) return 'buy'
    if (position === 1 && prevRsv > 80 && rsv <= 80) return 'sell'
    return 'hold'
  }
}

export const BUILTIN_STRATEGIES: Record<string, StrategyFn> = {
  'rsi': rsiStrategy(),
  'macd': macdStrategy(),
  'bollinger': bollStrategy(),
  'ema_cross': emaCrossStrategy(),
  'supertrend': supertrendStrategy(),
  'donchian': donchianStrategy(),
  'kdj': kdjStrategy(),
  'ma_golden_cross': maGoldenCrossStrategy(),
  'volume_breakout': volumeBreakoutStrategy(),
  'dual_thrust': dualThrustStrategy(),
  'adx_emerging': adxEmergingStrategy(),
  'mean_reversion': meanReversionStrategy(),
  'turtle_breakout': turtleBreakoutStrategy(),
  'rsi_conservative': rsiStrategy(25, 75),
  'boll_tight': bollStrategy(20, 1.5),
}

export function formatBacktestResult(r: BacktestResult): string {
  return [
    `Strategy: ${r.strategy}`,
    `Total Return: ${(r.totalReturn * 100).toFixed(2)}%`,
    `Annualized Return: ${(r.annualizedReturn * 100).toFixed(2)}%`,
    `Max Drawdown: ${(r.maxDrawdown * 100).toFixed(2)}%`,
    `Sharpe Ratio: ${r.sharpeRatio.toFixed(2)}`,
    `Win Rate: ${(r.winRate * 100).toFixed(1)}%`,
    `Profit Factor: ${r.profitFactor.toFixed(2)}`,
    `Trades: ${r.tradeCount}`,
  ].join('\n')
}
