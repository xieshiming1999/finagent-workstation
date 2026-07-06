import { describe, it, expect } from 'vitest'
import { sma, ema, rsi, macd, boll, kdj, atr } from '../../src/agent/data/indicators'
import type { KlineBar } from '../../src/agent/data/data-manager'

function makeBars(closes: number[]): KlineBar[] {
  return closes.map((c, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, '0')}`,
    open: c - 0.5, high: c + 1, low: c - 1, close: c,
    volume: 1000, amount: 10000, changePct: null, turnoverRate: null,
  }))
}

describe('SMA', () => {
  it('computes correctly for period 3', () => {
    const bars = makeBars([10, 11, 12, 13, 14])
    const result = sma(bars, 3)
    expect(result.values[0].value).toBeNull()
    expect(result.values[1].value).toBeNull()
    expect(result.values[2].value).toBeCloseTo(11)
    expect(result.values[3].value).toBeCloseTo(12)
    expect(result.values[4].value).toBeCloseTo(13)
  })
})

describe('EMA', () => {
  it('first value equals SMA', () => {
    const bars = makeBars([10, 11, 12, 13, 14])
    const result = ema(bars, 3)
    expect(result.values[2].value).toBeCloseTo(11)
  })

  it('subsequent values use exponential weighting', () => {
    const bars = makeBars([10, 11, 12, 13, 14])
    const result = ema(bars, 3)
    expect(result.values[3].value).not.toBeNull()
    expect(result.values[3].value!).toBeGreaterThan(11)
  })
})

describe('RSI', () => {
  it('returns null for first period bars', () => {
    const bars = makeBars(Array.from({ length: 20 }, (_, i) => 10 + i * 0.5))
    const result = rsi(bars, 14)
    expect(result.values[0].value).toBeNull()
    expect(result.values[13].value).toBeNull()
  })

  it('returns > 50 for uptrend', () => {
    const bars = makeBars(Array.from({ length: 20 }, (_, i) => 10 + i))
    const result = rsi(bars, 14)
    const last = result.values[result.values.length - 1].value
    expect(last).toBeGreaterThan(50)
  })

  it('returns < 50 for downtrend', () => {
    const bars = makeBars(Array.from({ length: 20 }, (_, i) => 30 - i))
    const result = rsi(bars, 14)
    const last = result.values[result.values.length - 1].value
    expect(last).toBeLessThan(50)
  })
})

describe('MACD', () => {
  it('returns dif, dea, macd', () => {
    const bars = makeBars(Array.from({ length: 30 }, (_, i) => 10 + Math.sin(i / 5) * 3))
    const result = macd(bars)
    expect(result.dif.values.length).toBe(30)
    expect(result.dea.values.length).toBe(30)
    expect(result.macd.values.length).toBe(30)
  })
})

describe('BOLL', () => {
  it('middle equals SMA', () => {
    const bars = makeBars(Array.from({ length: 25 }, (_, i) => 10 + i * 0.1))
    const result = boll(bars, 20)
    const smaResult = sma(bars, 20)
    const lastBoll = result.middle.values[result.middle.values.length - 1].value
    const lastSma = smaResult.values[smaResult.values.length - 1].value
    expect(lastBoll).toBeCloseTo(lastSma!)
  })

  it('upper > middle > lower', () => {
    const bars = makeBars(Array.from({ length: 25 }, (_, i) => 10 + Math.random() * 2))
    const result = boll(bars, 20)
    const i = 24
    const u = result.upper.values[i].value!
    const m = result.middle.values[i].value!
    const l = result.lower.values[i].value!
    expect(u).toBeGreaterThan(m)
    expect(m).toBeGreaterThan(l)
  })
})

describe('KDJ', () => {
  it('returns K, D, J values', () => {
    const bars = makeBars(Array.from({ length: 20 }, (_, i) => 10 + i * 0.5))
    const result = kdj(bars)
    expect(result.k.values.length).toBe(20)
    const lastK = result.k.values[19].value
    expect(lastK).not.toBeNull()
    expect(lastK!).toBeGreaterThan(0)
  })
})

describe('ATR', () => {
  it('returns positive values', () => {
    const bars = makeBars(Array.from({ length: 20 }, (_, i) => 10 + Math.random() * 5))
    const result = atr(bars, 14)
    const last = result.values[result.values.length - 1].value
    expect(last).not.toBeNull()
    expect(last!).toBeGreaterThan(0)
  })
})
