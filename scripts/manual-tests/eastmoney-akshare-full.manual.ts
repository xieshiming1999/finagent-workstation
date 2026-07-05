import { mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { latestTradingDay, type TradingCalendar } from '../../src/main/trading-calendar'
import { trackedFetch } from '../../src/agent/data/tracked-fetch'

const SIDECAR_URL = process.env.AKSHARE_SIDECAR_URL ?? 'http://127.0.0.1:19800'
const TRADE_DATE = process.env.FIN_API_TEST_DATE ?? compactDate(latestTradingDay(emptyTradingCalendar(), new Date()))
const DASH_DATE = dashedDate(TRADE_DATE)
const DELAY_MS = Number(process.env.FIN_API_PROBE_DELAY_MS ?? 2500)
const TIMEOUT_MS = Number(process.env.FIN_API_PROBE_TIMEOUT_MS ?? 90000)
const INCLUDE_BROAD = process.env.FIN_API_PROBE_BROAD === '1'
const OUT_DIR = process.env.FIN_API_PROBE_OUT_DIR ?? join(homedir(), '.finagent-workstation', 'manual-tests', 'finance-api')
const STOCK_CODE = process.env.FIN_API_TEST_STOCK ?? '600519'
const FUND_CODE = process.env.FIN_API_TEST_FUND ?? '000001'
const INDUSTRY_NAME = process.env.FIN_API_TEST_INDUSTRY ?? '白酒'
const INDUSTRY_CODE = process.env.FIN_API_TEST_INDUSTRY_CODE ?? 'BK0475'
const INDEX_CODE = process.env.FIN_API_TEST_INDEX ?? '000300'

type ProbeKind = 'sidecar-akshare' | 'direct-eastmoney'

interface Probe {
  id: string
  group: string
  kind: ProbeKind
  description: string
  url: string
  method?: 'GET' | 'POST'
  body?: unknown
  headers?: Record<string, string>
  appPath?: string
  finAgentReference?: string
  knownRestriction?: string
}

const BROAD_SIDECAR_PROBES: Probe[] = [
  sidecar('a_spot_sina', 'stock-list', 'A-share stock list via Sina wrapper', '/akshare/stock_zh_a_spot?_priority=background'),
  sidecar('a_spot_eastmoney', 'stock-list', 'A-share stock list via EastMoney wrapper', '/akshare/stock_zh_a_spot_em?_priority=background&_provider=eastmoney'),
  sidecar('hk_spot', 'stock-list', 'HK stock list', '/akshare/stock_hk_spot_em?_priority=background&_provider=eastmoney'),
  sidecar('us_spot', 'stock-list', 'US stock list', '/akshare/stock_us_spot_em?_priority=background&_provider=eastmoney'),
  sidecar('a_kline_akshare', 'kline', 'A-share daily K-line via AkShare wrapper', `/akshare/stock_zh_a_hist?symbol=${STOCK_CODE}&period=daily&adjust=qfq&start_date=20260101&end_date=${TRADE_DATE}&_priority=background&_provider=eastmoney`),
  sidecar('individual_info_akshare', 'stock-profile', 'Individual stock basic info via AkShare wrapper', `/akshare/stock_individual_info_em?symbol=${STOCK_CODE}&_priority=background&_provider=eastmoney`),
  sidecar('hot_rank_akshare', 'rank', 'Hot rank via AkShare wrapper', '/akshare/stock_hot_rank_em?_priority=background&_provider=eastmoney'),
  sidecar('money_flow_rank_akshare', 'money-flow', 'Market-wide fund flow rank via AkShare wrapper', '/akshare/stock_individual_fund_flow_rank?indicator=今日&_priority=background&_provider=eastmoney'),
]

const PROBES: Probe[] = [
  ...(INCLUDE_BROAD ? BROAD_SIDECAR_PROBES : []),
  directEastmoney('a_spot_eastmoney_direct_limited', 'stock-list', 'A-share stock list direct EastMoney limited page', eastmoneyClistUrl({
    fid: 'f12',
    fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048',
    fields: 'f12,f14,f2,f3',
    pz: '5',
  }), { finAgentReference: 'Bounded replacement for AkShare stock_zh_a_spot_em in probes' }),
  directEastmoney('hk_spot_direct_limited', 'stock-list', 'HK stock list direct EastMoney limited page', eastmoneyClistUrl({
    fid: 'f12',
    fs: 'm:128+t:3,m:128+t:4,m:128+t:1,m:128+t:2',
    fields: 'f12,f14,f2,f3',
    pz: '5',
  }), { knownRestriction: 'bounded probe; full AkShare wrapper is opt-in' }),
  directEastmoney('us_spot_direct_limited', 'stock-list', 'US stock list direct EastMoney limited page', eastmoneyClistUrl({
    fid: 'f12',
    fs: 'm:105,m:106,m:107',
    fields: 'f12,f14,f2,f3',
    pz: '5',
  }), { knownRestriction: 'bounded probe; full AkShare wrapper is opt-in' }),
  directEastmoney('individual_info_direct', 'stock-profile', 'Individual stock basic info direct EastMoney', eastmoneyStockGetUrl(STOCK_CODE), { finAgentReference: 'Bounded replacement for AkShare stock_individual_info_em in probes' }),
  sidecar('shareholder_count', 'stock-profile', 'Shareholder count history', '/akshare/stock_zh_a_gdhs?symbol=最新&_priority=background', { knownRestriction: 'symbol is 最新 or quarter-end date, not a stock code' }),
  sidecar('a_kline_route', 'kline', 'A-share daily K-line via app route fallback', `/akshare/stock_zh_a_hist?symbol=${STOCK_CODE}&period=daily&adjust=qfq&start_date=20260101&end_date=${TRADE_DATE}&_priority=background`, { finAgentReference: 'fetchKlineDaily provider route' }),
  sidecar('index_kline', 'kline', 'Index daily K-line', `/akshare/stock_zh_index_daily_em?symbol=${akshareIndexSymbol(INDEX_CODE)}&start_date=20260101&end_date=${TRADE_DATE}&_priority=background&_provider=eastmoney`),
  sidecar('index_spot', 'index', 'Index spot via AkShare/EastMoney', '/akshare/stock_zh_index_spot_em?symbol=沪深重要指数&_priority=background&_provider=eastmoney'),
  directEastmoney('index_spot_direct_limited', 'index', 'Index spot direct EastMoney limited page', eastmoneyClistUrl({
    fid: 'f12',
    fs: 'b:MK0010',
    fields: 'f12,f14,f2,f3',
    pz: '5',
  }), { knownRestriction: 'status bar should use TDX first' }),
  sidecar('quote_sidecar', 'quote', 'Sidecar quote endpoint used as AkShare quote fallback', `/quote?code=${STOCK_CODE}&_priority=background`),
  sidecar('money_flow_stock', 'money-flow', 'Single stock fund flow', `/akshare/stock_individual_fund_flow?stock=${STOCK_CODE}&market=sh&_priority=background&_provider=eastmoney`),
  directEastmoney('money_flow_rank_direct', 'money-flow', 'Market-wide fund flow rank direct EastMoney', eastmoneyClistUrl({
    fid: 'f62',
    fs: 'm:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2,m:0+t:7+f:!2,m:1+t:3+f:!2',
    fields: 'f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f204,f205,f124',
    ut: 'b2884a393a59ad64002292a3e90d46a5',
  }), { finAgentReference: 'EastMoneyAdvancedFetcher.getFlowRanking' }),
  sidecar('sector_industry', 'sector', 'Industry board ranking via AkShare', '/akshare/stock_board_industry_name_em?_priority=background&_provider=eastmoney'),
  sidecar('sector_concept', 'sector', 'Concept board ranking via AkShare', '/akshare/stock_board_concept_name_em?_priority=background&_provider=eastmoney'),
  directEastmoney('sector_cons_direct', 'sector', 'Industry constituent stocks direct EastMoney', eastmoneyClistUrl({
    fid: 'f3',
    fs: `b:${INDUSTRY_CODE} f:!50`,
    fields: 'f2,f3,f4,f5,f6,f7,f8,f9,f12,f14,f15,f16,f17,f18,f20',
    pz: '200',
  }), { finAgentReference: 'EastMoneySectorFetcher.getSectorStocks', knownRestriction: `uses board code ${INDUSTRY_CODE} for ${INDUSTRY_NAME}` }),
  directEastmoney('sector_industry_direct', 'sector', 'Industry board ranking direct EastMoney', eastmoneyClistUrl({
    fid: 'f3',
    fs: 'm:90 t:2 f:!50',
    fields: 'f2,f3,f4,f8,f12,f14,f104,f105,f128,f140,f141',
  }), { finAgentReference: 'EastMoneySectorFetcher.getSectorRanking(industry)' }),
  directEastmoney('sector_concept_direct', 'sector', 'Concept board ranking direct EastMoney', eastmoneyClistUrl({
    fid: 'f3',
    fs: 'm:90 t:3 f:!50',
    fields: 'f2,f3,f4,f8,f12,f14,f104,f105,f128,f140,f141',
  }), { finAgentReference: 'EastMoneySectorFetcher.getSectorRanking(concept)' }),
  sidecar('limit_up', 'limit-pool', 'Limit-up pool', `/akshare/stock_zt_pool_em?date=${TRADE_DATE}&_priority=background&_provider=eastmoney`, { knownRestriction: 'explicit date required' }),
  sidecar('limit_down', 'limit-pool', 'Limit-down pool', `/akshare/stock_zt_pool_dtgc_em?date=${TRADE_DATE}&_priority=background&_provider=eastmoney`, { knownRestriction: 'explicit recent date required' }),
  sidecar('limit_strong', 'limit-pool', 'Strong pool', `/akshare/stock_zt_pool_strong_em?date=${TRADE_DATE}&_priority=background&_provider=eastmoney`, { knownRestriction: 'explicit date required' }),
  sidecar('limit_failed', 'limit-pool', 'Failed limit-up pool', `/akshare/stock_zt_pool_zbgc_em?date=${TRADE_DATE}&_priority=background&_provider=eastmoney`, { knownRestriction: 'explicit recent date required' }),
  directEastmoney('limit_up_direct', 'limit-pool', 'Limit-up pool direct EastMoney', push2exUrl('getTopicZTPool', { date: TRADE_DATE, Ession: TRADE_DATE, sort: 'fbt:asc', pagesize: '10000' }), { finAgentReference: 'EastMoneyAdvancedFetcher.getLimitUpPool' }),
  directEastmoney('limit_down_direct', 'limit-pool', 'Limit-down pool direct EastMoney', push2exUrl('getTopicDTPool', { date: TRADE_DATE, sort: 'fund:asc', pagesize: '10000' }), { finAgentReference: 'EastMoneyAdvancedFetcher.getLimitDownPool' }),
  directEastmoney('limit_strong_direct', 'limit-pool', 'Strong pool direct EastMoney', push2exUrl('getTopicQSPool', { date: TRADE_DATE, sort: 'zdp:desc', pagesize: '5000' }), { finAgentReference: 'EastMoneyAdvancedFetcher.getStrongPool' }),
  directEastmoney('limit_failed_direct', 'limit-pool', 'Failed limit-up pool direct EastMoney', push2exUrl('getTopicZBPool', { date: TRADE_DATE, sort: 'fbt:asc', pagesize: '5000' }), { finAgentReference: 'EastMoneyAdvancedFetcher.getFailedLimitUp' }),
  sidecar('dragon_tiger_sina', 'dragon-tiger', 'Dragon tiger via current AkShare/Sina wrapper', `/akshare/stock_lhb_detail_daily_sina?date=${DASH_DATE}&_priority=background`),
  directEastmoney('dragon_tiger_direct', 'dragon-tiger', 'Dragon tiger direct EastMoney datacenter', datacenterUrl({
    reportName: 'RPT_DAILYBILLBOARD_DETAILSNEW',
    columns: 'ALL',
    filter: `(TRADE_DATE>='${DASH_DATE}')`,
    sortColumns: 'ACCUM_AMOUNT',
    sortTypes: '-1',
    pageNumber: '1',
    pageSize: '50',
  }), { finAgentReference: 'EastMoneyAdvancedFetcher.getDragonTiger' }),
  sidecar('northbound_hist_sh', 'northbound', '沪股通 history via AkShare', '/akshare/stock_hsgt_hist_em?symbol=沪股通&_priority=background&_provider=eastmoney'),
  sidecar('northbound_hist_sz', 'northbound', '深股通 history via AkShare', '/akshare/stock_hsgt_hist_em?symbol=深股通&_priority=background&_provider=eastmoney'),
  sidecar('northbound_hold', 'northbound', 'Northbound holding rank via AkShare', '/akshare/stock_hsgt_hold_stock_em?market=北向&indicator=今日排行&_priority=background&_provider=eastmoney', { knownRestriction: 'no date parameter' }),
  directEastmoney('northbound_flow_direct', 'northbound', 'Northbound flow direct EastMoney datacenter', datacenterUrl({
    reportName: 'RPT_MUTUAL_DEAL_HISTORY',
    columns: 'ALL',
    filter: '',
    sortColumns: 'TRADE_DATE',
    sortTypes: '-1',
    pageNumber: '1',
    pageSize: '20',
  }), { finAgentReference: 'EastMoneyAdvancedFetcher.getNorthboundFlow' }),
  directEastmoney('northbound_hold_direct', 'northbound', 'Northbound holding direct EastMoney datacenter', datacenterUrl({
    reportName: 'RPT_MUTUAL_STOCK_NORTHSTA',
    columns: 'ALL',
    filter: '(INTERVAL_TYPE="1")',
    sortColumns: 'TRADE_DATE,ADD_MARKET_CAP',
    sortTypes: '-1,-1',
    pageNumber: '1',
    pageSize: '50',
  }), { finAgentReference: 'AkShare stock_hsgt_hold_stock_em / EastMoneyAdvancedFetcher.getNorthboundFlow' }),
  directEastmoney('hot_rank_direct', 'rank', 'Hot rank direct EastMoney app endpoint', 'https://emappdata.eastmoney.com/stockrank/getAllCurrentList', {
    method: 'POST',
    body: { appId: 'appId01', globalId: '786e4c21-70dc-435a-93bb-38', marketType: '', pageNo: 1, pageSize: 50 },
    headers: { 'Content-Type': 'application/json' },
    finAgentReference: 'EastMoneyAdvancedFetcher.getHotRank',
  }),
  sidecar('unusual_activity', 'unusual', 'Unusual activity via AkShare', '/akshare/stock_changes_em?_priority=background&_provider=eastmoney'),
  directEastmoney('unusual_activity_direct', 'unusual', 'Unusual activity direct EastMoney', push2exUrl('getAllStockChanges', { dpt: 'wzchanges', type: '', pageindex: '1', pagesize: '50' }), { finAgentReference: 'EastMoneyAdvancedFetcher.getUnusualActivity' }),
  sidecar('index_components', 'index-components', 'Index constituents', `/akshare/index_stock_cons?symbol=${INDEX_CODE}&_priority=background`),
  sidecar('fundamental', 'fundamental', 'Financial analysis indicator', `/akshare/stock_financial_analysis_indicator?symbol=${STOCK_CODE}&_priority=background`),
  sidecar('fund_rank', 'fund', 'Open fund rank', '/akshare/fund_open_fund_rank_em?symbol=全部&_priority=background&_provider=eastmoney'),
  sidecar('fund_nav', 'fund', 'Open fund NAV history', `/akshare/fund_open_fund_info_em?symbol=${FUND_CODE}&indicator=单位净值走势&_priority=background&_provider=eastmoney`),
  sidecar('fund_holding', 'fund', 'Fund portfolio holding', `/akshare/fund_portfolio_hold_em?symbol=${FUND_CODE}&_priority=background&_provider=eastmoney`),
  sidecar('fund_manager', 'fund', 'Fund manager list', '/akshare/fund_manager_em?_priority=background&_provider=eastmoney'),
  sidecar('fund_etf_spot', 'fund', 'ETF spot quote list', '/akshare/fund_etf_spot_em?_priority=background&_provider=eastmoney'),
  sidecar('fund_etf_hist', 'fund', 'ETF history', `/akshare/fund_etf_hist_em?symbol=510300&period=daily&start_date=20260101&end_date=${TRADE_DATE}&adjust=qfq&_priority=background&_provider=eastmoney`),
  sidecar('macro_china_gdp', 'macro', 'China GDP macro series from shipped data-source skill', '/akshare/macro_china_gdp?_priority=background'),
]

describe('manual full FinAgent Workstation finance API contract', () => {
  it('probes every FinAgent Workstation AkShare/EastMoney call path serially and stores schemas/errors', async () => {
    const report: Record<string, unknown> = {
      sidecarUrl: SIDECAR_URL,
      includeBroad: INCLUDE_BROAD,
      broadProbeCountSkipped: INCLUDE_BROAD ? 0 : BROAD_SIDECAR_PROBES.length,
      tradeDate: TRADE_DATE,
      delayMs: DELAY_MS,
      timeoutMs: TIMEOUT_MS,
      stockCode: STOCK_CODE,
      fundCode: FUND_CODE,
      indexCode: INDEX_CODE,
      industryName: INDUSTRY_NAME,
      industryCode: INDUSTRY_CODE,
      startedAt: new Date().toISOString(),
      probes: [],
    }

    report.health = await request('sidecar-akshare', `${SIDECAR_URL}/health`)

    for (let i = 0; i < PROBES.length; i++) {
      if (i > 0 && DELAY_MS > 0) await sleep(DELAY_MS)
      const probe = PROBES[i]
      const result = await request(probe.kind, probe.url, probe)
      ;(report.probes as unknown[]).push({
        id: probe.id,
        group: probe.group,
        kind: probe.kind,
        description: probe.description,
        appPath: probe.appPath,
        finAgentReference: probe.finAgentReference,
        knownRestriction: probe.knownRestriction,
        ...result,
      })
      console.log(JSON.stringify({ index: i + 1, total: PROBES.length, id: probe.id, ok: result.ok, status: result.status, durationMs: result.durationMs, rowCount: result.rowCount, error: result.error }))
    }

    report.finishedAt = new Date().toISOString()
    const outFile = writeReport(report)
    console.log(JSON.stringify({ outFile, summary: summarize(report) }, null, 2))

    expect((report.probes as unknown[]).length).toBe(PROBES.length)
  }, 60 * 60_000)
})

function sidecar(id: string, group: string, description: string, path: string, extra: Partial<Probe> = {}): Probe {
  return {
    id,
    group,
    kind: 'sidecar-akshare',
    description,
    url: `${SIDECAR_URL}${path}`,
    appPath: path,
    ...extra,
  }
}

function directEastmoney(id: string, group: string, description: string, url: string, extra: Partial<Probe> = {}): Probe {
  return {
    id,
    group,
    kind: 'direct-eastmoney',
    description,
    url,
    ...extra,
  }
}

async function request(kind: ProbeKind, url: string, probe: Partial<Probe> = {}): Promise<Record<string, unknown>> {
  const started = Date.now()
  try {
    const init: RequestInit = {
      method: probe.method ?? 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://quote.eastmoney.com/',
        Accept: 'application/json,text/plain,*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Connection: 'close',
        ...(probe.headers ?? {}),
      },
      body: probe.body == null ? undefined : JSON.stringify(probe.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
    const res = kind === 'direct-eastmoney'
      ? await trackedFetch(url, init, TIMEOUT_MS)
      : await fetch(url, init)
    const bodyText = await res.text()
    const parsed = parseJson(bodyText)
    const rows = rowsOf(parsed)
    return {
      ok: res.ok,
      status: res.status,
      durationMs: Date.now() - started,
      kind,
      url: redactRuntime(url),
      provider: (parsed as { provider?: unknown } | null)?.provider,
      rowCount: rows.length,
      columns: columnsOf(parsed, rows),
      schema: schemaOf(rows[0]),
      sample: sampleOf(parsed, rows),
      error: res.ok ? undefined : errorOf(parsed, bodyText),
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - started,
      kind,
      url: redactRuntime(url),
      rowCount: 0,
      error: errorSummary(error),
    }
  }
}

function errorSummary(error: Error): string {
  const cause = (error as { cause?: unknown }).cause
  if (cause && typeof cause === 'object') {
    const code = (cause as { code?: unknown }).code
    const message = (cause as { message?: unknown }).message
    if (code || message) return `${error.message}; cause=${code ? `${code}: ` : ''}${String(message ?? '')}`
  }
  return error.message
}

function push2exUrl(endpoint: string, params: Record<string, string>): string {
  return urlWithParams(`https://push2ex.eastmoney.com/${endpoint}`, {
    ut: '7eea3edcaed734bea9cbfc24409ed989',
    dpt: 'wz.ztzt',
    ...params,
  })
}

function datacenterUrl(params: Record<string, string>): string {
  return urlWithParams('https://datacenter-web.eastmoney.com/api/data/v1/get', {
    source: 'WEB',
    client: 'WEB',
    ...params,
  })
}

function eastmoneyClistUrl(params: { fid: string; fs: string; fields: string; ut?: string; pz?: string }, host = 'push2delay.eastmoney.com'): string {
  return urlWithParams(`https://${host}/api/qt/clist/get`, {
    pn: '1',
    pz: params.pz ?? '100',
    po: '1',
    np: '1',
    ut: params.ut ?? 'bd1d9ddb04089700cf9c27f6f7426281',
    fltt: '2',
    invt: '2',
    fid: params.fid,
    fs: params.fs,
    fields: params.fields,
  })
}

function eastmoneyStockGetUrl(code: string): string {
  return urlWithParams('https://push2delay.eastmoney.com/api/qt/stock/get', {
    fltt: '2',
    invt: '2',
    fields: 'f43,f44,f45,f46,f47,f48,f51,f55,f57,f58,f60,f116,f168,f169,f170',
    secid: stockSecid(code),
  })
}

function stockSecid(code: string): string {
  const market = code.startsWith('6') ? '1' : '0'
  return `${market}.${code}`
}

function akshareIndexSymbol(code: string): string {
  if (/^(sh|sz|csi|bj)/i.test(code)) return code
  if (code.startsWith('399')) return `sz${code}`
  if (code.startsWith('000001')) return `sh${code}`
  return `csi${code}`
}

function urlWithParams(base: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params)
  return `${base}?${qs}`
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return { text: text.slice(0, 2000) }
  }
}

function rowsOf(value: unknown): unknown[] {
  const direct = value as any
  if (Array.isArray(direct)) return direct
  if (Array.isArray(direct?.data)) return direct.data
  if (Array.isArray(direct?.data?.diff)) return direct.data.diff
  if (Array.isArray(direct?.data?.pool)) return direct.data.pool
  if (Array.isArray(direct?.data?.allstock)) return direct.data.allstock
  if (Array.isArray(direct?.data?.klines)) return direct.data.klines
  if (Array.isArray(direct?.result?.data)) return direct.result.data
  return []
}

function columnsOf(parsed: unknown, rows: unknown[]): string[] {
  const columns = (parsed as { columns?: unknown } | null)?.columns
  if (Array.isArray(columns)) return columns.map(String)
  if (rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null) return Object.keys(rows[0] as Record<string, unknown>)
  return []
}

function sampleOf(parsed: unknown, rows: unknown[]): unknown {
  if (rows.length > 0) return rows[0]
  return parsed
}

function errorOf(value: unknown, fallback: string): string {
  const err = (value as { error?: unknown; message?: unknown } | null)?.error ?? (value as { message?: unknown } | null)?.message
  return err ? String(err) : fallback.slice(0, 500)
}

function schemaOf(row: unknown): Record<string, string> {
  if (typeof row === 'string') return { value: 'string:csv-or-line' }
  if (!row || typeof row !== 'object') return {}
  return Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value]))
}

function writeReport(report: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true })
  const file = join(OUT_DIR, `finance-api-contract-${new Date().toISOString().replaceAll(':', '-')}.json`)
  writeFileSync(file, JSON.stringify(report, null, 2), 'utf-8')
  return file
}

function summarize(report: Record<string, unknown>): Array<Record<string, unknown>> {
  return ((report.probes as Array<Record<string, unknown>>) ?? []).map((probe) => ({
    id: probe.id,
    group: probe.group,
    kind: probe.kind,
    ok: probe.ok,
    status: probe.status,
    durationMs: probe.durationMs,
    rowCount: probe.rowCount,
    error: probe.error,
  }))
}

function redactRuntime(url: string): string {
  return url.replace(SIDECAR_URL, '<sidecar>')
}

function compactDate(date: string): string {
  return date.replaceAll('-', '')
}

function dashedDate(date: string): string {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
}

function emptyTradingCalendar(): TradingCalendar {
  return {
    version: 1,
    dataYear: null,
    lastFetched: null,
    tradingDayCount: 0,
    tradingDays: [],
    overrides: {},
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
