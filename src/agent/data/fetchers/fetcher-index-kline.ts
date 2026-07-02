import type { KlineRow } from '../store/data-store'
import {
  type DataApiProviderCapability,
} from '../data-api-interface-contract'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data-api-interface-router'
import { readKlineRows } from '../data-api-interface-cache'
import type { FetchResult } from './base-fetcher'
import { normalizeTdxKlineRows, tdxMarketForCode } from '../normalizers/tdx-normalizer'
import {
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  strictCacheSourceFromFetchOptions,
  type DataApiFetchOptions,
} from './fetcher-interface-utils'
import { timeoutForEastmoneyBackedUrl } from '../provider-timeouts'
import { tencentDailyKline } from '../tencent-fetcher'

const GOTDX = 'http://127.0.0.1:19801'
const SIDECAR = 'http://127.0.0.1:19800'

const PRESET_INDICES = [
  { code: '000001', name: '上证指数' },
  { code: '399001', name: '深证成指' },
  { code: '399006', name: '创业板指' },
  { code: '000300', name: '沪深300' },
  { code: '000905', name: '中证500' },
  { code: '000852', name: '中证1000' },
]

export function getPresetIndices(): Array<{ code: string; name: string }> {
  return PRESET_INDICES.map((i) => ({ code: i.code, name: i.name }))
}

export async function fetchIndexKline(
  indexCode: string,
  opts: DataApiFetchOptions & { start?: string; end?: string } = {},
): Promise<FetchResult<KlineRow>> {
  const routed = await runDataApiInterfaceRoute(
    'index.daily_kline',
    (capability) => indexKlineSource(capability, indexCode, opts),
    {
      label: `index kline for ${indexCode}`,
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => {
        let rows = readKlineRows(indexCode, {
          start: opts.start,
          end: opts.end,
          adjust: 'none',
          source: strictCacheSourceFromFetchOptions(opts),
          minRows: 1,
        })
        if (rows.length === 0) {
          rows = readKlineRows(indexCode, {
            start: opts.start,
            end: opts.end,
            adjust: 'qfq',
            source: strictCacheSourceFromFetchOptions(opts),
            minRows: 1,
          })
        }
        return rows.length > 0 ? { data: rows, source: 'local', fetchedAt: new Date().toISOString() } : null
      },
      ...providerConstraintFromFetchOptions(opts),
    },
  )
  return withIndexKlineProvenance(routed.data, {
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: routed.cacheDecision,
  })
}

function indexKlineSource(
  capability: DataApiProviderCapability,
  indexCode: string,
  opts: { start?: string; end?: string },
): DataApiInterfaceRoute<FetchResult<KlineRow>> | null {
  const provider = capability.provider
  if (provider === 'tdx')
    return { capability, run: () => fetchIndexKlineTdx(indexCode, opts) }
  if (provider === 'eastmoney')
    return {
      capability,
      source: 'eastmoney',
      run: () => fetchIndexKlineEastmoney(indexCode, opts),
    }
  if (provider === 'akshare')
    return { capability, run: () => fetchIndexKlineAkshare(indexCode, opts, 'akshare') }
  if (provider === 'tencent')
    return {
      capability,
      source: 'tencent',
      run: () => fetchIndexKlineTencent(indexCode, opts),
    }
  return null
}

function withIndexKlineProvenance(
  result: FetchResult<KlineRow>,
  meta: {
    interfaceId: string
    capabilityId: string
    provider: string
    cacheStatus: 'cache-hit' | 'provider-hit'
    cacheMode?: 'cache-first' | 'live-only' | 'cache-only'
    cacheDecision?: string
  },
): FetchResult<KlineRow> {
  return {
    ...result,
    provenance: {
      interfaceId: meta.interfaceId,
      capabilityId: meta.capabilityId,
      provider: meta.provider,
      source: result.source,
      canonicalSchema: 'kline_daily',
      canonicalTable: 'kline_daily',
      cacheStatus: meta.cacheStatus,
      cacheMode: meta.cacheMode,
      cacheDecision: meta.cacheDecision,
      fetchedAt: result.fetchedAt,
    },
  }
}

async function fetchIndexKlineTdx(
  indexCode: string,
  opts: { start?: string; end?: string },
): Promise<FetchResult<KlineRow>> {
  const params = new URLSearchParams({
    code: indexCode,
    market: tdxMarketForCode(indexCode, true),
    category: '9',
    count: '800',
  })

  const res = await fetch(`${GOTDX}/index_bars?${params}`, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`TDX index kline: ${res.status}`)
  const json = await res.json()
  const data = normalizeTdxKlineRows(json, {
    code: indexCode,
    source: 'tdx:index_bars',
    start: opts.start,
    end: opts.end,
    index: true,
  })
  if (data.length === 0) throw new Error('TDX index kline returned no validated rows')
  return { data, source: 'tdx', fetchedAt: new Date().toISOString() }
}

async function fetchIndexKlineAkshare(
  indexCode: string,
  opts: { start?: string; end?: string },
  source: 'akshare' | 'eastmoney' = 'akshare',
): Promise<FetchResult<KlineRow>> {
  const params = new URLSearchParams({
    symbol: akshareIndexSymbol(indexCode),
    _priority: 'background',
  })
  if (source === 'eastmoney') params.set('_provider', 'eastmoney')
  if (opts.start) params.set('start_date', opts.start.replace(/-/g, ''))
  if (opts.end) params.set('end_date', opts.end.replace(/-/g, ''))

  const url = `${SIDECAR}/akshare/stock_zh_index_daily_em?${params}`
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url)) })
  if (!res.ok) throw new Error(`AkShare index kline: ${res.status}`)
  const json = (await res.json()) as any
  const rows = json.data as any[]
  if (!rows?.length)
    return { data: [], source: 'akshare', fetchedAt: new Date().toISOString() }

  const data: KlineRow[] = rows
    .map((r) => ({
      code: indexCode,
      date: String(r['日期'] ?? r.date ?? '').substring(0, 10),
      open: Number(r['开盘'] ?? r.open ?? 0),
      high: Number(r['最高'] ?? r.high ?? 0),
      low: Number(r['最低'] ?? r.low ?? 0),
      close: Number(r['收盘'] ?? r.close ?? 0),
      volume: Number(r['成交量'] ?? r.volume ?? 0),
      amount: Number(r['成交额'] ?? r.amount ?? 0),
      change_pct: r['涨跌幅'] != null ? Number(r['涨跌幅']) : null,
      turnover_rate: r['换手率'] != null ? Number(r['换手率']) : null,
      adjust: 'none',
      source,
    }))
    .filter((r) => r.close > 0)

  return { data, source, fetchedAt: new Date().toISOString() }
}

async function fetchIndexKlineEastmoney(
  indexCode: string,
  opts: { start?: string; end?: string },
): Promise<FetchResult<KlineRow>> {
  const params = new URLSearchParams({
    secid: eastmoneyIndexSecId(indexCode),
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt: '101',
    fqt: '0',
    beg: opts.start ? opts.start.replace(/-/g, '') : '0',
    end: opts.end ? opts.end.replace(/-/g, '') : '20500101',
  })
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url, 60_000)) })
  if (!res.ok) throw new Error(`EastMoney index kline: ${res.status}`)
  const json = (await res.json()) as any
  const rows = Array.isArray(json?.data?.klines) ? json.data.klines : []
  if (!rows.length) throw new Error('EastMoney index kline returned no rows')

  const data: KlineRow[] = rows
    .map((line: unknown) => {
      const parts = String(line ?? '').split(',')
      return {
        code: indexCode,
        date: String(parts[0] ?? '').substring(0, 10),
        open: Number(parts[1] ?? 0),
        high: Number(parts[3] ?? 0),
        low: Number(parts[4] ?? 0),
        close: Number(parts[2] ?? 0),
        volume: Number(parts[5] ?? 0),
        amount: Number(parts[6] ?? 0),
        change_pct: parts[8] != null ? Number(parts[8]) : null,
        turnover_rate: parts[10] != null ? Number(parts[10]) : null,
        adjust: 'none',
        source: 'eastmoney',
      }
    })
    .filter((row: KlineRow) => {
      if (!row.date || row.close <= 0) return false
      if (opts.start && row.date < opts.start) return false
      if (opts.end && row.date > opts.end) return false
      return true
    })
  if (!data.length) throw new Error('EastMoney index kline returned no valid rows')
  return { data, source: 'eastmoney', fetchedAt: new Date().toISOString() }
}

async function fetchIndexKlineTencent(
  indexCode: string,
  opts: { start?: string; end?: string },
): Promise<FetchResult<KlineRow>> {
  const data = await tencentDailyKline(indexCode, {
    start: opts.start,
    end: opts.end,
    adjust: 'qfq',
    index: true,
  })
  return { data, source: 'tencent', fetchedAt: new Date().toISOString() }
}

function akshareIndexSymbol(code: string): string {
  if (/^(sh|sz|csi|bj)/i.test(code)) return code
  if (code.startsWith('399')) return `sz${code}`
  if (code === '000001') return `sh${code}`
  return `csi${code}`
}

function eastmoneyIndexSecId(code: string): string {
  const clean = code.replace(/^(sh|sz|csi|bj)/i, '')
  return `${clean.startsWith('399') ? '0' : '1'}.${clean}`
}
