import { globalApiStats } from './resilience'
import { fetchSidecarJson, isSidecarStartupError } from './sidecar-http'
import type { DataStore } from './store/data-store'
import { resolveStockNames, saveStockNames } from './symbol-name-cache'
import { trackedFetchJSON } from './tracked-fetch'
import { providerForAksharePath, type AkshareProvider } from './akshare-provider-hints'
import { EASTMONEY_RUNTIME_TIMEOUT_MS, timeoutForEastmoneyBackedUrl } from './provider-timeouts'

const SIDECAR = 'http://127.0.0.1:19800'
const BACKGROUND_TIMEOUT_MS = EASTMONEY_RUNTIME_TIMEOUT_MS
const EASTMONEY_TIMEOUT_MS = EASTMONEY_RUNTIME_TIMEOUT_MS
const EASTMONEY_CLIST_URL = 'https://push2delay.eastmoney.com/api/qt/clist/get'
type AksharePriority = 'interactive' | 'background'
export interface AkshareRequestOptions {
  priority?: AksharePriority
  provider?: AkshareProvider
  timeout?: number
}

async function sidecarGet(path: string, options: number | AkshareRequestOptions = 15000): Promise<any> {
  const priority = typeof options === 'number' ? undefined : options.priority
  const provider = typeof options === 'number' ? providerForAksharePath(path) : (options.provider ?? providerForAksharePath(path))
  const requestPath = withAkshareControls(path, priority, provider)
  const fallbackTimeout = typeof options === 'number' ? options : 15000
  const timeout = typeof options === 'number'
    ? timeoutForEastmoneyBackedUrl(requestPath, fallbackTimeout)
    : (options.timeout ?? timeoutForEastmoneyBackedUrl(requestPath, fallbackTimeout))
  const start = Date.now()
  let recorded = false
  try {
    const res = await fetchSidecarJson(requestPath, { timeoutMs: timeout })
    globalApiStats.record({
      source: provider ? `akshare:${provider}` : 'akshare',
      url: path.split('?')[0],
      status: res.status,
      durationMs: Date.now() - start,
      success: res.ok,
      timestamp: new Date().toISOString(),
      tool: 'MarketData',
      action: path.split('?')[0],
    })
    recorded = true
    if (!res.ok) throw new Error(`sidecar ${requestPath}: ${res.status}`)
    return res.json()
  } catch (err) {
    if (!recorded && !isSidecarStartupError(err)) {
      globalApiStats.record({
        source: provider ? `akshare:${provider}` : 'akshare',
        url: path.split('?')[0],
        status: 0,
        durationMs: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
        tool: 'MarketData',
        action: path.split('?')[0],
      })
    }
    throw err
  }
}

function withAkshareControls(path: string, priority?: AksharePriority, provider?: AkshareProvider): string {
  const controls = new URLSearchParams()
  if (priority) controls.set('_priority', priority)
  if (provider) controls.set('_provider', provider)
  const suffix = controls.toString()
  if (!suffix) return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}${suffix}`
}

export function backgroundAkshareOptions(): AkshareRequestOptions {
  return { priority: 'background', provider: 'eastmoney', timeout: BACKGROUND_TIMEOUT_MS }
}

function akshareDate(date?: string): string | undefined {
  if (!date) return undefined
  return date.replaceAll('-', '')
}

function dashDate(date?: string): string {
  if (!date) return localDashDate()
  const compact = date.replaceAll('-', '')
  if (compact.length !== 8) return date
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
}

function localDashDate(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function eastmoneyUrl(base: string, params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value))
  }
  return `${base}?${qs}`
}

async function eastmoneyGet(base: string, params: Record<string, string | number | undefined>): Promise<any> {
  return trackedFetchJSON(eastmoneyUrl(base, params), {
    headers: {
      Referer: 'https://quote.eastmoney.com/',
    },
  }, EASTMONEY_TIMEOUT_MS) as Promise<any>
}

async function eastmoneyPost(url: string, body: Record<string, unknown>): Promise<any> {
  return trackedFetchJSON(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: 'https://guba.eastmoney.com/',
    },
    body: JSON.stringify(body),
  }, EASTMONEY_TIMEOUT_MS) as Promise<any>
}

function datacenterParams(params: Record<string, string | number | undefined>): Record<string, string | number | undefined> {
  return {
    source: 'WEB',
    client: 'WEB',
    ...params,
  }
}

function compactMarketCode(raw: unknown): string {
  return String(raw ?? '').replace(/^S[HZ]/i, '').replace(/^\d\./, '')
}

export interface LimitUpItem {
  code: string; name: string; price: number; changePct: number
  amount: number; turnoverRate: number; firstLimitTime: string
  lastLimitTime: string; limitCount: number; days: number; industry: string
}

export async function fetchLimitUpPool(date?: string, options: AkshareRequestOptions = {}): Promise<LimitUpItem[]> {
  const params = akshareDate(date) ? `?date=${akshareDate(date)}` : ''
  const json = await sidecarGet(`/akshare/stock_zt_pool_em${params}`, options)
  const data = json.data as any[]
  if (!data?.length) return []
  return data.map((d: any) => ({
    code: String(d['代码'] ?? ''), name: String(d['名称'] ?? ''),
    price: Number(d['最新价'] ?? 0), changePct: Number(d['涨跌幅'] ?? 0),
    amount: Number(d['成交额'] ?? 0), turnoverRate: Number(d['换手率'] ?? 0),
    firstLimitTime: String(d['首次封板时间'] ?? ''), lastLimitTime: String(d['最后封板时间'] ?? ''),
    limitCount: Number(d['炸板次数'] ?? 0), days: Number(d['连板数'] ?? 1),
    industry: String(d['所属行业'] ?? ''),
  }))
}

export interface DragonTigerItem {
  code: string; name: string; tradeDate: string
  accumAmount: number; buyAmt: number; sellAmt: number; netAmt: number
  reason: string
}

export async function fetchDragonTiger(date?: string, limit = 50): Promise<DragonTigerItem[]> {
  const json = await eastmoneyGet('https://datacenter-web.eastmoney.com/api/data/v1/get', datacenterParams({
    reportName: 'RPT_DAILYBILLBOARD_DETAILSNEW',
    columns: 'ALL',
    filter: `(TRADE_DATE>='${dashDate(date)}')`,
    pageNumber: 1,
    pageSize: limit,
    sortColumns: 'ACCUM_AMOUNT',
    sortTypes: -1,
  }))
  const data = json?.result?.data as any[]
  if (!data?.length) return []
  return data.map((d: any) => ({
    code: compactMarketCode(d.SECURITY_CODE ?? d.SECCODE ?? d['代码'] ?? ''),
    name: String(d.SECURITY_NAME_ABBR ?? d.SECURITY_NAME ?? d['名称'] ?? ''),
    tradeDate: String(d.TRADE_DATE ?? d['日期'] ?? '').substring(0, 10),
    accumAmount: Number(d.ACCUM_AMOUNT ?? d.BILLBOARD_AMOUNT ?? d['成交额'] ?? 0),
    buyAmt: Number(d.BUY ?? d.BUY_AMT ?? d.EXPLAIN_BUY ?? d['买入额'] ?? 0),
    sellAmt: Number(d.SELL ?? d.SELL_AMT ?? d.EXPLAIN_SELL ?? d['卖出额'] ?? 0),
    netAmt: Number(d.NET_BUY ?? d.NET_BUY_AMT ?? d['净买额'] ?? 0),
    reason: String(d.EXPLAIN ?? d.REASON ?? d['上榜原因'] ?? ''),
  }))
}

export interface NorthboundFlowItem {
  tradeDate: string
  mutualType: string
  buyAmount: number | null
  sellAmount: number | null
  netBuy: number | null
  holdMarketCap: number | null
}

export interface NorthboundHoldingItem {
  code: string; name: string; tradeDate: string
  holdMarketCap: number; holdRatio: number
}

export async function fetchNorthboundFlow(date?: string, limit = 50, _options: AkshareRequestOptions = {}): Promise<NorthboundFlowItem[]> {
  const filter = date ? `(TRADE_DATE='${dashDate(date)}')` : ''
  const json = await eastmoneyGet('https://datacenter-web.eastmoney.com/api/data/v1/get', datacenterParams({
    reportName: 'RPT_MUTUAL_DEAL_HISTORY',
    columns: 'ALL',
    filter,
    pageNumber: 1,
    pageSize: limit,
    sortColumns: 'TRADE_DATE',
    sortTypes: -1,
  }))
  const data = json?.result?.data as any[]
  if (!data?.length) return []
  return data.map((d: any) => ({
    tradeDate: String(d.TRADE_DATE ?? d['日期'] ?? date ?? '').substring(0, 10),
    mutualType: String(d.MUTUAL_TYPE ?? d['互联互通类别'] ?? d['类型'] ?? 'northbound'),
    buyAmount: nullableNumber(d.BUY_AMT ?? d.BUY_AMOUNT ?? d['买入成交额']),
    sellAmount: nullableNumber(d.SELL_AMT ?? d.SELL_AMOUNT ?? d['卖出成交额']),
    netBuy: nullableNumber(d.NET_BUY_AMT ?? d.NET_BUY ?? d['净买入额']),
    holdMarketCap: nullableNumber(d.HOLD_MARKETCAP ?? d.HOLD_MARKET_CAP ?? d['持股市值']),
  }))
}

export async function fetchNorthboundHolding(code?: string, limit = 50, _options: AkshareRequestOptions = {}): Promise<NorthboundHoldingItem[]> {
  const filter = code ? `(SECURITY_CODE="${compactMarketCode(code)}")` : ''
  const json = await eastmoneyGet('https://datacenter-web.eastmoney.com/api/data/v1/get', datacenterParams({
    reportName: 'RPT_MUTUAL_STOCKHOLDDETAILS',
    columns: 'ALL',
    filter,
    pageNumber: 1,
    pageSize: limit,
    sortColumns: 'HOLD_MARKETCAP',
    sortTypes: -1,
  }))
  const data = json?.result?.data as any[]
  if (!data?.length) return []
  return data.map((d: any) => ({
    code: compactMarketCode(d.SECURITY_CODE ?? d['代码'] ?? code ?? ''),
    name: String(d.SECURITY_NAME ?? d.SECURITY_NAME_ABBR ?? d['名称'] ?? ''),
    tradeDate: String(d.TRADE_DATE ?? d['日期'] ?? '').substring(0, 10),
    holdMarketCap: Number(d.HOLD_MARKETCAP ?? d.HOLD_MARKET_CAP ?? d['持股市值'] ?? 0),
    holdRatio: Number(d.HOLD_SHARES_RATIO ?? d.FREE_SHARES_RATIO ?? d.SHAREHOLD_RATIO ?? d['持股占流通股比'] ?? 0),
  }))
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

export interface HotRankItem {
  code: string; name: string; rank: number; rankChange: number | null; hotValue: number | null
}

export async function fetchHotRank(limit = 50, _options: AkshareRequestOptions = {}, nameStore?: DataStore | null): Promise<HotRankItem[]> {
  const json = await eastmoneyPost('https://emappdata.eastmoney.com/stockrank/getAllCurrentList', {
    appId: 'appId01',
    globalId: '786e4c21-70dc-435a-93bb-38',
    marketType: '',
    pageNo: 1,
    pageSize: limit,
  })
  const data = json.data as any[]
  if (!data?.length) return []
  const rows = data.map((d: any, i: number) => ({
    rawCode: String(d.sc ?? d['代码'] ?? d['股票代码'] ?? ''),
    code: compactMarketCode(d.sc ?? d['代码'] ?? d['股票代码'] ?? ''),
    name: String(d.sn ?? d['名称'] ?? d['股票简称'] ?? ''),
    rank: Number(d.rk ?? i + 1),
    rankChange: nullableNumber(d.rc ?? d.hisRc ?? d['排名变化']),
    hotValue: nullableNumber(d.hv ?? d['热度'] ?? d['人气值']),
  }))
  saveStockNames(nameStore, rows
    .filter((row) => row.name && row.name !== row.code)
    .map((row) => ({ code: row.code, name: row.name })))
  const names = await resolveStockNames(
    rows.map((row) => row.code),
    nameStore,
    (missingCodes) => fetchQuoteNames(missingCodes),
  )
  return rows.map(({ rawCode: _rawCode, ...row }) => ({
    ...row,
    name: row.name || names.get(row.code) || '',
  }))
}

async function fetchQuoteNames(codes: string[]): Promise<Map<string, string>> {
  const secids = codes.map(eastmoneySecid).filter(Boolean)
  if (secids.length === 0) return new Map()
  try {
    const json = await eastmoneyGet('https://push2delay.eastmoney.com/api/qt/ulist.np/get', {
      secids: secids.join(','),
      fields: 'f12,f14',
      fltt: 2,
      invt: 2,
    })
    const data = json?.data?.diff as any[]
    if (!data?.length) return new Map()
    return new Map(data
      .map((d: any) => [compactMarketCode(d.f12), String(d.f14 ?? '')] as const)
      .filter(([, name]) => name))
  } catch {
    return new Map()
  }
}

function eastmoneySecid(raw: string): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  const code = compactMarketCode(text)
  if (!code) return ''
  if (/^SH/i.test(text) || code.startsWith('6')) return `1.${code}`
  return `0.${code}`
}

export interface FlowRankItem {
  code: string; name: string; mainNetInflow: number; changePct: number
}

export async function fetchFlowRanking(days = 1): Promise<FlowRankItem[]> {
  const period = days >= 10 ? '10日' : days >= 5 ? '5日' : days >= 3 ? '3日' : '今日'
  const fieldsByPeriod: Record<string, { fid: string; main: string; pct: string; fields: string }> = {
    '今日': { fid: 'f62', main: 'f62', pct: 'f3', fields: 'f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f204,f205,f124' },
    '3日': { fid: 'f267', main: 'f267', pct: 'f127', fields: 'f12,f14,f2,f127,f267,f268,f269,f270,f271,f272,f273,f274,f275,f276,f257,f258,f124' },
    '5日': { fid: 'f164', main: 'f164', pct: 'f109', fields: 'f12,f14,f2,f109,f164,f165,f166,f167,f168,f169,f170,f171,f172,f173,f257,f258,f124' },
    '10日': { fid: 'f174', main: 'f174', pct: 'f160', fields: 'f12,f14,f2,f160,f174,f175,f176,f177,f178,f179,f180,f181,f182,f183,f260,f261,f124' },
  }
  const cfg = fieldsByPeriod[period]
  const json = await eastmoneyGet(EASTMONEY_CLIST_URL, {
    fid: cfg.fid,
    po: 1,
    pz: 100,
    pn: 1,
    np: 1,
    fltt: 2,
    invt: 2,
    ut: 'b2884a393a59ad64002292a3e90d46a5',
    fs: 'm:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2,m:0+t:7+f:!2,m:1+t:3+f:!2',
    fields: cfg.fields,
  })
  const data = json?.data?.diff as any[]
  if (!data?.length) return []
  return data.map((d: any) => ({
    code: compactMarketCode(d.f12 ?? d['代码'] ?? ''),
    name: String(d.f14 ?? d['名称'] ?? ''),
    mainNetInflow: Number(d[cfg.main] ?? d['主力净流入-净额'] ?? 0),
    changePct: Number(d[cfg.pct] ?? d['涨跌幅'] ?? d['最新涨跌幅'] ?? 0),
  }))
}

export interface LimitDownItem {
  code: string; name: string; price: number; changePct: number
  amount: number; turnoverRate: number; industry: string
}

export async function fetchLimitDownPool(date?: string, options: AkshareRequestOptions = {}): Promise<LimitDownItem[]> {
  const params = akshareDate(date) ? `?date=${akshareDate(date)}` : ''
  const json = await sidecarGet(`/akshare/stock_zt_pool_dtgc_em${params}`, options)
  const data = json.data as any[]
  if (!data?.length) return []
  return data.map((d: any) => ({
    code: String(d['代码'] ?? ''), name: String(d['名称'] ?? ''),
    price: Number(d['最新价'] ?? 0), changePct: Number(d['涨跌幅'] ?? 0),
    amount: Number(d['成交额'] ?? 0), turnoverRate: Number(d['换手率'] ?? 0),
    industry: String(d['所属行业'] ?? ''),
  }))
}

export interface ContinuousLimitItem {
  code: string; name: string; price: number; changePct: number
  days: number; industry: string; firstLimitTime: string
}

export async function fetchContinuousLimitPool(date?: string): Promise<ContinuousLimitItem[]> {
  const params = akshareDate(date) ? `?date=${akshareDate(date)}` : ''
  const json = await sidecarGet(`/akshare/stock_zt_pool_strong_em${params}`)
  const data = json.data as any[]
  if (!data?.length) return []
  return data.map((d: any) => ({
    code: String(d['代码'] ?? ''), name: String(d['名称'] ?? ''),
    price: Number(d['最新价'] ?? 0), changePct: Number(d['涨跌幅'] ?? 0),
    days: Number(d['连板数'] ?? 0), industry: String(d['所属行业'] ?? ''),
    firstLimitTime: String(d['首次封板时间'] ?? ''),
  }))
}

export interface FailedLimitItem {
  code: string; name: string; price: number; changePct: number
  amount: number; turnoverRate: number; industry: string
}

export async function fetchFailedLimitPool(date?: string): Promise<FailedLimitItem[]> {
  const params = akshareDate(date) ? `?date=${akshareDate(date)}` : ''
  const json = await sidecarGet(`/akshare/stock_zt_pool_zbgc_em${params}`)
  const data = json.data as any[]
  if (!data?.length) return []
  return data.map((d: any) => ({
    code: String(d['代码'] ?? ''), name: String(d['名称'] ?? ''),
    price: Number(d['最新价'] ?? 0), changePct: Number(d['涨跌幅'] ?? 0),
    amount: Number(d['成交额'] ?? 0), turnoverRate: Number(d['换手率'] ?? 0),
    industry: String(d['所属行业'] ?? ''),
  }))
}

export interface UnusualActivityItem {
  code: string; name: string; price: number; changePct: number
  type: string; time: string; description?: string
}

export async function fetchUnusualActivity(): Promise<UnusualActivityItem[]> {
  const json = await eastmoneyGet('https://push2ex.eastmoney.com/getAllStockChanges', {
    ut: '7eea3edcaed734bea9cbfc24409ed989',
    dpt: 'wzchanges',
    type: '',
    pageindex: 1,
    pagesize: 50,
  })
  const data = json?.data?.allstock as any[]
  if (!data?.length) return []
  return data.slice(0, 50).map((d: any) => ({
    code: compactMarketCode(d.c ?? d['代码'] ?? ''),
    name: String(d.n ?? d['名称'] ?? ''),
    price: Number(d.p ?? d['最新价'] ?? 0),
    changePct: Number(d.zdp ?? d['涨跌幅'] ?? 0),
    type: String(d.t ?? d['异动类型'] ?? d['变动类型'] ?? ''),
    time: String(d.tm ?? d['时间'] ?? ''),
    description: String(d.i ?? d['相关信息'] ?? ''),
  }))
}
