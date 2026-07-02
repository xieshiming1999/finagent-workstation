import { fetchKlineDaily } from './fetchers/fetcher-kline-daily'
import { fetchMoneyFlow } from './fetchers/fetcher-money-flow'
import { fetchQuote as fetchQuoteWithFallback } from './fetchers/fetcher-quote'
import { fetchSectorRanking } from './fetchers/fetcher-sector'
import {
  cached,
  type KlineBar,
  type MoneyFlow,
  type Quote,
  type SectorItem,
} from './data-manager-shared'

export async function getQuote(code: string): Promise<Quote | null> {
  return cached(`quote:${code}`, 10_000, async () => {
    try {
      const result = await fetchQuoteWithFallback(code)
      return result.data[0] ?? null
    } catch {
      return null
    }
  })
}

export async function getQuoteBatch(codes: string[]): Promise<Quote[]> {
  const normalizedCodes = codes.map((c) => c.trim()).filter(Boolean)
  return cached(`quotes:${normalizedCodes.slice().sort().join(',')}`, 10_000, async () => {
    const results: Quote[] = []
    for (const code of normalizedCodes) {
      const quote = await getQuote(code)
      if (quote) results.push(quote)
    }
    return results
  })
}

export async function getKline(
  code: string,
  period = 'daily',
  adjust = 'qfq',
  startDate?: string,
  limit = 120,
): Promise<KlineBar[]> {
  if (period !== 'daily') {
    throw new Error(`data-manager getKline supports only governed daily K-line, got ${period}`)
  }
  return cached(`kline:${code}:${period}:${adjust}:${startDate ?? ''}:${limit}`, 60_000, async () => {
    try {
      const result = await fetchKlineDaily(code, {
        adjust,
        start: startDate,
      })
      return result.data.slice(-limit).map((row) => ({
        date: row.date,
        open: Number(row.open ?? 0),
        close: Number(row.close ?? 0),
        high: Number(row.high ?? 0),
        low: Number(row.low ?? 0),
        volume: Number(row.volume ?? 0),
        amount: Number(row.amount ?? 0),
        changePct: row.change_pct == null ? null : Number(row.change_pct),
        turnoverRate: row.turnover_rate == null ? null : Number(row.turnover_rate),
      }))
    } catch {
      return []
    }
  })
}

export async function getMoneyFlow(code: string, days = 30): Promise<MoneyFlow[]> {
  return cached(`flow:${code}:${days}`, 60_000, async () => {
    try {
      const result = await fetchMoneyFlow(code, days)
      return result.data.map((row) => ({
        date: row.date,
        mainNetInflow: Number(row.main_net ?? 0),
        smallNetInflow: Number(row.small_net ?? 0),
        mediumNetInflow: Number(row.medium_net ?? 0),
        largeNetInflow: Number(row.large_net ?? 0),
        superLargeNetInflow: Number(row.super_large_net ?? 0),
        closePrice: row.close_price == null ? null : Number(row.close_price),
        changePct: row.change_pct == null ? null : Number(row.change_pct),
      }))
    } catch {
      return []
    }
  })
}

export async function getSectors(type: 'industry' | 'concept' | 'area' = 'industry'): Promise<SectorItem[]> {
  return cached(`sectors:${type}`, 30_000, async () => {
    try {
      const result = await fetchSectorRanking(type === 'concept' ? 'concept' : 'industry')
      return result.data.map((row) => ({
        code: row.code,
        name: row.name,
        changePct: Number(row.change_pct ?? 0),
        turnoverRate: row.turnover_rate == null ? null : Number(row.turnover_rate),
        upCount: Number(row.up_count ?? 0),
        downCount: Number(row.down_count ?? 0),
        leadingStock: row.leading_stock ?? null,
        leadingChangePct: row.leading_pct == null ? null : Number(row.leading_pct),
      }))
    } catch {
      return []
    }
  })
}
