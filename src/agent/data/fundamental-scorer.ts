import type { Quote } from './data-manager'

export interface FundamentalScore {
  code: string
  name: string
  totalScore: number
  breakdown: Record<string, number>
}

export function scoreFundamentals(quotes: Quote[]): FundamentalScore[] {
  return quotes.map((q) => {
    const breakdown: Record<string, number> = {}
    let total = 0

    if (q.pe != null && q.pe > 0) {
      const peScore = q.pe < 10 ? 25 : q.pe < 20 ? 20 : q.pe < 30 ? 15 : q.pe < 50 ? 10 : 5
      breakdown.pe = peScore
      total += peScore
    }

    if (q.pb != null && q.pb > 0) {
      const pbScore = q.pb < 1 ? 25 : q.pb < 2 ? 20 : q.pb < 3 ? 15 : q.pb < 5 ? 10 : 5
      breakdown.pb = pbScore
      total += pbScore
    }

    if (q.turnoverRate != null) {
      const trScore = q.turnoverRate > 1 && q.turnoverRate < 5 ? 20 : q.turnoverRate < 10 ? 15 : 10
      breakdown.turnoverRate = trScore
      total += trScore
    }

    if (q.marketCap != null && q.marketCap > 0) {
      const mcScore = q.marketCap > 100e8 ? 20 : q.marketCap > 50e8 ? 15 : q.marketCap > 10e8 ? 10 : 5
      breakdown.marketCap = mcScore
      total += mcScore
    }

    return { code: q.code, name: q.name, totalScore: total, breakdown }
  }).sort((a, b) => b.totalScore - a.totalScore)
}
