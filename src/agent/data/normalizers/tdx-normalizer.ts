import type { KlineRow } from '../store/data-store'

export interface TdxKlineOptions {
  code: string
  source?: string
  start?: string
  end?: string
  minRows?: number
  index?: boolean
}

export interface TdxQuoteOptions {
  expectedCode?: string
  index?: boolean
}

const INDEX_PRICE_RANGES: Record<string, [number, number]> = {
  '000001': [1000, 10000],
  '399001': [5000, 30000],
  '399006': [1000, 10000],
  '000300': [1000, 10000],
  '000905': [1000, 15000],
  '000852': [1000, 15000],
}

export function tdxMarketForCode(code: string, index = false): string {
  if (index && code === '000001') return '1'
  if (code.startsWith('6')) return '1'
  return '0'
}

export function tdxList(payload: unknown): unknown[] {
  const value = payload as any
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.List)) return value.List
  if (Array.isArray(value?.reply?.List)) return value.reply.List
  if (Array.isArray(value?.data)) return value.data
  return []
}

export function normalizeTdxKlineRows(payload: unknown, options: TdxKlineOptions): KlineRow[] {
  return tdxList(payload)
    .map((bar) => normalizeTdxKlineRow(bar, options))
    .filter((row): row is KlineRow => {
      if (!row) return false
      if (options.start && row.date < options.start) return false
      if (options.end && row.date > options.end) return false
      return true
    })
}

export function normalizeTdxEndpoint(endpoint: string, payload: unknown, input: Record<string, unknown> = {}): Record<string, unknown> {
  const code = String(input.code ?? '')
  if (endpoint === 'mac/board_list' || endpoint === 'mac/symbol_belong_board') {
    const sectorType = String(input.sector_type ?? input.type ?? 'industry')
    return {
      normalized: true,
      source: 'tdx:mac',
      endpoint,
      schema: 'sector_rank',
      data: normalizeTdxMacSectorRankingRows(payload, { sectorType }),
    }
  }
  if (endpoint === 'kline' || endpoint === 'kline_advanced' || endpoint === 'mac/bars') {
    const source = endpoint === 'mac/bars' ? 'tdx:mac' : 'tdx'
    const rows = normalizeTdxKlineRows(payload, { code, source, start: stringOrUndefined(input.start), end: stringOrUndefined(input.end) })
    return { normalized: true, source, endpoint, schema: 'kline_daily', data: rows }
  }
  if (endpoint === 'ex/kline' || endpoint === 'ex/kline2') {
    const rows = normalizeTdxKlineRows(payload, { code, source: 'tdx:ex', start: stringOrUndefined(input.start), end: stringOrUndefined(input.end) })
    return { normalized: true, source: 'tdx:ex', endpoint, schema: 'kline_daily', data: rows }
  }
  if (endpoint === 'index_bars') {
    const rows = normalizeTdxKlineRows(payload, { code, source: 'tdx:index_bars', start: stringOrUndefined(input.start), end: stringOrUndefined(input.end), index: true })
    return {
      normalized: true,
      source: 'tdx:index_bars',
      endpoint,
      schema: 'index_kline',
      data: rows,
      warning: rows.length === 0 ? 'TDX index_bars response did not pass source-specific validation; use AkShare/DataStore fallback until gotdx raw index decoder is fixed.' : undefined,
    }
  }
  if (endpoint === 'quote') {
    const data = tdxQuoteRows(payload).map((row) => normalizeTdxQuote(row, { expectedCode: code })).filter(Boolean)
    return { normalized: true, source: 'tdx', endpoint, schema: 'quote_snapshot', data, warning: quoteWarning(endpoint, code, data.length) }
  }
  if (endpoint === 'mac/quotes') {
    const data = normalizeTdxMacQuoteSnapshot(payload, { expectedCode: code })
    return { normalized: true, source: 'tdx:mac', endpoint, schema: 'quote_snapshot', data: data ? [data] : [], warning: quoteWarning(endpoint, code, data ? 1 : 0) }
  }
  if (endpoint === 'quotes' || endpoint === 'quotes_list') {
    return { normalized: true, source: 'tdx', endpoint, schema: 'quote_snapshot', data: tdxList(payload).map((row) => normalizeTdxQuote(row)).filter(Boolean) }
  }
  if (endpoint === 'ex/quote') {
    const data = tdxQuoteRows(payload).map((row) => normalizeTdxQuote(row, { expectedCode: code })).filter(Boolean)
    return { normalized: true, source: 'tdx:ex', endpoint, schema: 'quote_snapshot', data, warning: quoteWarning(endpoint, code, data.length) }
  }
  if (endpoint === 'ex/quotes' || endpoint === 'ex/quotes_list') {
    return { normalized: true, source: 'tdx:ex', endpoint, schema: 'quote_snapshot', data: tdxList(payload).map((row) => normalizeTdxQuote(row)).filter(Boolean) }
  }
  if (endpoint === 'index_info') {
    const row = normalizeTdxQuote(payload, { expectedCode: code, index: true })
    return { normalized: true, source: 'tdx:index_info', endpoint, schema: 'quote_snapshot', data: row ? [row] : [], warning: row ? undefined : quoteWarning(endpoint, code, 0) }
  }
  if (endpoint === 'stock_list' || endpoint === 'stock_list_range' || endpoint === 'ex/list') {
    return {
      normalized: true,
      source: endpoint === 'ex/list' ? 'tdx:ex' : 'tdx',
      endpoint,
      schema: 'stock_list',
      data: tdxList(payload).map((row) => row as Record<string, unknown>),
    }
  }
  return {
    normalized: false,
    source: 'tdx',
    endpoint,
    schema: 'raw_tdx',
    warning: 'Raw TDX endpoint response. Add a source-specific normalizer before using this data for scoring, persistence, or generated reports.',
    raw: payload,
  }
}

export function normalizeTdxMacSectorRankingRows(
  payload: unknown,
  options: { sectorType?: string; source?: string } = {},
): Array<Record<string, unknown>> {
  const sectorType = options.sectorType ?? 'industry'
  const source = options.source ?? 'tdx:mac'
  return tdxList(payload)
    .map((row, index) => normalizeTdxMacSectorRankingRow(row, { sectorType, source, rank: index + 1 }))
    .filter((row): row is Record<string, unknown> => !!row)
}

export function normalizeTdxQuote(row: unknown, options: TdxQuoteOptions = {}): Record<string, unknown> | null {
  if (!row || typeof row !== 'object') return null
  const q = row as Record<string, unknown>
  const rawCode = String(q.Code ?? q.code ?? '')
  const code = options.index ? publicIndexCode(rawCode) : rawCode
  const expectedCode = options.index ? publicIndexCode(options.expectedCode ?? '') : String(options.expectedCode ?? '')
  if (expectedCode && code && code !== expectedCode) return null
  const canonicalCode = options.index ? canonicalIndexCode(expectedCode || code) : (expectedCode || code)
  const price = numberField(q, ['Price', 'price', 'Close', 'close'])
  const prevClose = numberField(q, ['PreClose', 'preClose', 'LastClose', 'lastClose', 'PrevClose', 'prevClose'])
  if (!isFinitePositive(price)) return null
  if (options.index && expectedCode && !isPlausibleIndexPrice(expectedCode, price)) return null
  const open = numberField(q, ['Open', 'open'], 0)
  const high = numberField(q, ['High', 'high'], 0)
  const low = numberField(q, ['Low', 'low'], 0)
  if (high > 0 && low > 0 && high < low) return null
  if (high > 0 && price > high) return null
  if (low > 0 && price < low) return null
  if (high > 0 && open > 0 && open > high) return null
  if (low > 0 && open > 0 && open < low) return null
  const change = Number.isFinite(prevClose) && prevClose > 0 ? price - prevClose : 0
  return {
    code: canonicalCode,
    timestamp: stringField(q, ['timestamp', 'Timestamp', 'trade_time', 'tradeTime', 'time', 'Time', 'DateTime', 'datetime', 'dateTime', 'trade_date', 'tradeDate', 'date', 'Date']) ?? undefined,
    name: String((q.Name ?? q.name ?? expectedCode) || code),
    price,
    change,
    changePct: Number.isFinite(prevClose) && prevClose > 0 ? change / prevClose * 100 : 0,
    open,
    high,
    low,
    prevClose: Number.isFinite(prevClose) ? prevClose : 0,
    volume: numberField(q, ['Vol', 'Volume', 'vol', 'volume'], 0),
    amount: numberField(q, ['Amount', 'amount'], 0),
  }
}

function normalizeTdxMacQuoteSnapshot(row: unknown, options: TdxQuoteOptions = {}): Record<string, unknown> | null {
  if (!row || typeof row !== 'object') return null
  const q = row as Record<string, unknown>
  const code = String(q.Code ?? q.code ?? options.expectedCode ?? '')
  const expectedCode = String(options.expectedCode ?? '')
  if (expectedCode && code && code !== expectedCode) return null
  const price = numberField(q, ['Price', 'price', 'Close', 'close'])
  const prevClose = numberField(q, ['PreClose', 'preClose', 'PrevClose', 'prevClose'])
  if (!isFinitePositive(price)) return null
  const change = Number.isFinite(prevClose) && prevClose > 0 ? price - prevClose : numberField(q, ['Momentum', 'momentum'], 0)
  return {
    code: expectedCode || code,
    timestamp: stringField(q, ['DateTime', 'datetime', 'dateTime', 'Timestamp', 'timestamp']),
    name: String((q.Name ?? q.name ?? expectedCode) || code),
    price,
    change,
    changePct: Number.isFinite(prevClose) && prevClose > 0 ? change / prevClose * 100 : 0,
    open: numberField(q, ['Open', 'open'], 0),
    high: numberField(q, ['High', 'high'], 0),
    low: numberField(q, ['Low', 'low'], 0),
    prevClose: Number.isFinite(prevClose) ? prevClose : 0,
    volume: numberField(q, ['Vol', 'Volume', 'vol', 'volume'], 0),
    amount: numberField(q, ['Amount', 'amount'], 0),
    turnoverRate: numberField(q, ['Turnover', 'turnover', 'TurnoverRate', 'turnoverRate']),
  }
}

export function normalizeTdxKlineRow(bar: unknown, options: TdxKlineOptions): KlineRow | null {
  if (!bar || typeof bar !== 'object') return null
  const row = bar as Record<string, unknown>
  const date = formatTdxDate(String(row.DateTime ?? row.dateTime ?? row.date ?? ''))
  const open = numberField(row, ['Open', 'open'])
  const high = numberField(row, ['High', 'high'])
  const low = numberField(row, ['Low', 'low'])
  const close = numberField(row, ['Close', 'close', 'Price', 'price'])
  if (!date || !isFinitePositive(close) || !isFinitePositive(open) || !isFinitePositive(high) || !isFinitePositive(low)) return null
  if (options.index && !isPlausibleIndexPrice(options.code, close)) return null
  if (high < low || high < open || high < close || low > open || low > close) return null
  return {
    code: options.code,
    date,
    open,
    high,
    low,
    close,
    volume: numberField(row, ['Vol', 'Volume', 'vol', 'volume'], 0),
    amount: numberField(row, ['Amount', 'amount'], 0),
    change_pct: null,
    turnover_rate: null,
    adjust: 'none',
    source: options.source ?? 'tdx',
  }
}

function normalizeTdxMacSectorRankingRow(
  row: unknown,
  options: { sectorType: string; source: string; rank: number },
): Record<string, unknown> | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const code = stringField(r, ['Code', 'code', 'BoardCode', 'boardCode'])
  const name = stringField(r, ['Name', 'name', 'BoardName', 'boardName'])
  if (!code || !name) return null
  const price = numberField(r, ['Price', 'price'])
  const prevClose = numberField(r, ['PreClose', 'preClose'])
  const speed = numberField(r, ['RiseSpeed', 'riseSpeed', 'SpeedPct', 'speedPct'])
  const changePct = Number.isFinite(price) && Number.isFinite(prevClose) && prevClose > 0
    ? (price - prevClose) / prevClose * 100
    : (Number.isFinite(speed) ? speed : 0)
  return {
    sector_type: options.sectorType,
    code,
    name,
    change_pct: changePct,
    turnover_rate: null,
    up_count: numberField(r, ['LimitUpCount', 'limitUpCount'], 0),
    down_count: numberField(r, ['LimitDownCount', 'limitDownCount'], 0),
    leading_stock: stringField(r, ['SymbolName', 'symbolName']),
    leading_pct: nullableNumberField(r, ['SymbolRiseSpeed', 'symbolRiseSpeed', 'SymbolSpeedPct', 'symbolSpeedPct']),
    rank: options.rank,
    source: options.source,
  }
}

export function hasEnoughTdxRows(rows: KlineRow[], minRows: number): boolean {
  return rows.length >= minRows
}

export function formatTdxDate(value: string): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  const year = Number(m[1])
  const currentYear = new Date().getFullYear()
  if (!Number.isFinite(year) || year < 1990 || year > currentYear + 1) return ''
  return `${m[1]}-${m[2]}-${m[3]}`
}

function numberField(row: Record<string, unknown>, names: string[], fallback = NaN): number {
  for (const name of names) {
    const value = row[name]
    if (value !== undefined && value !== null && value !== '') {
      const n = Number(value)
      if (Number.isFinite(n)) return n
    }
  }
  return fallback
}

function nullableNumberField(row: Record<string, unknown>, names: string[]): number | null {
  const value = numberField(row, names)
  return Number.isFinite(value) ? value : null
}

function stringField(row: Record<string, unknown>, names: string[]): string | null {
  for (const name of names) {
    const value = row[name]
    if (value !== undefined && value !== null && value !== '') return String(value)
  }
  return null
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function isPlausibleIndexPrice(code: string, price: number): boolean {
  const range = INDEX_PRICE_RANGES[code]
  if (!range) return true
  return price >= range[0] && price <= range[1]
}

function tdxQuoteRows(payload: unknown): unknown[] {
  const rows = tdxList(payload)
  return rows.length > 0 ? rows : [payload]
}

function publicIndexCode(code: string): string {
  if (code === '999999') return '000001'
  return code
}

function canonicalIndexCode(code: string): string {
  return code
}

function quoteWarning(endpoint: string, expectedCode: string, count: number): string | undefined {
  if (!expectedCode || count > 0) return undefined
  return `TDX ${endpoint} response did not match requested code ${expectedCode}; skipped persistence.`
}

function stringOrUndefined(value: unknown): string | undefined {
  return value == null || value === '' ? undefined : String(value)
}
