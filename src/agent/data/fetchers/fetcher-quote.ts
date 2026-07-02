import type { FetchResult } from './base-fetcher'
import { fetchQuote as fetchEastmoneyQuote } from '../eastmoney-fetcher'
import { sinaQuotes } from '../sina-fetcher'
import { tencentQuotes } from '../tencent-fetcher'
import { tdxMarketForCode } from '../normalizers/tdx-normalizer'
import type { DataApiProviderCapability } from '../data-api-interface-contract'
import { readRecentQuoteSnapshot } from '../data-api-interface-cache'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data-api-interface-router'
import {
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  strictCacheSourceFromFetchOptions,
  type DataApiFetchOptions,
} from './fetcher-interface-utils'

const GOTDX = 'http://127.0.0.1:19801'
const SIDECAR = 'http://127.0.0.1:19800'

export interface QuoteData {
  code: string
  name: string
  price: number
  change: number
  changePct: number
  open: number
  high: number
  low: number
  prevClose: number
  volume: number
  amount: number
  pe: number | null
  pb: number | null
  marketCap: number | null
  turnoverRate: number | null
}

const cache = new Map<string, { data: QuoteData; provider: string; expiry: number }>()
const CACHE_TTL = 15_000
const DATASTORE_QUOTE_TTL = 5 * 60_000

export async function fetchQuote(
  code: string,
  opts: DataApiFetchOptions & { instrumentType?: 'stock' | 'convertible_bond' } = {},
): Promise<FetchResult<QuoteData>> {
  const interfaceId = opts.instrumentType === 'convertible_bond' || isConvertibleBondCode(code)
    ? 'bond.convertible_quote'
    : 'stock.quote'
  const effectiveOpts = isGlobalSymbol(code) && !opts.provider && !opts.providers?.length
    ? { ...opts, provider: 'yahoo', providerMode: 'strict' as const, allowFallback: false }
    : opts
  const cached = cache.get(code)
  const cacheMode = cacheModeFromFetchOptions(effectiveOpts)
  const providerConstraint = providerConstraintFromFetchOptions(effectiveOpts)
  const strictCacheSource = strictCacheSourceFromFetchOptions(effectiveOpts)
  if (cacheMode === 'cache-first' && cached && Date.now() < cached.expiry && (!strictCacheSource || cached.provider === strictCacheSource)) {
    const fetchedAt = new Date().toISOString()
    return {
      data: [cached.data],
      source: 'cache',
      fetchedAt,
      provenance: {
        interfaceId,
        provider: 'local',
        source: 'cache',
        canonicalSchema: 'quote_snapshot',
        canonicalTable: 'quote_snapshot',
        cacheStatus: 'cache-hit',
        cacheMode,
        cacheDecision: strictCacheSource
          ? `in-memory quote cache hit for strict provider source ${strictCacheSource} before DataStore/provider routing`
          : 'in-memory quote cache hit before DataStore/provider routing',
        providerMode: providerConstraint.providerMode ?? (providerConstraint.provider ? 'strict' : 'auto'),
        requestedProvider: providerConstraint.provider ? String(providerConstraint.provider) : undefined,
        allowFallback: providerConstraint.allowFallback !== false,
        fetchedAt,
      },
    }
  }

  const routed = await runDataApiInterfaceRoute(interfaceId, (capability) => quoteSource(capability, code), {
    label: 'quote',
    cacheMode,
    readCache: () => {
      const row = readRecentQuoteSnapshot(code, DATASTORE_QUOTE_TTL, strictCacheSource)
      return row ? quoteFromSnapshot(row, code) : null
    },
    ...providerConstraint,
  })
  cache.set(code, { data: routed.data, provider: routed.source, expiry: Date.now() + CACHE_TTL })
  const fetchedAt = new Date().toISOString()
  return {
    data: [routed.data],
    source: routed.source,
    fetchedAt,
    provenance: {
      interfaceId: routed.interfaceId,
      capabilityId: routed.capabilityId,
      provider: routed.provider,
      source: routed.source,
      canonicalSchema: 'quote_snapshot',
      canonicalTable: 'quote_snapshot',
      cacheStatus: routed.cacheStatus,
      cacheMode: routed.cacheMode,
      cacheDecision: routed.cacheDecision,
      providerMode: routed.providerMode,
      requestedProvider: routed.requestedProvider,
      allowFallback: routed.allowFallback,
      fetchedAt,
    },
  }
}

function quoteFromSnapshot(row: ReturnType<typeof readRecentQuoteSnapshot>, code: string): QuoteData | null {
  if (!row) return null
  return {
    code,
    name: row.name ?? '',
    price: row.price ?? 0,
    change: row.change ?? 0,
    changePct: row.change_pct ?? 0,
    open: row.open ?? 0,
    high: row.high ?? 0,
    low: row.low ?? 0,
    prevClose: row.prev_close ?? 0,
    volume: row.volume ?? 0,
    amount: row.amount ?? 0,
    pe: row.pe ?? null,
    pb: row.pb ?? null,
    marketCap: row.market_cap ?? null,
    turnoverRate: row.turnover_rate ?? null,
  }
}

function quoteSource(
  capability: DataApiProviderCapability,
  code: string,
): DataApiInterfaceRoute<QuoteData> | null {
  const provider = capability.provider
  if (provider === 'tdx') return { capability, run: () => fetchQuoteTdx(code) }
  if (provider === 'eastmoney')
    return { capability, source: 'eastmoney', run: () => fetchQuoteEastmoney(code) }
  if (provider === 'sina')
    return { capability, source: 'sina', run: () => fetchQuoteSina(code) }
  if (provider === 'tencent') {
    const globalSymbol = isTencentGlobalQuoteSymbol(code)
    if (capability.id === 'tencent.global.stock_quote' && !globalSymbol) return null
    if (capability.id === 'tencent.stock.quote' && globalSymbol) return null
    return { capability, source: 'tencent', run: () => fetchQuoteTencent(code) }
  }
  if (provider === 'akshare')
    return { capability, run: () => fetchQuoteAkshare(code) }
  if (provider === 'yahoo')
    return { capability, source: 'yfinance', run: () => fetchQuoteYfinance(code) }
  return null
}

async function fetchQuoteTdx(code: string): Promise<QuoteData> {
  const market = tdxMarketForCode(code)
  const res = await fetch(`${GOTDX}/quote?code=${code}&market=${market}`, {
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`TDX ${res.status}`)
  const json = (await res.json()) as any
  const q = json?.List?.[0] ?? json?.reply?.List?.[0] ?? json
  if (!q || (!q.Price && !q.price)) throw new Error('TDX empty response')
  const returnedCode = String(q.Code ?? q.code ?? code)
  if (returnedCode && returnedCode !== code) {
    throw new Error(`TDX quote code mismatch: requested ${code}, received ${returnedCode}`)
  }

  const price = Number(q.Price ?? q.price ?? 0)
  const prevClose = Number(q.LastClose ?? q.lastClose ?? 0)
  return {
    code,
    name: q.Name ?? q.name ?? '',
    price,
    change: price - prevClose,
    changePct: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
    open: Number(q.Open ?? q.open ?? 0),
    high: Number(q.High ?? q.high ?? 0),
    low: Number(q.Low ?? q.low ?? 0),
    prevClose,
    volume: q.Vol ?? q.vol ?? 0,
    amount: q.Amount ?? q.amount ?? 0,
    pe: null,
    pb: null,
    marketCap: null,
    turnoverRate: null,
  }
}

async function fetchQuoteEastmoney(code: string): Promise<QuoteData> {
  const quote = await fetchEastmoneyQuote(code)
  if (!quote) throw new Error('EastMoney empty response')
  return quote
}

async function fetchQuoteSina(code: string): Promise<QuoteData> {
  const [quote] = await sinaQuotes([code])
  if (!quote) throw new Error('Sina empty response')
  if (quote.code !== code) {
    throw new Error(`Sina quote code mismatch: requested ${code}, received ${quote.code}`)
  }
  return quote
}

async function fetchQuoteTencent(code: string): Promise<QuoteData> {
  const [quote] = await tencentQuotes([code])
  if (!quote) throw new Error('Tencent empty response')
  if (quote.code !== code) {
    throw new Error(`Tencent quote code mismatch: requested ${code}, received ${quote.code}`)
  }
  return quote
}

async function fetchQuoteAkshare(code: string): Promise<QuoteData> {
  const res = await fetch(`${SIDECAR}/quote?code=${code}`, {
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`AkShare ${res.status}`)
  const json = (await res.json()) as any
  if (json.error) throw new Error(json.error)
  return {
    code: json.code ?? code,
    name: json.name ?? '',
    price: json.price ?? 0,
    change: json.change ?? 0,
    changePct: json.changePct ?? 0,
    open: json.open ?? 0,
    high: json.high ?? 0,
    low: json.low ?? 0,
    prevClose: json.prevClose ?? 0,
    volume: json.volume ?? 0,
    amount: json.amount ?? 0,
    pe: json.pe ?? null,
    pb: json.pb ?? null,
    marketCap: json.marketCap ?? null,
    turnoverRate: json.turnoverRate ?? null,
  }
}

async function fetchQuoteYfinance(code: string): Promise<QuoteData> {
  const symbol = yahooSymbolForCode(code)
  const res = await fetch(`${SIDECAR}/yfinance/fast_info?symbol=${encodeURIComponent(symbol)}`, {
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`yfinance quote: ${res.status}`)
  const json = (await res.json()) as Record<string, unknown>
  if (json.error) throw new Error(String(json.error))
  const row = (json.data && typeof json.data === 'object' ? json.data : json) as Record<string, unknown>
  const price = numberField(row, ['lastPrice', 'last_price', 'regularMarketPrice', 'currentPrice', 'price'])
  if (price == null) throw new Error('yfinance quote: empty price')
  const prevClose = numberField(row, ['previousClose', 'previous_close', 'regularMarketPreviousClose']) ?? price
  const change = price - prevClose
  return {
    code,
    name: stringField(row, ['shortName', 'longName', 'name', 'symbol']) ?? code,
    price,
    change,
    changePct: prevClose > 0 ? (change / prevClose) * 100 : 0,
    open: numberField(row, ['open', 'regularMarketOpen']) ?? 0,
    high: numberField(row, ['dayHigh', 'regularMarketDayHigh']) ?? 0,
    low: numberField(row, ['dayLow', 'regularMarketDayLow']) ?? 0,
    prevClose,
    volume: numberField(row, ['lastVolume', 'regularMarketVolume', 'volume', 'tenDayAverageVolume']) ?? 0,
    amount: 0,
    pe: numberField(row, ['trailingPE', 'forwardPE']),
    pb: numberField(row, ['priceToBook']),
    marketCap: numberField(row, ['marketCap']),
    turnoverRate: null,
  }
}

export async function fetchQuoteBatch(
  codes: string[],
): Promise<FetchResult<QuoteData>> {
  const results: QuoteData[] = []
  const providers = new Set<string>()
  for (const code of codes) {
    try {
      const r = await fetchQuote(code)
      results.push(...r.data)
      if (r.provenance?.provider) providers.add(r.provenance.provider)
    } catch {}
  }
  const fetchedAt = new Date().toISOString()
  return {
    data: results,
    source: 'mixed',
    fetchedAt,
    provenance: {
      interfaceId: 'stock.quote',
      provider: providers.size === 1 ? [...providers][0] : 'mixed',
      source: 'mixed',
      canonicalSchema: 'quote_snapshot',
      canonicalTable: 'quote_snapshot',
      cacheStatus: 'provider-hit',
      fetchedAt,
    },
  }
}

export function isConvertibleBondCode(code: string): boolean {
  const clean = String(code ?? '').replace(/^(sh|sz|bj)/i, '').replace(/\.(SH|SZ|BJ)$/i, '').trim()
  return /^(11|12)\d{4}$/.test(clean)
}

function isGlobalSymbol(code: string): boolean {
  const value = String(code ?? '').trim()
  return /^[A-Z][A-Z0-9._-]*$/i.test(value) && !/^\d{6}$/.test(value)
}

function isTencentGlobalQuoteSymbol(code: string): boolean {
  const value = String(code ?? '').trim()
  return /^hk\d{5}$/i.test(value) || /^us[A-Za-z0-9.]+$/i.test(value)
}

function yahooSymbolForCode(code: string): string {
  const value = String(code ?? '').trim()
  if (/^\d{1,5}$/.test(value)) return `${value.padStart(4, '0')}.HK`
  return value
}

function numberField(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key]
    const raw = value && typeof value === 'object' && 'raw' in value
      ? (value as { raw?: unknown }).raw
      : value
    const num = Number(raw)
    if (Number.isFinite(num)) return num
  }
  return null
}

function stringField(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export function clearQuoteCache(): void {
  cache.clear()
}
