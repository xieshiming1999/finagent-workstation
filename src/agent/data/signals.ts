import type { KlineBar } from './data-manager'
import * as ind from './indicators'

export interface Signal {
  indicator: string
  signal: 'buy' | 'sell' | 'hold'
  strength: number
  reason: string
}

export function generateSignals(bars: KlineBar[]): Signal[] {
  if (bars.length < 30) return []
  const signals: Signal[] = []

  const rsi = ind.rsi(bars)
  const rsiVal = lastVal(rsi)
  if (rsiVal != null) {
    if (rsiVal < 30) signals.push({ indicator: 'RSI', signal: 'buy', strength: 0.7, reason: `RSI=${rsiVal.toFixed(1)} oversold` })
    else if (rsiVal > 70) signals.push({ indicator: 'RSI', signal: 'sell', strength: 0.7, reason: `RSI=${rsiVal.toFixed(1)} overbought` })
    else signals.push({ indicator: 'RSI', signal: 'hold', strength: 0.3, reason: `RSI=${rsiVal.toFixed(1)} neutral` })
  }

  const m = ind.macd(bars)
  const dif = lastVal(m.dif), dea = lastVal(m.dea)
  if (dif != null && dea != null) {
    const prev_dif = prevVal(m.dif), prev_dea = prevVal(m.dea)
    if (prev_dif != null && prev_dea != null) {
      if (prev_dif < prev_dea && dif > dea) signals.push({ indicator: 'MACD', signal: 'buy', strength: 0.8, reason: 'MACD golden cross' })
      else if (prev_dif > prev_dea && dif < dea) signals.push({ indicator: 'MACD', signal: 'sell', strength: 0.8, reason: 'MACD death cross' })
      else signals.push({ indicator: 'MACD', signal: 'hold', strength: 0.2, reason: `DIF=${dif.toFixed(2)} DEA=${dea.toFixed(2)}` })
    }
  }

  const k = ind.kdj(bars)
  const kVal = lastVal(k.k), dVal = lastVal(k.d)
  if (kVal != null && dVal != null) {
    if (kVal < 20 && dVal < 20) signals.push({ indicator: 'KDJ', signal: 'buy', strength: 0.6, reason: `K=${kVal.toFixed(0)} D=${dVal.toFixed(0)} oversold zone` })
    else if (kVal > 80 && dVal > 80) signals.push({ indicator: 'KDJ', signal: 'sell', strength: 0.6, reason: `K=${kVal.toFixed(0)} D=${dVal.toFixed(0)} overbought zone` })
  }

  const sma5 = ind.sma(bars, 5), sma20 = ind.sma(bars, 20)
  const s5 = lastVal(sma5), s20 = lastVal(sma20)
  const ps5 = prevVal(sma5), ps20 = prevVal(sma20)
  if (s5 != null && s20 != null && ps5 != null && ps20 != null) {
    if (ps5 < ps20 && s5 > s20) signals.push({ indicator: 'MA', signal: 'buy', strength: 0.7, reason: 'SMA5 crossed above SMA20' })
    else if (ps5 > ps20 && s5 < s20) signals.push({ indicator: 'MA', signal: 'sell', strength: 0.7, reason: 'SMA5 crossed below SMA20' })
  }

  const b = ind.boll(bars)
  const price = bars[bars.length - 1].close
  const upper = lastVal(b.upper), lower = lastVal(b.lower)
  if (upper != null && lower != null) {
    if (price < lower) signals.push({ indicator: 'BOLL', signal: 'buy', strength: 0.6, reason: `Price ${price} below lower band ${lower.toFixed(2)}` })
    else if (price > upper) signals.push({ indicator: 'BOLL', signal: 'sell', strength: 0.6, reason: `Price ${price} above upper band ${upper.toFixed(2)}` })
  }

  return signals
}

export function signalSummary(signals: Signal[]): { overall: 'buy' | 'sell' | 'hold'; score: number } {
  if (signals.length === 0) return { overall: 'hold', score: 0 }
  let score = 0
  for (const s of signals) {
    if (s.signal === 'buy') score += s.strength
    else if (s.signal === 'sell') score -= s.strength
  }
  const normalized = score / signals.length
  if (normalized > 0.2) return { overall: 'buy', score: normalized }
  if (normalized < -0.2) return { overall: 'sell', score: normalized }
  return { overall: 'hold', score: normalized }
}

function lastVal(r: ind.IndicatorResult): number | null {
  for (let i = r.values.length - 1; i >= 0; i--) {
    if (r.values[i].value != null) return r.values[i].value
  }
  return null
}

function prevVal(r: ind.IndicatorResult): number | null {
  let found = 0
  for (let i = r.values.length - 1; i >= 0; i--) {
    if (r.values[i].value != null) {
      found++
      if (found === 2) return r.values[i].value
    }
  }
  return null
}
