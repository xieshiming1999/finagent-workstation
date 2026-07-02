import { supportsOrdinaryFundNav } from '../agent/data/fund-category'

type QueryableStore = {
  query<T = unknown>(sql: string, ...params: unknown[]): T[]
}

export interface FundRefreshTaskRequest {
  taskType: string
  code: string | null
  params: Record<string, unknown>
  priority: number
}

export function queryFundSuggestions(ds: QueryableStore, limit = 8): Array<Record<string, unknown>> {
  return ds.query(
    `SELECT code,name,fund_type,fund_category,company,nav,nav_date,return_1y,return_3y,return_ytd,updated_at
      FROM fund_list
      WHERE code IS NOT NULL AND code != ''
        AND ${supportedFundNavSqlPredicate()}
      ORDER BY COALESCE(total_size, 0) DESC, COALESCE(return_ytd, return_1y, 0) DESC
      LIMIT ?`,
    boundedLimit(limit),
  )
}

export function buildFundPulseRefreshRequests(ds: QueryableStore, watchlistCodes: string[] = []): {
  requests: FundRefreshTaskRequest[]
  existing: boolean
} {
  const requests: FundRefreshTaskRequest[] = []
  let existing = false

  for (const taskType of ['fund_list', 'etf_quotes']) {
    if (hasActiveTask(ds, taskType)) {
      existing = true
      continue
    }
    requests.push({
      taskType,
      code: null,
      params: { source: 'fund-pulse', limit: 80, forceLive: true },
      priority: 2,
    })
  }

  if (needsNoCodeRefresh(ds, 'fund_performance_metrics', 'fetched_at') && !hasActiveTask(ds, 'fund_performance')) {
    requests.push({
      taskType: 'fund_performance',
      code: null,
      params: { source: 'fund-pulse', forceLive: true },
      priority: 3,
    })
  } else if (hasActiveTask(ds, 'fund_performance')) {
    existing = true
  }

  for (const code of fundNavSeedCodes(ds, watchlistCodes, 8)) {
    if (hasActiveTask(ds, 'fund_nav', code)) {
      existing = true
      continue
    }
    if (!needsFundNavRefresh(ds, code)) continue
    requests.push({
      taskType: 'fund_nav',
      code,
      params: { source: 'fund-pulse', forceLive: true },
      priority: 4,
    })
  }

  return { requests, existing }
}

export function fundNavSeedCodes(ds: QueryableStore, watchlistCodes: string[] = [], limit = 8): string[] {
  const cleanWatchlist = filterFundNavSupportedCodes(ds, uniqueCodes(watchlistCodes))
  const ranked = ds.query<{ code: string; name?: string | null; fund_type?: string | null; fund_category?: string | null }>(
    `SELECT code FROM fund_list
      WHERE code IS NOT NULL AND code != ''
        AND ${supportedFundNavSqlPredicate()}
      ORDER BY COALESCE(total_size, 0) DESC, COALESCE(return_ytd, return_1y, 0) DESC
      LIMIT ?`,
    boundedLimit(limit),
  ).map((row) => row.code)
  return uniqueCodes([...cleanWatchlist, ...ranked]).slice(0, boundedLimit(limit))
}

function filterFundNavSupportedCodes(ds: QueryableStore, codes: string[]): string[] {
  if (codes.length === 0) return []
  const placeholders = codes.map(() => '?').join(',')
  const rows = ds.query<{ code: string; name?: string | null; fund_type?: string | null; fund_category?: string | null }>(
    `SELECT code,name,fund_type,fund_category FROM fund_list WHERE code IN (${placeholders})`,
    ...codes,
  )
  if (rows.length === 0) return codes
  const supported = new Set(rows.filter(isFundNavSupportedRow).map((row) => String(row.code)))
  const known = new Set(rows.map((row) => String(row.code)))
  return codes.filter((code) => !known.has(code) || supported.has(code))
}

function supportedFundNavSqlPredicate(): string {
  return `fund_category NOT IN ('money', 'backend', 'unknown')`
}

function isFundNavSupportedRow(row: { fund_category?: string | null }): boolean {
  return supportsOrdinaryFundNav(row.fund_category)
}

function needsFundNavRefresh(ds: QueryableStore, code: string): boolean {
  const coverage = ds.query<{ latest_date: string | null; last_updated: string | null }>(
    'SELECT latest_date,last_updated FROM data_coverage WHERE code = ? AND data_type = ? LIMIT 1',
    code,
    'fund_nav',
  )[0]
  const latest = coverage?.last_updated ?? coverage?.latest_date
  if (!latest) return true
  const ts = new Date(latest).getTime()
  if (!Number.isFinite(ts)) return true
  return (Date.now() - ts) / 86400000 >= 1
}

function needsNoCodeRefresh(ds: QueryableStore, table: string, timeColumn: string): boolean {
  const rows = ds.query<{ count: number; latest: string | null }>(
    `SELECT COUNT(*) as count, MAX(${timeColumn}) as latest FROM ${table}`,
  )
  const row = rows[0]
  const count = Number(row?.count ?? 0)
  if (!Number.isFinite(count) || count <= 0) return true
  const latest = row?.latest
  if (!latest) return true
  const ts = new Date(latest).getTime()
  if (!Number.isFinite(ts)) return true
  return (Date.now() - ts) / 86400000 >= 1
}

function hasActiveTask(ds: QueryableStore, taskType: string, code?: string): boolean {
  const rows = code
    ? ds.query<{ id: number }>(
      'SELECT id FROM fetch_tasks WHERE task_type = ? AND code = ? AND status IN (?,?) LIMIT 1',
      taskType,
      code,
      'pending',
      'running',
    )
    : ds.query<{ id: number }>(
      'SELECT id FROM fetch_tasks WHERE task_type = ? AND status IN (?,?) LIMIT 1',
      taskType,
      'pending',
      'running',
    )
  return rows.length > 0
}

function uniqueCodes(values: Array<unknown>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)))
}

function boundedLimit(limit: number): number {
  return Math.max(1, Math.min(20, Number(limit) || 8))
}
