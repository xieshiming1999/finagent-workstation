import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../../../agent/data/data-api-interface-router'
import { readRecentQuoteSnapshot } from '../../../agent/data/data-api-interface-cache'
import { normalizeTdxQuote, tdxMarketForCode } from '../../../agent/data/normalizers/tdx-normalizer'
import { globalApiStats } from '../../../agent/data/resilience'
import { tencentIndexQuotes } from '../../../agent/data/tencent-fetcher'
import { gotdxFetch, sidecarFetch, waitForSidecarReady } from '../../../main/sidecar'

export interface BridgeFinanceProvider {
  readIndexQuotes(codes: string[]): Promise<IndexQuoteRouteResult | null>
  callSidecarRoute(route: string, params: Record<string, unknown>): Promise<unknown>
  callGotdxRoute(route: string, params: Record<string, unknown>): Promise<unknown>
}

export interface IndexQuoteRouteResult {
  data: Array<Record<string, unknown>>
  source: string
  cacheStatus?: 'cache-hit' | 'provider-hit'
  provenance?: {
    interfaceId: string
    capabilityId: string
    provider: string
    canonicalSchema: string
    canonicalTable: string
    cacheStatus?: 'cache-hit' | 'provider-hit'
    cacheMode?: 'cache-first' | 'live-only' | 'cache-only'
    cacheDecision?: string
  }
}

export class DefaultBridgeFinanceProvider implements BridgeFinanceProvider {
  async readIndexQuotes(
    codes: string[],
  ): Promise<IndexQuoteRouteResult | null> {
    const start = Date.now()
    let sidecarResult: unknown
    let routeFailure: string | null = null

    try {
      const routed = await runDataApiInterfaceRoute<{ data: Array<Record<string, unknown>>; source: string }>(
        'index.quote',
        (capability): DataApiInterfaceRoute<{ data: Array<Record<string, unknown>>; source: string }> | null => {
          if (capability.provider === 'tdx') {
            return {
              capability,
              run: async () => {
                const fallback = await getIndexQuotesFromTdx(codes)
                if (fallback.data.length === 0 || fallback.data.length < codes.length) {
                  throw new Error(fallback.error ?? 'incomplete TDX index quote response')
                }
                return { data: fallback.data, source: 'tdx' }
              },
            }
          }
          if (capability.provider === 'sina') {
            return {
              capability,
              run: async () => {
                const fallback = await getIndexQuotesFromSina(codes)
                if (fallback.data.length === 0 || fallback.data.length < codes.length) {
                  throw new Error(fallback.error ?? 'incomplete Sina index quote response')
                }
                return { data: fallback.data, source: 'sina' }
              },
            }
          }
          if (capability.provider === 'tencent') {
            return {
              capability,
              run: async () => {
                const fallback = await getIndexQuotesFromTencent(codes)
                if (fallback.data.length === 0 || fallback.data.length < codes.length) {
                  throw new Error(fallback.error ?? 'incomplete Tencent index quote response')
                }
                return { data: fallback.data, source: 'tencent' }
              },
            }
          }
          if (capability.provider === 'akshare') {
            return {
              capability,
              run: async () => {
                await waitForSidecarReady(3_000)
                sidecarResult = await sidecarFetch('/index/quotes', codes.length > 0 ? { code: codes.join(',') } : {}, 0)
                if (!hasData(sidecarResult)) throw new Error(errorSummary(sidecarResult) ?? 'empty AkShare index quote response')
                return {
                  data: ((sidecarResult as Record<string, unknown>).data ?? []) as Array<Record<string, unknown>>,
                  source: String((sidecarResult as Record<string, unknown>).source ?? 'akshare'),
                }
              },
            }
          }
          if (capability.provider === 'eastmoney') {
            return {
              capability,
              run: async () => {
                await waitForSidecarReady(3_000)
                sidecarResult = await sidecarFetch('/akshare/stock_zh_index_spot_em', {
                  symbol: 'all',
                  _provider: 'eastmoney',
                  _priority: 'interactive',
                }, 0)
                const fallback = normalizeEastMoneyIndexQuotes(sidecarResult, codes)
                if (fallback.data.length === 0 || fallback.data.length < codes.length) {
                  throw new Error(fallback.error ?? 'incomplete EastMoney index quote response')
                }
                return { data: fallback.data, source: 'eastmoney' }
              },
            }
          }
          return null
        },
        {
          label: 'index quote',
          cacheMode: 'cache-first',
          readCache: () => readCachedIndexQuotes(codes),
        },
      )
      recordIndexQuoteRoute(routed.source, start, true)
      return {
        ...routed.data,
        cacheStatus: routed.cacheStatus,
        provenance: indexQuoteProvenance(routed),
      }
    } catch (error) {
      routeFailure = error instanceof Error ? error.message : String(error)
      recordIndexQuoteRoute(
        'index-quotes',
        start,
        false,
        summarizeIndexQuoteFailure(routeFailure, sidecarResult),
      )
      return null
    }
  }

  callSidecarRoute(route: string, params: Record<string, unknown>): Promise<unknown> {
    return sidecarFetch(route, params as Record<string, string>)
  }

  callGotdxRoute(route: string, params: Record<string, unknown>): Promise<unknown> {
    return gotdxFetch(route, params as Record<string, string>)
  }
}

function readCachedIndexQuotes(codes: string[]): { data: Array<Record<string, unknown>>; source: string } | null {
  if (codes.length === 0) return null
  const rows: Array<Record<string, unknown>> = []
  for (const code of codes) {
    const quote = readRecentQuoteSnapshot(code, 30_000)
    if (!quote) return null
    rows.push({
      code: quote.code,
      name: INDEX_NAMES[quote.code] ?? quote.name ?? quote.code,
      price: quote.price,
      change: quote.change,
      changePct: quote.change_pct,
      volume: quote.volume,
      amount: quote.amount,
      source: quote.source ?? 'local',
      timestamp: quote.timestamp,
      fetchedAt: quote.fetched_at,
    })
  }
  return { data: rows, source: 'local' }
}

function indexQuoteProvenance(route: {
  interfaceId: string
  capabilityId: string
  provider: string
  cacheStatus: 'cache-hit' | 'provider-hit'
  cacheMode: 'cache-first' | 'live-only' | 'cache-only'
  cacheDecision: string
}): {
  interfaceId: string
  capabilityId: string
  provider: string
  canonicalSchema: string
  canonicalTable: string
  cacheStatus: 'cache-hit' | 'provider-hit'
  cacheMode: 'cache-first' | 'live-only' | 'cache-only'
  cacheDecision: string
} {
  return {
    interfaceId: route.interfaceId,
    capabilityId: route.capabilityId,
    provider: route.provider,
    canonicalSchema: 'quote_snapshot',
    canonicalTable: 'quote_snapshot',
    cacheStatus: route.cacheStatus,
    cacheMode: route.cacheMode,
    cacheDecision: route.cacheDecision,
  }
}

async function getIndexQuotesFromTdx(
  codes: string[],
): Promise<{ data: Array<Record<string, unknown>>; error: string | null }> {
  if (codes.length === 0) return { data: [], error: 'tdx: no requested index codes' }
  const rows: Array<Record<string, unknown>> = []
  const issues: string[] = []

  for (const code of codes) {
    const result = await gotdxFetch('/quote', {
      code,
      market: tdxMarketForCode(code, true),
    })
    const error = (result as { error?: unknown } | null)?.error
    if (error) {
      issues.push(`tdx:${code}: ${String(error)}`)
      continue
    }
    const row = normalizeTdxQuote(result, { expectedCode: code, index: true })
    if (!row) {
      issues.push(`tdx:${code}: invalid`)
      continue
    }
    rows.push({ ...row, source: 'tdx:index_quote' })
  }

  return {
    data: rows,
    error: issues.length > 0 ? issues.join(', ') : null,
  }
}

function hasData(value: unknown): boolean {
  const data = (value as { data?: unknown } | null)?.data
  return Array.isArray(data) && data.length > 0
}

function errorSummary(value: unknown): string | null {
  const error = (value as { error?: unknown } | null)?.error
  if (!error) return null
  const text = String(error)
  if (/Python sidecar not running/i.test(text)) return null
  if (
    /ProxyError|HTTPSConnectionPool|RemoteDisconnected|Max retries exceeded/i.test(
      text,
    )
  ) {
    return 'EastMoney/AkShare request failed through the configured network proxy'
  }
  if (/timeout|aborted/i.test(text)) {
    return 'EastMoney/AkShare request timed out'
  }
  return text.length > 180 ? `${text.slice(0, 180)}...` : text
}

function normalizeEastMoneyIndexQuotes(
  value: unknown,
  codes: string[],
): { data: Array<Record<string, unknown>>; error: string | null } {
  const data = (value as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    return { data: [], error: errorSummary(value) ?? 'empty EastMoney index quote response' }
  }
  const requested = new Map(codes.map((code, index) => [code, index]))
  const rows: Array<{ index: number; row: Record<string, unknown> }> = []
  const issues: string[] = []

  for (const raw of data) {
    const item = raw as Record<string, unknown>
    const code = String(item.code ?? item['代码'] ?? '').trim()
    if (!code || !requested.has(code)) continue
    const price = numberFrom(item.price ?? item['最新价'])
    const changePct = numberFrom(item.changePct ?? item['涨跌幅'])
    if (!isPlausibleIndexQuote(code, price, changePct)) {
      issues.push(`eastmoney:${code}: invalid`)
      continue
    }
    rows.push({
      index: requested.get(code) ?? 0,
      row: {
        code,
        name: String(item.name ?? item['名称'] ?? INDEX_NAMES[code] ?? code),
        price,
        change: numberFrom(item.change ?? item['涨跌额']),
        changePct,
        volume: numberFrom(item.volume ?? item['成交量']),
        amount: numberFrom(item.amount ?? item['成交额']),
        open: numberFrom(item.open ?? item['今开']),
        high: numberFrom(item.high ?? item['最高']),
        low: numberFrom(item.low ?? item['最低']),
        source: 'eastmoney:index_quote',
      },
    })
  }

  rows.sort((a, b) => a.index - b.index)
  const found = new Set(rows.map((item) => String(item.row.code)))
  for (const code of codes) {
    if (!found.has(code)) issues.push(`eastmoney:${code}: missing`)
  }
  return {
    data: rows.map((item) => item.row),
    error: issues.length > 0 ? issues.join(', ') : null,
  }
}

function numberFrom(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const text = String(value ?? '').replace(/,/g, '').trim()
  if (!text || text === '-' || text === '--') return 0
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : 0
}

function summarizeIndexQuoteFailure(
  routeFailure: string | null,
  sidecarResult: unknown,
): string {
  const akshareFailure = errorSummary(sidecarResult)
  const reasons = [routeFailure, routeFailure ? null : akshareFailure ? `akshare: ${akshareFailure}` : null].filter(Boolean)
  if (reasons.length === 0) return 'all-sources-unavailable'
  return reasons.join('; ')
}

const INDEX_NAMES: Record<string, string> = {
  '000001': '上证',
  '399001': '深成',
  '399006': '创业板',
  '000688': '科创50',
  '000300': '沪深300',
  '000905': '中证500',
  '000852': '中证1000',
  '000016': '上证50',
}

const INDEX_PRICE_RANGES: Record<string, [number, number]> = {
  '000001': [1000, 10000],
  '399001': [5000, 30000],
  '399006': [1000, 10000],
  '000688': [300, 3000],
  '000300': [1000, 10000],
  '000905': [2000, 15000],
  '000852': [2000, 15000],
  '000016': [1000, 10000],
}

async function getIndexQuotesFromSina(
  codes: string[],
): Promise<{ data: Array<Record<string, unknown>>; error: string | null }> {
  if (codes.length === 0) return { data: [], error: 'sina: no requested index codes' }
  const symbols = codes.map((code) => `s_${sinaIndexSymbol(code)}`)
  const url = `https://hq.sinajs.cn/list=${symbols.join(',')}`
  const response = await fetch(url, {
    headers: {
      Referer: 'https://finance.sina.com.cn/',
      'User-Agent': 'Mozilla/5.0',
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Sina index quote HTTP ${response.status}`)
  const text = decodeSinaResponse(await response.arrayBuffer())
  const rows: Array<Record<string, unknown>> = []
  const issues: string[] = []

  for (const code of codes) {
    const symbol = sinaIndexSymbol(code)
    const pattern = new RegExp(`hq_str_s_${symbol}="([^"]*)"`)
    const match = pattern.exec(text)
    if (!match) {
      issues.push(`sina:${code}: missing`)
      continue
    }
    const parts = match[1].split(',')
    const price = Number(parts[1])
    const change = Number(parts[2])
    const changePct = Number(parts[3])
    if (!isPlausibleIndexQuote(code, price, changePct)) {
      issues.push(`sina:${code}: invalid`)
      continue
    }
    rows.push({
      code,
      name: INDEX_NAMES[code] || parts[0] || code,
      price,
      change,
      changePct,
      volume: Number(parts[4]) || 0,
      amount: Number(parts[5]) || 0,
      source: 'sina:index_quote',
    })
  }

  return {
    data: rows,
    error: issues.length > 0 ? issues.join(', ') : null,
  }
}

async function getIndexQuotesFromTencent(
  codes: string[],
): Promise<{ data: Array<Record<string, unknown>>; error: string | null }> {
  if (codes.length === 0) return { data: [], error: 'tencent: no requested index codes' }
  const quotes = await tencentIndexQuotes(codes)
  const byCode = new Map(quotes.map((quote) => [quote.code, quote]))
  const rows: Array<Record<string, unknown>> = []
  const issues: string[] = []

  for (const code of codes) {
    const quote = byCode.get(code)
    if (!quote) {
      issues.push(`tencent:${code}: missing`)
      continue
    }
    if (!isPlausibleIndexQuote(code, quote.price, quote.changePct)) {
      issues.push(`tencent:${code}: invalid`)
      continue
    }
    rows.push({
      code,
      name: INDEX_NAMES[code] || quote.name || code,
      price: quote.price,
      change: quote.change,
      changePct: quote.changePct,
      volume: quote.volume,
      amount: quote.amount,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      source: 'tencent:index_quote',
    })
  }

  return {
    data: rows,
    error: issues.length > 0 ? issues.join(', ') : null,
  }
}

function decodeSinaResponse(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('gb18030').decode(buffer)
  } catch {
    try {
      return new TextDecoder('gbk').decode(buffer)
    } catch {
      return new TextDecoder().decode(buffer)
    }
  }
}

function sinaIndexSymbol(code: string): string {
  return code.startsWith('399') ? `sz${code}` : `sh${code}`
}

function isPlausibleIndexQuote(
  code: string,
  price: number,
  changePct: number,
): boolean {
  if (!Number.isFinite(price) || price <= 0) return false
  if (Number.isFinite(changePct) && Math.abs(changePct) > 20) return false
  const range = INDEX_PRICE_RANGES[code]
  if (!range) return true
  return price >= range[0] && price <= range[1]
}

function recordIndexQuoteRoute(
  source: string,
  start: number,
  success: boolean,
  error?: string,
): void {
  globalApiStats.record({
    source,
    url: '/api/finance/index/quotes',
    status: success ? 200 : 0,
    durationMs: Date.now() - start,
    success,
    error,
    timestamp: new Date().toISOString(),
    tool: 'BridgeIPC',
    action: 'index/quotes',
  })
}
