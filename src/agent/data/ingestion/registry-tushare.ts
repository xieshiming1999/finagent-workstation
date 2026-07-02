import type {
  DataStore,
  FundamentalRow,
  IndexConstituentRow,
  KlineRow,
} from '../store/data-store'
import type { IngestionRequest, IngestionResult } from './registry'
import {
  normalizeDate,
  numberField,
  result,
  stringField,
  stripTushareCode,
  tushareSuffix,
} from './registry-common'

export function ingestTushare(store: DataStore, request: IngestionRequest, source: string): IngestionResult | null {
  const endpoint = request.endpoint
  const payload = request.payload as any
  const data = Array.isArray(payload?.data) ? payload.data as Array<Record<string, unknown>> : Array.isArray(payload) ? payload as Array<Record<string, unknown>> : []

  if (endpoint === 'stock_basic') {
    const rows = data.map((row) => normalizeTushareStockBasic(row)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveStockList(rows as any)
    return result(request, 'stock_list', 'stock_list', rows.length)
  }

  if (['daily', 'weekly', 'monthly', 'index_daily'].includes(endpoint)) {
    const rows = data.map((row) => normalizeTushareKline(row, request, source)).filter((row): row is KlineRow => !!row)
    store.saveKline(rows)
    return result(request, 'kline_daily', 'kline_daily', rows.length)
  }

  if (endpoint === 'index_weight') {
    const rows = data.map((row) => normalizeTushareIndexConstituent(row, request)).filter((row): row is IndexConstituentRow => !!row)
    store.saveIndexConstituents(rows)
    return result(request, 'index_constituent', 'index_constituent', rows.length)
  }

  if (endpoint === 'daily_basic') {
    const rows = data.map((row) => normalizeTushareFundamental(row, endpoint, source)).filter((row): row is FundamentalRow => !!row)
    store.saveFundamental(rows)
    return result(request, 'fundamental', 'fundamental', rows.length)
  }

  if (endpoint === 'trade_cal') {
    const rows = data.map((row) => normalizeTushareTradeCalendar(row, request)).filter(Boolean) as Array<Record<string, unknown>>
    store.saveCalendar(rows)
    return result(request, 'trade_calendar', 'trade_calendar', rows.length)
  }

  return null
}

function normalizeTushareStockBasic(row: Record<string, unknown>): Record<string, unknown> | null {
  const ts = stringField(row, ['ts_code', 'code'])
  const code = stringField(row, ['symbol']) ?? stripTushareCode(ts)
  if (!code) return null
  return {
    code,
    name: stringField(row, ['name']) ?? code,
    market: stringField(row, ['market']) ?? tushareSuffix(ts),
    industry: stringField(row, ['industry']),
    list_date: normalizeDate(stringField(row, ['list_date'])),
    delist_date: normalizeDate(stringField(row, ['delist_date'])),
    stock_type: stringField(row, ['stock_type']) ?? 'stock',
    updated_at: new Date().toISOString(),
  }
}

function normalizeTushareKline(row: Record<string, unknown>, request: IngestionRequest, source: string): KlineRow | null {
  const code = stripTushareCode(stringField(row, ['ts_code', 'code'])) ?? stripTushareCode(request.code) ?? stripTushareCode(stringField(request.params ?? {}, ['ts_code', 'code']))
  const date = normalizeDate(stringField(row, ['trade_date', 'date']))
  const open = numberField(row, ['open'])
  const high = numberField(row, ['high'])
  const low = numberField(row, ['low'])
  const close = numberField(row, ['close'])
  if (!code || !date || open == null || high == null || low == null || close == null) return null
  const vol = numberField(row, ['vol', 'volume'])
  const amount = numberField(row, ['amount'])
  return {
    code,
    date,
    open,
    high,
    low,
    close,
    volume: vol == null ? null : vol * 100,
    amount: amount == null ? null : amount * 1000,
    change_pct: numberField(row, ['pct_chg', 'change_pct']),
    turnover_rate: numberField(row, ['turnover_rate', 'turnover_rate_f']),
    adjust: String(request.params?.adjust ?? 'none'),
    source,
  }
}

function normalizeTushareIndexConstituent(row: Record<string, unknown>, request: IngestionRequest): IndexConstituentRow | null {
  const rawIndexCode = stringField(request.params ?? {}, ['index_code', 'ts_code', 'code']) ??
    stringField(row, ['index_code', 'indexCode'])
  const indexCode = stripTushareCode(rawIndexCode)
  const stockCode = stripTushareCode(stringField(row, ['con_code', 'ts_code', 'stock_code', 'code']))
  const asOfDate = normalizeDate(stringField(row, ['trade_date', 'end_date', 'date'])) ?? new Date().toISOString().slice(0, 10)
  if (!indexCode || !stockCode) return null
  return {
    index_code: indexCode,
    stock_code: stockCode,
    stock_name: stringField(row, ['con_name', 'stock_name', 'name']) ?? stockCode,
    weight: numberField(row, ['weight', 'weight_pct']),
    as_of_date: asOfDate,
    provider: 'tushare',
    capability_id: 'tushare.index.constituents',
    source_action: 'index_weight',
    fetched_at: new Date().toISOString(),
    raw_json: JSON.stringify(row),
  }
}

function normalizeTushareFundamental(row: Record<string, unknown>, endpoint: string, source: string): FundamentalRow | null {
  const code = stripTushareCode(stringField(row, ['ts_code', 'code']))
  const reportDate = normalizeDate(stringField(row, ['trade_date', 'end_date', 'ann_date', 'period', 'report_date']))
  if (!code || !reportDate) return null
  const totalMv = numberField(row, ['total_mv'])
  const circMv = numberField(row, ['circ_mv'])
  return {
    code,
    report_date: reportDate,
    pe_ttm: numberField(row, ['pe_ttm', 'pe']),
    pb: numberField(row, ['pb']),
    ps_ttm: numberField(row, ['ps_ttm', 'ps']),
    roe: numberField(row, ['roe', 'roe_dt']),
    gross_margin: numberField(row, ['grossprofit_margin']),
    net_margin: numberField(row, ['netprofit_margin']),
    revenue: numberField(row, ['revenue', 'total_revenue']),
    revenue_yoy: numberField(row, ['or_yoy', 'tr_yoy', 'revenue_yoy']),
    net_profit: numberField(row, ['n_income_attr_p', 'net_profit', 'profit_to_gr']),
    profit_yoy: numberField(row, ['netprofit_yoy', 'dt_netprofit_yoy']),
    total_assets: numberField(row, ['total_assets']),
    total_liabilities: numberField(row, ['total_liab', 'total_liabilities']),
    debt_ratio: numberField(row, ['debt_to_assets']),
    dividend_yield: numberField(row, ['dv_ttm', 'dv_ratio']),
    market_cap: totalMv == null ? null : totalMv * 10000,
    circ_cap: circMv == null ? null : circMv * 10000,
    source: `${source}:${endpoint}`,
    updated_at: new Date().toISOString(),
  }
}

function normalizeTushareTradeCalendar(row: Record<string, unknown>, request: IngestionRequest): Record<string, unknown> | null {
  const date = normalizeDate(stringField(row, ['cal_date', 'date']))
  if (!date) return null
  return {
    date,
    market: stringField(row, ['exchange']) ?? String(request.params?.exchange ?? 'SSE'),
    is_trading_day: Number(numberField(row, ['is_open']) ?? 0),
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
  }
}
