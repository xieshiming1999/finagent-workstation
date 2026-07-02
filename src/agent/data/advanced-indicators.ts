import type { KlineBar } from './data-manager'
import type { IndicatorResult } from './indicators'

export interface IchimokuResult {
  tenkan: IndicatorResult
  kijun: IndicatorResult
  senkouA: IndicatorResult
  senkouB: IndicatorResult
  chikou: IndicatorResult
}

export function ichimoku(bars: KlineBar[], tenkanPeriod = 9, kijunPeriod = 26, senkouBPeriod = 52): IchimokuResult {
  const highLow = (start: number, period: number): number | null => {
    if (start < period - 1) return null
    let high = -Infinity, low = Infinity
    for (let i = start - period + 1; i <= start; i++) {
      if (bars[i].high > high) high = bars[i].high
      if (bars[i].low < low) low = bars[i].low
    }
    return (high + low) / 2
  }

  const tenkan: IndicatorResult = { name: 'Tenkan-sen', values: bars.map((b, i) => ({ date: b.date, value: highLow(i, tenkanPeriod) })) }
  const kijun: IndicatorResult = { name: 'Kijun-sen', values: bars.map((b, i) => ({ date: b.date, value: highLow(i, kijunPeriod) })) }

  const senkouA: IndicatorResult = { name: 'Senkou A', values: bars.map((b, i) => {
    const t = tenkan.values[i].value
    const k = kijun.values[i].value
    return { date: b.date, value: t != null && k != null ? (t + k) / 2 : null }
  })}

  const senkouB: IndicatorResult = { name: 'Senkou B', values: bars.map((b, i) => ({ date: b.date, value: highLow(i, senkouBPeriod) })) }

  const chikou: IndicatorResult = { name: 'Chikou', values: bars.map((b, i) => ({
    date: b.date, value: i + kijunPeriod < bars.length ? bars[i + kijunPeriod].close : null,
  }))}

  return { tenkan, kijun, senkouA, senkouB, chikou }
}

export interface PivotPoints {
  pivot: number
  r1: number; r2: number; r3: number
  s1: number; s2: number; s3: number
}

export function pivotPoints(bars: KlineBar[]): PivotPoints | null {
  if (bars.length < 2) return null
  const prev = bars[bars.length - 2]
  const pivot = (prev.high + prev.low + prev.close) / 3
  return {
    pivot,
    r1: 2 * pivot - prev.low,
    r2: pivot + (prev.high - prev.low),
    r3: prev.high + 2 * (pivot - prev.low),
    s1: 2 * pivot - prev.high,
    s2: pivot - (prev.high - prev.low),
    s3: prev.low - 2 * (prev.high - pivot),
  }
}

export function vwap(bars: KlineBar[]): IndicatorResult {
  let cumVolPrice = 0, cumVol = 0
  return {
    name: 'VWAP',
    values: bars.map((b) => {
      const typical = (b.high + b.low + b.close) / 3
      cumVolPrice += typical * b.volume
      cumVol += b.volume
      return { date: b.date, value: cumVol > 0 ? cumVolPrice / cumVol : null }
    }),
  }
}

export function obv(bars: KlineBar[]): IndicatorResult {
  let obvVal = 0
  return {
    name: 'OBV',
    values: bars.map((b, i) => {
      if (i === 0) return { date: b.date, value: 0 }
      if (b.close > bars[i - 1].close) obvVal += b.volume
      else if (b.close < bars[i - 1].close) obvVal -= b.volume
      return { date: b.date, value: obvVal }
    }),
  }
}

export function williamsR(bars: KlineBar[], period = 14): IndicatorResult {
  return {
    name: `Williams%R(${period})`,
    values: bars.map((b, i) => {
      if (i < period - 1) return { date: b.date, value: null }
      let high = -Infinity, low = Infinity
      for (let j = i - period + 1; j <= i; j++) {
        if (bars[j].high > high) high = bars[j].high
        if (bars[j].low < low) low = bars[j].low
      }
      return { date: b.date, value: high !== low ? ((high - b.close) / (high - low)) * -100 : null }
    }),
  }
}
