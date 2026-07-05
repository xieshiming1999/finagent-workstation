import { describe, it, expect } from 'vitest'
import { runBacktest, rsiStrategy, macdStrategy, bollStrategy, emaCrossStrategy } from '../../src/agent/data/backtest'
import type { KlineBar } from '../../src/agent/data/data-manager'

function generateBars(n: number, startPrice = 10): KlineBar[] {
  const bars: KlineBar[] = []
  let price = startPrice
  for (let i = 0; i < n; i++) {
    const change = (Math.random() - 0.48) * 0.5
    price = Math.max(1, price + change)
    bars.push({
      date: `2024-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      open: price - 0.1, high: price + 0.5, low: price - 0.3, close: price,
      volume: 10000 + Math.random() * 5000, amount: price * 10000,
      changePct: null, turnoverRate: null,
    })
  }
  return bars
}

describe('Backtest Engine', () => {
  const bars = generateBars(200)

  it('RSI strategy produces valid result', () => {
    const result = runBacktest(bars, rsiStrategy(), 'rsi')
    expect(result.strategy).toBe('rsi')
    expect(result.tradeCount).toBeGreaterThanOrEqual(0)
    expect(result.maxDrawdown).toBeGreaterThanOrEqual(0)
    expect(result.maxDrawdown).toBeLessThanOrEqual(1)
    expect(result.winRate).toBeGreaterThanOrEqual(0)
    expect(result.winRate).toBeLessThanOrEqual(1)
  })

  it('MACD strategy runs without error', () => {
    const result = runBacktest(bars, macdStrategy(), 'macd')
    expect(result.strategy).toBe('macd')
    expect(typeof result.totalReturn).toBe('number')
    expect(typeof result.sharpeRatio).toBe('number')
  })

  it('Bollinger strategy runs', () => {
    const result = runBacktest(bars, bollStrategy(), 'boll')
    expect(result.strategy).toBe('boll')
  })

  it('EMA cross strategy runs', () => {
    const result = runBacktest(bars, emaCrossStrategy(), 'ema_cross')
    expect(result.strategy).toBe('ema_cross')
  })

  it('handles short data gracefully', () => {
    const shortBars = generateBars(10)
    const result = runBacktest(shortBars, rsiStrategy(), 'rsi')
    expect(result.tradeCount).toBe(0)
  })
})
