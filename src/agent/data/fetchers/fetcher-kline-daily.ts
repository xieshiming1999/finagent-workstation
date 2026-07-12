import type { KlineRow } from '../store/data-store'
import { normalizeTdxKlineRows, tdxMarketForCode } from '../normalizers/tdx-normalizer'
import { readKlineRows } from '../data-api-interface-cache'
import {
  type DataApiProviderCapability,
} from '../data-api-interface-contract'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data-api-interface-router'
import type { FetchResult } from './base-fetcher'
import {
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  strictCacheSourceFromFetchOptions,
  type DataApiFetchOptions,
} from './fetcher-interface-utils'
import { timeoutForEastmoneyBackedUrl } from '../provider-timeouts'
import { tencentDailyKline } from '../tencent-fetcher'
import { isConvertibleBondCode } from './fetcher-quote'

const GOTDX = 'http://127.0.0.1:19801'
const SIDECAR = 'http://127.0.0.1:19800'

export async function fetchKlineDaily(
  code: string,
  opts: DataApiFetchOptions & { start?: string; end?: string; adjust?: string; market?: string; instrumentType?: 'stock' | 'etf' | 'convertible_bond' } = {},
): Promise<FetchResult<KlineRow>> {
  const market = opts.market ?? guessMarket(code)
  const interfaceId = opts.instrumentType === 'convertible_bond' || isConvertibleBondCode(code)
    ? 'bond.convertible_daily_kline'
    : opts.instrumentType === 'etf' || isChinaEtfCode(code)
      ? 'fund.etf_daily_ohlcv_bars'
      : 'stock.daily_kline'
  const requestedProviders = [
    opts.provider,
    ...(opts.providers ?? []),
  ].filter((provider): provider is string => Boolean(provider))
  const adjust = opts.adjust ?? (interfaceId === 'bond.convertible_daily_kline'
    ? 'none'
    : requestedProviders.includes('sina') ? 'none' : 'qfq')
  if (interfaceId === 'bond.convertible_daily_kline' && adjust !== 'none') {
    throw new Error('Convertible bond daily K-line is governed only for unadjusted Tencent bars; use adjust:"none".')
  }
  try {
    return await fetchKlineDailyWithAdjust(code, opts, {
      adjust,
      market,
      interfaceId,
      requestedProviders,
    })
  } catch (error) {
    if (!shouldFallbackToUnadjustedKline(adjust, requestedProviders, interfaceId)) throw error
    const fallback = await fetchKlineDailyWithAdjust(code, opts, {
      adjust: 'none',
      market,
      interfaceId,
      requestedProviders,
      fallbackReason: `Adjusted ${adjust} provider route failed; returned governed unadjusted daily K-line instead. Original failure: ${error instanceof Error ? error.message : String(error)}`,
    })
    return fallback
  }
}

async function fetchKlineDailyWithAdjust(
  code: string,
  opts: DataApiFetchOptions & { start?: string; end?: string; adjust?: string; market?: string; instrumentType?: 'stock' | 'etf' | 'convertible_bond' },
  route: {
    adjust: string
    market: string
    interfaceId: string
    requestedProviders: string[]
    fallbackReason?: string
  },
): Promise<FetchResult<KlineRow>> {
  const { adjust, market, interfaceId, requestedProviders, fallbackReason } = route
  const effectiveOpts = (market === 'US' || market === 'HK') && !opts.provider && !opts.providers?.length
    ? { ...opts, provider: 'yahoo', providerMode: 'strict' as const, allowFallback: false }
    : opts

  const routed = await runDataApiInterfaceRoute(
    interfaceId,
    (capability) => klineSource(capability, code, adjust, opts.start, opts.end, market, interfaceId),
    {
      label: `kline for ${code}`,
      ...providerConstraintFromFetchOptions({
        ...effectiveOpts,
        allowDegraded: effectiveOpts.allowDegraded ?? Boolean(effectiveOpts.providers?.length),
      }),
      cacheMode: cacheModeFromFetchOptions(effectiveOpts),
      readCache: () => {
        const rows = readKlineRows(code, {
          start: opts.start,
          end: opts.end,
          adjust,
          source: strictCacheSourceFromFetchOptions(effectiveOpts),
          minRows: opts.start || opts.end ? 1 : 10,
        })
        if (rows.length === 0) return null
        const fetchedAt = new Date().toISOString()
        return { data: rows, source: 'local', fetchedAt }
      },
    },
  )
  return withKlineProvenance(routed.data, {
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    canonicalTable: 'kline_daily',
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: fallbackReason
      ? `${fallbackReason}; ${routed.cacheDecision ?? 'provider route returned rows'}`
      : routed.cacheDecision,
  })
}

function shouldFallbackToUnadjustedKline(
  adjust: string,
  requestedProviders: string[],
  interfaceId: string,
): boolean {
  return adjust !== 'none' &&
    requestedProviders.length === 0 &&
    (interfaceId === 'stock.daily_kline' || interfaceId === 'fund.etf_daily_ohlcv_bars')
}

function klineSource(
  capability: DataApiProviderCapability,
  code: string,
  adjust: string,
  start?: string,
  end?: string,
  market?: string,
  interfaceId = 'stock.daily_kline',
): DataApiInterfaceRoute<FetchResult<KlineRow>> | null {
  const provider = capability.provider
  if (provider === 'tdx') return { capability, run: () => fetchKlineTdx(code, start, end) }
  if (provider === 'eastmoney')
    return {
      capability,
      source: 'eastmoney',
      run: () => fetchKlineEastmoney(code, adjust, start, end),
    }
  if (provider === 'sina')
    return {
      capability,
      source: 'sina',
      run: () => fetchKlineSina(code, adjust, start, end),
    }
  if (provider === 'tencent')
    return {
      capability,
      source: 'tencent',
      run: () => fetchKlineTencent(code, adjust, start, end),
    }
  if (provider === 'akshare' && interfaceId === 'fund.etf_daily_ohlcv_bars')
    return {
      capability,
      source: 'akshare',
      run: () => fetchKlineAkShareEtf(code, adjust, start, end),
    }
  if (provider === 'akshare')
    return { capability, run: () => fetchKlineAkShare(code, adjust, start, end, 'akshare') }
  if (provider === 'yahoo')
    return {
      capability,
      source: 'yfinance',
      run: () => fetchKlineYfinance(code, start, end, market),
    }
  return null
}

async function fetchKlineAkShareEtf(
  code: string,
  adjust: string,
  start?: string,
  end?: string,
): Promise<FetchResult<KlineRow>> {
  const params = new URLSearchParams({
    symbol: sinaStockSymbol(code),
    _priority: 'background',
  })
  if (start) params.set('start_date', start.replace(/-/g, ''))
  if (end) params.set('end_date', end.replace(/-/g, ''))
  const url = `${SIDECAR}/akshare/fund_etf_hist_sina?${params}`
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url)) })
  if (!res.ok) throw new Error(`AkShare/Sina ETF kline: ${res.status}`)
  const json = (await res.json()) as any
  const rows = (json.data ?? json) as Array<Record<string, unknown>>
  const now = new Date().toISOString()
  const data: KlineRow[] = rows
    .map((row) => ({
      code,
      date: formatDate(String(row.date ?? row['日期'] ?? '')),
      open: Number(row.open ?? row['开盘'] ?? 0),
      high: Number(row.high ?? row['最高'] ?? 0),
      low: Number(row.low ?? row['最低'] ?? 0),
      close: Number(row.close ?? row['收盘'] ?? 0),
      volume: Number(row.volume ?? row['成交量'] ?? 0),
      amount: Number(row.amount ?? row['成交额'] ?? 0),
      change_pct: null,
      turnover_rate: null,
      adjust,
      source: 'akshare:sina',
    }))
    .filter((row) => row.date && row.close > 0)

  if (data.length === 0) throw new Error('AkShare/Sina ETF kline: no valid bars')
  return { data, source: 'akshare:sina', fetchedAt: now }
}

function withKlineProvenance(
  result: FetchResult<KlineRow>,
  meta: {
    interfaceId: string
    capabilityId: string
    provider: string
    canonicalTable: string
    cacheStatus?: 'cache-hit' | 'provider-hit'
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
      canonicalTable: meta.canonicalTable,
      cacheStatus: meta.cacheStatus ?? 'provider-hit',
      cacheMode: meta.cacheMode,
      cacheDecision: meta.cacheDecision,
      fetchedAt: result.fetchedAt,
    },
  }
}

async function fetchKlineTdx(
  code: string,
  start?: string,
  end?: string,
): Promise<FetchResult<KlineRow>> {
  const count = 500
  const market = tdxMarketForCode(code)
  const url = `${GOTDX}/kline?code=${encodeURIComponent(code)}&market=${market}&category=9&count=${count}`
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`TDX kline: ${res.status}`)
  const json = (await res.json()) as unknown
  const data = normalizeTdxKlineRows(json, { code, start, end, source: 'tdx' })
  if (!data.length) throw new Error('TDX kline: empty')

  const now = new Date().toISOString()
  if (data.length < 10) throw new Error(`TDX kline: only ${data.length} bars`)
  return { data, source: 'tdx', fetchedAt: now }
}

async function fetchKlineAkShare(
  code: string,
  adjust: string,
  start?: string,
  end?: string,
  source: 'akshare' | 'eastmoney' = 'akshare',
): Promise<FetchResult<KlineRow>> {
  const fqt = adjust === 'hfq' ? 'hfq' : adjust === 'none' ? '' : 'qfq'
  const params = new URLSearchParams({
    symbol: code,
    period: 'daily',
    adjust: fqt,
    _priority: 'background',
  })
  if (source === 'eastmoney') params.set('_provider', 'eastmoney')
  if (start) params.set('start_date', start.replace(/-/g, ''))
  if (end) params.set('end_date', end.replace(/-/g, ''))

  const url = `${SIDECAR}/akshare/stock_zh_a_hist?${params}`
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url)) })
  if (!res.ok) throw new Error(`AkShare kline: ${res.status}`)
  const json = (await res.json()) as any
  const rows = (json.data ?? json) as Array<Record<string, unknown>>

  const now = new Date().toISOString()
  const data: KlineRow[] = rows
    .map((r) => ({
      code,
      date: formatDate(String(r['日期'] ?? r['date'] ?? '')),
      open: Number(r['开盘'] ?? r['open'] ?? 0),
      high: Number(r['最高'] ?? r['high'] ?? 0),
      low: Number(r['最低'] ?? r['low'] ?? 0),
      close: Number(r['收盘'] ?? r['close'] ?? 0),
      volume: Number(r['成交量'] ?? r['volume'] ?? 0),
      amount: Number(r['成交额'] ?? r['amount'] ?? 0),
      change_pct: Number(r['涨跌幅'] ?? r['change_pct'] ?? 0),
      turnover_rate: Number(r['换手率'] ?? r['turnover_rate'] ?? 0),
      adjust,
      source,
    }))
    .filter((r) => r.date && r.close > 0)

  return { data, source, fetchedAt: now }
}

async function fetchKlineSina(
  code: string,
  adjust: string,
  start?: string,
  end?: string,
): Promise<FetchResult<KlineRow>> {
  if (adjust !== 'none') throw new Error('Sina kline supports only unadjusted bars; use adjust:"none" or another provider for qfq/hfq.')
  const params = new URLSearchParams({
    symbol: sinaStockSymbol(code),
    scale: '240',
    ma: 'no',
    datalen: '1023',
  })
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?${params}`
  const res = await fetch(url, {
    headers: {
      Referer: 'https://finance.sina.com.cn/',
      'User-Agent': 'Mozilla/5.0',
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Sina kline: HTTP ${res.status}`)
  const rows = await res.json() as Array<Record<string, unknown>>
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Sina kline: empty')

  const data = rows
    .map((row) => ({
      code,
      date: formatDate(String(row.day ?? row.date ?? '')),
      open: Number(row.open ?? 0),
      high: Number(row.high ?? 0),
      low: Number(row.low ?? 0),
      close: Number(row.close ?? 0),
      volume: Number(row.volume ?? 0),
      amount: Number(row.amount ?? 0),
      change_pct: null,
      turnover_rate: null,
      adjust: 'none',
      source: 'sina',
    }))
    .filter((row) => row.date && row.close > 0)
    .filter((row) => (!start || row.date >= formatDate(start)) && (!end || row.date <= formatDate(end)))

  if (data.length === 0) throw new Error('Sina kline: no valid bars')
  return { data, source: 'sina', fetchedAt: new Date().toISOString() }
}

async function fetchKlineTencent(
  code: string,
  adjust: string,
  start?: string,
  end?: string,
): Promise<FetchResult<KlineRow>> {
  const rows = await tencentDailyKline(code, { adjust, start, end })
  return { data: rows, source: 'tencent', fetchedAt: new Date().toISOString() }
}

async function fetchKlineEastmoney(
  code: string,
  adjust: string,
  start?: string,
  end?: string,
): Promise<FetchResult<KlineRow>> {
  const fqt = adjust === 'hfq' ? '2' : adjust === 'none' ? '0' : '1'
  const params = new URLSearchParams({
    secid: `${tdxMarketForCode(code)}.${code}`,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt: '101',
    fqt,
    beg: start ? start.replace(/-/g, '') : '0',
    end: end ? end.replace(/-/g, '') : '20500101',
  })
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url, 60_000)),
  })
  if (!res.ok) throw new Error(`EastMoney kline: ${res.status}`)
  const json = (await res.json()) as any
  const rows = Array.isArray(json?.data?.klines) ? json.data.klines : []
  if (!rows.length) throw new Error('EastMoney kline: empty')

  const now = new Date().toISOString()
  const data = normalizeEastmoneyKlineRows(rows, code, adjust)

  if (!data.length) throw new Error('EastMoney kline: no valid bars')
  return { data, source: 'eastmoney', fetchedAt: now }
}

export function normalizeEastmoneyKlineRows(
  rows: unknown[],
  code: string,
  adjust: string,
): KlineRow[] {
  return rows
    .map((line: unknown) => {
      const parts = String(line ?? '').split(',')
      return {
        code,
        date: formatDate(parts[0] ?? ''),
        open: Number(parts[1] ?? 0),
        close: Number(parts[2] ?? 0),
        high: Number(parts[3] ?? 0),
        low: Number(parts[4] ?? 0),
        volume: Number(parts[5] ?? 0),
        amount: Number(parts[6] ?? 0),
        change_pct: Number(parts[8] ?? 0),
        turnover_rate: Number(parts[10] ?? 0),
        adjust,
        source: 'eastmoney',
      }
    })
    .filter((row: KlineRow) => row.date && row.close > 0)
}

async function fetchKlineYfinance(
  code: string,
  start?: string,
  end?: string,
  market?: string,
): Promise<FetchResult<KlineRow>> {
  const symbol = market === 'HK' ? `${code.padStart(4, '0')}.HK` : code
  const params = new URLSearchParams({ symbol, _priority: 'background' })
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  if (!start && !end) params.set('period', '5y')

  const url = `${SIDECAR}/yfinance/history?${params}`
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`yfinance kline: ${res.status}`)
  const json = (await res.json()) as any
  const rows = json.data as Array<Record<string, unknown>>
  if (!rows?.length) throw new Error('yfinance: empty')

  const now = new Date().toISOString()
  const data: KlineRow[] = rows
    .map((r) => ({
      code,
      date: String(r['_index'] ?? '').split(' ')[0],
      open: Number(r['Open'] ?? 0),
      high: Number(r['High'] ?? 0),
      low: Number(r['Low'] ?? 0),
      close: Number(r['Close'] ?? 0),
      volume: Number(r['Volume'] ?? 0),
      amount: null,
      change_pct: null,
      turnover_rate: null,
      adjust: 'none',
      source: 'yfinance',
    }))
    .filter((r) => r.date && r.close > 0)

  return { data, source: 'yfinance', fetchedAt: now }
}

function formatDate(d: string): string {
  if (d.includes('-') && d.length >= 10) return d.substring(0, 10)
  if (d.length === 8)
    return `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`
  return d
}

function guessMarket(code: string): string {
  if (code.startsWith('6')) return 'SH'
  if (code.startsWith('0') || code.startsWith('3')) return 'SZ'
  if (/^[A-Z]/.test(code)) return 'US'
  return 'SZ'
}

function isChinaEtfCode(code: string): boolean {
  const clean = code.replace(/\.(SH|SZ|BJ)$/i, '').replace(/^(SH|SZ|BJ)/i, '')
  return /^(15|16|50|51|52|56|58)\d{4}$/.test(clean)
}

function sinaStockSymbol(code: string): string {
  const clean = code.replace(/\.(SH|SZ|BJ)$/i, '').replace(/^(SH|SZ|BJ)/i, '')
  return `${clean.startsWith('6') ? 'sh' : 'sz'}${clean}`
}
