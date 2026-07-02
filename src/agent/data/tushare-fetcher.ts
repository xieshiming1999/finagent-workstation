import { trackedFetch } from './tracked-fetch'
import { runtimeText } from '../runtime-language'

const TUSHARE_ENDPOINT_MIN_INTERVAL_MS: Record<string, number> = {
  trade_cal: 61_000,
}
const DISABLED_TUSHARE_APIS = new Set([
  'fina_indicator',
  'income',
  'balancesheet',
  'cashflow',
  'moneyflow',
  'fund_basic',
  'fund_nav',
])
const tushareEndpointLastCall = new Map<string, number>()

function enforceTushareEndpointGuard(apiName: string): void {
  if (DISABLED_TUSHARE_APIS.has(apiName)) {
    throw new Error(`UNSUPPORTED_TUSHARE_API: ${apiName} is disabled in this app because the configured Tushare permission set cannot access it. Use local cache, EastMoney/AkShare, Yahoo, or Wind where available.`)
  }
  const interval = TUSHARE_ENDPOINT_MIN_INTERVAL_MS[apiName]
  if (!interval) return
  const now = Date.now()
  const last = tushareEndpointLastCall.get(apiName) ?? 0
  const waitMs = interval - (now - last)
  if (waitMs > 0) {
    throw new Error(`TUSHARE_RATE_LIMIT: ${apiName} has an endpoint frequency window; wait ${Math.ceil(waitMs / 1000)}s before retrying.`)
  }
  tushareEndpointLastCall.set(apiName, now)
}

export function tsCode(code: string): string {
  const clean = code.replace(/\.(SH|SZ|BJ)$/i, '').replace(/^(SH|SZ|BJ)/i, '')
  return clean.startsWith('6') ? `${clean}.SH` : `${clean}.SZ`
}

function formatDate(d: string): string {
  return d.replace(/-/g, '')
}

function parseDate(d: string): string {
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
  return d
}

export async function tushareCall(
  token: string,
  apiName: string,
  params: Record<string, unknown>,
  fields?: string,
): Promise<Array<Record<string, unknown>>> {
  enforceTushareEndpointGuard(apiName)
  const body: Record<string, unknown> = { api_name: apiName, token, params }
  if (fields) body.fields = fields

  const res = await trackedFetch('http://api.tushare.pro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 30_000)

  const json = await res.json() as any
  if (json.code !== 0) {
    const msg = json.msg ?? ''
    if (/权限|积分|permission/i.test(msg)) {
      throw new Error(runtimeText('Tushare permission denied', 'Tushare 权限不足'))
    }
    if (/频率|limit|每分钟|最多访问|访问.*次/i.test(msg)) throw new Error(`TUSHARE_RATE_LIMIT: ${apiName} frequency limited by Tushare: ${msg}`)
    throw new Error(`Tushare error ${json.code}: ${msg}`)
  }

  const data = json.data ?? {}
  const fieldNames: string[] = data.fields ?? []
  const items: unknown[][] = data.items ?? []
  return items.map((row) => Object.fromEntries(fieldNames.map((f, i) => [f, row[i]])))
}

export async function tushareDaily(
  token: string,
  code: string,
  startDate?: string,
  endDate?: string,
): Promise<Array<Record<string, unknown>>> {
  const params: Record<string, unknown> = { ts_code: tsCode(code) }
  if (startDate) params.start_date = formatDate(startDate)
  if (endDate) params.end_date = formatDate(endDate)

  const rows = await tushareCall(
    token, 'daily', params,
    'ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount',
  )

  return rows.map((r) => ({
    ...r,
    trade_date: parseDate(String(r.trade_date ?? '')),
    vol: Number(r.vol ?? 0) * 100,
    amount: Number(r.amount ?? 0) * 1000,
  })).reverse()
}

export async function tushareStockBasic(token: string): Promise<Array<Record<string, unknown>>> {
  return tushareCall(token, 'stock_basic', { list_status: 'L' }, 'ts_code,name,area,industry,list_date,market')
}

export async function tushareTradeCal(
  token: string,
  startDate: string,
  endDate: string,
): Promise<string[]> {
  const rows = await tushareCall(
    token, 'trade_cal',
    { exchange: 'SSE', is_open: '1', start_date: formatDate(startDate), end_date: formatDate(endDate) },
    'cal_date',
  )
  return rows.map((r) => parseDate(String(r.cal_date ?? ''))).sort()
}
