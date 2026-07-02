import type { FetchResult } from './base-fetcher'
import {
  type DataApiProviderCapability,
} from '../data-api-interface-contract'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data-api-interface-router'
import { readMoneyFlowRows } from '../data-api-interface-cache'
import {
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  type DataApiFetchOptions,
  withInterfaceProvenance,
} from './fetcher-interface-utils'
import { timeoutForEastmoneyBackedUrl } from '../provider-timeouts'

const SIDECAR = 'http://127.0.0.1:19800'

export interface MoneyFlowRow {
  code: string; date: string
  main_net: number; small_net: number; medium_net: number; large_net: number; super_large_net: number
  close_price: number | null; change_pct: number | null; source: string
}

export async function fetchMoneyFlow(
  code: string,
  days = 30,
  opts: DataApiFetchOptions = {},
): Promise<FetchResult<MoneyFlowRow>> {
  const routed = await runDataApiInterfaceRoute(
    'stock.money_flow',
    (capability) => moneyFlowSource(capability, code, days),
    {
      label: 'stock money flow',
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => {
        const rows = readMoneyFlowRows(code, { minRows: 1, limit: days })
        return rows.length > 0 ? { data: rows, source: 'local', fetchedAt: new Date().toISOString() } : null
      },
      ...providerConstraintFromFetchOptions(opts),
    },
  )
  return withInterfaceProvenance(routed.data, {
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    canonicalSchema: 'money_flow',
    canonicalTable: 'money_flow',
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: routed.cacheDecision,
  })
}

function moneyFlowSource(
  capability: DataApiProviderCapability,
  code: string,
  days: number,
): DataApiInterfaceRoute<FetchResult<MoneyFlowRow>> | null {
  if (capability.provider === 'eastmoney') {
    return {
      capability,
      source: 'eastmoney',
      run: () => fetchMoneyFlowEastmoney(code, days),
    }
  }
  if (capability.provider === 'akshare') {
    return {
      capability,
      source: 'akshare',
      run: () => fetchMoneyFlowAkshare(code, days),
    }
  }
  return null
}

async function fetchMoneyFlowEastmoney(code: string, days = 30): Promise<FetchResult<MoneyFlowRow>> {
  return fetchMoneyFlowSidecar(code, days, 'eastmoney', true)
}

async function fetchMoneyFlowAkshare(code: string, days = 30): Promise<FetchResult<MoneyFlowRow>> {
  return fetchMoneyFlowSidecar(code, days, 'akshare', false)
}

async function fetchMoneyFlowSidecar(
  code: string,
  days: number,
  source: 'eastmoney' | 'akshare',
  allowEastmoneyFallback: boolean,
): Promise<FetchResult<MoneyFlowRow>> {
  const market = code.startsWith('6') ? 'sh' : code.startsWith('8') || code.startsWith('4') ? 'bj' : 'sz'
  const providerParam = source === 'eastmoney' ? '&_provider=eastmoney' : ''
  const url = `${SIDECAR}/akshare/stock_individual_fund_flow?stock=${code}&market=${market}&_priority=background${providerParam}`
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url)) })
  } catch (error) {
    if (allowEastmoneyFallback) return fetchMoneyFlowRankFallback(code, error)
    throw error
  }
  if (!res.ok) {
    const error = new Error(`${source} money flow failed: ${res.status}`)
    if (allowEastmoneyFallback) return fetchMoneyFlowRankFallback(code, error)
    throw error
  }
  const json = await res.json() as any
  const rows = json.data as any[]
  if (!rows?.length) {
    const error = new Error(`${source} money flow returned no rows`)
    if (allowEastmoneyFallback) return fetchMoneyFlowRankFallback(code, error)
    throw error
  }

  const data: MoneyFlowRow[] = rows.slice(-days).map((r) => ({
    code,
    date: String(r['日期'] ?? r.date ?? '').substring(0, 10),
    main_net: Number(r['主力净流入-净额'] ?? 0),
    small_net: Number(r['小单净流入-净额'] ?? 0),
    medium_net: Number(r['中单净流入-净额'] ?? 0),
    large_net: Number(r['大单净流入-净额'] ?? 0),
    super_large_net: Number(r['超大单净流入-净额'] ?? 0),
    close_price: r['收盘价'] != null ? Number(r['收盘价']) : null,
    change_pct: r['涨跌幅'] != null ? Number(r['涨跌幅']) : null,
    source,
  }))

  return { data, source, fetchedAt: new Date().toISOString() }
}

async function fetchMoneyFlowRankFallback(code: string, cause: unknown): Promise<FetchResult<MoneyFlowRow>> {
  try {
    return await fetchMoneyFlowUlistFallback(code)
  } catch (ulistError) {
    return fetchMoneyFlowRankBackup(code, `${errorMessage(cause)}; ulist=${errorMessage(ulistError)}`)
  }
}

async function fetchMoneyFlowUlistFallback(code: string): Promise<FetchResult<MoneyFlowRow>> {
  const cleanCode = compactCode(code)
  const params = new URLSearchParams({
    secids: eastmoneySecid(cleanCode),
    fields: 'f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f124',
    fltt: '2',
    invt: '2',
    ut: 'b2884a393a59ad64002292a3e90d46a5',
  })
  const res = await fetch(`https://push2delay.eastmoney.com/api/qt/ulist.np/get?${params}`, {
    signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl('https://push2delay.eastmoney.com/api/qt/ulist.np/get')),
    headers: {
      Referer: 'https://quote.eastmoney.com/',
      'User-Agent': 'Mozilla/5.0',
    },
  })
  if (!res.ok) throw new Error(`EastMoney ulist money flow failed: ${res.status}`)
  const json = await res.json() as any
  const row = json?.data?.diff?.[0]
  if (!row || String(row.f12 ?? '') !== cleanCode) throw new Error(`EastMoney ulist money flow had no row for ${cleanCode}`)
  return {
    data: [{
      code: cleanCode,
      date: dateFromEastmoneyTimestamp(row.f124),
      main_net: Number(row.f62 ?? 0),
      small_net: Number(row.f84 ?? 0),
      medium_net: Number(row.f78 ?? 0),
      large_net: Number(row.f72 ?? 0),
      super_large_net: Number(row.f66 ?? 0),
      close_price: row.f2 != null ? Number(row.f2) : null,
      change_pct: row.f3 != null ? Number(row.f3) : null,
      source: 'eastmoney:ulist_fallback',
    }],
    source: 'eastmoney:ulist_fallback',
    fetchedAt: new Date().toISOString(),
  }
}

async function fetchMoneyFlowRankBackup(code: string, cause: unknown): Promise<FetchResult<MoneyFlowRow>> {
  const url = `${SIDECAR}/akshare/stock_individual_fund_flow_rank?indicator=今日&_priority=background&_provider=eastmoney`
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url)) })
  if (!res.ok) throw new Error(`AkShare money flow failed and flow-rank fallback failed: ${res.status}; cause=${errorMessage(cause)}`)
  const json = await res.json() as any
  const rows = (json.data as any[] | undefined) ?? []
  const cleanCode = compactCode(code)
  const row = rows.find((item) => String(item['代码'] ?? item.code ?? item['股票代码'] ?? '') === cleanCode)
  if (!row) throw new Error(`AkShare money flow failed and flow-rank fallback had no row for ${cleanCode}; cause=${errorMessage(cause)}`)
  return {
    data: [{
      code: cleanCode,
      date: today(),
      main_net: Number(row['今日主力净流入-净额'] ?? row['主力净流入-净额'] ?? 0),
      small_net: 0,
      medium_net: Number(row['今日中单净流入-净额'] ?? row['中单净流入-净额'] ?? 0),
      large_net: Number(row['今日大单净流入-净额'] ?? row['大单净流入-净额'] ?? 0),
      super_large_net: Number(row['今日超大单净流入-净额'] ?? row['超大单净流入-净额'] ?? 0),
      close_price: row['最新价'] != null ? Number(row['最新价']) : null,
      change_pct: row['今日涨跌幅'] != null ? Number(row['今日涨跌幅']) : row['涨跌幅'] != null ? Number(row['涨跌幅']) : null,
      source: 'akshare:flow_rank_fallback',
    }],
    source: 'akshare:flow_rank_fallback',
    fetchedAt: new Date().toISOString(),
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function compactCode(code: string): string {
  return code.replace(/\.(SH|SZ|BJ)$/i, '').replace(/^(SH|SZ|BJ)/i, '')
}

function eastmoneySecid(code: string): string {
  return code.startsWith('6') ? `1.${code}` : `0.${code}`
}

function dateFromEastmoneyTimestamp(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return today()
  return new Date(n * 1000).toISOString().slice(0, 10)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
