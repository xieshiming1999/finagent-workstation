import { normalizeFundCategory } from '../fund-category'

type Row = Record<string, unknown>

type StoreDeps = {
  exec(sql: string, ...params: unknown[]): void
  query<T = unknown>(sql: string, ...params: unknown[]): T[]
  updateCoverage(code: string, dataType: string): void
}

export function saveMoneyFlow(store: StoreDeps, rows: Row[]): void {
  for (const r of rows) {
    store.exec(
      'INSERT OR REPLACE INTO money_flow (code,date,main_net,small_net,medium_net,large_net,super_large_net,close_price,change_pct,source) VALUES (?,?,?,?,?,?,?,?,?,?)',
      r.code, r.date, r.main_net, r.small_net, r.medium_net, r.large_net, r.super_large_net, r.close_price, r.change_pct, r.source,
    )
  }
  if (rows.length > 0) store.updateCoverage(String(rows[0].code), 'money_flow')
}

export function queryMoneyFlow(store: StoreDeps, code: string, limit = 30): Row[] {
  return store.query('SELECT * FROM money_flow WHERE code = ? ORDER BY date DESC LIMIT ?', code, limit)
}

export function saveSectorRanking(store: StoreDeps, date: string, sectorType: string, rows: Row[]): void {
  store.exec('DELETE FROM sector_ranking WHERE date = ? AND sector_type = ?', date, sectorType)
  for (const r of rows) {
    store.exec(
      'INSERT INTO sector_ranking (date,sector_type,code,name,change_pct,turnover_rate,up_count,down_count,leading_stock,leading_pct,rank,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      date, sectorType, r.code, r.name, r.change_pct, r.turnover_rate, r.up_count, r.down_count, r.leading_stock, r.leading_pct, r.rank, r.source,
    )
  }
  if (rows.length > 0) store.updateCoverage(String(rows[0].fund_code), 'fund_holding')
}

export function querySectorRanking(store: StoreDeps, date?: string, type = 'industry', limit = 50): Row[] {
  if (date) return store.query('SELECT * FROM sector_ranking WHERE date = ? AND sector_type = ? ORDER BY rank LIMIT ?', date, type, limit)
  return store.query('SELECT * FROM sector_ranking WHERE sector_type = ? ORDER BY date DESC, rank LIMIT ?', type, limit)
}

export function saveLimitPool(store: StoreDeps, rows: Row[]): void {
  const fetchedAt = new Date().toISOString()
  for (const r of rows) {
    store.exec(
      'INSERT OR REPLACE INTO limit_pool (date,code,name,limit_type,change_pct,first_limit_time,last_limit_time,open_count,limit_reason,continuous_days,source,fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      r.date, r.code, r.name, r.limit_type, r.change_pct, r.first_limit_time, r.last_limit_time, r.open_count, r.limit_reason, r.continuous_days, r.source, r.fetched_at ?? fetchedAt,
    )
  }
}

export function queryLimitPool(store: StoreDeps, date?: string, type?: string): Row[] {
  let sql = 'SELECT * FROM limit_pool WHERE 1=1'
  const params: unknown[] = []
  if (date) { sql += ' AND date = ?'; params.push(date) }
  if (type) { sql += ' AND limit_type = ?'; params.push(type) }
  return store.query(`${sql} ORDER BY date DESC, fetched_at DESC, change_pct DESC LIMIT 100`, ...params)
}

export function saveNorthboundFlow(store: StoreDeps, rows: Row[]): void {
  const fetchedAt = new Date().toISOString()
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO northbound_flow
        (trade_date,source,fetched_at,mutual_type,buy_amount,sell_amount,net_buy,hold_market_cap,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?)`,
      r.trade_date, r.source, r.fetched_at ?? fetchedAt, r.mutual_type ?? 'northbound',
      r.buy_amount ?? null, r.sell_amount ?? null, r.net_buy ?? null, r.hold_market_cap ?? null, r.raw_json ?? null,
    )
  }
}

export function queryNorthboundFlow(store: StoreDeps, date?: string, limit = 30): Row[] {
  let sql = 'SELECT * FROM northbound_flow WHERE 1=1'
  const params: unknown[] = []
  if (date) { sql += ' AND trade_date = ?'; params.push(date) }
  return store.query(`${sql} ORDER BY trade_date DESC LIMIT ?`, ...params, limit)
}

export function saveNorthbound(store: StoreDeps, rows: Row[]): void {
  for (const r of rows) {
    store.exec(
      'INSERT OR REPLACE INTO northbound (date,sh_net,sz_net,total_net,sh_buy,sh_sell,sz_buy,sz_sell,source) VALUES (?,?,?,?,?,?,?,?,?)',
      r.date, r.sh_net, r.sz_net, r.total_net, r.sh_buy, r.sh_sell, r.sz_buy, r.sz_sell, r.source,
    )
  }
}

export function queryNorthbound(store: StoreDeps, limit = 30): Row[] {
  return store.query('SELECT * FROM northbound ORDER BY date DESC LIMIT ?', limit)
}

export function saveNorthboundHolding(store: StoreDeps, rows: Row[]): void {
  const fetchedAt = new Date().toISOString()
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO northbound_holding
        (trade_date,code,name,hold_market_cap,hold_ratio,source,fetched_at,raw_json)
        VALUES (?,?,?,?,?,?,?,?)`,
      r.trade_date, r.code, r.name ?? null, r.hold_market_cap ?? null, r.hold_ratio ?? null, r.source, r.fetched_at ?? fetchedAt, r.raw_json ?? null,
    )
  }
}

export function queryNorthboundHolding(store: StoreDeps, code?: string, date?: string, limit = 30): Row[] {
  let sql = 'SELECT * FROM northbound_holding WHERE 1=1'
  const params: unknown[] = []
  if (code) { sql += ' AND code = ?'; params.push(code) }
  if (date) { sql += ' AND trade_date = ?'; params.push(date) }
  return store.query(`${sql} ORDER BY trade_date DESC, fetched_at DESC, hold_market_cap DESC LIMIT ?`, ...params, limit)
}

export function saveFundNav(store: StoreDeps, rows: Row[]): void {
  const fetchedAt = new Date().toISOString()
  for (const r of rows) {
    store.exec(
      'INSERT OR REPLACE INTO fund_nav (code,date,nav,acc_nav,daily_return,source,fetched_at) VALUES (?,?,?,?,?,?,?)',
      r.code, r.date, r.nav, r.acc_nav, r.daily_return, r.source, r.fetched_at ?? fetchedAt,
    )
  }
  if (rows.length > 0) store.updateCoverage(String(rows[0].code), 'fund_nav')
}

type DateSeriesQueryOptions = {
  start?: string
  end?: string
  limit?: number
  order?: 'asc' | 'desc'
}

type FundListQueryOptions = {
  type?: string
  code?: string
  codes?: string[]
  limit?: number
}

function normalizeFundTypePatterns(type?: string): string[] {
  const normalized = String(type ?? '').trim().toLowerCase()
  if (!normalized) return []
  const map: Record<string, string[]> = {
    mixed: ['混合'],
    mix: ['混合'],
    hybrid: ['混合'],
    stock: ['股票'],
    equity: ['股票'],
    bond: ['债券'],
    fixed_income: ['债券'],
    money: ['货币'],
    monetary: ['货币'],
    index: ['指数'],
    etf: ['ETF', '指数'],
    fof: ['FOF'],
    qdii: ['QDII'],
    reits: ['REIT'],
    reit: ['REIT'],
  }
  return map[normalized] ?? [String(type).trim()]
}

function normalizeFundCodes(opts: FundListQueryOptions): string[] {
  const codes = new Set<string>()
  if (opts.code) codes.add(opts.code)
  for (const code of opts.codes ?? []) {
    if (code) codes.add(code)
  }
  return Array.from(codes).map((code) => code.trim()).filter(Boolean)
}

function dateSeriesOrder(order?: 'asc' | 'desc'): 'ASC' | 'DESC' {
  return order === 'asc' ? 'ASC' : 'DESC'
}

export function queryFundNav(store: StoreDeps, code: string, opts: DateSeriesQueryOptions = {}): Row[] {
  let sql = 'SELECT * FROM fund_nav WHERE code = ?'
  const params: unknown[] = [code]
  if (opts.start) { sql += ' AND date >= ?'; params.push(opts.start) }
  if (opts.end) { sql += ' AND date <= ?'; params.push(opts.end) }
  sql += ` ORDER BY date ${dateSeriesOrder(opts.order)}`
  if (opts.limit) params.push(opts.limit), sql += ' LIMIT ?'
  return store.query(sql, ...params)
}

export function saveFundMoneyYield(store: StoreDeps, rows: Row[]): void {
  const fetchedAt = new Date().toISOString()
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO fund_money_yield
        (code,date,million_copies_income,seven_day_annualized_yield,source,fetched_at,raw_json)
        VALUES (?,?,?,?,?,?,?)`,
      r.code,
      r.date,
      r.million_copies_income,
      r.seven_day_annualized_yield,
      r.source,
      r.fetched_at ?? fetchedAt,
      r.raw_json ?? null,
    )
  }
  if (rows.length > 0) store.updateCoverage(String(rows[0].code), 'fund_money_yield')
}

export function queryFundMoneyYield(store: StoreDeps, code: string, opts: DateSeriesQueryOptions = {}): Row[] {
  let sql = 'SELECT * FROM fund_money_yield WHERE code = ?'
  const params: unknown[] = [code]
  if (opts.start) { sql += ' AND date >= ?'; params.push(opts.start) }
  if (opts.end) { sql += ' AND date <= ?'; params.push(opts.end) }
  sql += ` ORDER BY date ${dateSeriesOrder(opts.order)}`
  if (opts.limit) params.push(opts.limit), sql += ' LIMIT ?'
  return store.query(sql, ...params)
}

export function saveFundDividendFactors(store: StoreDeps, rows: Row[]): void {
  const fetchedAt = new Date().toISOString()
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO fund_dividend_factor
        (code,event_date,dividend,factor,source,fetched_at,raw_json)
        VALUES (?,?,?,?,?,?,?)`,
      r.code,
      r.event_date,
      r.dividend ?? null,
      r.factor ?? null,
      r.source,
      r.fetched_at ?? fetchedAt,
      r.raw_json ?? null,
    )
  }
  if (rows.length > 0) store.updateCoverage(String(rows[0].code), 'fund_dividend_factor')
}

export function queryFundDividendFactors(
  store: StoreDeps,
  code: string,
  opts: { start?: string; end?: string; limit?: number } = {},
): Row[] {
  let sql = 'SELECT * FROM fund_dividend_factor WHERE code = ?'
  const params: unknown[] = [code]
  if (opts.start) { sql += ' AND event_date >= ?'; params.push(opts.start) }
  if (opts.end) { sql += ' AND event_date <= ?'; params.push(opts.end) }
  sql += ' ORDER BY event_date ASC'
  if (opts.limit) params.push(opts.limit), sql += ' LIMIT ?'
  return store.query(sql, ...params)
}

export function saveIntradayOhlcvBars(store: StoreDeps, rows: Row[]): void {
  const fetchedAt = new Date().toISOString()
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO intraday_ohlcv_bars
        (code,bar_time,trade_date,interval_minutes,open,high,low,close,volume,source,fetched_at,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      r.code,
      r.bar_time,
      r.trade_date ?? null,
      r.interval_minutes,
      r.open ?? null,
      r.high ?? null,
      r.low ?? null,
      r.close ?? null,
      r.volume ?? null,
      r.source,
      r.fetched_at ?? fetchedAt,
      r.raw_json ?? null,
    )
  }
  if (rows.length > 0) store.updateCoverage(String(rows[0].code), 'intraday_ohlcv_bars')
}

export function queryIntradayOhlcvBars(
  store: StoreDeps,
  code: string,
  opts: { start?: string; end?: string; intervalMinutes?: number; limit?: number } = {},
): Row[] {
  let sql = 'SELECT * FROM intraday_ohlcv_bars WHERE code = ?'
  const params: unknown[] = [code]
  if (opts.start) { sql += ' AND bar_time >= ?'; params.push(opts.start) }
  if (opts.end) { sql += ' AND bar_time <= ?'; params.push(opts.end) }
  if (opts.intervalMinutes) { sql += ' AND interval_minutes = ?'; params.push(opts.intervalMinutes) }
  sql += ' ORDER BY bar_time ASC'
  if (opts.limit) params.push(opts.limit), sql += ' LIMIT ?'
  return store.query(sql, ...params)
}

export function saveFundHolding(store: StoreDeps, rows: Row[]): void {
  for (const r of rows) {
    store.exec(
      'INSERT OR REPLACE INTO fund_holding (fund_code,report_date,stock_code,stock_name,hold_shares,hold_value,hold_pct,rank,source) VALUES (?,?,?,?,?,?,?,?,?)',
      r.fund_code, r.report_date, r.stock_code, r.stock_name, r.hold_shares, r.hold_value, r.hold_pct, r.rank, r.source,
    )
  }
  if (rows.length > 0) store.updateCoverage(String(rows[0].fund_code), 'fund_holding')
}

export function queryFundHolding(
  store: StoreDeps,
  opts: { fundCode?: string; stockCode?: string; reportDate?: string; limit?: number } = {},
): Row[] {
  let sql = 'SELECT * FROM fund_holding WHERE 1=1'
  const params: unknown[] = []
  if (opts.fundCode) { sql += ' AND fund_code = ?'; params.push(opts.fundCode) }
  if (opts.stockCode) { sql += ' AND stock_code = ?'; params.push(opts.stockCode) }
  if (opts.reportDate) { sql += ' AND report_date = ?'; params.push(opts.reportDate) }
  return store.query(`${sql} ORDER BY report_date DESC, rank ASC LIMIT ?`, ...params, opts.limit ?? 100)
}

export function saveFundList(store: StoreDeps, rows: Row[]): void {
  for (const r of rows) {
    const fundCategory = normalizeFundCategory(r)
    store.exec(
      'INSERT OR REPLACE INTO fund_list (code,name,fund_type,fund_category,company,manager,setup_date,total_size,nav,nav_date,return_1y,return_3y,return_ytd,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      r.code, r.name, r.fund_type, fundCategory, r.company, r.manager, r.setup_date, r.total_size, r.nav, r.nav_date, r.return_1y, r.return_3y, r.return_ytd, r.updated_at,
    )
  }
}

export function queryFundList(store: StoreDeps, opts: FundListQueryOptions = {}): Row[] {
  let sql = 'SELECT * FROM fund_list WHERE 1=1'
  const params: unknown[] = []
  const codes = normalizeFundCodes(opts)
  if (codes.length > 0) {
    sql += ` AND code IN (${codes.map(() => '?').join(',')})`
    params.push(...codes)
  }
  const typePatterns = normalizeFundTypePatterns(opts.type)
  if (typePatterns.length > 0) {
    sql += ` AND (${typePatterns.map(() => 'fund_type LIKE ?').join(' OR ')})`
    params.push(...typePatterns.map((pattern) => `%${pattern}%`))
  }
  return store.query(
    `${sql} ORDER BY CASE WHEN total_size IS NULL THEN 1 ELSE 0 END, total_size DESC, code ASC LIMIT ?`,
    ...params,
    opts.limit ?? 50,
  )
}

export function saveFundPerformanceMetrics(store: StoreDeps, rows: Row[]): void {
  const fetchedAt = new Date().toISOString()
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO fund_performance_metrics
        (code,metric_date,provider,capability_id,source_action,nav,return_ytd,return_1w,return_1m,return_3m,return_6m,return_1y,return_2y,return_3y,return_since_inception,fetched_at,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      r.code,
      r.metric_date,
      r.provider,
      r.capability_id,
      r.source_action,
      r.nav ?? null,
      r.return_ytd ?? null,
      r.return_1w ?? null,
      r.return_1m ?? null,
      r.return_3m ?? null,
      r.return_6m ?? null,
      r.return_1y ?? null,
      r.return_2y ?? null,
      r.return_3y ?? null,
      r.return_since_inception ?? null,
      r.fetched_at ?? fetchedAt,
      r.raw_json ?? null,
    )
  }
}

export function queryFundPerformanceMetrics(
  store: StoreDeps,
  opts: { code?: string; provider?: string; metricDate?: string; limit?: number } = {},
): Row[] {
  let sql = 'SELECT * FROM fund_performance_metrics WHERE 1=1'
  const params: unknown[] = []
  if (opts.code) { sql += ' AND code = ?'; params.push(opts.code) }
  if (opts.provider) { sql += ' AND provider = ?'; params.push(opts.provider) }
  if (opts.metricDate) { sql += ' AND metric_date = ?'; params.push(opts.metricDate) }
  return store.query(`${sql} ORDER BY metric_date DESC, fetched_at DESC, return_1y DESC LIMIT ?`, ...params, opts.limit ?? 100)
}

export function saveIndexConstituents(store: StoreDeps, rows: Row[]): void {
  const fetchedAt = new Date().toISOString()
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO index_constituent
        (index_code,stock_code,stock_name,weight,as_of_date,provider,capability_id,source_action,fetched_at,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
      r.index_code,
      r.stock_code,
      r.stock_name ?? null,
      r.weight ?? null,
      r.as_of_date,
      r.provider,
      r.capability_id ?? null,
      r.source_action ?? null,
      r.fetched_at ?? fetchedAt,
      r.raw_json ?? null,
    )
  }
  const indexCodes = Array.from(new Set(rows.map((r) => String(r.index_code ?? '')).filter(Boolean)))
  for (const indexCode of indexCodes) {
    const stats = store.query<Record<string, unknown>>(
      'SELECT MIN(as_of_date) as earliest, MAX(as_of_date) as latest, COUNT(*) as cnt FROM index_constituent WHERE index_code = ?',
      indexCode,
    )[0]
    store.exec(
      'INSERT OR REPLACE INTO data_coverage (code,data_type,earliest_date,latest_date,row_count,last_updated) VALUES (?,?,?,?,?,?)',
      indexCode,
      'index_constituent',
      stats?.earliest ?? null,
      stats?.latest ?? null,
      stats?.cnt ?? 0,
      new Date().toISOString(),
    )
  }
}

export function queryIndexConstituents(
  store: StoreDeps,
  opts: { indexCode?: string; stockCode?: string; asOfDate?: string; provider?: string; limit?: number } = {},
): Row[] {
  let sql = 'SELECT * FROM index_constituent WHERE 1=1'
  const params: unknown[] = []
  if (opts.indexCode) { sql += ' AND index_code = ?'; params.push(opts.indexCode) }
  if (opts.stockCode) { sql += ' AND stock_code = ?'; params.push(opts.stockCode) }
  if (opts.asOfDate) { sql += ' AND as_of_date = ?'; params.push(opts.asOfDate) }
  if (opts.provider) { sql += ' AND provider = ?'; params.push(opts.provider) }
  return store.query(`${sql} ORDER BY as_of_date DESC, weight DESC, stock_code LIMIT ?`, ...params, opts.limit ?? 300)
}

export function saveStockShareholders(store: StoreDeps, rows: Row[]): void {
  const fetchedAt = new Date().toISOString()
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO stock_shareholder
        (code,report_date,holder_name,holder_type,rank,hold_shares,hold_pct,share_nature,announcement_date,shareholder_note,shareholder_count,average_holding,source,fetched_at,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      r.code,
      r.report_date,
      r.holder_name,
      r.holder_type,
      r.rank ?? null,
      r.hold_shares ?? null,
      r.hold_pct ?? null,
      r.share_nature ?? null,
      r.announcement_date ?? null,
      r.shareholder_note ?? null,
      r.shareholder_count ?? null,
      r.average_holding ?? null,
      r.source,
      r.fetched_at ?? fetchedAt,
      r.raw_json ?? null,
    )
  }
  const codes = Array.from(new Set(rows.map((r) => String(r.code ?? '')).filter(Boolean)))
  for (const code of codes) {
    const stats = store.query<Record<string, unknown>>(
      'SELECT MIN(report_date) as earliest, MAX(report_date) as latest, COUNT(*) as cnt FROM stock_shareholder WHERE code = ?',
      code,
    )[0]
    store.exec(
      'INSERT OR REPLACE INTO data_coverage (code,data_type,earliest_date,latest_date,row_count,last_updated) VALUES (?,?,?,?,?,?)',
      code,
      'stock_shareholder',
      stats?.earliest ?? null,
      stats?.latest ?? null,
      stats?.cnt ?? 0,
      new Date().toISOString(),
    )
  }
}

export function queryStockShareholders(
  store: StoreDeps,
  opts: { code?: string; holderName?: string; reportDate?: string; source?: string; limit?: number } = {},
): Row[] {
  let sql = 'SELECT * FROM stock_shareholder WHERE 1=1'
  const params: unknown[] = []
  if (opts.code) { sql += ' AND code = ?'; params.push(opts.code) }
  if (opts.holderName) { sql += ' AND holder_name LIKE ?'; params.push(`%${opts.holderName}%`) }
  if (opts.reportDate) { sql += ' AND report_date = ?'; params.push(opts.reportDate) }
  if (opts.source) { sql += ' AND source = ?'; params.push(opts.source) }
  return store.query(`${sql} ORDER BY report_date DESC, rank IS NULL, rank ASC, hold_pct DESC LIMIT ?`, ...params, opts.limit ?? 100)
}

export function saveFundManagers(store: StoreDeps, rows: Row[]): void {
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO fund_manager
        (manager_id,name,company,start_date,total_size,fund_count,best_return,experience_years,updated_at,source,capability_id,source_action,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      r.manager_id, r.name, r.company, r.start_date, r.total_size, r.fund_count, r.best_return, r.experience_years, r.updated_at,
      r.source ?? null, r.capability_id ?? null, r.source_action ?? null, r.raw_json ?? null,
    )
  }
}

export function queryFundManagers(store: StoreDeps, opts: { company?: string; name?: string; limit?: number } = {}): Row[] {
  let sql = 'SELECT * FROM fund_manager WHERE 1=1'
  const params: unknown[] = []
  if (opts.company) { sql += ' AND company = ?'; params.push(opts.company) }
  if (opts.name) { sql += ' AND name = ?'; params.push(opts.name) }
  return store.query(`${sql} ORDER BY total_size DESC, updated_at DESC LIMIT ?`, ...params, opts.limit ?? 100)
}

export function saveCalendar(store: StoreDeps, rows: Row[]): void {
  for (const r of rows) {
    store.exec('INSERT OR REPLACE INTO trade_calendar (date,market,is_trading_day,year,month) VALUES (?,?,?,?,?)', r.date, r.market, r.is_trading_day, r.year, r.month)
  }
  const markets = Array.from(new Set(rows.map((r) => String(r.market ?? 'CN')).filter(Boolean)))
  for (const market of markets) {
    const stats = store.query<Record<string, unknown>>(
      'SELECT MIN(date) as earliest, MAX(date) as latest, COUNT(*) as cnt FROM trade_calendar WHERE market = ?',
      market,
    )[0]
    store.exec(
      'INSERT OR REPLACE INTO data_coverage (code,data_type,earliest_date,latest_date,row_count,last_updated) VALUES (?,?,?,?,?,?)',
      market,
      'calendar',
      stats?.earliest ?? null,
      stats?.latest ?? null,
      stats?.cnt ?? 0,
      new Date().toISOString(),
    )
  }
}

export function queryCalendar(
  store: StoreDeps,
  opts: { market?: string; start?: string; end?: string; limit?: number; order?: 'asc' | 'desc' } = {},
): Row[] {
  let sql = 'SELECT * FROM trade_calendar WHERE 1=1'
  const params: unknown[] = []
  if (opts.market) { sql += ' AND market = ?'; params.push(String(opts.market).toUpperCase()) }
  if (opts.start) { sql += ' AND date >= ?'; params.push(opts.start) }
  if (opts.end) { sql += ' AND date <= ?'; params.push(opts.end) }
  const order = opts.order === 'desc' ? 'DESC' : 'ASC'
  return store.query(`${sql} ORDER BY date ${order} LIMIT ?`, ...params, opts.limit ?? 100)
}

export function saveFinanceNews(store: StoreDeps, rows: Row[]): void {
  const fetchedAt = new Date().toISOString()
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO finance_news
        (news_id,title,summary,content,publisher,published_at,url,source,fetched_at,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
      r.news_id,
      r.title ?? null,
      r.summary ?? null,
      r.content ?? null,
      r.publisher ?? null,
      r.published_at ?? null,
      r.url ?? null,
      r.source ?? 'news',
      r.fetched_at ?? fetchedAt,
      r.raw_json ?? null,
    )
  }
}

export function queryFinanceNews(
  store: StoreDeps,
  opts: { keyword?: string; source?: string; limit?: number } = {},
): Row[] {
  const queryLimit = Math.max(opts.limit ?? 50, 200)
  const rows = opts.source
    ? store.query<Row>(
      `SELECT * FROM finance_news
       WHERE source = ?
       ORDER BY published_at DESC, fetched_at DESC
       LIMIT ${queryLimit}`,
      opts.source,
    )
    : store.query<Row>(
      `SELECT * FROM finance_news
       ORDER BY published_at DESC, fetched_at DESC
       LIMIT ${queryLimit}`,
    )
  const terms = String(opts.keyword ?? '')
    .split(/\s+/)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean)
  const filtered = terms.length === 0
    ? rows
    : rows.filter((row) => {
      const haystack = [
        row.title,
        row.summary,
        row.content,
      ].map((value) => String(value ?? '').toLowerCase()).join(' ')
      return terms.some((term) => haystack.includes(term))
    })
  return filtered.slice(0, opts.limit ?? 50)
}

export function saveMarketScreeningSnapshots(store: StoreDeps, rows: Row[]): void {
  const fetchedAt = new Date().toISOString()
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO market_screening_snapshot
        (provider,capability_id,source_action,symbol,name,market,rank,score,screened_at,fetched_at,universe_json,filters_json,sort_json,fields_json,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      r.provider,
      r.capability_id,
      r.source_action,
      r.symbol,
      r.name ?? null,
      r.market ?? null,
      r.rank ?? null,
      r.score ?? null,
      r.screened_at,
      r.fetched_at ?? fetchedAt,
      r.universe_json ?? null,
      r.filters_json ?? null,
      r.sort_json ?? null,
      r.fields_json ?? null,
      r.raw_json ?? null,
    )
  }
}

export function queryMarketScreeningSnapshots(
  store: StoreDeps,
  opts: { provider?: string; symbol?: string; sourceAction?: string; since?: string; limit?: number } = {},
): Row[] {
  let sql = 'SELECT * FROM market_screening_snapshot WHERE 1=1'
  const params: unknown[] = []
  if (opts.provider) { sql += ' AND provider = ?'; params.push(opts.provider) }
  if (opts.symbol) { sql += ' AND symbol = ?'; params.push(opts.symbol) }
  if (opts.sourceAction) { sql += ' AND source_action = ?'; params.push(opts.sourceAction) }
  if (opts.since) { sql += ' AND screened_at >= ?'; params.push(opts.since) }
  return store.query(
    `${sql} ORDER BY screened_at DESC, rank IS NULL, rank ASC, score DESC LIMIT ?`,
    ...params,
    opts.limit ?? 50,
  )
}

export function saveMarginTradingRows(store: StoreDeps, rows: Row[]): void {
  const fetchedAt = new Date().toISOString()
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO margin_trading
        (trade_date,code,name,provider,capability_id,source_action,financing_buy,financing_balance,margin_sell_volume,margin_balance_volume,margin_balance,total_balance,fetched_at,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      r.trade_date,
      r.code,
      r.name ?? null,
      r.provider,
      r.capability_id ?? null,
      r.source_action ?? null,
      r.financing_buy ?? null,
      r.financing_balance ?? null,
      r.margin_sell_volume ?? null,
      r.margin_balance_volume ?? null,
      r.margin_balance ?? null,
      r.total_balance ?? null,
      r.fetched_at ?? fetchedAt,
      r.raw_json ?? null,
    )
  }
  const codes = Array.from(new Set(rows.map((r) => String(r.code ?? '')).filter(Boolean)))
  for (const code of codes) {
    const stats = store.query<Record<string, unknown>>(
      'SELECT MIN(trade_date) as earliest, MAX(trade_date) as latest, COUNT(*) as cnt FROM margin_trading WHERE code = ?',
      code,
    )[0]
    store.exec(
      'INSERT OR REPLACE INTO data_coverage (code,data_type,earliest_date,latest_date,row_count,last_updated) VALUES (?,?,?,?,?,?)',
      code,
      'margin_trading',
      stats?.earliest ?? null,
      stats?.latest ?? null,
      stats?.cnt ?? 0,
      new Date().toISOString(),
    )
  }
}

export function queryMarginTradingRows(
  store: StoreDeps,
  opts: { code?: string; tradeDate?: string; provider?: string; limit?: number } = {},
): Row[] {
  let sql = 'SELECT * FROM margin_trading WHERE 1=1'
  const params: unknown[] = []
  if (opts.code) { sql += ' AND code = ?'; params.push(opts.code) }
  if (opts.tradeDate) { sql += ' AND trade_date = ?'; params.push(opts.tradeDate) }
  if (opts.provider) { sql += ' AND provider = ?'; params.push(opts.provider) }
  return store.query(
    `${sql} ORDER BY trade_date DESC, fetched_at DESC, total_balance DESC LIMIT ?`,
    ...params,
    opts.limit ?? 100,
  )
}

export function saveTechnicalIndicatorSeries(store: StoreDeps, rows: Row[]): void {
  const fetchedAt = new Date().toISOString()
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO technical_indicator_series
        (provider,capability_id,source_action,symbol,indicator,field_name,params_hash,source_date,value,fetched_at,params_json,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      r.provider,
      r.capability_id,
      r.source_action,
      r.symbol,
      r.indicator,
      r.field_name,
      r.params_hash,
      r.source_date,
      r.value ?? null,
      r.fetched_at ?? fetchedAt,
      r.params_json ?? null,
      r.raw_json ?? null,
    )
  }
}

export function queryTechnicalIndicatorSeries(
  store: StoreDeps,
  opts: { symbol?: string; indicator?: string; fieldName?: string; since?: string; limit?: number } = {},
): Row[] {
  let sql = 'SELECT * FROM technical_indicator_series WHERE 1=1'
  const params: unknown[] = []
  if (opts.symbol) { sql += ' AND symbol = ?'; params.push(opts.symbol) }
  if (opts.indicator) { sql += ' AND indicator = ?'; params.push(opts.indicator) }
  if (opts.fieldName) { sql += ' AND field_name = ?'; params.push(opts.fieldName) }
  if (opts.since) { sql += ' AND source_date >= ?'; params.push(opts.since) }
  return store.query(
    `${sql} ORDER BY source_date DESC, fetched_at DESC, field_name LIMIT ?`,
    ...params,
    opts.limit ?? 200,
  )
}

export function saveAlphaFactorRows(store: StoreDeps, rows: Row[]): void {
  const fetchedAt = new Date().toISOString()
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO alpha_factor
        (provider,capability_id,source_action,symbol,factor_name,params_hash,source_date,value,bars,fetched_at,params_json,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      r.provider,
      r.capability_id,
      r.source_action,
      r.symbol,
      r.factor_name,
      r.params_hash,
      r.source_date,
      r.value ?? null,
      r.bars ?? null,
      r.fetched_at ?? fetchedAt,
      r.params_json ?? null,
      r.raw_json ?? null,
    )
  }
}

export function queryAlphaFactorRows(
  store: StoreDeps,
  opts: { symbol?: string; factorName?: string; since?: string; provider?: string; limit?: number } = {},
): Row[] {
  let sql = 'SELECT * FROM alpha_factor WHERE 1=1'
  const params: unknown[] = []
  if (opts.symbol) { sql += ' AND symbol = ?'; params.push(opts.symbol) }
  if (opts.factorName) { sql += ' AND factor_name = ?'; params.push(opts.factorName) }
  if (opts.since) { sql += ' AND source_date >= ?'; params.push(opts.since) }
  if (opts.provider) { sql += ' AND provider = ?'; params.push(opts.provider) }
  return store.query(
    `${sql} ORDER BY source_date DESC, fetched_at DESC, factor_name LIMIT ?`,
    ...params,
    opts.limit ?? 200,
  )
}

export function saveIndustryMap(store: StoreDeps, rows: Row[]): void {
  for (const r of rows) {
    store.exec('INSERT OR REPLACE INTO industry_map (code,industry_l1,industry_l2,industry_l3,updated_at) VALUES (?,?,?,?,?)', r.code, r.industry_l1, r.industry_l2, r.industry_l3, r.updated_at)
  }
}

export function saveTickChartIntraday(store: StoreDeps, rows: Row[]): void {
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO tick_chart_intraday
        (code,trade_date,time,price,avg_price,volume,amount,source,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?)`,
      r.code, r.trade_date, r.time, r.price, r.avg_price, r.volume, r.amount, r.source, r.raw_json,
    )
  }
}

export function saveTransactions(store: StoreDeps, rows: Row[]): void {
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO transactions
        (code,trade_date,time,price,volume,amount,direction,source,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?)`,
      r.code, r.trade_date, r.time, r.price, r.volume, r.amount, r.direction, r.source, r.raw_json,
    )
  }
}

export function saveVolumeProfile(store: StoreDeps, rows: Row[]): void {
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO volume_profile
        (code,trade_date,price,volume,pct,source,raw_json)
        VALUES (?,?,?,?,?,?,?)`,
      r.code, r.trade_date, r.price, r.volume, r.pct, r.source, r.raw_json,
    )
  }
}

export function saveTdxBlockMembers(store: StoreDeps, rows: Row[]): void {
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO tdx_block_member
        (block_code,block_name,code,name,block_type,source,updated_at,raw_json)
        VALUES (?,?,?,?,?,?,?,?)`,
      r.block_code, r.block_name, r.code, r.name, r.block_type, r.source, r.updated_at, r.raw_json,
    )
  }
}

export function saveStockCompanyInfo(store: StoreDeps, rows: Row[]): void {
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO stock_company_info
        (code,info_type,title,content,source,updated_at,raw_json)
        VALUES (?,?,?,?,?,?,?)`,
      r.code, r.info_type, r.title, r.content, r.source, r.updated_at, r.raw_json,
    )
  }
}

export function saveHotRank(store: StoreDeps, rows: Row[]): void {
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO hot_rank
        (date,code,name,"rank",heat,rank_change,source,raw_json)
        VALUES (?,?,?,?,?,?,?,?)`,
      r.date, r.code, r.name, r.rank, r.heat, r.rank_change, r.source, r.raw_json ?? null,
    )
  }
}

export function saveDragonTiger(store: StoreDeps, rows: Row[]): void {
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO dragon_tiger
        (date,code,name,reason,buy_amt,sell_amt,net_amt,accum_amount,source,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
      r.date, r.code, r.name, r.reason, r.buy_amt, r.sell_amt, r.net_amt, r.accum_amount, r.source, r.raw_json ?? null,
    )
  }
}

export function saveUnusualActivity(store: StoreDeps, rows: Row[]): void {
  const fetchedAt = new Date().toISOString()
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO unusual_activity
        (event_date,code,event_time,event_type,name,info,source,fetched_at,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?)`,
      r.event_date, r.code, r.event_time, r.event_type, r.name ?? null, r.info ?? null, r.source, r.fetched_at ?? fetchedAt, r.raw_json ?? null,
    )
  }
}

export function queryUnusualActivity(store: StoreDeps, code?: string, date?: string, limit = 50): Row[] {
  let sql = 'SELECT * FROM unusual_activity WHERE 1=1'
  const params: unknown[] = []
  if (code) { sql += ' AND code = ?'; params.push(code) }
  if (date) { sql += ' AND event_date = ?'; params.push(date) }
  return store.query(`${sql} ORDER BY event_date DESC, fetched_at DESC, event_time DESC LIMIT ?`, ...params, limit)
}

export function saveFlowRank(store: StoreDeps, rows: Row[]): void {
  const fetchedAt = new Date().toISOString()
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO flow_rank
        (trade_date,period,code,name,main_net,main_pct,super_large_net,super_large_pct,large_net,large_pct,medium_net,medium_pct,source,fetched_at,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      r.trade_date, r.period, r.code, r.name ?? null, r.main_net ?? null, r.main_pct ?? null,
      r.super_large_net ?? null, r.super_large_pct ?? null, r.large_net ?? null, r.large_pct ?? null,
      r.medium_net ?? null, r.medium_pct ?? null, r.source, r.fetched_at ?? fetchedAt, r.raw_json ?? null,
    )
  }
}

export function queryFlowRank(store: StoreDeps, period?: string, code?: string, date?: string, limit = 50): Row[] {
  let sql = 'SELECT * FROM flow_rank WHERE 1=1'
  const params: unknown[] = []
  if (period) { sql += ' AND period = ?'; params.push(period) }
  if (code) { sql += ' AND code = ?'; params.push(code) }
  if (date) { sql += ' AND trade_date = ?'; params.push(date) }
  return store.query(`${sql} ORDER BY trade_date DESC, fetched_at DESC, main_net DESC LIMIT ?`, ...params, limit)
}

export function saveChipDistribution(store: StoreDeps, rows: Row[]): void {
  const fetchedAt = new Date().toISOString()
  for (const r of rows) {
    store.exec(
      `INSERT OR REPLACE INTO chip_distribution
        (code,trade_date,avg_cost,profit_ratio,concentration70,concentration90,current_price,method,source,fetched_at,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      r.code, r.trade_date, r.avg_cost ?? null, r.profit_ratio ?? null, r.concentration70 ?? null,
      r.concentration90 ?? null, r.current_price ?? null, r.method ?? null, r.source, r.fetched_at ?? fetchedAt, r.raw_json ?? null,
    )
  }
}

export function queryChipDistribution(store: StoreDeps, code: string, date?: string, limit = 20): Row[] {
  let sql = 'SELECT * FROM chip_distribution WHERE code = ?'
  const params: unknown[] = [code]
  if (date) { sql += ' AND trade_date = ?'; params.push(date) }
  return store.query(`${sql} ORDER BY trade_date DESC, fetched_at DESC LIMIT ?`, ...params, limit)
}
