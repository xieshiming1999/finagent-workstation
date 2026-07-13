import type { StockInfo } from '../store/data-store'
import type { FetchResult } from './base-fetcher'
import type { FinanceProvider } from '../provider-policy'
import {
  type DataApiProviderCapability,
} from '../data-api-interface-contract'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data-api-interface-router'
import { readStockIdentityList } from '../data-api-interface-cache'
import {
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  type DataApiFetchOptions,
} from './fetcher-interface-utils'
import { timeoutForEastmoneyBackedUrl } from '../provider-timeouts'
import { tencentStockList } from '../tencent-fetcher'

const GOTDX = 'http://127.0.0.1:19801'
const SIDECAR = 'http://127.0.0.1:19800'
const GOTDX_STOCK_LIST_TIMEOUT_MS = 30_000

export async function fetchStockListA(opts: DataApiFetchOptions = {}): Promise<FetchResult<StockInfo>> {
  const routed = await runDataApiInterfaceRoute(
    'stock.identity_list',
    stockListSource,
    {
      label: 'stock list',
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => {
        const rows = readStockIdentityList({ minRows: 100 })
        return rows.length > 0 ? { data: rows, source: 'local', fetchedAt: new Date().toISOString() } : null
      },
      ...providerConstraintFromFetchOptions(opts),
    },
  )
  console.log(`[StockList] Loaded ${routed.data.data.length} stocks from ${routed.source}`)
  return withStockListProvenance(routed.data, {
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: routed.cacheDecision,
  })
}

function stockListSource(
  capability: DataApiProviderCapability,
): DataApiInterfaceRoute<FetchResult<StockInfo>> | null {
  if (capability.provider === 'tdx') return { capability, run: () => fetchStockListTdx() }
  if (capability.provider === 'sina')
    return {
      capability,
      source: 'sina',
      run: () => fetchStockListSina(),
    }
  if (capability.provider === 'eastmoney')
    return {
      capability,
      source: 'eastmoney',
      run: () => fetchStockListEastmoney(),
    }
  if (capability.provider === 'tencent')
    return {
      capability,
      source: 'tencent',
      run: () => fetchStockListTencent(),
    }
  if (capability.provider === 'akshare')
    return {
      capability,
      run: () => fetchStockListAkshare(`${SIDECAR}/akshare/stock_zh_a_spot?_priority=background`, 'akshare'),
    }
  return null
}

async function fetchStockListTdx(): Promise<FetchResult<StockInfo>> {
  // Use the provider count and the bounded range endpoint. The legacy
  // stock_list endpoint defaults to 100 rows and is not a completeness signal.
  const now = new Date().toISOString()
  const data: StockInfo[] = []

  for (const market of [0, 1]) {
    const countJson = await fetchTdxJson(`${GOTDX}/count?market=${market}`, 'stock count')
    const total = Number(countJson?.Count ?? countJson?.count ?? 0)
    if (!Number.isInteger(total) || total < 100) throw new Error(`TDX stock count: invalid market ${market} count ${total}`)

    let start = 0
    const seenCodes = new Set<string>()
    while (start < total) {
      const requested = Math.min(1000, total - start)
      const list = await fetchTdxStockListPage(market, start, requested)

      let unseenCount = 0
      for (const s of list) {
        const code = String(s.Code ?? s.code ?? '')
        const name = String(s.Name ?? s.name ?? '')
        if (seenCodes.has(code)) continue
        seenCodes.add(code)
        unseenCount += 1
        if (isAshareEquityCode(code, market) && name) {
          data.push({
            code, name,
            market: market === 1 ? 'SH' : 'SZ',
            industry: null, list_date: null, delist_date: null,
            stock_type: 'stock', updated_at: now,
          })
        }
      }

      if (unseenCount === 0) throw new Error(`TDX stock_list: page added no identities at market ${market} start ${start}`)
      start += list.length
    }
  }

  if (data.length < 100) throw new Error(`TDX stock_list: only ${data.length}`)
  return { data, source: 'tdx', fetchedAt: now }
}

async function fetchTdxStockListPage(market: number, start: number, count: number): Promise<any[]> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const json = await fetchTdxJson(
      `${GOTDX}/stock_list_range?market=${market}&start=${start}&count=${count}`,
      `stock_list market ${market} start ${start}`,
    )
    const list = json?.List ?? json?.reply?.List ?? []
    if (Array.isArray(list) && list.length > 0) return list
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 100 * attempt))
  }
  throw new Error(`TDX stock_list: empty page at market ${market} start ${start}`)
}

async function fetchTdxJson(url: string, label: string): Promise<any> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(GOTDX_STOCK_LIST_TIMEOUT_MS) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 200 * attempt))
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`TDX ${label}: ${detail}`)
}

function isAshareEquityCode(code: string, market: number): boolean {
  if (!/^\d{6}$/.test(code)) return false
  const prefixes = market === 1
    ? ['600', '601', '603', '605', '688', '689']
    : ['000', '001', '002', '003', '300', '301']
  return prefixes.some((prefix) => code.startsWith(prefix))
}

async function fetchStockListAkshare(url: string, source = 'akshare'): Promise<FetchResult<StockInfo>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json() as any
  if (json.error) throw new Error(json.error)
  const items = json.data as any[]
  if (!items?.length) throw new Error('empty response')

  const now = new Date().toISOString()
  const data: StockInfo[] = items.map((d: any) => ({
    code: String(d['代码'] ?? d.code ?? ''),
    name: String(d['名称'] ?? d.name ?? ''),
    market: guessMarket(String(d['代码'] ?? d.code ?? '')),
    industry: null, list_date: null, delist_date: null,
    stock_type: 'stock', updated_at: now,
  })).filter((s) => s.code.length >= 6)

  return { data, source, fetchedAt: now }
}

async function fetchStockListSina(): Promise<FetchResult<StockInfo>> {
  const params = new URLSearchParams({
    page: '1',
    num: '6000',
    sort: 'symbol',
    asc: '1',
    node: 'hs_a',
    symbol: '',
    _s_r_a: 'init',
  })
  const url = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?${params}`
  const res = await fetch(url, {
    headers: {
      Referer: 'https://finance.sina.com.cn/',
      'User-Agent': 'Mozilla/5.0',
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Sina stock list failed: HTTP ${res.status}`)
  const rows = await res.json() as Array<Record<string, unknown>>
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Sina stock list returned empty response')

  const now = new Date().toISOString()
  const data: StockInfo[] = rows.map((row) => {
    const rawSymbol = String(row.symbol ?? row['代码'] ?? row.code ?? '')
    const code = rawSymbol.replace(/^(sh|sz|bj)/i, '')
    const name = String(row.name ?? row['名称'] ?? '')
    return {
      code,
      name,
      market: guessMarket(code),
      industry: null,
      list_date: null,
      delist_date: null,
      stock_type: 'stock',
      updated_at: now,
    }
  }).filter((stock) => stock.code.length >= 6 && stock.name)

  if (data.length === 0) throw new Error('Sina stock list contained no valid code/name rows')
  return { data, source: 'sina', fetchedAt: now }
}

async function fetchStockListEastmoney(): Promise<FetchResult<StockInfo>> {
  const params = new URLSearchParams({
    pn: '1',
    pz: '6000',
    po: '1',
    np: '1',
    ut: 'bd1d9ddb04089700cf9c27f6f7426281',
    fltt: '2',
    invt: '2',
    fid: 'f12',
    fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048',
    fields: 'f12,f14',
  })
  const url = `https://push2delay.eastmoney.com/api/qt/clist/get?${params}`
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url, 120_000)),
  })
  if (!res.ok) throw new Error(`EastMoney stock list failed: HTTP ${res.status}`)
  const json = await res.json() as any
  const rows = Array.isArray(json?.data?.diff) ? json.data.diff : []
  if (rows.length === 0) throw new Error('EastMoney stock list returned empty response')

  const now = new Date().toISOString()
  const data: StockInfo[] = rows.map((row: any) => {
    const code = String(row.f12 ?? row['代码'] ?? row.code ?? '')
    const name = String(row.f14 ?? row['名称'] ?? row.name ?? '')
    return {
      code,
      name,
      market: guessMarket(code),
      industry: null,
      list_date: null,
      delist_date: null,
      stock_type: 'stock',
      updated_at: now,
    }
  }).filter((stock: StockInfo) => stock.code.length >= 6 && stock.name)

  if (data.length === 0) throw new Error('EastMoney stock list contained no valid code/name rows')
  return { data, source: 'eastmoney', fetchedAt: now }
}

async function fetchStockListTencent(): Promise<FetchResult<StockInfo>> {
  return {
    data: await tencentStockList(),
    source: 'tencent',
    fetchedAt: new Date().toISOString(),
  }
}

export async function fetchStockListHK(_opts: { providers?: FinanceProvider[] } = {}): Promise<FetchResult<StockInfo>> {
  const url = `${SIDECAR}/akshare/stock_hk_spot_em?_priority=background&_provider=eastmoney`
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url, 60_000)) })
  if (!res.ok) throw new Error(`AkShare HK stock list failed: ${res.status}`)
  const json = await res.json() as any
  const items = json.data as any[]
  if (!items) return { data: [], source: 'akshare', fetchedAt: new Date().toISOString() }

  const now = new Date().toISOString()
  const data: StockInfo[] = items.map((d: any) => ({
    code: String(d['代码'] ?? d.code ?? ''),
    name: String(d['名称'] ?? d.name ?? ''),
    market: 'HK',
    industry: null,
    list_date: null,
    delist_date: null,
    stock_type: 'stock',
    updated_at: now,
  })).filter((s) => s.code)

  return { data, source: 'akshare', fetchedAt: now }
}

export async function fetchStockListUS(_opts: { providers?: FinanceProvider[] } = {}): Promise<FetchResult<StockInfo>> {
  const url = `${SIDECAR}/akshare/stock_us_spot_em?_priority=background&_provider=eastmoney`
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url, 60_000)) })
  if (!res.ok) throw new Error(`AkShare US stock list failed: ${res.status}`)
  const json = await res.json() as any
  const items = json.data as any[]
  if (!items) return { data: [], source: 'akshare', fetchedAt: new Date().toISOString() }

  const now = new Date().toISOString()
  const data: StockInfo[] = items.map((d: any) => ({
    code: String(d['代码'] ?? d.code ?? ''),
    name: String(d['名称'] ?? d.name ?? ''),
    market: 'US',
    industry: null,
    list_date: null,
    delist_date: null,
    stock_type: 'stock',
    updated_at: now,
  })).filter((s) => s.code)

  return { data, source: 'akshare', fetchedAt: now }
}

function withStockListProvenance(
  result: FetchResult<StockInfo>,
  meta: {
    interfaceId: string
    capabilityId: string
    provider: string
    cacheStatus: 'cache-hit' | 'provider-hit'
    cacheMode?: 'cache-first' | 'live-only' | 'cache-only'
    cacheDecision?: string
  },
): FetchResult<StockInfo> {
  return {
    ...result,
    provenance: {
      interfaceId: meta.interfaceId,
      capabilityId: meta.capabilityId,
      provider: meta.provider,
      source: result.source,
      canonicalSchema: 'stock_list',
      canonicalTable: 'stock_list',
      cacheStatus: meta.cacheStatus,
      cacheMode: meta.cacheMode,
      cacheDecision: meta.cacheDecision,
      fetchedAt: result.fetchedAt,
    },
  }
}

function guessMarket(code: string): string {
  if (code.startsWith('6')) return 'SH'
  if (code.startsWith('0') || code.startsWith('3')) return 'SZ'
  if (code.startsWith('4') || code.startsWith('8') || code.startsWith('9')) return 'BJ'
  return 'SZ'
}
