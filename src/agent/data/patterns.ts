import type { KlineBar } from './data-manager'

export interface PatternMatch {
  date: string
  pattern: string
  type: 'bullish' | 'bearish' | 'neutral'
  reliability: 'high' | 'medium' | 'low'
}

export function detectPatterns(bars: KlineBar[]): PatternMatch[] {
  const results: PatternMatch[] = []
  for (let i = 1; i < bars.length; i++) {
    const c = bars[i], p = bars[i - 1]
    const pp = i >= 2 ? bars[i - 2] : null
    const body = c.close - c.open
    const absBody = Math.abs(body)
    const range = c.high - c.low
    const pBody = p.close - p.open

    if (range > 0 && absBody / range < 0.1 && range > absBody * 3) {
      const lowerShadow = Math.min(c.open, c.close) - c.low
      const upperShadow = c.high - Math.max(c.open, c.close)
      if (lowerShadow > absBody * 2 && upperShadow < absBody * 0.5) {
        results.push({ date: c.date, pattern: 'Hammer', type: pBody < 0 ? 'bullish' : 'neutral', reliability: 'medium' })
      }
      if (upperShadow > absBody * 2 && lowerShadow < absBody * 0.5) {
        results.push({ date: c.date, pattern: 'Shooting Star', type: pBody > 0 ? 'bearish' : 'neutral', reliability: 'medium' })
      }
      if (lowerShadow > 0 && upperShadow > 0 && absBody / range < 0.05) {
        results.push({ date: c.date, pattern: 'Doji', type: 'neutral', reliability: 'low' })
      }
    }

    if (pBody < 0 && body > 0 && c.close > p.open && c.open < p.close) {
      results.push({ date: c.date, pattern: 'Bullish Engulfing', type: 'bullish', reliability: 'high' })
    }
    if (pBody > 0 && body < 0 && c.close < p.open && c.open > p.close) {
      results.push({ date: c.date, pattern: 'Bearish Engulfing', type: 'bearish', reliability: 'high' })
    }

    if (pBody < 0 && body > 0 && c.open <= p.close && c.close >= p.open + Math.abs(pBody) * 0.5) {
      results.push({ date: c.date, pattern: 'Piercing Line', type: 'bullish', reliability: 'medium' })
    }
    if (pBody > 0 && body < 0 && c.open >= p.close && c.close <= p.open - Math.abs(pBody) * 0.5) {
      results.push({ date: c.date, pattern: 'Dark Cloud Cover', type: 'bearish', reliability: 'medium' })
    }

    if (pp) {
      const ppBody = pp.close - pp.open
      if (ppBody < 0 && Math.abs(pBody) / Math.abs(ppBody) < 0.3 && body > 0 && c.close > pp.open) {
        results.push({ date: c.date, pattern: 'Morning Star', type: 'bullish', reliability: 'high' })
      }
      if (ppBody > 0 && Math.abs(pBody) / Math.abs(ppBody) < 0.3 && body < 0 && c.close < pp.open) {
        results.push({ date: c.date, pattern: 'Evening Star', type: 'bearish', reliability: 'high' })
      }

      if (ppBody > 0 && pBody > 0 && body > 0 &&
          pp.close < p.open && p.close < c.open &&
          absBody > Math.abs(ppBody) * 0.5) {
        results.push({ date: c.date, pattern: 'Three White Soldiers', type: 'bullish', reliability: 'high' })
      }
      if (ppBody < 0 && pBody < 0 && body < 0 &&
          pp.close > p.open && p.close > c.open) {
        results.push({ date: c.date, pattern: 'Three Black Crows', type: 'bearish', reliability: 'high' })
      }
    }

    if (absBody > 0) {
      const upperShadow = c.high - Math.max(c.open, c.close)
      const lowerShadow = Math.min(c.open, c.close) - c.low
      if (absBody / range > 0.7 && upperShadow < absBody * 0.1 && lowerShadow < absBody * 0.1) {
        results.push({
          date: c.date,
          pattern: body > 0 ? 'Marubozu (Bull)' : 'Marubozu (Bear)',
          type: body > 0 ? 'bullish' : 'bearish',
          reliability: 'medium',
        })
      }
    }
  }
  return results
}

export function findSupportResistance(bars: KlineBar[], lookback = 20): { support: number[]; resistance: number[] } {
  const support: number[] = []
  const resistance: number[] = []
  const recent = bars.slice(-lookback)

  for (let i = 2; i < recent.length - 2; i++) {
    if (recent[i].low < recent[i - 1].low && recent[i].low < recent[i - 2].low &&
        recent[i].low < recent[i + 1].low && recent[i].low < recent[i + 2].low) {
      support.push(recent[i].low)
    }
    if (recent[i].high > recent[i - 1].high && recent[i].high > recent[i - 2].high &&
        recent[i].high > recent[i + 1].high && recent[i].high > recent[i + 2].high) {
      resistance.push(recent[i].high)
    }
  }
  return { support, resistance }
}
