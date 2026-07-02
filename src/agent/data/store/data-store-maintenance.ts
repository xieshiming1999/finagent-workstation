import type { DataCoverage, FeedConfig } from './data-store-types'

type StoreDeps = {
  exec(sql: string, ...params: unknown[]): void
  query<T = unknown>(sql: string, ...params: unknown[]): T[]
  one(sql: string, params?: unknown[]): Record<string, unknown> | null
}

export function getCoverage(store: StoreDeps, code: string, dataType: string): DataCoverage | null {
  return store.one('SELECT * FROM data_coverage WHERE code = ? AND data_type = ?', [code, dataType]) as DataCoverage | null
}

export function getAllCoverage(store: StoreDeps, dataType?: string): DataCoverage[] {
  if (dataType) return store.query<DataCoverage>('SELECT * FROM data_coverage WHERE data_type = ? ORDER BY code', dataType)
  return store.query<DataCoverage>('SELECT * FROM data_coverage ORDER BY data_type, code')
}

export function updateCoverage(store: StoreDeps, code: string, dataType: string): void {
  const tableMap: Record<string, { table: string; codeColumn: string; dateColumn: string }> = {
    kline_daily: { table: 'kline_daily', codeColumn: 'code', dateColumn: 'date' },
    fund_nav: { table: 'fund_nav', codeColumn: 'code', dateColumn: 'date' },
    fund_money_yield: { table: 'fund_money_yield', codeColumn: 'code', dateColumn: 'date' },
    fund_holding: { table: 'fund_holding', codeColumn: 'fund_code', dateColumn: 'report_date' },
    money_flow: { table: 'money_flow', codeColumn: 'code', dateColumn: 'date' },
    fundamental: { table: 'fundamental', codeColumn: 'code', dateColumn: 'report_date' },
  }
  const meta = tableMap[dataType]
  if (!meta) {
    store.exec('INSERT OR REPLACE INTO data_coverage (code,data_type,earliest_date,latest_date,row_count,last_updated) VALUES (?,?,NULL,NULL,0,?)', code, dataType, new Date().toISOString())
    return
  }
  const stats = store.one(`SELECT MIN(${meta.dateColumn}) as earliest, MAX(${meta.dateColumn}) as latest, COUNT(*) as cnt FROM ${meta.table} WHERE ${meta.codeColumn} = ?`, [code])
  store.exec(
    'INSERT OR REPLACE INTO data_coverage (code,data_type,earliest_date,latest_date,row_count,last_updated) VALUES (?,?,?,?,?,?)',
    code, dataType, stats?.earliest ?? null, stats?.latest ?? null, stats?.cnt ?? 0, new Date().toISOString(),
  )
}

export function createTask(store: StoreDeps, type: string, code: string | null, params: Record<string, unknown>, priority = 5): number {
  store.exec('INSERT INTO fetch_tasks (task_type,code,params,status,priority,created_at) VALUES (?,?,?,?,?,?)', type, code, JSON.stringify(params), 'pending', priority, new Date().toISOString())
  return Number(store.one('SELECT last_insert_rowid() as id')?.id ?? 0)
}

export function getPendingTasks(store: StoreDeps, limit = 10): Array<Record<string, unknown>> {
  return store.query('SELECT * FROM fetch_tasks WHERE status = ? ORDER BY priority ASC, created_at ASC LIMIT ?', 'pending', limit)
}

export function updateTaskStatus(store: StoreDeps, id: number, status: string, progress?: Record<string, unknown>, error?: string): void {
  store.exec('UPDATE fetch_tasks SET status=?, progress=?, error=?, updated_at=? WHERE id=?', status, progress ? JSON.stringify(progress) : null, error ?? null, new Date().toISOString(), id)
}

export function failStaleActiveTasks(store: StoreDeps, maxAgeMs: number, reason = 'stale active task recovered on startup'): number {
  const now = Date.now()
  const rows = store.query<Record<string, unknown>>(
    "SELECT id,created_at,updated_at FROM fetch_tasks WHERE status IN ('pending','running')",
  )
  let count = 0
  for (const row of rows) {
    const marker = String(row.updated_at ?? row.created_at ?? '')
    const ts = Date.parse(marker)
    if (!Number.isFinite(ts) || now - ts < maxAgeMs) continue
    store.exec('UPDATE fetch_tasks SET status=?, error=?, updated_at=? WHERE id=?', 'failed', reason, new Date().toISOString(), row.id)
    count++
  }
  return count
}

export function reconcileDanglingRunningFeeds(store: StoreDeps): number {
  const feeds = store.query<FeedConfig>("SELECT * FROM data_feed_config WHERE status = 'running'")
  let count = 0
  for (const feed of feeds) {
    const directActive = store.query<Record<string, unknown>>(
      "SELECT id FROM fetch_tasks WHERE status IN ('pending','running') AND params LIKE ? LIMIT 1",
      `%"_feedId":"${feed.feed_id}"%`,
    )
    const legacyActive = store.query<Record<string, unknown>>(
      "SELECT id FROM fetch_tasks WHERE status IN ('pending','running') AND task_type = ? LIMIT 1",
      feedTaskType(feed.feed_type),
    )
    if (directActive.length > 0 || legacyActive.length > 0) continue
    store.exec('UPDATE data_feed_config SET status=?, last_error=NULL, updated_at=? WHERE feed_id=?', 'idle', new Date().toISOString(), feed.feed_id)
    count++
  }
  return count
}

export function getFeedConfigs(store: StoreDeps): FeedConfig[] {
  const rows = store.query<FeedConfig>('SELECT * FROM data_feed_config ORDER BY feed_id')
  if (rows.length > 0) {
    ensureDefaultFeedRows(store)
    ensureDailyIdentityFeeds(store)
    return store.query<FeedConfig>('SELECT * FROM data_feed_config ORDER BY feed_id')
  }
  initDefaultFeedConfigs(store)
  return store.query<FeedConfig>('SELECT * FROM data_feed_config ORDER BY feed_id')
}

export function getFeedConfig(store: StoreDeps, feedId: string): FeedConfig | null {
  return store.one('SELECT * FROM data_feed_config WHERE feed_id = ?', [feedId]) as FeedConfig | null
}

export function updateFeedConfig(store: StoreDeps, feedId: string, updates: Partial<FeedConfig>): void {
  const fields: string[] = []
  const values: unknown[] = []
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'feed_id') continue
    fields.push(`${key}=?`)
    values.push(value)
  }
  if (fields.length === 0) return
  fields.push('updated_at=?')
  values.push(new Date().toISOString(), feedId)
  store.exec(`UPDATE data_feed_config SET ${fields.join(',')} WHERE feed_id=?`, ...values)
}

function initDefaultFeedConfigs(store: StoreDeps): void {
  ensureDefaultFeedRows(store)
}

function feedTaskType(feedType: string): string {
  if (feedType === 'fund_performance_metrics') return 'fund_performance'
  if (feedType === 'kline_daily') return 'kline_batch'
  return feedType
}

function ensureDefaultFeedRows(store: StoreDeps): void {
  const now = new Date().toISOString()
  const defs = [
    ['kline_daily','日K线数据','kline_daily',1,'watchlist',null,5,'daily_close','15:30','["eastmoney","akshare"]'],
    ['fundamental','基本面数据','fundamental',1,'watchlist',null,3,'weekly','15:30','["akshare"]'],
    ['money_flow','资金流向','money_flow',1,'watchlist',null,1,'daily_close','15:30','["eastmoney"]'],
    ['sector','板块排名','sector',1,'all',null,0,'5min','15:30','["eastmoney"]'],
    ['limit_pool','涨停跌停','limit_pool',1,'all',null,0,'5min','15:30','["eastmoney"]'],
    ['northbound','北向资金','northbound',1,'all',null,1,'daily_close','15:30','["eastmoney"]'],
    ['stock_list','股票列表','stock_list',1,'all',null,0,'daily','15:30','["tdx","sina","eastmoney"]'],
    ['fund_list','基金列表','fund_list',1,'all',null,0,'daily','15:30','["akshare"]'],
    ['fund_performance','基金业绩指标','fund_performance_metrics',1,'all',null,0,'daily','15:30','["eastmoney","akshare"]'],
    ['fund_nav','基金净值','fund_nav',1,'all',null,3,'daily_close','15:30','["akshare"]'],
    ['fund_money_yield','货币基金收益','fund_money_yield',1,'all',null,3,'daily_close','15:30','["eastmoney","akshare"]'],
    ['fund_holding','基金持仓','fund_holding',1,'all',null,1,'quarterly','15:30','["akshare"]'],
    ['fund_manager','基金经理','fund_manager',1,'all',null,0,'monthly','15:30','["akshare"]'],
    ['etf_quotes','ETF行情','etf_quotes',1,'all',null,0,'5min','15:30','["eastmoney","akshare"]'],
    ['index_components','指数成分股','index_components',1,'preset','["000300","000905","000852","000016","399006"]',0,'monthly','15:30','["akshare"]'],
    ['index_kline','指数K线','index_kline',1,'preset','["000001","399001","399006","000300","000905","000852"]',5,'daily_close','15:30','["tdx","eastmoney"]'],
    ['calendar','交易日历','calendar',1,'all',null,0,'yearly','15:30','["szse"]'],
    ['industry','行业分类','industry',1,'all',null,0,'monthly','15:30','["akshare"]'],
  ]
  for (const def of defs) {
    store.exec('INSERT OR IGNORE INTO data_feed_config (feed_id,display_name,feed_type,enabled,scope,scope_codes,history_years,update_frequency,trigger_time,source_priority,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', ...def, 'idle', now)
  }
  ensureBoundedFundBatchScopes(store)
}

function ensureBoundedFundBatchScopes(store: StoreDeps): void {
  const now = new Date().toISOString()
  for (const feedId of ['fund_nav', 'fund_money_yield', 'fund_holding']) {
    store.exec(
      `UPDATE data_feed_config
        SET scope=?, updated_at=?
        WHERE feed_id=?
          AND scope=?
          AND (scope_codes IS NULL OR scope_codes = '')`,
      'all',
      now,
      feedId,
      'watchlist',
    )
  }
}

function ensureDailyIdentityFeeds(store: StoreDeps): void {
  store.exec(
    `UPDATE data_feed_config
      SET update_frequency=?, source_priority=?, updated_at=?
      WHERE feed_id=? AND (update_frequency IS NULL OR update_frequency != ? OR source_priority IS NULL OR source_priority NOT LIKE ?)`,
    'daily',
    '["tdx","sina","eastmoney"]',
    new Date().toISOString(),
    'stock_list',
    'daily',
    '%tdx%',
  )
  store.exec(
    `UPDATE data_feed_config
      SET update_frequency=?, source_priority=?, updated_at=?
      WHERE feed_id=? AND (update_frequency IS NULL OR update_frequency != ? OR source_priority IS NULL OR source_priority NOT LIKE ?)`,
    'daily',
    '["akshare"]',
    new Date().toISOString(),
    'fund_list',
    'daily',
    '%akshare%',
  )
}

export function getStats(store: StoreDeps): { tables: Array<{ name: string; count: number }>; sizeBytes: number } {
  const tables = store.query<Array<{ name: string }>[number]>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  return {
    tables: tables.map((table) => ({ name: table.name, count: Number(store.one(`SELECT COUNT(*) as cnt FROM ${table.name}`)?.cnt ?? 0) })),
    sizeBytes: 0,
  }
}
