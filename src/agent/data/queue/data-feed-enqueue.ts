import type { DataStore } from '../store/data-store'
import type { FeedConfig } from '../store/data-store-types'
import { supportsMoneyFundYield } from '../fund-category'
import {
  missingFeedScopePrerequisite,
  resolveFeedCodesWithStore,
} from './feed-scope'

export interface DataFeedQueue {
  enqueue(taskType: string, code: string | null, params: Record<string, unknown>, priority: number): number
}

export interface EnqueueDataFeedOptions {
  basePath: string
  feedRunId?: string
  extraParams?: Record<string, unknown>
  taskPriority: number
  prerequisitePriority: number
  now?: Date
  skipActivePrerequisite?: (taskType: string, code: string | null) => boolean
}

export type EnqueueDataFeedResult =
  | { kind: 'started'; taskIds: number[]; message: string }
  | { kind: 'prerequisite'; taskIds: number[]; message: string; reason: string }
  | { kind: 'needs_codes'; taskIds: []; message: string }

export function enqueueConfiguredDataFeed(
  store: DataStore,
  queue: DataFeedQueue,
  feed: FeedConfig,
  opts: EnqueueDataFeedOptions,
): EnqueueDataFeedResult {
  const feedRunId = opts.feedRunId ?? `${feed.feed_id}:${Date.now()}`
  const params = {
    scope: feed.scope,
    scope_codes: feed.scope_codes,
    history_years: feed.history_years,
    source_priority: feed.source_priority,
    _feedId: feed.feed_id,
    _feedRunId: feedRunId,
    ...(opts.extraParams ?? {}),
  }
  const taskIds: number[] = []
  const taskType = feedTaskType(feed.feed_type)

  if (noCodeFeedTypes.has(feed.feed_type)) {
    taskIds.push(queue.enqueue(taskType, null, params, opts.taskPriority))
    store.updateFeedConfig(feed.feed_id, { status: 'running', last_run_at: (opts.now ?? new Date()).toISOString() } as any)
    return { kind: 'started', taskIds, message: feedStartedMessage(feed.display_name, taskIds.length) }
  }

  const codes = resolveFeedCodesWithStore(feed, opts.basePath, store)
  if (codes.length === 0) {
    const prerequisite = missingFeedScopePrerequisite(feed)
    if (!prerequisite) {
      const message = feedNeedsCodesMessage(feed.display_name)
      store.updateFeedConfig(feed.feed_id, { status: 'idle', last_error: message } as any)
      return { kind: 'needs_codes', taskIds: [], message }
    }
    if (!opts.skipActivePrerequisite?.(prerequisite.taskType, prerequisite.code)) {
      taskIds.push(queue.enqueue(prerequisite.taskType, prerequisite.code, prerequisite.params, opts.prerequisitePriority))
    }
    const message = feedWaitingForPrerequisiteMessage(feed.display_name, prerequisite.reason)
    store.updateFeedConfig(feed.feed_id, { status: 'waiting_prerequisite', last_error: message } as any)
    return { kind: 'prerequisite', taskIds, message, reason: prerequisite.reason }
  }

  if (taskType === 'kline_daily') {
    taskIds.push(queue.enqueue('kline_batch', null, { ...params, codes }, opts.taskPriority))
  } else if (taskType === 'fund_nav') {
    const split = splitFundNavCodes(store, codes)
    for (const code of split.ordinary) taskIds.push(queue.enqueue('fund_nav', code, params, opts.taskPriority))
    for (const code of split.money) taskIds.push(queue.enqueue('fund_money_yield', code, params, opts.taskPriority))
  } else {
    for (const code of codes) taskIds.push(queue.enqueue(taskType, code, params, opts.taskPriority))
  }

  if (taskIds.length > 0) {
    store.updateFeedConfig(feed.feed_id, { status: 'running', last_run_at: (opts.now ?? new Date()).toISOString() } as any)
  }
  return { kind: 'started', taskIds, message: feedStartedMessage(feed.display_name, taskIds.length) }
}

export function feedTaskType(feedType: string): string {
  if (feedType === 'fund_performance_metrics') return 'fund_performance'
  return feedType
}

export function feedStartedMessage(displayName: string, count: number): string {
  return `Feed ${displayName} started (${count} task${count === 1 ? '' : 's'})`
}

export function feedWaitingForPrerequisiteMessage(displayName: string, reason: string): string {
  return `Feed ${displayName} is waiting for prerequisite data: ${reason}. The target feed has not run yet.`
}

export function feedNeedsCodesMessage(displayName: string): string {
  return `Feed ${displayName} needs codes. Add items to the related watchlist or set scope_codes.`
}

const noCodeFeedTypes = new Set([
  'stock_list',
  'fund_list',
  'fund_performance_metrics',
  'fund_manager',
  'etf_quotes',
  'sector',
  'limit_pool',
  'northbound',
  'calendar',
  'industry',
])

function splitFundNavCodes(ds: DataStore, codes: string[]): { ordinary: string[]; money: string[] } {
  const fundRows = ds.queryFundList({ limit: 10000 })
  const moneyCodes = new Set(
    fundRows
      .filter((row) => supportsMoneyFundYield(row.fund_category))
      .map((row) => String(row.code ?? '').trim())
      .filter(Boolean),
  )
  const ordinary: string[] = []
  const money: string[] = []
  for (const code of codes) {
    if (moneyCodes.has(code)) money.push(code)
    else ordinary.push(code)
  }
  return { ordinary, money }
}
