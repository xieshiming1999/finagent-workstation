import type {
  AuctionSnapshotRow,
  ExCategoryRow,
  ExTableEntryRow,
  FundamentalRow,
  IndexMomentumRow,
  KlineRow,
  StockInfo,
  TdxChartSamplingRow,
  TdxSecurityCountRow,
  TopBoardRow,
  XdxrEventRow,
} from './data-store-types'

type StoreDeps = {
  exec(sql: string, ...params: unknown[]): void
  query<T = unknown>(sql: string, ...params: unknown[]): T[]
  updateCoverage(code: string, dataType: string): void
}

export function queryKline(
  store: StoreDeps,
  code: string,
  opts: { start?: string; end?: string; adjust?: string; limit?: number; source?: string } = {},
): KlineRow[] {
  const adjust = opts.adjust ?? 'qfq'
  let sql = 'SELECT * FROM kline_daily WHERE code = ? AND adjust = ?'
  const params: unknown[] = [code, adjust]
  if (opts.source) { sql += ' AND lower(source) = lower(?)'; params.push(opts.source) }
  if (opts.start) { sql += ' AND date >= ?'; params.push(opts.start) }
  if (opts.end) { sql += ' AND date <= ?'; params.push(opts.end) }
  sql += ' ORDER BY date ASC'
  if (opts.limit) { sql += ' LIMIT ?'; params.push(opts.limit) }
  return store.query<KlineRow>(sql, ...params)
}

export function saveKline(store: StoreDeps, rows: KlineRow[]): void {
  for (const row of rows) {
    store.exec(
      'INSERT OR REPLACE INTO kline_daily (code,date,open,high,low,close,volume,amount,change_pct,turnover_rate,adjust,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      row.code, row.date, row.open, row.high, row.low, row.close, row.volume, row.amount, row.change_pct, row.turnover_rate, row.adjust ?? 'qfq', row.source,
    )
  }
  if (rows.length > 0) store.updateCoverage(rows[0].code, 'kline_daily')
}

export function queryStockList(store: StoreDeps, filter?: { market?: string; industry?: string; type?: string }): StockInfo[] {
  let sql = 'SELECT * FROM stock_list WHERE delist_date IS NULL'
  const params: unknown[] = []
  if (filter?.market) { sql += ' AND market = ?'; params.push(filter.market) }
  if (filter?.industry) { sql += ' AND industry LIKE ?'; params.push(`%${filter.industry}%`) }
  if (filter?.type) { sql += ' AND stock_type = ?'; params.push(filter.type) }
  return store.query<StockInfo>(`${sql} ORDER BY code`, ...params)
}

export function queryStockIdentity(store: StoreDeps, code: string): StockInfo | null {
  const trimmed = code.trim()
  if (!trimmed) return null
  const rows = store.query<StockInfo>(
    'SELECT * FROM stock_list WHERE code = ? ORDER BY updated_at DESC LIMIT 1',
    trimmed,
  )
  return rows[0] ?? null
}

export function saveStockList(store: StoreDeps, stocks: StockInfo[]): void {
  for (const stock of stocks) {
    store.exec(
      `INSERT INTO stock_list (code,name,market,industry,list_date,delist_date,stock_type,total_share,circ_share,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(code) DO UPDATE SET name=excluded.name,market=excluded.market,industry=excluded.industry,stock_type=excluded.stock_type,updated_at=excluded.updated_at`,
      stock.code, stock.name, stock.market, stock.industry, stock.list_date, stock.delist_date, stock.stock_type, null, null, stock.updated_at,
    )
  }
}

export function saveExCategories(store: StoreDeps, rows: ExCategoryRow[]): void {
  for (const row of rows) {
    store.exec(
      `INSERT OR REPLACE INTO ex_category
        (category,name,abbr,source,updated_at,raw_json)
        VALUES (?,?,?,?,?,?)`,
      row.category, row.name, row.abbr ?? null, row.source ?? null, row.updated_at, row.raw_json ?? null,
    )
  }
}

export function queryExCategories(store: StoreDeps, limit = 100): ExCategoryRow[] {
  return store.query<ExCategoryRow>('SELECT * FROM ex_category ORDER BY category LIMIT ?', limit)
}

export function saveXdxrEvents(store: StoreDeps, rows: XdxrEventRow[]): void {
  for (const row of rows) {
    store.exec(
      `INSERT OR REPLACE INTO xdxr_event
        (code,event_date,category,source,fetched_at,category_name,a,b,c,d,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      row.code, row.event_date, row.category, row.source, row.fetched_at, row.category_name ?? null,
      row.a ?? null, row.b ?? null, row.c ?? null, row.d ?? null, row.raw_json ?? null,
    )
  }
}

export function queryXdxrEvents(store: StoreDeps, code: string, limit = 50): XdxrEventRow[] {
  return store.query<XdxrEventRow>('SELECT * FROM xdxr_event WHERE code = ? ORDER BY event_date DESC, category LIMIT ?', code, limit)
}

export function saveAuctionSnapshots(store: StoreDeps, rows: AuctionSnapshotRow[]): void {
  for (const row of rows) {
    store.exec(
      `INSERT OR REPLACE INTO auction_snapshot
        (code,trade_date,time,sequence,source,fetched_at,price,volume,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?)`,
      row.code, row.trade_date, row.time, row.sequence, row.source, row.fetched_at, row.price ?? null, row.volume ?? null, row.raw_json ?? null,
    )
  }
}

export function queryAuctionSnapshots(store: StoreDeps, code: string, date?: string, limit = 100): AuctionSnapshotRow[] {
  let sql = 'SELECT * FROM auction_snapshot WHERE code = ?'
  const params: unknown[] = [code]
  if (date) { sql += ' AND trade_date = ?'; params.push(date) }
  return store.query<AuctionSnapshotRow>(`${sql} ORDER BY trade_date DESC, sequence ASC LIMIT ?`, ...params, limit)
}

export function saveIndexMomentumRows(store: StoreDeps, rows: IndexMomentumRow[]): void {
  for (const row of rows) {
    store.exec(
      `INSERT OR REPLACE INTO tdx_index_momentum
        (code,trade_date,sequence,source,fetched_at,value,raw_json)
        VALUES (?,?,?,?,?,?,?)`,
      row.code, row.trade_date, row.sequence, row.source, row.fetched_at, row.value ?? null, row.raw_json ?? null,
    )
  }
}

export function queryIndexMomentum(store: StoreDeps, code: string, date?: string, limit = 200): IndexMomentumRow[] {
  let sql = 'SELECT * FROM tdx_index_momentum WHERE code = ?'
  const params: unknown[] = [code]
  if (date) { sql += ' AND trade_date = ?'; params.push(date) }
  return store.query<IndexMomentumRow>(`${sql} ORDER BY trade_date DESC, sequence ASC LIMIT ?`, ...params, limit)
}

export function saveTopBoardRows(store: StoreDeps, rows: TopBoardRow[]): void {
  for (const row of rows) {
    store.exec(
      `INSERT OR REPLACE INTO tdx_top_board
        (board_date,category,side,rank,code,source,fetched_at,market,price,value,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      row.board_date, row.category, row.side, row.rank, row.code, row.source, row.fetched_at, row.market ?? null, row.price ?? null, row.value ?? null, row.raw_json ?? null,
    )
  }
}

export function queryTopBoard(
  store: StoreDeps,
  opts: { code?: string; category?: string; side?: string; boardDate?: string; limit?: number } = {},
): TopBoardRow[] {
  let sql = 'SELECT * FROM tdx_top_board WHERE 1=1'
  const params: unknown[] = []
  if (opts.code) { sql += ' AND code = ?'; params.push(opts.code) }
  if (opts.category) { sql += ' AND category = ?'; params.push(opts.category) }
  if (opts.side) { sql += ' AND side = ?'; params.push(opts.side) }
  if (opts.boardDate) { sql += ' AND board_date = ?'; params.push(opts.boardDate) }
  return store.query<TopBoardRow>(`${sql} ORDER BY board_date DESC, category, side, rank LIMIT ?`, ...params, opts.limit ?? 100)
}

export function saveTdxSecurityCounts(store: StoreDeps, rows: TdxSecurityCountRow[]): void {
  for (const row of rows) {
    store.exec(
      `INSERT OR REPLACE INTO tdx_security_count
        (scope,market,source,fetched_at,count,raw_json)
        VALUES (?,?,?,?,?,?)`,
      row.scope, row.market, row.source, row.fetched_at, row.count, row.raw_json ?? null,
    )
  }
}

export function queryTdxSecurityCounts(
  store: StoreDeps,
  opts: { scope?: string; market?: string; limit?: number } = {},
): TdxSecurityCountRow[] {
  let sql = 'SELECT * FROM tdx_security_count WHERE 1=1'
  const params: unknown[] = []
  if (opts.scope) { sql += ' AND scope = ?'; params.push(opts.scope) }
  if (opts.market) { sql += ' AND market = ?'; params.push(opts.market) }
  return store.query<TdxSecurityCountRow>(`${sql} ORDER BY fetched_at DESC LIMIT ?`, ...params, opts.limit ?? 50)
}

export function saveTdxChartSampling(store: StoreDeps, rows: TdxChartSamplingRow[]): void {
  for (const row of rows) {
    store.exec(
      `INSERT OR REPLACE INTO tdx_chart_sampling
        (scope,code,sequence,source,fetched_at,market,category,pre_close,price,change,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      row.scope, row.code, row.sequence, row.source, row.fetched_at, row.market ?? null,
      row.category ?? null, row.pre_close ?? null, row.price ?? null, row.change ?? null, row.raw_json ?? null,
    )
  }
}

export function queryTdxChartSampling(
  store: StoreDeps,
  opts: { scope?: string; code?: string; market?: string; category?: string; limit?: number } = {},
): TdxChartSamplingRow[] {
  let sql = 'SELECT * FROM tdx_chart_sampling WHERE 1=1'
  const params: unknown[] = []
  if (opts.scope) { sql += ' AND scope = ?'; params.push(opts.scope) }
  if (opts.code) { sql += ' AND code = ?'; params.push(opts.code) }
  if (opts.market) { sql += ' AND market = ?'; params.push(opts.market) }
  if (opts.category) { sql += ' AND category = ?'; params.push(opts.category) }
  return store.query<TdxChartSamplingRow>(`${sql} ORDER BY fetched_at DESC, sequence ASC LIMIT ?`, ...params, opts.limit ?? 240)
}

export function saveExTableEntries(store: StoreDeps, rows: ExTableEntryRow[]): void {
  for (const row of rows) {
    store.exec(
      `INSERT OR REPLACE INTO ex_table_entry
        (entry_key,category,code,name,source,updated_at,raw_json)
        VALUES (?,?,?,?,?,?,?)`,
      row.entry_key, row.category ?? null, row.code, row.name ?? null, row.source, row.updated_at, row.raw_json ?? null,
    )
  }
}

export function queryExTableEntries(store: StoreDeps, opts: { code?: string; category?: string; limit?: number } = {}): ExTableEntryRow[] {
  let sql = 'SELECT * FROM ex_table_entry WHERE 1=1'
  const params: unknown[] = []
  if (opts.code) { sql += ' AND code = ?'; params.push(opts.code) }
  if (opts.category) { sql += ' AND category = ?'; params.push(opts.category) }
  return store.query<ExTableEntryRow>(`${sql} ORDER BY updated_at DESC, category, code LIMIT ?`, ...params, opts.limit ?? 100)
}

export function searchStock(store: StoreDeps, query: string): StockInfo[] {
  const terms = stockSearchTerms(query)
  const clauses = terms.map(() => '(code LIKE ? OR name LIKE ? OR industry LIKE ?)').join(' OR ')
  const params = terms.flatMap((term) => [`%${term}%`, `%${term}%`, `%${term}%`])
  return store.query<StockInfo>(
    `SELECT * FROM stock_list WHERE ${clauses} LIMIT 20`,
    ...params,
  )
}

function stockSearchTerms(query: string): string[] {
  const raw = query.trim()
  if (!raw) return ['']
  const terms = new Set<string>([raw])
  for (const term of raw.split(/[\s,，;；、/|()（）:：]+/).map((item) => item.trim()).filter(Boolean)) {
    if (/^\d{6}$/.test(term) || (term.length >= 2 && term.length <= 24)) terms.add(term)
  }
  const normalized = raw.toLowerCase()
  const aliases: Array<[RegExp, string[]]> = [
    [/\bbaijiu\b/, ['白酒']],
    [/\bmoutai\b|\bkweichow\s+moutai\b|\bguizhou\s+moutai\b/, ['茅台', '贵州茅台', '白酒']],
  ]
  for (const [pattern, mappedTerms] of aliases) {
    if (pattern.test(normalized)) {
      for (const term of mappedTerms) terms.add(term)
    }
  }
  return [...terms]
}

export function queryFundamental(store: StoreDeps, code: string, limit = 8): FundamentalRow[] {
  return store.query<FundamentalRow>('SELECT * FROM fundamental WHERE code = ? ORDER BY report_date DESC LIMIT ?', code, limit)
}

export function queryFundamentalSample(
  store: StoreDeps,
  opts: { limit?: number; peLte?: number; peGte?: number; roeGte?: number; latestOnly?: boolean } = {},
): FundamentalRow[] {
  const limit = Math.max(1, Math.min(Number(opts.limit ?? 50), 200))
  const params: unknown[] = []
  let sql = opts.latestOnly !== false
    ? `SELECT f.* FROM fundamental f
       JOIN (
         SELECT code, MAX(report_date) AS report_date
         FROM fundamental
         GROUP BY code
       ) latest ON latest.code = f.code AND latest.report_date = f.report_date
       WHERE 1=1`
    : 'SELECT f.* FROM fundamental f WHERE 1=1'
  if (opts.peLte != null && Number.isFinite(opts.peLte)) {
    sql += ' AND f.pe_ttm IS NOT NULL AND f.pe_ttm <= ?'
    params.push(opts.peLte)
  }
  if (opts.peGte != null && Number.isFinite(opts.peGte)) {
    sql += ' AND f.pe_ttm IS NOT NULL AND f.pe_ttm >= ?'
    params.push(opts.peGte)
  }
  if (opts.roeGte != null && Number.isFinite(opts.roeGte)) {
    sql += ' AND f.roe IS NOT NULL AND f.roe >= ?'
    params.push(opts.roeGte)
  }
  sql += ' ORDER BY f.report_date DESC, f.roe DESC, f.pe_ttm ASC LIMIT ?'
  params.push(limit)
  return store.query<FundamentalRow>(sql, ...params)
}

export function saveFundamental(store: StoreDeps, rows: FundamentalRow[]): void {
  for (const row of rows) {
    store.exec(
      `INSERT INTO fundamental
        (code,report_date,pe_ttm,pb,ps_ttm,roe,gross_margin,net_margin,revenue,revenue_yoy,net_profit,profit_yoy,total_assets,total_liabilities,debt_ratio,dividend_yield,market_cap,circ_cap,source,updated_at,raw_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(code,report_date) DO UPDATE SET
          pe_ttm=COALESCE(excluded.pe_ttm, fundamental.pe_ttm),
          pb=COALESCE(excluded.pb, fundamental.pb),
          ps_ttm=COALESCE(excluded.ps_ttm, fundamental.ps_ttm),
          roe=COALESCE(excluded.roe, fundamental.roe),
          gross_margin=COALESCE(excluded.gross_margin, fundamental.gross_margin),
          net_margin=COALESCE(excluded.net_margin, fundamental.net_margin),
          revenue=COALESCE(excluded.revenue, fundamental.revenue),
          revenue_yoy=COALESCE(excluded.revenue_yoy, fundamental.revenue_yoy),
          net_profit=COALESCE(excluded.net_profit, fundamental.net_profit),
          profit_yoy=COALESCE(excluded.profit_yoy, fundamental.profit_yoy),
          total_assets=COALESCE(excluded.total_assets, fundamental.total_assets),
          total_liabilities=COALESCE(excluded.total_liabilities, fundamental.total_liabilities),
          debt_ratio=COALESCE(excluded.debt_ratio, fundamental.debt_ratio),
          dividend_yield=COALESCE(excluded.dividend_yield, fundamental.dividend_yield),
          market_cap=COALESCE(excluded.market_cap, fundamental.market_cap),
          circ_cap=COALESCE(excluded.circ_cap, fundamental.circ_cap),
          source=excluded.source,
          updated_at=excluded.updated_at,
          raw_json=COALESCE(excluded.raw_json, fundamental.raw_json)`,
      row.code, row.report_date, row.pe_ttm ?? null, row.pb ?? null, row.ps_ttm ?? null, row.roe ?? null,
      row.gross_margin ?? null, row.net_margin ?? null, row.revenue ?? null, row.revenue_yoy ?? null, row.net_profit ?? null,
      row.profit_yoy ?? null, row.total_assets ?? null, row.total_liabilities ?? null, row.debt_ratio ?? null,
      row.dividend_yield ?? null, row.market_cap ?? null, row.circ_cap ?? null, row.source ?? null, row.updated_at ?? new Date().toISOString(),
      row.raw_json ?? null,
    )
  }
  if (rows.length > 0) store.updateCoverage(rows[0].code, 'fundamental')
}
