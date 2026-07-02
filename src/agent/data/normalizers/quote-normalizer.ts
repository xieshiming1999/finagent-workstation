import type { Quote } from '../data-manager'
import type { QuoteSnapshot } from './types'

export function quoteToSnapshot(quote: Quote, source: string, timestamp = new Date().toISOString()): QuoteSnapshot {
  return {
    code: quote.code,
    timestamp,
    source,
    name: quote.name,
    price: quote.price,
    change: quote.change,
    change_pct: quote.changePct,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    prev_close: quote.prevClose,
    volume: quote.volume,
    amount: quote.amount,
    pe: quote.pe,
    pb: quote.pb,
    market_cap: quote.marketCap,
    turnover_rate: quote.turnoverRate,
    raw_json: JSON.stringify(quote),
  }
}

export function snapshotToQuote(snapshot: QuoteSnapshot): Quote | null {
  if (snapshot.price == null) return null
  return {
    code: snapshot.code,
    name: snapshot.name ?? snapshot.code,
    price: snapshot.price,
    change: snapshot.change ?? 0,
    changePct: snapshot.change_pct ?? 0,
    open: snapshot.open ?? 0,
    high: snapshot.high ?? 0,
    low: snapshot.low ?? 0,
    prevClose: snapshot.prev_close ?? 0,
    volume: snapshot.volume ?? 0,
    amount: snapshot.amount ?? 0,
    pe: snapshot.pe ?? null,
    pb: snapshot.pb ?? null,
    marketCap: snapshot.market_cap ?? null,
    turnoverRate: snapshot.turnover_rate ?? null,
    source: snapshot.source,
    timestamp: snapshot.timestamp ?? null,
    fetchedAt: snapshot.fetched_at ?? null,
  }
}
