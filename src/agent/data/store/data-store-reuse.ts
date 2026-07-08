import type {
  ApiCallLogRow,
  ApiResultCacheRow,
  QuoteSnapshotRow,
  RawApiPayloadRow,
} from './data-store-types'
import { numOrNull } from './data-store-utils'

type Row = Record<string, unknown>

type StoreDeps = {
  exec(sql: string, ...params: unknown[]): void
  query<T = unknown>(sql: string, ...params: unknown[]): T[]
  one(sql: string, params?: unknown[]): Record<string, unknown> | null
}

export interface ReusableDataSummaryRow {
  name: string
  count: number
  latest: string | null
  sources?: string | null
}

export function saveApiCall(store: StoreDeps, row: ApiCallLogRow): void {
  store.exec(
    `INSERT INTO api_call_log
      (source,provider,interface_id,capability_id,tool,action,endpoint,status,success,failure_class,duration_ms,error,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    row.source, row.provider ?? row.source, row.interface_id ?? null, row.capability_id ?? null,
    row.tool ?? null, row.action ?? null, row.endpoint ?? null, row.status ?? null,
    row.success ? 1 : 0, row.failure_class ?? null, row.duration_ms ?? null, row.error ?? null,
    row.created_at ?? new Date().toISOString(),
  )
}

export function getApiCallSummary(
  store: StoreDeps,
  minutes = 24 * 60,
): Record<string, { total: number; success: number; failRate: number; avgLatency: number }> {
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString()
  const rows = store.query<Row>(
    `SELECT source, COUNT(*) as total, SUM(success) as success, AVG(duration_ms) as avgLatency
      FROM api_call_log WHERE created_at >= ? GROUP BY source`,
    cutoff,
  )
  const result: Record<string, { total: number; success: number; failRate: number; avgLatency: number }> = {}
  for (const row of rows) {
    const total = Number(row.total ?? 0)
    const success = Number(row.success ?? 0)
    result[String(row.source)] = {
      total,
      success,
      failRate: total > 0 ? ((total - success) / total) * 100 : 0,
      avgLatency: Math.round(Number(row.avgLatency ?? 0)),
    }
  }
  return result
}

export function getRecentApiCalls(store: StoreDeps, minutes = 30, limit = 100): Row[] {
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString()
  return store.query('SELECT * FROM api_call_log WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?', cutoff, limit)
}

export function queryWindEconomicSeries(store: StoreDeps, limit = 20): Row[] {
  return store.query<Row>(
    `SELECT * FROM wind_economic_series
     ORDER BY date DESC, updated_at DESC
     LIMIT ?`,
    limit,
  )
}

export function queryWindDocuments(store: StoreDeps, limit = 20): Row[] {
  return store.query<Row>(
    `SELECT * FROM wind_document
     ORDER BY published_at DESC, updated_at DESC
     LIMIT ?`,
    limit,
  )
}

export function saveApiResultCache(store: StoreDeps, row: ApiResultCacheRow): void {
  store.exec(
    `INSERT OR REPLACE INTO api_result_cache
      (source,tool,action,request_hash,request_json,response_json,is_error,created_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
    row.source, row.tool, row.action, row.request_hash, row.request_json, row.response_json,
    row.is_error ? 1 : 0, row.created_at, row.expires_at,
  )
}

export function saveRawApiPayload(store: StoreDeps, row: RawApiPayloadRow): void {
  store.exec(
    `INSERT OR REPLACE INTO raw_api_payload
      (source,endpoint,request_hash,request_json,response_json,is_error,created_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?)`,
    row.source, row.endpoint, row.request_hash, row.request_json, row.response_json,
    row.is_error ? 1 : 0, row.created_at, row.expires_at ?? null,
  )
}

export function getApiResultCache(
  store: StoreDeps,
  source: string,
  tool: string,
  action: string,
  requestHash: string,
): ApiResultCacheRow | null {
  const row = store.one(
    `SELECT * FROM api_result_cache
      WHERE source = ? AND tool = ? AND action = ? AND request_hash = ? AND expires_at > ?
      LIMIT 1`,
    [source, tool, action, requestHash, new Date().toISOString()],
  )
  if (!row) return null
  return {
    source: String(row.source),
    tool: String(row.tool),
    action: String(row.action),
    request_hash: String(row.request_hash),
    request_json: String(row.request_json),
    response_json: row.response_json == null ? null : String(row.response_json),
    is_error: Number(row.is_error ?? 0) === 1,
    created_at: String(row.created_at),
    expires_at: String(row.expires_at),
  }
}

export function saveQuoteSnapshots(store: StoreDeps, rows: QuoteSnapshotRow[]): void {
  for (const row of rows) {
    const fetchedAt = row.fetched_at ?? new Date().toISOString()
    store.exec(
      `INSERT OR REPLACE INTO quote_snapshot
        (code,timestamp,fetched_at,source,name,price,change,change_pct,open,high,low,prev_close,volume,amount,pe,pb,market_cap,turnover_rate,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      row.code, row.timestamp ?? fetchedAt, fetchedAt, row.source, row.name ?? null, row.price ?? null, row.change ?? null,
      row.change_pct ?? null, row.open ?? null, row.high ?? null, row.low ?? null, row.prev_close ?? null, row.volume ?? null,
      row.amount ?? null, row.pe ?? null, row.pb ?? null, row.market_cap ?? null, row.turnover_rate ?? null, row.raw_json ?? null,
    )
  }
}

function saveTypedRows(store: StoreDeps, sql: string, params: unknown[][]): void {
  for (const row of params) store.exec(sql, ...row)
}

export function saveYfinanceProfileFields(store: StoreDeps, rows: Row[]): void {
  saveTypedRows(store, `INSERT OR REPLACE INTO yfinance_profile_fields
    (symbol,field_key,field_value,field_type,source,updated_at,raw_json)
    VALUES (?,?,?,?,?,?,?)`,
  rows.map((r) => [r.symbol, r.field_key, r.field_value ?? null, r.field_type ?? null, r.source ?? null, r.updated_at, r.raw_json ?? null]))
}

export function saveYfinanceStatementItems(store: StoreDeps, rows: Row[]): void {
  saveTypedRows(store, `INSERT OR REPLACE INTO yfinance_statement_items
    (symbol,statement_type,period,item,value,source,updated_at,raw_json)
    VALUES (?,?,?,?,?,?,?,?)`,
  rows.map((r) => [r.symbol, r.statement_type, r.period, r.item, r.value ?? null, r.source ?? null, r.updated_at, r.raw_json ?? null]))
}

export function saveYfinanceRecommendations(store: StoreDeps, rows: Row[]): void {
  saveTypedRows(store, `INSERT OR REPLACE INTO yfinance_recommendations
    (symbol,period,strong_buy,buy,hold,sell,strong_sell,source,updated_at,raw_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
  rows.map((r) => [r.symbol, r.period, r.strong_buy ?? null, r.buy ?? null, r.hold ?? null, r.sell ?? null, r.strong_sell ?? null, r.source ?? null, r.updated_at, r.raw_json ?? null]))
}

export function saveYfinanceNews(store: StoreDeps, rows: Row[]): void {
  saveTypedRows(store, `INSERT OR REPLACE INTO yfinance_news
    (symbol,news_id,title,publisher,published_at,link,summary,source,updated_at,raw_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
  rows.map((r) => [r.symbol, r.news_id, r.title ?? null, r.publisher ?? null, r.published_at ?? null, r.link ?? null, r.summary ?? null, r.source ?? null, r.updated_at, r.raw_json ?? null]))
}

export function saveYfinanceOptionExpiries(store: StoreDeps, rows: Row[]): void {
  saveTypedRows(store, `INSERT OR REPLACE INTO yfinance_option_expiries
    (symbol,expiry_date,source,updated_at)
    VALUES (?,?,?,?)`,
  rows.map((r) => [r.symbol, r.expiry_date, r.source ?? null, r.updated_at]))
}

export function saveYfinanceOptionContracts(store: StoreDeps, rows: Row[]): void {
  saveTypedRows(store, `INSERT OR REPLACE INTO yfinance_option_contracts
    (symbol,expiry_date,option_type,contract_symbol,strike,last_price,bid,ask,change,percent_change,volume,open_interest,implied_volatility,in_the_money,currency,last_trade_date,source,updated_at,raw_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  rows.map((r) => [
    r.symbol, r.expiry_date, r.option_type, r.contract_symbol, r.strike ?? null, r.last_price ?? null, r.bid ?? null, r.ask ?? null,
    r.change ?? null, r.percent_change ?? null, r.volume ?? null, r.open_interest ?? null, r.implied_volatility ?? null, r.in_the_money ?? null,
    r.currency ?? null, r.last_trade_date ?? null, r.source ?? null, r.updated_at, r.raw_json ?? null,
  ]))
}

export function saveYfinanceCorporateActions(store: StoreDeps, rows: Row[]): void {
  saveTypedRows(store, `INSERT OR REPLACE INTO yfinance_corporate_actions
    (symbol,action_type,action_date,value,source,updated_at,raw_json)
    VALUES (?,?,?,?,?,?,?)`,
  rows.map((r) => [r.symbol, r.action_type, r.action_date, r.value ?? null, r.source ?? null, r.updated_at, r.raw_json ?? null]))
}

export function saveYfinanceHolders(store: StoreDeps, rows: Row[]): void {
  saveTypedRows(store, `INSERT OR REPLACE INTO yfinance_holders
    (symbol,holder_type,holder_name,reported_date,pct_held,shares,value,pct_change,source,updated_at,raw_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  rows.map((r) => [r.symbol, r.holder_type, r.holder_name, r.reported_date, r.pct_held ?? null, r.shares ?? null, r.value ?? null, r.pct_change ?? null, r.source ?? null, r.updated_at, r.raw_json ?? null]))
}

export function saveYfinanceInsiderTransactions(store: StoreDeps, rows: Row[]): void {
  saveTypedRows(store, `INSERT OR REPLACE INTO yfinance_insider_transactions
    (symbol,transaction_id,insider,position,transaction_text,start_date,ownership,shares,value,source,updated_at,raw_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  rows.map((r) => [r.symbol, r.transaction_id, r.insider ?? null, r.position ?? null, r.transaction_text ?? null, r.start_date ?? null, r.ownership ?? null, r.shares ?? null, r.value ?? null, r.source ?? null, r.updated_at, r.raw_json ?? null]))
}

export function saveWindDocuments(store: StoreDeps, rows: Row[]): void {
  saveTypedRows(store, `INSERT OR REPLACE INTO wind_document
    (doc_id,tool,query,title,publisher,published_at,url,summary,entity_code,entity_name,source,updated_at,raw_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  rows.map((r) => [r.doc_id, r.tool, r.query ?? null, r.title ?? null, r.publisher ?? null, r.published_at ?? null, r.url ?? null, r.summary ?? null, r.entity_code ?? null, r.entity_name ?? null, r.source, r.updated_at, r.raw_json ?? null]))
}

export function saveWindEconomicSeries(store: StoreDeps, rows: Row[]): void {
  saveTypedRows(store, `INSERT OR REPLACE INTO wind_economic_series
    (series_key,metric_query,metric_name,metric_code,date,value_num,value_text,unit,frequency,currency,source,updated_at,raw_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  rows.map((r) => [r.series_key, r.metric_query, r.metric_name, r.metric_code ?? null, r.date, r.value_num ?? null, r.value_text ?? null, r.unit ?? null, r.frequency ?? null, r.currency ?? null, r.source, r.updated_at, r.raw_json ?? null]))
}

export function saveWindAnalyticsResults(store: StoreDeps, rows: Row[]): void {
  saveTypedRows(store, `INSERT OR REPLACE INTO wind_analytics_result
    (result_id,question,entity_code,entity_name,value_date,title,content,value_num,value_text,unit,source,updated_at,raw_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  rows.map((r) => [r.result_id, r.question, r.entity_code ?? null, r.entity_name ?? null, r.value_date ?? null, r.title ?? null, r.content ?? null, r.value_num ?? null, r.value_text ?? null, r.unit ?? null, r.source, r.updated_at, r.raw_json ?? null]))
}

function mapQuoteRow(row: Record<string, unknown>): QuoteSnapshotRow {
  return {
    code: String(row.code),
    timestamp: String(row.timestamp),
    fetched_at: row.fetched_at == null ? null : String(row.fetched_at),
    source: String(row.source),
    name: row.name == null ? null : String(row.name),
    price: numOrNull(row.price),
    change: numOrNull(row.change),
    change_pct: numOrNull(row.change_pct),
    open: numOrNull(row.open),
    high: numOrNull(row.high),
    low: numOrNull(row.low),
    prev_close: numOrNull(row.prev_close),
    volume: numOrNull(row.volume),
    amount: numOrNull(row.amount),
    pe: numOrNull(row.pe),
    pb: numOrNull(row.pb),
    market_cap: numOrNull(row.market_cap),
    turnover_rate: numOrNull(row.turnover_rate),
    raw_json: row.raw_json == null ? null : String(row.raw_json),
  }
}

export function getRecentQuoteSnapshot(store: StoreDeps, code: string, maxAgeMs: number, source?: string): QuoteSnapshotRow | null {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString()
  const params: unknown[] = [code, cutoff]
  let sql = 'SELECT * FROM quote_snapshot WHERE code = ? AND timestamp >= ?'
  if (source) { sql += ' AND source = ?'; params.push(source) }
  const row = store.one(`${sql} ORDER BY timestamp DESC LIMIT 1`, params)
  return row ? mapQuoteRow(row) : null
}

export function queryQuoteSnapshots(store: StoreDeps, code: string, limit = 20, source?: string): QuoteSnapshotRow[] {
  const params: unknown[] = [code]
  let sql = 'SELECT * FROM quote_snapshot WHERE code = ?'
  if (source) {
    sql += ' AND lower(source) = lower(?)'
    params.push(source)
  }
  params.push(limit)
  return store.query<Row>(`${sql} ORDER BY timestamp DESC LIMIT ?`, ...params).map(mapQuoteRow)
}

export function getReusableDataSummary(store: StoreDeps): ReusableDataSummaryRow[] {
  const queries = [
    ['quote_snapshot', 'timestamp'],
    ['yfinance_profile_fields', 'updated_at'],
    ['yfinance_statement_items', 'updated_at'],
    ['yfinance_recommendations', 'updated_at'],
    ['yfinance_news', 'updated_at'],
    ['yfinance_option_expiries', 'updated_at'],
    ['yfinance_option_contracts', 'updated_at'],
    ['yfinance_corporate_actions', 'updated_at'],
    ['yfinance_holders', 'updated_at'],
    ['yfinance_insider_transactions', 'updated_at'],
    ['api_result_cache', 'created_at'],
    ['raw_api_payload', 'created_at'],
    ['api_call_log', 'created_at'],
    ['kline_daily', 'date'],
    ['fundamental', 'updated_at'],
    ['money_flow', 'date'],
    ['sector_ranking', 'date'],
    ['limit_pool', 'date'],
    ['northbound', 'date'],
    ['fund_nav', 'date'],
    ['tick_chart_intraday', 'trade_date'],
    ['transactions', 'trade_date'],
    ['volume_profile', 'trade_date'],
    ['xdxr_event', 'fetched_at'],
    ['auction_snapshot', 'fetched_at'],
    ['tdx_index_momentum', 'fetched_at'],
    ['tdx_top_board', 'fetched_at'],
    ['tdx_security_count', 'fetched_at'],
    ['tdx_chart_sampling', 'fetched_at'],
    ['ex_table_entry', 'updated_at'],
    ['tdx_block_member', 'updated_at'],
    ['stock_company_info', 'updated_at'],
    ['ex_category', 'updated_at'],
    ['hot_rank', 'date'],
    ['dragon_tiger', 'date'],
    ['wind_document', 'updated_at'],
    ['wind_economic_series', 'updated_at'],
    ['wind_analytics_result', 'updated_at'],
    ['market_screening_snapshot', 'screened_at'],
    ['alpha_factor', 'source_date'],
  ] as const
  return queries.map(([table, timeCol]) => {
    try {
      const row = store.one(`SELECT COUNT(*) as cnt, MAX(${timeCol}) as latest FROM ${table}`)
      return {
        name: table,
        count: Number(row?.cnt ?? 0),
        latest: row?.latest == null ? null : String(row.latest),
        sources: sourceBreakdown(store, table),
      }
    } catch {
      return { name: table, count: 0, latest: null }
    }
  })
}

function sourceBreakdown(store: StoreDeps, table: string): string | null {
  try {
    const columns = store.query<{ name: string }>(`PRAGMA table_info(${table})`)
    const sourceColumn = columns.some((column) => column.name === 'source')
      ? 'source'
      : columns.some((column) => column.name === 'provider')
        ? 'provider'
        : null
    if (!sourceColumn) return null
    const rows = store.query<{ source: string | null; cnt: number }>(
      `SELECT COALESCE(${sourceColumn}, 'unknown') as source, COUNT(*) as cnt
        FROM ${table}
        GROUP BY COALESCE(${sourceColumn}, 'unknown')
        ORDER BY cnt DESC, source ASC
        LIMIT 3`,
    )
    const parts = rows
      .map((row) => `${row.source ?? 'unknown'}:${Number(row.cnt ?? 0)}`)
      .filter((part) => !part.endsWith(':0'))
    return parts.length > 0 ? parts.join(', ') : null
  } catch {
    return null
  }
}

export function cleanupApiReuseData(store: StoreDeps, opts: { quoteRetentionDays?: number; apiLogRetentionDays?: number }): void {
  const quoteDays = opts.quoteRetentionDays ?? 30
  const logDays = opts.apiLogRetentionDays ?? 90
  store.exec('DELETE FROM quote_snapshot WHERE timestamp < ?', new Date(Date.now() - quoteDays * 86400_000).toISOString())
  store.exec('DELETE FROM api_call_log WHERE created_at < ?', new Date(Date.now() - logDays * 86400_000).toISOString())
  store.exec('DELETE FROM api_result_cache WHERE expires_at <= ?', new Date().toISOString())
  store.exec('DELETE FROM raw_api_payload WHERE expires_at IS NOT NULL AND expires_at <= ?', new Date().toISOString())
}
