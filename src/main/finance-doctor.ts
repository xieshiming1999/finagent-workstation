import { getSidecarUrl, getGotdxUrl } from './sidecar'
import type { DataStore } from '../agent/data/store/data-store'
import { getIngestionRegistrySummary } from '../agent/data/ingestion/registry'
import { providerOrder, type FinanceDataTask, type ProviderGates } from '../agent/data/provider-policy'
import { classifyApiFailures } from '../agent/api-failure-classifier'
import { accessSync, constants, existsSync, statSync } from 'fs'
import { join } from 'path'
import { isActionableFeedFailure } from '../agent/data/data-feed-failure-policy'

export type DoctorStatus = 'ok' | 'warning' | 'critical'

export interface FinanceDoctorCheck {
  id: string
  status: DoctorStatus
  detail: string
  nextStep?: string
  metrics?: Record<string, string | number | boolean | null>
}

export interface FinanceDoctorReport {
  status: DoctorStatus
  generatedAt: string
  summary: string
  checks: FinanceDoctorCheck[]
}

export interface FinanceDoctorOptions {
  dataStore: DataStore | null
  gates?: ProviderGates
  basePath?: string
}

const coreTasks: FinanceDataTask[] = [
  'quote',
  'indexQuote',
  'kline',
  'sector',
  'fund',
  'fundamental',
]

export function buildFinanceDoctorReport(opts: FinanceDoctorOptions): FinanceDoctorReport {
  const generatedAt = new Date().toISOString()
  const ds = opts.dataStore
  const checks: FinanceDoctorCheck[] = []

  addRuntimePathChecks(checks, opts.basePath)

  if (!ds || !ds.isReady) {
    checks.push({
      id: 'datastore',
      status: 'critical',
      detail: 'DataStore is not initialized.',
      nextStep: 'Wait for startup to finish before running data tasks or provider probes.',
      metrics: { ready: false },
    })
    return finalizeReport(generatedAt, checks)
  }

  checks.push({
    id: 'datastore',
    status: 'ok',
    detail: 'DataStore is ready.',
    metrics: { ready: true },
  })

  addApiFailureCheck(checks, ds)
  addQueueCheck(checks, ds)
  addReusableDataChecks(checks, ds)
  addFeedCheck(checks, ds)
  addProviderRouteCheck(checks, opts.gates ?? {})
  addSchemaRegistryCheck(checks)
  addServiceCheck(checks)

  return finalizeReport(generatedAt, checks)
}

function addRuntimePathChecks(checks: FinanceDoctorCheck[], basePath?: string): void {
  if (!basePath) return
  const runtime = inspectDirectory(basePath)
  checks.push({
    id: 'runtime_paths',
    status: runtime.ok ? 'ok' : 'critical',
    detail: runtime.ok ? 'Project runtime directory is readable and writable.' : runtime.detail,
    nextStep: runtime.ok ? undefined : 'Fix project data directory permissions before running agent, data, or automation tasks.',
    metrics: { path: basePath, readable: runtime.readable, writable: runtime.writable },
  })

  const sessionsDir = join(basePath, 'sessions')
  const historyDir = join(sessionsDir, 'history')
  const archiveDir = join(sessionsDir, 'archive')
  const currentPath = join(sessionsDir, 'current.jsonl')
  const sessionRoot = inspectDirectory(sessionsDir)
  const history = inspectDirectory(historyDir)
  const archive = inspectDirectory(archiveDir)
  const current = inspectOptionalFile(currentPath)
  const status: DoctorStatus = sessionRoot.ok && history.ok && archive.ok && current.ok ? 'ok' : 'warning'
  checks.push({
    id: 'session_history',
    status,
    detail: status === 'ok'
      ? 'Session working context, archive, and audit history paths are readable.'
      : [
          sessionRoot.ok ? null : `sessions: ${sessionRoot.detail}`,
          history.ok ? null : `history: ${history.detail}`,
          archive.ok ? null : `archive: ${archive.detail}`,
          current.ok ? null : `current: ${current.detail}`,
        ].filter(Boolean).join('; '),
    nextStep: status === 'ok' ? undefined : 'Open a session once or repair session/history directory permissions before relying on resume/history.',
    metrics: {
      sessionsDir,
      historyDir,
      archiveDir,
      currentPath,
      currentExists: current.exists,
    },
  })

  const indexPath = join(sessionsDir, 'search_index.json')
  const index = inspectOptionalFile(indexPath)
  checks.push({
    id: 'session_index',
    status: index.exists && index.ok ? 'ok' : 'warning',
    detail: index.exists ? index.detail : 'Session search index is missing; search can be rebuilt from JSONL history.',
    nextStep: index.exists && index.ok ? undefined : 'Rebuild or refresh the session search index from sessions/history when search is needed.',
    metrics: { indexPath, exists: index.exists },
  })
}

function inspectDirectory(path: string): { ok: boolean; detail: string; readable: boolean; writable: boolean } {
  if (!existsSync(path)) return { ok: false, detail: `${path} is missing.`, readable: false, writable: false }
  try {
    if (!statSync(path).isDirectory()) return { ok: false, detail: `${path} is not a directory.`, readable: false, writable: false }
  } catch (err) {
    return { ok: false, detail: `${path} cannot be inspected: ${String((err as Error).message ?? err)}`, readable: false, writable: false }
  }
  const readable = canAccess(path, constants.R_OK)
  const writable = canAccess(path, constants.W_OK)
  return {
    ok: readable && writable,
    detail: readable && writable ? `${path} is readable and writable.` : `${path} permission check failed.`,
    readable,
    writable,
  }
}

function inspectOptionalFile(path: string): { ok: boolean; exists: boolean; detail: string } {
  if (!existsSync(path)) return { ok: true, exists: false, detail: `${path} is not present yet.` }
  try {
    if (!statSync(path).isFile()) return { ok: false, exists: true, detail: `${path} is not a file.` }
  } catch (err) {
    return { ok: false, exists: true, detail: `${path} cannot be inspected: ${String((err as Error).message ?? err)}` }
  }
  const readable = canAccess(path, constants.R_OK)
  const writable = canAccess(path, constants.W_OK)
  return {
    ok: readable && writable,
    exists: true,
    detail: readable && writable ? `${path} is readable and writable.` : `${path} permission check failed.`,
  }
}

function canAccess(path: string, mode: number): boolean {
  try {
    accessSync(path, mode)
    return true
  } catch {
    return false
  }
}

function addApiFailureCheck(checks: FinanceDoctorCheck[], ds: DataStore): void {
  const recent = ds.getRecentApiCalls(30, 100)
  const failures = recent.filter((row) => Number(row.success ?? 0) === 0)
  if (failures.length === 0) {
    checks.push({ id: 'api_failures', status: 'ok', detail: 'No API failures in the last 30 minutes.' })
    return
  }
  const bySource = new Map<string, number>()
  for (const row of failures) {
    const source = String(row.source ?? 'unknown')
    bySource.set(source, (bySource.get(source) ?? 0) + 1)
  }
  const top = Array.from(bySource.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([source, count]) => `${source}:${count}`)
    .join(', ')
  const classes = classifyApiFailures(failures)
    .slice(0, 3)
    .map((row) => `${row.classification}:${row.count}`)
    .join(', ')
  checks.push({
    id: 'api_failures',
    status: failures.length >= 5 ? 'critical' : 'warning',
    detail: `${failures.length} failure(s) in the last 30 minutes${top ? ` (${top})` : ''}${classes ? `; classes ${classes}` : ''}.`,
    nextStep: 'Inspect API Health recent errors and retry only the failed dataset after a source recovers.',
    metrics: { failures: failures.length, top, classes },
  })
}

function addQueueCheck(checks: FinanceDoctorCheck[], ds: DataStore): void {
  const rows = ds.query<Record<string, unknown>>(
    `SELECT status, COUNT(*) as count, MAX(updated_at) as updated_at, MAX(created_at) as created_at
       FROM fetch_tasks
      WHERE NOT (
        status = 'failed'
        AND (
          error LIKE 'manual data-feed verification recovered stale active task%'
          OR error LIKE 'manual verification interrupted before completion%'
          OR error LIKE 'stale active task recovered on startup%'
          OR (code IS NULL AND error LIKE 'code required%')
          OR (
            task_type = 'fund_money_yield'
            AND NOT EXISTS (
              SELECT 1 FROM fund_list f
              WHERE f.code = fetch_tasks.code
                AND (
                  f.fund_category = 'money'
                )
            )
          )
          OR (
            task_type = 'fund_nav'
            AND EXISTS (
              SELECT 1 FROM fund_list f
              WHERE f.code = fetch_tasks.code
                AND (
                  f.fund_category IN ('money', 'backend', 'unknown')
                )
            )
          )
        )
      )
      GROUP BY status`,
  )
  const staleCutoff = new Date(Date.now() - 30 * 60_000).toISOString()
  const staleRows = ds.query<Record<string, unknown>>(
    "SELECT COUNT(*) as count, MIN(created_at) as oldest FROM fetch_tasks WHERE status IN ('pending','running') AND created_at < ?",
    staleCutoff,
  )
  const stale = Number(staleRows[0]?.count ?? 0)
  const oldest = String(staleRows[0]?.oldest ?? '')
  const counts = Object.fromEntries(rows.map((row) => [String(row.status), Number(row.count ?? 0)]))
  const failed = counts.failed ?? 0
  const running = counts.running ?? 0
  const pending = counts.pending ?? 0
  if (failed === 0 && running + pending === 0) {
    checks.push({ id: 'queue', status: 'ok', detail: 'No failed or active data tasks.', metrics: { pending: 0, running: 0, failed: 0 } })
    return
  }
  checks.push({
    id: 'queue',
    status: failed > 0 || stale > 0 ? 'warning' : 'ok',
    detail: `${pending} pending, ${running} running, ${failed} failed task(s), ${stale} stale active task(s).`,
    nextStep: failed > 0 || stale > 0 ? 'Open Queue and retry the smallest failed or stale task, not the full feed.' : undefined,
    metrics: { pending, running, failed, stale, oldest: oldest || null, staleCutoff },
  })
}

function addReusableDataChecks(checks: FinanceDoctorCheck[], ds: DataStore): void {
  const summary = new Map(ds.getReusableDataSummary().map((row) => [row.name, row]))
  for (const [id, table, purpose] of [
    ['stock_identity', 'stock_list', 'stock code/name search'],
    ['fund_identity', 'fund_list', 'fund search and Fund Pulse'],
    ['quote_cache', 'quote_snapshot', 'stock/fund pulse quotes'],
    ['kline_cache', 'kline_daily', 'backtests and chart reuse'],
  ] as const) {
    const row = summary.get(table)
    const count = row?.count ?? 0
    checks.push({
      id,
      status: count > 0 ? 'ok' : 'warning',
      detail: `${table}: ${count} row(s)${row?.latest ? `, latest ${row.latest}` : ''}.`,
      nextStep: count > 0 ? undefined : `Run the targeted feed for ${purpose} when data is needed.`,
      metrics: { table, count, latest: row?.latest ?? null, purpose },
    })
  }
}

function addFeedCheck(checks: FinanceDoctorCheck[], ds: DataStore): void {
  const feeds = ds.getFeedConfigs()
  const enabled = feeds.filter((feed) => Number(feed.enabled) !== 0)
  const failed = feeds.filter(isActionableFeedFailure)
  const ignored = feeds.filter((feed) => Number(feed.enabled) !== 0 && !isActionableFeedFailure(feed) && Boolean(feed.last_error || feed.status === 'waiting_prerequisite')).length
  checks.push({
    id: 'feeds',
    status: failed.length > 0 ? 'warning' : 'ok',
    detail: `${enabled.length}/${feeds.length} feed(s) enabled, ${failed.length} actionable error(s)${ignored > 0 ? `, ${ignored} waiting/non-actionable state(s)` : ''}.`,
    nextStep: failed.length > 0 ? 'Run one failed feed after checking the matching provider route.' : undefined,
    metrics: { enabled: enabled.length, total: feeds.length, failed: failed.length, ignored },
  })
}

function addProviderRouteCheck(checks: FinanceDoctorCheck[], gates: ProviderGates): void {
  const missing = coreTasks.filter((task) => providerOrder(task, gates).length === 0)
  checks.push({
    id: 'provider_routes',
    status: missing.length > 0 ? 'critical' : 'ok',
    detail: missing.length > 0
      ? `No available provider route for: ${missing.join(', ')}.`
      : 'Core provider routes have at least one configured fallback.',
    nextStep: missing.length > 0 ? 'Configure the missing provider key or update provider-policy before scheduling tasks.' : undefined,
    metrics: { missing: missing.join(', ') },
  })
}

function addSchemaRegistryCheck(checks: FinanceDoctorCheck[]): void {
  const providers = getIngestionRegistrySummary()
  const missing = providers.filter((provider) => provider.schemas.length === 0 || provider.tables.length === 0)
  const endpointCount = providers.reduce((sum, provider) => sum + provider.endpoints.length, 0)
  const schemaCount = providers.reduce((sum, provider) => sum + provider.schemas.length, 0)
  const tableCount = providers.reduce((sum, provider) => sum + provider.tables.length, 0)
  checks.push({
    id: 'schema_registry',
    status: missing.length > 0 ? 'critical' : 'ok',
    detail: missing.length > 0
      ? `Missing registered schemas for provider(s): ${missing.map((provider) => provider.provider).join(', ')}.`
      : `${providers.length} provider registry entries, ${endpointCount} endpoint mappings, ${schemaCount} schemas, ${tableCount} canonical tables.`,
    nextStep: missing.length > 0 ? 'Add parser, normalizer, canonical write, and readback tests before enabling those provider schemas.' : undefined,
    metrics: {
      providers: providers.length,
      endpoints: endpointCount,
      schemas: schemaCount,
      tables: tableCount,
      missing: missing.map((provider) => provider.provider).join(', '),
    },
  })
}

function addServiceCheck(checks: FinanceDoctorCheck[]): void {
  const sidecarRunning = Boolean(getSidecarUrl())
  const gotdxRunning = Boolean(getGotdxUrl())
  checks.push({
    id: 'desktop_services',
    status: gotdxRunning && sidecarRunning ? 'ok' : 'warning',
    detail: `sidecar ${sidecarRunning ? 'running' : 'stopped'}, gotdx ${gotdxRunning ? 'running' : 'stopped'}.`,
    nextStep: gotdxRunning && sidecarRunning ? undefined : 'Restart FinAgent Workstation after building/starting the missing local service.',
    metrics: { sidecar: sidecarRunning ? 'running' : 'stopped', gotdx: gotdxRunning ? 'running' : 'stopped' },
  })
}

function finalizeReport(generatedAt: string, checks: FinanceDoctorCheck[]): FinanceDoctorReport {
  const status: DoctorStatus = checks.some((check) => check.status === 'critical')
    ? 'critical'
    : checks.some((check) => check.status === 'warning') ? 'warning' : 'ok'
  const critical = checks.filter((check) => check.status === 'critical').length
  const warning = checks.filter((check) => check.status === 'warning').length
  return {
    status,
    generatedAt,
    summary: status === 'ok'
      ? 'All local diagnostics passed.'
      : `${critical} critical, ${warning} warning check(s).`,
    checks,
  }
}
