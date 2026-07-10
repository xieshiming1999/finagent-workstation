import type { ToolContext } from '../../../agent/tool'
import type * as dm from '../../../agent/data/data-manager'
import type { KlineRow } from '../../../agent/data/store/data-store'
import type { FetchProvenance } from '../../../agent/data/fetchers/base-fetcher'
import { cachePolicyFor, type CachePolicy } from '../../../agent/data/cache-policy'
import { isCoreCnMarketIndexCode } from '../market-index-universe'
import { LocalMarketDataRepository } from '../repositories/local-market-data-repository'

export type StorageReadStatus = 'hit' | 'miss' | 'stale'

export interface QuoteReadResult {
  quotes: dm.Quote[]
  cachedCount: number
  freshCount: number
  freshSources: string[]
  status: StorageReadStatus
  missingCodes: string[]
  staleCodes: string[]
  reason: string
  provenance: FetchProvenance[]
}

export interface KlineReadResult {
  bars: Array<{
    date: string
    open: number
    close: number
    high: number
    low: number
    volume: number
    amount: number
    changePct: number | null
    turnoverRate: number | null
  }>
  source: string
  period: string
  adjust: string
  status: StorageReadStatus
  reason: string
  coverage: { rowCount: number; requiredRows: number }
  provenance?: FetchProvenance
}

export class MarketDataReadService {
  private readonly repository = new LocalMarketDataRepository()

  readQuotes(ctx: ToolContext, codes: string[], policy: Partial<CachePolicy> = {}): QuoteReadResult {
    const resolvedPolicy = cachePolicyFor('quote', policy)
    const maxAgeMs = resolvedPolicy.maxAgeMs ?? 15_000
    const cachedQuotes = this.repository.getRecentQuotes(ctx, codes, maxAgeMs)
    const latestQuotes = this.repository.getLatestQuotes(ctx, codes)
    const missingCodes = codes.filter((code) => !cachedQuotes.has(code))
    const staleCodes = missingCodes.filter((code) => latestQuotes.has(code))
    const status: StorageReadStatus = missingCodes.length === 0
      ? 'hit'
      : staleCodes.length > 0
        ? 'stale'
        : 'miss'

    return {
      quotes: codes.filter((code) => cachedQuotes.has(code)).map((code) => cachedQuotes.get(code)!),
      cachedCount: cachedQuotes.size,
      freshCount: 0,
      freshSources: [],
      status,
      missingCodes,
      staleCodes,
      reason: quoteReason(status, missingCodes, staleCodes, maxAgeMs),
      provenance: codes
        .filter((code) => cachedQuotes.has(code))
        .map((code) => localQuoteProvenance(cachedQuotes.get(code)!)),
    }
  }

  readKline(
    ctx: ToolContext,
    code: string,
    options: { period?: string; adjust?: string; limit?: number; policy?: Partial<CachePolicy> } = {},
  ): KlineReadResult {
    const period = options.period ?? 'daily'
    const adjust = options.adjust ?? 'qfq'
    const limit = options.limit ?? 60
    const resolvedPolicy = cachePolicyFor(period === 'daily' ? 'kline' : 'intradayTick', options.policy ?? {})
    const minRows = resolvedPolicy.minRows ?? Math.min(limit, 10)
    const maxBarAgeDays = resolvedPolicy.maxBarAgeDays
    const localBars = period === 'daily'
      ? this.repository.queryKline(ctx, code, { adjust, limit })
      : []
    const coverageEnough = localBars.length >= Math.min(limit, minRows)
    const latestDate = latestBarDate(localBars)
    const staleByDate = Boolean(latestDate && maxBarAgeDays != null && isDateOlderThan(latestDate, maxBarAgeDays))
    const status: StorageReadStatus = coverageEnough && !staleByDate
      ? 'hit'
      : localBars.length > 0
        ? 'stale'
        : 'miss'

    return {
      bars: localBars.map(toKlineBar),
      source: 'local',
      period,
      adjust,
      status,
      reason: klineReason(status, localBars.length, Math.min(limit, minRows), latestDate, maxBarAgeDays),
      coverage: { rowCount: localBars.length, requiredRows: Math.min(limit, minRows) },
      provenance: localBars.length > 0 ? localKlineProvenance(code) : undefined,
    }
  }
}

function toKlineBar(bar: KlineRow): KlineReadResult['bars'][number] {
  return {
    date: bar.date,
    open: bar.open,
    close: bar.close,
    high: bar.high,
    low: bar.low,
    volume: bar.volume ?? 0,
    amount: bar.amount ?? 0,
    changePct: bar.change_pct,
    turnoverRate: bar.turnover_rate,
  }
}

function quoteReason(status: StorageReadStatus, missingCodes: string[], staleCodes: string[], maxAgeMs: number): string {
  if (status === 'hit') return `all requested quotes found in reusable storage within ${maxAgeMs}ms`
  if (status === 'stale') return `some quotes exist but are older than ${maxAgeMs}ms: ${staleCodes.join(',')}`
  return `no reusable quote rows for: ${missingCodes.join(',')}`
}

function klineReason(status: StorageReadStatus, rowCount: number, requiredRows: number, latestDate: string | null, maxBarAgeDays?: number): string {
  const latestText = latestDate ? `; latest bar ${latestDate}` : ''
  if (status === 'hit') return `local kline coverage has ${rowCount} rows${latestText}`
  if (status === 'stale') {
    if (latestDate && maxBarAgeDays != null && isDateOlderThan(latestDate, maxBarAgeDays)) {
      return `local kline latest bar ${latestDate} is older than ${maxBarAgeDays} days`
    }
    return `local kline coverage has ${rowCount}/${requiredRows} required rows${latestText}`
  }
  return 'no local kline rows'
}

function latestBarDate(rows: KlineRow[]): string | null {
  let latest: string | null = null
  for (const row of rows) {
    if (typeof row.date !== 'string' || !row.date) continue
    if (!latest || row.date > latest) latest = row.date
  }
  return latest
}

function isDateOlderThan(date: string, maxAgeDays: number): boolean {
  const parsed = Date.parse(`${date}T23:59:59Z`)
  if (!Number.isFinite(parsed)) return false
  const ageMs = Date.now() - parsed
  return ageMs > maxAgeDays * 24 * 60 * 60 * 1000
}

function localQuoteProvenance(quote: dm.Quote): FetchProvenance {
  const interfaceId = isCoreCnMarketIndexCode(quote.code) ? 'index.quote' : 'stock.quote'
  return {
    interfaceId,
    capabilityId: 'local.cache',
    provider: 'local',
    source: quote.source ?? 'local',
    endpoint: `quote_snapshot:${quote.code}`,
    canonicalSchema: 'quote_snapshot',
    canonicalTable: 'quote_snapshot',
    cacheStatus: 'cache-hit',
    asOf: quote.timestamp ?? undefined,
    fetchedAt: quote.fetchedAt ?? undefined,
  }
}

function localKlineProvenance(code: string): FetchProvenance {
  return {
    interfaceId: 'stock.daily_kline',
    capabilityId: 'local.cache',
    provider: 'local',
    source: 'local',
    endpoint: `kline_daily:${code}`,
    canonicalSchema: 'kline_daily',
    canonicalTable: 'kline_daily',
    cacheStatus: 'cache-hit',
  }
}
