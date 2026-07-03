import { toolError } from '../tool'
import { DataStore } from '../data/store/data-store'
import type { FetchQueue, FetchTask } from '../data/queue/fetch-queue'
import { supportsMoneyFundYield } from '../data/fund-category'
import {
  normalizeTimeout,
  parseFetchTask,
  queuedResult,
  readbackTitle,
  summarizeFetchTask,
} from './data-store-tool-utils'

export async function fetchDataStore(
  ds: DataStore,
  fetchQueue: FetchQueue | null,
  input: Record<string, unknown>,
): Promise<string> {
  const type = String(input.type ?? 'kline')
  const code = stringParam(input, ['code', 'symbol', 'fundCode'])
  const codes = listParam(input, ['codes', 'symbols', 'fundCodes'])
  const priority = Number(input.priority ?? 3)
  const block = input.block !== false
  const timeoutMs = normalizeTimeout(input.timeout)
  const ids: number[] = []
  const queueOrStore = (taskType: string, taskCode: string | null, params: Record<string, unknown>, taskPriority = priority) => {
    const id = fetchQueue
      ? fetchQueue.enqueue(taskType, taskCode, params, taskPriority)
      : ds.createTask(taskType, taskCode, params, taskPriority)
    ids.push(id)
    return id
  }

  const noCodeTypes = ['stock_list', 'fund_list', 'fund_performance', 'fund_manager', 'sector', 'limit_pool', 'northbound', 'calendar', 'industry']
  if (noCodeTypes.includes(type)) {
    queueOrStore(type, null, { ...input, type: undefined, block: undefined, timeout: undefined }, priority)
    return block ? await waitForFetchTasks(ds, fetchQueue, ids, timeoutMs) : queuedResult(type, ids, priority)
  }

  if (type === 'index_components') {
    if (!code) return toolError('code required. Example: DataStore(action: "fetch", type: "index_components", code: "000300")')
    queueOrStore('index_components', code, { start: input.start, forceLive: input.forceLive }, priority)
    return block ? await waitForFetchTasks(ds, fetchQueue, ids, timeoutMs) : queuedResult(`index ${code} components + kline`, ids, priority)
  }

  if (type === 'fund_money_yield') {
    if (!code) return toolError('code required. Example: DataStore(action: "fetch", type: "fund_money_yield", code: "000009")')
    queueOrStore('fund_money_yield', code, { start: input.start, end: input.end, forceLive: input.forceLive }, priority)
    return block ? await waitForFetchTasks(ds, fetchQueue, ids, timeoutMs) : queuedResult(`money fund yield for ${code}`, ids, priority)
  }

  if (type === 'fund_nav' && code && isKnownMoneyFund(ds, code)) {
    return toolError(
      `fund_nav is not valid for known money fund ${code}. ` +
      `Use DataStore(action: "query_fund_money_yield", code: "${code}", limit: 60) first, ` +
      `then DataStore(action: "fetch", type: "fund_money_yield", code: "${code}") only if local yield rows are missing or stale. ` +
      `Money funds expose per-10k income and 7-day annualized yield, not ordinary NAV history.`,
    )
  }

  if (type === 'kline' && codes) {
    if (fetchQueue) {
      ids.push(...fetchQueue.enqueueBatch('kline_daily', codes, { start: input.start, end: input.end, market: input.market, forceLive: input.forceLive }, priority))
    } else {
      queueOrStore('kline_batch', null, { codes, start: input.start, end: input.end, market: input.market, forceLive: input.forceLive }, priority)
    }
    return block ? await waitForFetchTasks(ds, fetchQueue, ids, timeoutMs) : queuedResult(`kline for ${codes.length} stocks`, ids, priority)
  }

  if (code) {
    const taskType = type === 'kline' ? 'kline_daily' : type
    queueOrStore(taskType, code, { start: input.start, end: input.end, market: input.market, days: input.limit, forceLive: input.forceLive }, priority)
    return block ? await waitForFetchTasks(ds, fetchQueue, ids, timeoutMs) : queuedResult(`${taskType} for ${code}`, ids, priority)
  }

  if (type === 'fundamental') {
    return toolError('code required for type "fundamental"; DataStore(fetch,type:"fundamental") is selected-code refresh, not full-market PE/PB/ROE screening. Use query_stock_daily_valuation or screen_stock for PE/ROE screens, and if they report no-values/0 coverage, disclose the valuation data gap instead of retrying a broad fetch.')
  }

  return toolError(`code required for type "${type}". Use DataStore(action: "help") for usage.`)
}

function stringParam(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function listParam(input: Record<string, unknown>, keys: string[]): string[] | undefined {
  for (const key of keys) {
    const value = input[key]
    if (Array.isArray(value)) {
      const rows = value.map((item) => String(item).trim()).filter(Boolean)
      if (rows.length > 0) return rows
    }
    if (typeof value === 'string' && value.trim()) {
      const rows = value.split(',').map((item) => item.trim()).filter(Boolean)
      if (rows.length > 0) return rows
    }
  }
  return undefined
}

function isKnownMoneyFund(ds: DataStore, code: string): boolean {
  const rows = ds.queryFundList({ codes: [code], limit: 5 })
  return rows.some((row) => supportsMoneyFundYield(row.fund_category))
}

export function fetchStatus(ds: DataStore, input: Record<string, unknown> = {}): string {
  const limit = Math.max(1, Math.min(Number(input.limit ?? 20), 100))
  const status = normalizeFetchStatus(input.status)
  const tasks = readFetchTasks(ds, status.queryStatus, limit)
  const provenance = fetchTaskQueueProvenance()
  const rows = tasks.map(fetchTaskRow)
  const actionableFailures = rows.filter((row) => row.actionableFailure)
  const nonActionableEvidence = rows.filter((row) => row.nonActionableEvidence)
  return JSON.stringify({
    action: 'fetch_status',
    ...provenance,
    status: status.publicStatus,
    queryStatus: status.queryStatus,
    total: tasks.length,
    returned: rows.length,
    summary: {
      pending: rows.filter((row) => row.status === 'pending').length,
      running: rows.filter((row) => row.status === 'running').length,
      completed: rows.filter((row) => row.status === 'completed').length,
      failed: rows.filter((row) => row.status === 'failed').length,
      cancelled: rows.filter((row) => row.status === 'cancelled').length,
      actionableFailures: actionableFailures.length,
      nonActionableEvidence: nonActionableEvidence.length,
    },
    title: readbackTitle(`Fetch queue (${rows.length} ${status.publicStatus})`, provenance),
    tasks: rows,
    actionableFailures,
    nonActionableEvidence,
    note: 'Read-only durable fetch task status. Inspect actionableFailures before retrying; failed calls stay in task/API-health logs, not reusable data tables.',
  }, null, 2)
}

function normalizeFetchStatus(raw: unknown): { publicStatus: string; queryStatus: string } {
  const status = String(raw ?? 'pending').trim().toLowerCase()
  if (status === 'done' || status === 'completed') {
    return { publicStatus: 'completed', queryStatus: 'done' }
  }
  if (['pending', 'running', 'failed', 'cancelled', 'all'].includes(status)) {
    return { publicStatus: status, queryStatus: status }
  }
  return { publicStatus: 'pending', queryStatus: 'pending' }
}

function readFetchTasks(ds: DataStore, status: string, limit: number): FetchTask[] {
  const rows = status === 'all'
    ? ds.query<Record<string, unknown>>(
      'SELECT * FROM fetch_tasks ORDER BY created_at DESC LIMIT ?',
      limit,
    )
    : ds.query<Record<string, unknown>>(
      'SELECT * FROM fetch_tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?',
      status,
      limit,
    )
  return rows.map(parseFetchTask)
}

function fetchTaskRow(task: FetchTask): Record<string, unknown> {
  const actionableFailure = isActionableFetchTaskFailure(task)
  const nonActionableEvidence = task.status === 'failed' && !actionableFailure
  return {
    ...summarizeFetchTask(task),
    status: task.status === 'done' ? 'completed' : task.status,
    rawStatus: task.status,
    priority: task.priority,
    params: task.params,
    createdAt: task.createdAt,
    actionableFailure,
    nonActionableEvidence,
    nextAction: fetchTaskNextAction(task, actionableFailure),
  }
}

function isActionableFetchTaskFailure(task: FetchTask): boolean {
  if (task.status !== 'failed') return false
  const error = String(task.error ?? '').toLowerCase()
  if (isStaleOrRecoveredFetchTaskError(error)) return false
  if ((error.startsWith('code required') || error.includes('needs codes')) && !hasFetchTaskCodeLikeParam(task)) {
    return false
  }
  return true
}

function isStaleOrRecoveredFetchTaskError(error: string): boolean {
  return error.includes('manual data-feed verification recovered stale active task') ||
    error.includes('manual verification interrupted before completion') ||
    error.includes('stale active task recovered on startup') ||
    error.includes('recovered stale active task')
}

function hasFetchTaskCodeLikeParam(task: FetchTask): boolean {
  if (typeof task.code === 'string' && task.code.trim()) return true
  for (const key of ['code', 'symbol', 'symbols', 'codes']) {
    const value = task.params[key]
    if (typeof value === 'string' && value.trim()) return true
    if (Array.isArray(value) && value.length > 0) return true
  }
  return false
}

function fetchTaskNextAction(task: FetchTask, actionableFailure: boolean): string {
  if (task.status === 'pending' || task.status === 'running') {
    return 'Wait for current task evidence before enqueueing another run.'
  }
  if (task.status === 'done') {
    return 'Use local query/readback before enqueueing another provider run.'
  }
  if (task.status === 'cancelled') {
    return 'Task was cancelled; inspect workflow intent before retrying.'
  }
  const error = String(task.error ?? '').toLowerCase()
  if (isStaleOrRecoveredFetchTaskError(error)) {
    return 'No provider retry is needed for this stale recovered task marker; inspect current fetch_status/data_health first.'
  }
  if ((error.startsWith('code required') || error.includes('needs codes')) && !hasFetchTaskCodeLikeParam(task)) {
    return 'Add task scope/code parameters before running this task again.'
  }
  if (actionableFailure) {
    return 'Inspect data_health failureActionQueue and API Health provider evidence before retrying this task.'
  }
  return 'Inspect fetch_status and data_health before deciding whether retry is needed.'
}

async function waitForFetchTasks(
  ds: DataStore,
  fetchQueue: FetchQueue | null,
  taskIds: number[],
  timeoutMs: number,
): Promise<string> {
  if (taskIds.length === 0) return toolError('No fetch tasks were created.')
  if (fetchQueue) {
    cancelUnrelatedWorkflowFetchTasks(ds, taskIds)
    void fetchQueue.start()
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    const tasks = getFetchTasks(ds, taskIds)
    if (tasks.length === taskIds.length && tasks.every((t) => t.status === 'done' || t.status === 'failed' || t.status === 'cancelled')) {
      return fetchTaskResult(tasks)
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  const tasks = getFetchTasks(ds, taskIds)
  return toolError(`DataStore fetch did not complete within ${timeoutMs}ms. Current tasks: ${JSON.stringify(tasks.map(summarizeFetchTask))}. These tasks may still be running; use DataStore(action:"fetch_status") to inspect progress before retrying.`)
}

function cancelUnrelatedWorkflowFetchTasks(ds: DataStore, taskIds: number[]): void {
  if (process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION !== '1') return
  const enable = String(process.env.FINAGENT_WORKSTATION_WORKFLOW_ENABLE_BACKGROUND ?? '').trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(enable)) return
  const value = String(process.env.FINAGENT_WORKSTATION_WORKFLOW_DISABLE_BACKGROUND ?? '').trim().toLowerCase()
  if (['0', 'false', 'no', 'off'].includes(value)) return
  if (taskIds.length === 0) return
  const placeholders = taskIds.map(() => '?').join(',')
  ds.exec(
    `UPDATE fetch_tasks
       SET status = 'cancelled',
           error = COALESCE(error, 'cancelled during isolated workflow test; unrelated queued prefetch must not delay explicit agent fetch'),
           updated_at = datetime('now')
     WHERE status IN ('pending', 'running')
       AND id NOT IN (${placeholders})`,
    ...taskIds,
  )
}

function getFetchTasks(ds: DataStore, ids: number[]): FetchTask[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  const rows = ds.query<Record<string, unknown>>(`SELECT * FROM fetch_tasks WHERE id IN (${placeholders}) ORDER BY id`, ...ids)
  return rows.map(parseFetchTask)
}

function fetchTaskResult(tasks: FetchTask[]): string {
  const failed = tasks.filter((t) => t.status === 'failed' || t.status === 'cancelled')
  const provenance = fetchTaskQueueProvenance()
  if (failed.length > 0) {
    return toolError(`DataStore fetch failed: ${JSON.stringify({
      provenance,
      failed: failed.map(summarizeFetchTask),
      next: 'Inspect DataStore(action:"fetch_status") and API Health before retrying. Failed calls stay in task/API health logs, not reusable data tables.',
    })}`)
  }
  const summaries = tasks.map(summarizeFetchTask)
  const persistedRows = tasks.reduce((total, task) => total + persistedRowCount(task), 0)
  if (persistedRows === 0) {
    return JSON.stringify({
      ok: true,
      action: 'fetch',
      retrieval_status: 'empty',
      provenance,
      taskCount: tasks.length,
      persistedRows,
      tasks: summaries,
      note: 'Fetch task completed but no reusable rows were persisted. Treat this as a data gap; inspect fetch_status/API Health/provider evidence before relying on this dataset.',
    }, null, 2)
  }
  return JSON.stringify({
    ok: true,
    action: 'fetch',
    retrieval_status: 'success',
    provenance,
    taskCount: tasks.length,
    persistedRows,
    tasks: summaries,
    note: 'Requested data has been persisted in local DataStore. Query it with DataStore coverage/query_* actions before calling external APIs again.',
  }, null, 2)
}

function persistedRowCount(task: FetchTask): number {
  const progress = task.progress
  if (!progress) return 0
  for (const key of ['saved', 'fetched']) {
    const value = Number(progress[key as keyof typeof progress])
    if (Number.isFinite(value) && value > 0) return value
  }
  return 0
}

function fetchTaskQueueProvenance(): {
  interfaceId: string
  provider: string
  capabilityId: string
  canonicalSchema: string
  canonicalTable: string
  cacheStatus: string
  readbackAction: string
} {
  return {
    interfaceId: 'provider.fetch_task_queue',
    provider: 'local',
    capabilityId: 'local.provider.fetch_task_queue',
    canonicalSchema: 'fetch_task_queue',
    canonicalTable: 'fetch_tasks',
    cacheStatus: 'local-hit',
    readbackAction: 'fetch_status',
  }
}
