import type { ToolContext } from '../../../agent/tool'
import type { KlineRow } from '../../../agent/data/store/data-store'
import type * as dm from '../../../agent/data/data-manager'
import { quoteToSnapshot, snapshotToQuote } from '../../../agent/data/normalizers/quote-normalizer'
import { getLocalStore } from '../../../agent/tools/market-data-utils'

export class LocalMarketDataRepository {
  getRecentQuotes(ctx: ToolContext, codes: string[], maxAgeMs: number): Map<string, dm.Quote> {
    const result = new Map<string, dm.Quote>()
    try {
      const store = getLocalStore(ctx)
      for (const code of codes) {
        const snapshot = store.getRecentQuoteSnapshot(code, maxAgeMs)
        if (!snapshot) continue
        const quote = snapshotToQuote(snapshot)
        if (quote) result.set(code, quote)
      }
    } catch {}
    return result
  }

  getLatestQuotes(ctx: ToolContext, codes: string[]): Map<string, dm.Quote> {
    const result = new Map<string, dm.Quote>()
    try {
      const store = getLocalStore(ctx)
      for (const code of codes) {
        const snapshot = store.queryQuoteSnapshots(code, 1)[0]
        if (!snapshot) continue
        const quote = snapshotToQuote(snapshot)
        if (quote) result.set(code, quote)
      }
    } catch {}
    return result
  }

  saveQuotes(ctx: ToolContext, quotes: dm.Quote[], source: string): void {
    if (quotes.length === 0) return
    try {
      getLocalStore(ctx).saveQuoteSnapshots(quotes.map((quote) => quoteToSnapshot(quote, source)))
    } catch {}
  }

  queryKline(ctx: ToolContext, code: string, opts: { adjust?: string; limit?: number }): KlineRow[] {
    try {
      return getLocalStore(ctx).queryKline(code, opts)
    } catch {
      return []
    }
  }

  queryFundRows(ctx: ToolContext, code: string, limit: number): Array<Record<string, unknown>> {
    if (!code) return []
    try {
      const store = getLocalStore(ctx)
      const navRows = store.queryFundNav(code, { limit, order: 'asc' })
      if (navRows.length > 0) return navRows
      return store.queryFundMoneyYield(code, { limit, order: 'asc' })
    } catch {
      return []
    }
  }

  saveKline(ctx: ToolContext, rows: KlineRow[]): void {
    if (rows.length === 0) return
    try {
      getLocalStore(ctx).saveKline(rows)
    } catch {}
  }
}
