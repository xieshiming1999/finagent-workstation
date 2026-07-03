import type { ToolContext } from '../tool'
import { DataStore } from '../data/store/data-store'
import type { FetchTask } from '../data/queue/fetch-queue'
import type { IngestionResult } from '../data/ingestion/registry'

let store: DataStore | null = null

export function getStore(ctx: ToolContext): DataStore {
  if (!store) store = new DataStore(ctx.basePath)
  return store
}

export function normalizeTimeout(raw: unknown): number {
  const value = Number(raw ?? 60_000)
  if (!Number.isFinite(value)) return 60_000
  return Math.max(1_000, Math.min(Math.floor(value), 300_000))
}

export function queuedResult(description: string, ids: number[], priority: number): string {
  return JSON.stringify({
    ok: true,
    action: 'fetch',
    retrieval_status: 'queued',
    taskIds: ids,
    priority,
    target: description,
    next: 'Use DataStore(action:"fetch_status") to inspect progress, then query local coverage/data before calling external APIs again.',
  }, null, 2)
}

export function parseFetchTask(row: Record<string, unknown>): FetchTask {
  let params: Record<string, unknown> = {}
  try { params = JSON.parse(String(row.params ?? '{}')) } catch { params = {} }
  let progress: FetchTask['progress'] = null
  try { progress = row.progress ? JSON.parse(String(row.progress)) : null } catch { progress = null }
  return {
    id: Number(row.id),
    taskType: String(row.task_type ?? ''),
    code: row.code == null ? null : String(row.code),
    params,
    status: String(row.status ?? 'pending') as FetchTask['status'],
    priority: Number(row.priority ?? 5),
    progress,
    createdAt: String(row.created_at ?? ''),
    error: row.error == null ? null : String(row.error),
  }
}

export function summarizeFetchTask(task: FetchTask): Record<string, unknown> {
  return {
    id: task.id,
    type: task.taskType,
    code: task.code,
    status: task.status,
    progress: task.progress,
    error: task.error,
  }
}

export function formatIngestionResult(result: IngestionResult): string {
  return JSON.stringify({
    ingestion: 'structured',
    provider: result.provider,
    endpoint: result.endpoint,
    schema: result.schema,
    table: result.table,
    rows: result.count,
    persisted: result.persisted,
    rawSaved: result.rawSaved,
    warning: result.warning,
  }, null, 2)
}

export function formatRows(
  title: string,
  rows: Array<Record<string, unknown>>,
  render: (row: Record<string, unknown>) => string,
  provenance?: ReadbackProvenance,
): string {
  return `${readbackTitle(title, provenance)} (${rows.length}):\n${rows.map(render).join('\n')}`
}

export type ReadbackProvenance = {
  interfaceId: string
  provider?: string
  providerId?: string
  providerStatus?: string
  capabilityId?: string
  canonicalSchema?: string
  canonicalTable?: string
  cacheStatus?: string
  readbackAction?: string
  providerFilter?: string
  providerMode?: string
  cacheSourceFilter?: string
  sourceProviders?: string[]
  marketScope?: string[]
  globalOnly?: boolean
  asOf?: string | null
  fetchedAt?: string | null
}

export function readbackTitle(title: string, provenance?: ReadbackProvenance): string {
  if (!provenance) return title
  const parts = [
    `interface:${provenance.interfaceId}`,
    `provider:${provenance.provider ?? 'local'}`,
    provenance.providerId ? `providerId:${provenance.providerId}` : null,
    provenance.providerStatus ? `providerStatus:${provenance.providerStatus}` : null,
    provenance.capabilityId ? `capability:${provenance.capabilityId}` : null,
    provenance.canonicalSchema ? `schema:${provenance.canonicalSchema}` : null,
    provenance.canonicalTable ? `table:${provenance.canonicalTable}` : null,
    `cacheStatus:${provenance.cacheStatus ?? 'local-hit'}`,
    provenance.readbackAction ? `readback:${provenance.readbackAction}` : null,
    provenance.providerFilter ? `providerFilter:${provenance.providerFilter}` : null,
    provenance.providerMode ? `providerMode:${provenance.providerMode}` : null,
    provenance.cacheSourceFilter ? `cacheSourceFilter:${provenance.cacheSourceFilter}` : null,
    provenance.sourceProviders?.length ? `sourceProviders:${provenance.sourceProviders.join(',')}` : null,
    provenance.globalOnly === true ? 'globalOnly:true' : null,
    provenance.marketScope?.length ? `marketScope:${provenance.marketScope.join(',')}` : null,
    provenance.asOf ? `asOf:${provenance.asOf}` : null,
    provenance.fetchedAt ? `fetchedAt:${provenance.fetchedAt}` : null,
  ].filter(Boolean)
  return `${title} | ${parts.join(' | ')}`
}

export function defaultYfinanceFunc(dataset: string): string {
  return ({
    profile: 'info',
    statements: 'financials',
    recommendations: 'recommendations',
    news: 'news',
    options: 'option_chain',
    option_open_interest: 'option_chain',
    open_interest: 'option_chain',
    option_volume: 'option_chain',
    volume: 'option_chain',
    option_implied_volatility: 'option_chain',
    implied_volatility: 'option_chain',
    option_moneyness: 'option_chain',
    moneyness: 'option_chain',
    in_the_money: 'option_chain',
    option_bid_ask_spread: 'option_chain',
    option_spread: 'option_chain',
    bid_ask_spread: 'option_chain',
    spread: 'option_chain',
    option_price_change: 'option_chain',
    price_change: 'option_chain',
    change: 'option_chain',
    percent_change: 'option_chain',
    option_trade_recency: 'option_chain',
    trade_recency: 'option_chain',
    last_trade: 'option_chain',
    last_trade_date: 'option_chain',
    expiries: 'options',
    option_expiries: 'options',
    actions: 'actions',
    dividends: 'actions',
    splits: 'actions',
    stock_splits: 'actions',
    holders: 'institutional_holders',
    institutional_holders: 'institutional_holders',
    institutions: 'institutional_holders',
    mutualfund_holders: 'mutualfund_holders',
    mutual_fund_holders: 'mutualfund_holders',
    fund_holders: 'mutualfund_holders',
    insiders: 'insider_transactions',
    earnings_calendar: 'earnings_dates',
    earnings_dates: 'earnings_dates',
    earnings_history: 'earnings_history',
    earnings_estimates: 'earnings_estimate',
    earnings_estimate: 'earnings_estimate',
    eps_revisions: 'eps_revisions',
    eps_trend: 'eps_trend',
    quarterly_financial_statements: 'quarterly_financials',
    quarterly_financials: 'quarterly_financials',
    quarterly_statements: 'quarterly_financials',
    upgrade_downgrade_events: 'recommendations',
    upgrades_downgrades: 'recommendations',
  } as Record<string, string>)[dataset] ?? 'info'
}

export function normalizeTushareParams(input: Record<string, unknown>): Record<string, unknown> {
  const nested = input.params && typeof input.params === 'object' && !Array.isArray(input.params)
    ? input.params as Record<string, unknown>
    : null
  if (nested) return { ...nested }

  const reserved = new Set([
    'action', 'api_name', 'apiName', 'func', 'fields', 'persist', 'limit', 'timeout',
    'block', 'priority', 'source', 'sourceName',
  ])
  const params: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (reserved.has(key) || value == null) continue
    params[key] = value
  }
  return params
}

export function queryByCodeDate(
  ds: DataStore,
  table: string,
  code: string,
  date: string | undefined,
  limit: number,
  orderBy: string,
): Array<Record<string, unknown>> {
  let sql = `SELECT * FROM ${table} WHERE code = ?`
  const params: unknown[] = [code]
  if (date) { sql += ' AND trade_date = ?'; params.push(date) }
  sql += ` ORDER BY ${orderBy} LIMIT ?`; params.push(limit)
  return ds.query<Record<string, unknown>>(sql, ...params)
}

export function queryByOptionalCodeDate(
  ds: DataStore,
  table: string,
  input: Record<string, unknown>,
  orderBy: string,
  limit: number,
): Array<Record<string, unknown>> {
  const code = String(input.code ?? '')
  const date = input.date as string | undefined
  let sql = `SELECT * FROM ${table} WHERE 1=1`
  const params: unknown[] = []
  if (code) { sql += ' AND code = ?'; params.push(code) }
  if (date) { sql += ' AND date = ?'; params.push(date) }
  sql += ` ORDER BY ${orderBy} LIMIT ?`; params.push(limit)
  return ds.query<Record<string, unknown>>(sql, ...params)
}
