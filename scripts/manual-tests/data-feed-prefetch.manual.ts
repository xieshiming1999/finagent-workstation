import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { closeDb } from '../../src/agent/data/store/db'
import { DataStore, type FeedConfig } from '../../src/agent/data/store/data-store'
import { FetchQueue } from '../../src/agent/data/queue/fetch-queue'
import { FetchScheduler } from '../../src/agent/data/queue/fetch-scheduler'
import { resolveProjectBasePath } from '../../src/main/project-path'
import { globalConfigPath } from '../../src/main/main-runtime'
import {
  missingFeedScopePrerequisite,
  resolveFeedCodesWithStore,
} from '../../src/main/watchlist-feed-codes'
import { fetchStockListA } from '../../src/agent/data/fetchers/fetcher-stock-list'
import { fetchFundList, fetchFundPerformanceMetrics } from '../../src/agent/data/fetchers/fetcher-fund-list'
import { fetchKlineDaily } from '../../src/agent/data/fetchers/fetcher-kline-daily'
import { fetchFundamental } from '../../src/agent/data/fetchers/fetcher-fundamental'
import { fetchMoneyFlow } from '../../src/agent/data/fetchers/fetcher-money-flow'
import { fetchSectorRanking } from '../../src/agent/data/fetchers/fetcher-sector'
import { fetchLimitUpPool } from '../../src/agent/data/fetchers/fetcher-limit-pool'
import { fetchNorthbound } from '../../src/agent/data/fetchers/fetcher-northbound'
import { fetchFundManagers } from '../../src/agent/data/fetchers/fetcher-fund-manager'
import { fetchIndexComponents } from '../../src/agent/data/fetchers/fetcher-index-components'
import { fetchIndexKline } from '../../src/agent/data/fetchers/fetcher-index-kline'
import { fetchTradeCalendar } from '../../src/agent/data/fetchers/fetcher-calendar'
import { readEtfQuoteRows, readSectorConstituentRows } from '../../src/agent/data/data-api-interface-cache'
import { fetchFundNav } from '../../src/agent/data/fetchers/fetcher-fund-nav'
import { fetchFundMoneyYield } from '../../src/agent/data/fetchers/fetcher-fund-money-yield'
import { fetchFundHolding } from '../../src/agent/data/fetchers/fetcher-fund-holding'

const REPO_ROOT = resolve(process.cwd(), '..')
const PROJECT_CWD = process.env.FINAGENT_WORKSTATION_PROJECT_CWD ?? process.cwd()
const BASE_PATH = process.env.FINAGENT_WORKSTATION_DATA_DIR ?? resolveProjectBasePath(globalConfigPath(), PROJECT_CWD)
const ACTIVE_DB_PATH = join(BASE_PATH, 'data', 'market.db')
const OUT_DIR = process.env.DATA_FEED_PREFETCH_OUT_DIR ?? join(REPO_ROOT, 'docs', 'design', 'integrations', 'data-feed-prefetch-live')
const FEED_IDS = (process.env.DATA_FEED_IDS ?? '').split(',').map((item) => item.trim()).filter(Boolean)
const FORCE = process.env.DATA_FEED_FORCE === 'true'
const WAIT_MS = Number(process.env.DATA_FEED_WAIT_MS ?? 500)
const TIMEOUT_MS = Number(process.env.DATA_FEED_TIMEOUT_MS ?? 180000)
const MAX_ITERATIONS = Number(process.env.DATA_FEED_MAX_ITERATIONS ?? 2)
const STALE_ACTIVE_TASK_MS = Number(process.env.DATA_FEED_STALE_ACTIVE_TASK_MS ?? 60_000)
const INDUSTRY_MAX_BOARDS = Number(process.env.DATA_FEED_INDUSTRY_MAX_BOARDS ?? 10)

interface FeedEvidence {
  feedId: string
  feedType: string
  displayName: string
  scope: string
  sourcePriority: string
  frequency: string
  triggerTime: string
  resolvedCount: number
  status: 'passed' | 'failed' | 'skipped-fresh' | 'skipped-disabled' | 'no-task' | 'timeout'
  reason?: string
  taskIds: number[]
  tasks: Array<Record<string, unknown>>
  logs: Array<Record<string, unknown>>
  readback: Record<string, unknown>
  interfaceReuse?: Record<string, unknown>
}

describe('manual Data Feed prefetch verification', () => {
  it('runs selected feeds one by one through FetchQueue and records evidence', async () => {
    const store = new DataStore(BASE_PATH)
    await store.init()
    const queue = new FetchQueue(store)
    const scheduler = new FetchScheduler(store, queue, BASE_PATH)
    const report: Record<string, unknown> = loadExistingReport()
    Object.assign(report, {
      basePath: BASE_PATH,
      activeDatabase: ACTIVE_DB_PATH,
      projectCwd: PROJECT_CWD,
      force: FORCE,
      waitMs: WAIT_MS,
      timeoutMs: TIMEOUT_MS,
      maxIterations: MAX_ITERATIONS,
      staleActiveTaskMs: STALE_ACTIVE_TASK_MS,
      industryMaxBoards: INDUSTRY_MAX_BOARDS,
      startedAt: new Date().toISOString(),
      feeds: Array.isArray(report.feeds) ? report.feeds : [],
    })

    try {
      const staleTasksRecovered = store.failStaleActiveTasks(
        STALE_ACTIVE_TASK_MS,
        'manual data-feed verification recovered stale active task',
      )
      const danglingFeedsRecovered = store.reconcileDanglingRunningFeeds()
      report.staleTasksRecovered = staleTasksRecovered
      report.danglingFeedsRecovered = danglingFeedsRecovered
      queue.start()
      const feeds = store.getFeedConfigs()
      const selected = FEED_IDS.length > 0 ? feeds.filter((feed) => FEED_IDS.includes(feed.feed_id)) : feeds
      const missing = FEED_IDS.filter((id) => !feeds.some((feed) => feed.feed_id === id))
      expect(missing).toEqual([])
      for (const feed of selected) {
        const evidence = await verifyFeed(feed, store, queue, scheduler)
        upsertFeedEvidence(report, evidence)
        writeReport(report)
      }
      report.finishedAt = new Date().toISOString()
      const outFile = writeReport(report)
      console.log(JSON.stringify({ outFile, summary: summarize(report) }, null, 2))

      const selectedIds = new Set(selected.map((feed) => feed.feed_id))
      const failures = (report.feeds as FeedEvidence[]).filter((feed) =>
        selectedIds.has(feed.feedId) && (feed.status === 'failed' || feed.status === 'timeout')
      )
      expect(failures).toEqual([])
    } finally {
      queue.stop()
      closeDb(BASE_PATH)
    }
  }, Math.max(10 * 60_000, TIMEOUT_MS * Math.max(1, FEED_IDS.length || 1)))
})

async function verifyFeed(feed: FeedConfig, store: DataStore, queue: FetchQueue, scheduler: FetchScheduler): Promise<FeedEvidence> {
  const resolvedCodes = resolveFeedCodesWithStore(feed, BASE_PATH, store)
  const base: Omit<FeedEvidence, 'status' | 'taskIds' | 'tasks' | 'logs' | 'readback'> = {
    feedId: feed.feed_id,
    feedType: feed.feed_type,
    displayName: feed.display_name,
    scope: feed.scope,
    sourcePriority: feed.source_priority,
    frequency: feed.update_frequency,
    triggerTime: feed.trigger_time,
    resolvedCount: resolvedCodes.length,
  }
  const logs: Array<Record<string, unknown>> = [{
    at: new Date().toISOString(),
    event: 'resolved-scope',
    resolvedCount: resolvedCodes.length,
    scope: feed.scope,
    sourcePriority: feed.source_priority,
  }]
  if (!feed.enabled) {
    logs.push({ at: new Date().toISOString(), event: 'skip', reason: 'feed disabled' })
    return { ...base, status: 'skipped-disabled', reason: 'feed disabled', taskIds: [], tasks: [], logs, readback: readbackEvidence(store, feed), interfaceReuse: await interfaceReuseEvidence(feed, store, resolvedCodes) }
  }
  const initialReadback = readbackEvidence(store, feed)
  if (resolvedCodes.length === 0 && !missingFeedScopePrerequisite(feed)) {
    const reason = 'no task enqueued; likely missing watchlist/custom codes'
    logs.push({ at: new Date().toISOString(), event: 'skip', reason })
    store.updateFeedConfig(feed.feed_id, { status: 'idle', last_error: null } as any)
    return { ...base, status: 'no-task', reason, taskIds: [], tasks: [], logs, readback: initialReadback, interfaceReuse: await interfaceReuseEvidence(feed, store, resolvedCodes) }
  }
  if (!FORCE && isFreshSuccess(feed) && readbackHasRows(initialReadback)) {
    logs.push({ at: new Date().toISOString(), event: 'skip', reason: 'recent successful last_run_at', lastRunAt: feed.last_run_at })
    store.updateFeedConfig(feed.feed_id, { status: 'idle', last_error: null } as any)
    return { ...base, status: 'skipped-fresh', reason: 'recent successful last_run_at; use DATA_FEED_FORCE=true to rerun', taskIds: [], tasks: [], logs, readback: initialReadback, interfaceReuse: await interfaceReuseEvidence(feed, store, resolvedCodes) }
  }

  const taskIds: number[] = []
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const ids = (scheduler as any).enqueueConfiguredFeed(feed, manualFeedParams(feed)) as number[]
    logs.push({ at: new Date().toISOString(), event: 'enqueue', iteration: iteration + 1, taskIds: ids })
    taskIds.push(...ids)
    if (ids.length === 0) break
    await waitForTasks(store, ids, logs)
    const latest = ids.map((id) => taskById(store, id)).filter(Boolean) as Array<Record<string, unknown>>
    logs.push({ at: new Date().toISOString(), event: 'iteration-complete', iteration: iteration + 1, tasks: compactTasks(latest) })
    if (latest.some((task) => task.status === 'failed')) break
    if (!latest.every((task) => isPrerequisiteTaskForFeed(feed, String(task.task_type)))) break
  }

  const tasks = taskIds.map((id) => taskById(store, id)).filter(Boolean) as Array<Record<string, unknown>>
  const readback = readbackEvidence(store, feed)
  const interfaceReuse = await interfaceReuseEvidence(feed, store, resolvedCodes)
  logs.push({ at: new Date().toISOString(), event: 'readback', readback })
  if (taskIds.length === 0) {
    store.updateFeedConfig(feed.feed_id, { status: 'idle', last_error: null } as any)
    return { ...base, status: 'no-task', reason: 'no task enqueued; likely missing watchlist/custom codes', taskIds, tasks, logs, readback, interfaceReuse }
  }
  if (tasks.some((task) => task.status === 'failed')) {
    const reason = firstTaskError(tasks)
    store.updateFeedConfig(feed.feed_id, { status: 'error', last_error: reason } as any)
    return { ...base, status: 'failed', reason, taskIds, tasks, logs, readback, interfaceReuse }
  }
  if (tasks.some((task) => task.status === 'pending' || task.status === 'running')) {
    store.updateFeedConfig(feed.feed_id, { status: 'running', last_error: 'tasks did not finish before timeout' } as any)
    return { ...base, status: 'timeout', reason: 'tasks did not finish before timeout', taskIds, tasks, logs, readback, interfaceReuse }
  }
  if (!readbackHasRows(readback)) {
    const reason = 'prefetch completed but canonical DB readback returned no rows'
    store.updateFeedConfig(feed.feed_id, { status: 'error', last_error: reason } as any)
    return { ...base, status: 'failed', reason, taskIds, tasks, logs, readback, interfaceReuse }
  }
  store.updateFeedConfig(feed.feed_id, { status: 'idle', last_error: null } as any)
  return { ...base, status: 'passed', taskIds, tasks, logs, readback, interfaceReuse }
}

function manualFeedParams(feed: FeedConfig): Record<string, unknown> {
  const params: Record<string, unknown> = { source: 'manual-prefetch-verification', forceLive: FORCE }
  if (feed.feed_type === 'industry') params.industry_max_boards = INDUSTRY_MAX_BOARDS
  return params
}

function isFreshSuccess(feed: FeedConfig): boolean {
  if (!feed.last_run_at || feed.last_error || feed.status === 'error') return false
  const last = new Date(feed.last_run_at).getTime()
  if (!Number.isFinite(last)) return false
  const elapsedMs = Date.now() - last
  if (elapsedMs < 0) return false
  switch (feed.update_frequency) {
    case '5min': return elapsedMs < 5 * 60 * 1000
    case '30min': return elapsedMs < 30 * 60 * 1000
    case 'hourly': return elapsedMs < 60 * 60 * 1000
    case 'daily':
    case 'daily_close': return elapsedMs < 20 * 60 * 60 * 1000
    case 'weekly': return elapsedMs < 6.5 * 24 * 60 * 60 * 1000
    case 'monthly': return elapsedMs < 27 * 24 * 60 * 60 * 1000
    case 'quarterly': return elapsedMs < 85 * 24 * 60 * 60 * 1000
    case 'yearly': return elapsedMs < 350 * 24 * 60 * 60 * 1000
    default: return false
  }
}

async function waitForTasks(store: DataStore, ids: number[], logs: Array<Record<string, unknown>>): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS
  const previous = new Map<number, string>()
  while (Date.now() < deadline) {
    const tasks = ids.map((id) => taskById(store, id)).filter(Boolean) as Array<Record<string, unknown>>
    for (const task of tasks) {
      const id = Number(task.id)
      const status = String(task.status)
      if (previous.get(id) !== status) {
        previous.set(id, status)
        logs.push({ at: new Date().toISOString(), event: 'task-status', task: compactTask(task) })
      }
    }
    if (tasks.length === ids.length && tasks.every((task) => !['pending', 'running'].includes(String(task.status)))) return
    await sleep(WAIT_MS)
  }
  logs.push({ at: new Date().toISOString(), event: 'wait-timeout', taskIds: ids, timeoutMs: TIMEOUT_MS })
}

function taskById(store: DataStore, id: number): Record<string, unknown> | null {
  return store.query<Record<string, unknown>>('SELECT * FROM fetch_tasks WHERE id = ? LIMIT 1', id)[0] ?? null
}

function firstTaskError(tasks: Array<Record<string, unknown>>): string {
  return String(tasks.find((task) => task.error)?.error ?? 'task failed')
}

function compactTasks(tasks: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return tasks.map(compactTask)
}

function compactTask(task: Record<string, unknown>): Record<string, unknown> {
  return {
    id: task.id,
    task_type: task.task_type,
    code: task.code,
    status: task.status,
    error: task.error,
    created_at: task.created_at,
    updated_at: task.updated_at,
  }
}

function isPrerequisiteTaskForFeed(feed: FeedConfig, taskType: string): boolean {
  if (feed.scope === 'all' && feed.feed_type !== 'stock_list' && feed.feed_type !== 'fund_list') {
    return taskType === (feed.feed_type.startsWith('fund_') ? 'fund_list' : 'stock_list')
  }
  if ((feed.scope === 'csi300' || feed.scope === 'csi500') && feed.feed_type !== 'index_components') {
    return taskType === 'index_components'
  }
  return false
}

function readbackEvidence(store: DataStore, feed: FeedConfig): Record<string, unknown> {
  switch (feed.feed_type) {
    case 'stock_list': return countLatest(store, 'stock_list', 'updated_at')
    case 'fund_list': return countLatest(store, 'fund_list', 'updated_at')
    case 'fund_performance_metrics': return countLatest(store, 'fund_performance_metrics', 'fetched_at')
    case 'fund_manager': return countLatest(store, 'fund_manager', 'updated_at')
    case 'fund_nav': return coverageCount(store, 'fund_nav')
    case 'fund_money_yield': return coverageCount(store, 'fund_money_yield')
    case 'fund_holding': return countLatest(store, 'fund_holding', 'report_date')
    case 'etf_quotes': return store.query<Record<string, unknown>>("SELECT COUNT(*) as count, MAX(fetched_at) as latest FROM quote_snapshot WHERE code IN (SELECT code FROM stock_list WHERE stock_type = 'etf')")[0] ?? {}
    case 'index_components': return countLatest(store, 'index_constituent', 'fetched_at')
    case 'index_kline':
    case 'kline_daily': return coverageCount(store, 'kline_daily')
    case 'fundamental': return coverageCount(store, 'fundamental')
    case 'money_flow': return coverageCount(store, 'money_flow')
    case 'sector': return countLatest(store, 'sector_ranking', 'date')
    case 'limit_pool': return countLatest(store, 'limit_pool', 'fetched_at')
    case 'northbound': return countLatest(store, 'northbound_flow', 'fetched_at')
    case 'calendar': return countLatest(store, 'trade_calendar', 'date')
    case 'industry': return countLatest(store, 'industry_map', 'updated_at')
    default: return {}
  }
}

function countLatest(store: DataStore, table: string, latestColumn: string): Record<string, unknown> {
  try {
    return store.query<Record<string, unknown>>(`SELECT COUNT(*) as count, MAX(${latestColumn}) as latest FROM ${table}`)[0] ?? {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

function coverageCount(store: DataStore, dataType: string): Record<string, unknown> {
  return store.query<Record<string, unknown>>('SELECT COUNT(*) as symbols, SUM(row_count) as rows, MAX(last_updated) as latest FROM data_coverage WHERE data_type = ?', dataType)[0] ?? {}
}

function readbackHasRows(readback: Record<string, unknown>): boolean {
  const count = Number(readback.count ?? readback.rows ?? readback.symbols ?? 0)
  return Number.isFinite(count) && count > 0
}

async function interfaceReuseEvidence(feed: FeedConfig, store: DataStore, resolvedCodes: string[]): Promise<Record<string, unknown>> {
  try {
    const opts = { cacheMode: 'cache-only' as const }
    const code = resolvedCodes[0] ?? sampleCoverageCode(store, feed.feed_type)
    switch (feed.feed_type) {
      case 'stock_list': return summarizeReuse(await fetchStockListA(opts))
      case 'fund_list': return summarizeReuse(await fetchFundList(opts))
      case 'fund_performance_metrics': return summarizeReuse(await fetchFundPerformanceMetrics({ ...opts, limit: 20 }))
      case 'fund_manager': return summarizeReuse(await fetchFundManagers(opts))
      case 'kline_daily':
        if (!code) return { status: 'not-applicable', reason: 'no sample code' }
        return summarizeReuse(await fetchKlineDaily(code, opts))
      case 'index_kline':
        return summarizeReuse(await fetchIndexKline('000300', opts))
      case 'fundamental':
        {
          const sample = sampleCoverageCode(store, 'fundamental') ?? code
          if (!sample) return { status: 'not-applicable', reason: 'no sample code' }
          return summarizeReuse(await fetchFundamental(sample, opts))
        }
      case 'money_flow':
        if (!code) return { status: 'not-applicable', reason: 'no sample code' }
        return summarizeReuse(await fetchMoneyFlow(code, 30, opts))
      case 'sector': return summarizeReuse(await fetchSectorRanking('industry', opts))
      case 'limit_pool': return summarizeReuse(await fetchLimitUpPool(undefined, opts))
      case 'northbound': return summarizeReuse(await fetchNorthbound(30, opts))
      case 'index_components': return summarizeReuse(await fetchIndexComponents('000300', opts))
      case 'calendar': return summarizeReuse(await fetchTradeCalendar(new Date().getFullYear(), 'CN', opts))
      case 'fund_nav':
        {
          const sample = sampleCoverageCode(store, 'fund_nav') ?? resolvedCodes[0]
          if (!sample) return { status: 'not-applicable', reason: 'no sample fund code' }
          return summarizeReuse(await fetchFundNav(sample, undefined, opts))
        }
      case 'fund_money_yield':
        {
          const sample = sampleCoverageCode(store, 'fund_money_yield') ?? resolvedCodes[0]
          if (!sample) return { status: 'not-applicable', reason: 'no sample money fund code' }
          return summarizeReuse(await fetchFundMoneyYield(sample, undefined, opts))
        }
      case 'fund_holding':
        {
          const sample = sampleCoverageCode(store, 'fund_holding') ?? resolvedCodes[0]
          if (!sample) return { status: 'not-applicable', reason: 'no sample fund holding code' }
          return summarizeReuse(await fetchFundHolding(sample, opts))
        }
      case 'industry':
        return summarizeCacheReaderReuse(readIndustryCacheRows(store), {
          interfaceId: 'market.sector_constituents',
          canonicalTable: 'industry_map',
          reader: 'readSectorConstituentRows',
        })
      case 'etf_quotes':
        {
          const rows = readEtfQuoteRows({ minRows: 1, limit: 80, maxAgeMs: 24 * 60 * 60 * 1000 })
          return summarizeCacheReaderReuse(rows?.quotes ?? [], {
            interfaceId: 'fund.etf_quote',
            canonicalTable: 'quote_snapshot',
            reader: 'readEtfQuoteRows',
          })
        }
      default:
        return { status: 'not-applicable', reason: `no cache verification mapping for ${feed.feed_type}` }
    }
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) }
  }
}

function readIndustryCacheRows(store: DataStore): unknown[] {
  const row = store.query<Record<string, unknown>>(
    `SELECT COALESCE(industry_l1, industry_l2, industry_l3) as industry
       FROM industry_map
      WHERE COALESCE(industry_l1, industry_l2, industry_l3) IS NOT NULL
      GROUP BY industry
      ORDER BY MAX(updated_at) DESC
      LIMIT 1`,
  )[0]
  const industry = String(row?.industry ?? '').trim()
  if (!industry) return []
  const rows = readSectorConstituentRows(industry, { minRows: 1, limit: 100 })
  if (rows.length > 0) return rows
  return store.query<Record<string, unknown>>(
    `SELECT * FROM industry_map
      WHERE industry_l1 = ? OR industry_l2 = ? OR industry_l3 = ?
      ORDER BY updated_at DESC, code LIMIT 100`,
    industry,
    industry,
    industry,
  )
}

function summarizeCacheReaderReuse(rows: unknown[] | null | undefined, meta: Record<string, unknown>): Record<string, unknown> {
  const count = Array.isArray(rows) ? rows.length : 0
  return {
    status: count > 0 ? 'passed' : 'failed',
    cacheStatus: count > 0 ? 'cache-hit' : 'cache-miss',
    rows: count,
    ...meta,
  }
}

function sampleCoverageCode(store: DataStore, dataType: string): string | null {
  const row = store.query<Record<string, unknown>>(
    'SELECT code FROM data_coverage WHERE data_type = ? AND row_count > 0 ORDER BY last_updated DESC LIMIT 1',
    dataType,
  )[0]
  return row?.code ? String(row.code) : null
}

function summarizeReuse(result: unknown): Record<string, unknown> {
  const value = result as { data?: unknown[]; provenance?: Record<string, unknown>; source?: string; fetchedAt?: string }
  const provenance = value.provenance ?? {}
  return {
    status: provenance.cacheStatus === 'cache-hit' ? 'passed' : 'failed',
    cacheStatus: provenance.cacheStatus ?? null,
    interfaceId: provenance.interfaceId ?? null,
    provider: provenance.provider ?? null,
    capabilityId: provenance.capabilityId ?? null,
    canonicalTable: provenance.canonicalTable ?? null,
    rows: Array.isArray(value.data) ? value.data.length : null,
    cacheDecision: provenance.cacheDecision ?? null,
  }
}

function writeReport(report: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true })
  const file = reportPath()
  writeFileSync(file, JSON.stringify(report, null, 2), 'utf-8')
  return file
}

function loadExistingReport(): Record<string, unknown> {
  const file = reportPath()
  if (!existsSync(file)) return { feeds: [] }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
    if (!Array.isArray(parsed.feeds)) parsed.feeds = []
    return parsed
  } catch {
    return { feeds: [] }
  }
}

function reportPath(): string {
  return join(OUT_DIR, `data-feed-prefetch-${new Date().toISOString().slice(0, 10)}.json`)
}

function upsertFeedEvidence(report: Record<string, unknown>, evidence: FeedEvidence): void {
  const feeds = Array.isArray(report.feeds) ? report.feeds as FeedEvidence[] : []
  const index = feeds.findIndex((feed) => feed.feedId === evidence.feedId)
  if (index >= 0) feeds[index] = evidence
  else feeds.push(evidence)
  report.feeds = feeds
}

function summarize(report: Record<string, unknown>): Array<Record<string, unknown>> {
  return ((report.feeds as FeedEvidence[]) ?? []).map((feed) => ({
    feedId: feed.feedId,
    status: feed.status,
    resolvedCount: feed.resolvedCount,
    taskIds: feed.taskIds,
    reason: feed.reason,
    readback: feed.readback,
  }))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
