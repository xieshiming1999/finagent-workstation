import type { KlineBar } from './data-manager'

export interface IndicatorResult {
  name: string
  values: Array<{ date: string; value: number | null }>
}

export function sma(bars: KlineBar[], period: number): IndicatorResult {
  const values = bars.map((b, i) => {
    if (i < period - 1) return { date: b.date, value: null }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].close
    return { date: b.date, value: sum / period }
  })
  return { name: `SMA(${period})`, values }
}

export function ema(bars: KlineBar[], period: number): IndicatorResult {
  const k = 2 / (period + 1)
  const values: Array<{ date: string; value: number | null }> = []
  let prev: number | null = null
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) {
      values.push({ date: bars[i].date, value: null })
    } else if (prev === null) {
      let sum = 0
      for (let j = i - period + 1; j <= i; j++) sum += bars[j].close
      prev = sum / period
      values.push({ date: bars[i].date, value: prev })
    } else {
      prev = bars[i].close * k + prev * (1 - k)
      values.push({ date: bars[i].date, value: prev })
    }
  }
  return { name: `EMA(${period})`, values }
}

export function rsi(bars: KlineBar[], period = 14): IndicatorResult {
  const values: Array<{ date: string; value: number | null }> = []
  let avgGain = 0, avgLoss = 0
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) { values.push({ date: bars[i].date, value: null }); continue }
    const change = bars[i].close - bars[i - 1].close
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? -change : 0
    if (i < period) {
      avgGain += gain / period
      avgLoss += loss / period
      values.push({ date: bars[i].date, value: null })
    } else if (i === period) {
      avgGain += gain / period
      avgLoss += loss / period
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
      values.push({ date: bars[i].date, value: 100 - 100 / (1 + rs) })
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
      values.push({ date: bars[i].date, value: 100 - 100 / (1 + rs) })
    }
  }
  return { name: `RSI(${period})`, values }
}

export interface MACDResult {
  dif: IndicatorResult
  dea: IndicatorResult
  macd: IndicatorResult
}

export function macd(bars: KlineBar[], fast = 12, slow = 26, signal = 9): MACDResult {
  const emaFast = ema(bars, fast)
  const emaSlow = ema(bars, slow)
  const difValues: Array<{ date: string; value: number | null }> = []
  for (let i = 0; i < bars.length; i++) {
    const f = emaFast.values[i].value
    const s = emaSlow.values[i].value
    difValues.push({ date: bars[i].date, value: f != null && s != null ? f - s : null })
  }

  const k = 2 / (signal + 1)
  const deaValues: Array<{ date: string; value: number | null }> = []
  const macdValues: Array<{ date: string; value: number | null }> = []
  let prevDea: number | null = null

  for (let i = 0; i < bars.length; i++) {
    const dif = difValues[i].value
    if (dif == null) {
      deaValues.push({ date: bars[i].date, value: null })
      macdValues.push({ date: bars[i].date, value: null })
    } else if (prevDea == null) {
      prevDea = dif
      deaValues.push({ date: bars[i].date, value: prevDea })
      macdValues.push({ date: bars[i].date, value: (dif - prevDea) * 2 })
    } else {
      prevDea = dif * k + prevDea * (1 - k)
      deaValues.push({ date: bars[i].date, value: prevDea })
      macdValues.push({ date: bars[i].date, value: (dif - prevDea) * 2 })
    }
  }

  return {
    dif: { name: 'DIF', values: difValues },
    dea: { name: 'DEA', values: deaValues },
    macd: { name: 'MACD', values: macdValues },
  }
}

export interface BollResult {
  upper: IndicatorResult
  middle: IndicatorResult
  lower: IndicatorResult
}

export function boll(bars: KlineBar[], period = 20, multiplier = 2): BollResult {
  const mid = sma(bars, period)
  const upper: Array<{ date: string; value: number | null }> = []
  const lower: Array<{ date: string; value: number | null }> = []

  for (let i = 0; i < bars.length; i++) {
    const m = mid.values[i].value
    if (m == null || i < period - 1) {
      upper.push({ date: bars[i].date, value: null })
      lower.push({ date: bars[i].date, value: null })
    } else {
      let sumSq = 0
      for (let j = i - period + 1; j <= i; j++) {
        sumSq += (bars[j].close - m) ** 2
      }
      const std = Math.sqrt(sumSq / period)
      upper.push({ date: bars[i].date, value: m + multiplier * std })
      lower.push({ date: bars[i].date, value: m - multiplier * std })
    }
  }

  return {
    upper: { name: `BOLL_UP(${period})`, values: upper },
    middle: mid,
    lower: { name: `BOLL_DN(${period})`, values: lower },
  }
}

export interface KDJResult {
  k: IndicatorResult
  d: IndicatorResult
  j: IndicatorResult
}

export function kdj(bars: KlineBar[], n = 9, m1 = 3, m2 = 3): KDJResult {
  const kVals: Array<{ date: string; value: number | null }> = []
  const dVals: Array<{ date: string; value: number | null }> = []
  const jVals: Array<{ date: string; value: number | null }> = []
  let prevK = 50, prevD = 50

  for (let i = 0; i < bars.length; i++) {
    if (i < n - 1) {
      kVals.push({ date: bars[i].date, value: null })
      dVals.push({ date: bars[i].date, value: null })
      jVals.push({ date: bars[i].date, value: null })
      continue
    }
    let high = -Infinity, low = Infinity
    for (let j = i - n + 1; j <= i; j++) {
      if (bars[j].high > high) high = bars[j].high
      if (bars[j].low < low) low = bars[j].low
    }
    const rsv = high === low ? 50 : ((bars[i].close - low) / (high - low)) * 100
    const k = (2 / m1) * rsv + ((m1 - 2) / m1) * prevK
    const d = (2 / m2) * k + ((m2 - 2) / m2) * prevD
    const j = 3 * k - 2 * d
    prevK = k
    prevD = d
    kVals.push({ date: bars[i].date, value: k })
    dVals.push({ date: bars[i].date, value: d })
    jVals.push({ date: bars[i].date, value: j })
  }

  return {
    k: { name: 'K', values: kVals },
    d: { name: 'D', values: dVals },
    j: { name: 'J', values: jVals },
  }
}

export function atr(bars: KlineBar[], period = 14): IndicatorResult {
  const trValues: number[] = []
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      trValues.push(bars[i].high - bars[i].low)
    } else {
      const tr = Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1].close),
        Math.abs(bars[i].low - bars[i - 1].close),
      )
      trValues.push(tr)
    }
  }

  const values: Array<{ date: string; value: number | null }> = []
  let atrVal: number | null = null
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) {
      values.push({ date: bars[i].date, value: null })
    } else if (atrVal === null) {
      let sum = 0
      for (let j = i - period + 1; j <= i; j++) sum += trValues[j]
      atrVal = sum / period
      values.push({ date: bars[i].date, value: atrVal })
    } else {
      atrVal = (atrVal * (period - 1) + trValues[i]) / period
      values.push({ date: bars[i].date, value: atrVal })
    }
  }
  return { name: `ATR(${period})`, values }
}
