import type { DataStore } from '../data/store/data-store'
import type { FeedConfig } from '../data/store/data-store-types'
import { resolveFeedCodesWithStore } from '../data/queue/feed-scope'
import {
  isActionableFeedFailure,
  isStaleOrRecoveredDataFeedError,
} from '../data/data-feed-failure-policy'
import { shouldReuseRowCountCache } from '../data/data-api-cache-policy'

export function dataFeeds(ds: DataStore, input: Record<string, unknown>, runtimeBasePath?: string): string {
  const feedId = String(input.feedId ?? input.id ?? '').trim()
  const limit = Math.max(1, Math.min(Number(input.limit ?? 50), 100))
  const allFeeds = ds.getFeedConfigs()
  const feeds = feedId ? allFeeds.filter((feed) => feed.feed_id === feedId) : allFeeds
  const rows = feeds.slice(0, limit).map((feed) => feedToPayload(ds, feed, runtimeBasePath))
  const actionable = rows.filter((row) => row.actionableFailure)
  const nonActionableEvidence = rows.filter((row) => row.nonActionableEvidence)
  const waitingPrerequisite = rows.filter((row) => row.status === 'waiting_prerequisite')
  const running = rows.filter((row) => row.status === 'running')
  return JSON.stringify({
    action: 'data_feeds',
    feedId: feedId || null,
    total: feeds.length,
    returned: rows.length,
    summary: {
      enabled: rows.filter((row) => row.enabled).length,
      disabled: rows.filter((row) => !row.enabled).length,
      running: running.length,
      waitingPrerequisite: waitingPrerequisite.length,
      actionableFailures: actionable.length,
      nonActionableEvidence: nonActionableEvidence.length,
    },
    feeds: rows,
    actionableFailures: actionable,
    nonActionableEvidence,
    waitingPrerequisite,
    running,
    provenance: {
      interfaceId: 'data.feed_status',
      providerId: 'local',
      provider: 'local',
      capabilityId: 'local.data.feed_status',
      providerMode: 'local-data-manager',
      cacheStatus: 'local-evidence',
      cacheDecision:
        'data_feeds reads configured Data Manager feed state and queue evidence; it describes prefetch status and does not itself call providers',
      canonicalSchema: 'data_feed_config',
      canonicalTable: 'data_feed_config',
      readbackAction: 'data_feeds',
      source: 'DataStore data_feed_config and configured Data Manager feed state',
      basePath: runtimeBasePath,
      fetchedAt: new Date().toISOString(),
    },
    note: 'Read-only Data Manager feed status. Use the Data Manager Run action or scheduler path for actual prefetch; do not call providers directly from this status result.',
  }, null, 2)
}

function feedToPayload(ds: DataStore, feed: FeedConfig, runtimeBasePath?: string): Record<string, unknown> {
  const enabled = Number(feed.enabled) !== 0
  const status = String(feed.status ?? 'idle')
  const lastError = feed.last_error ?? null
  const resolvedCodes = resolveFeedCodesWithStore(feed, runtimeBasePath ?? '', ds)
  const targetEvidence = feedTargetEvidence(ds, feed, resolvedCodes)
  return {
    feedId: feed.feed_id,
    displayName: feed.display_name,
    feedType: feed.feed_type,
    enabled,
    scope: feed.scope,
    scopeCodes: feed.scope_codes,
    historyYears: feed.history_years,
    updateFrequency: feed.update_frequency,
    triggerTime: feed.trigger_time,
    sourcePriority: parseJsonArray(feed.source_priority),
    status,
    lastRunAt: feed.last_run_at,
    lastError,
    updatedAt: feed.updated_at,
    resolvedCount: resolvedCodes.length,
    targetEvidence,
    needsCodes: typeof lastError === 'string' && /needs codes/i.test(lastError),
    waitingPrerequisite: status === 'waiting_prerequisite',
    actionableFailure: isActionableFeedFailure(feed),
    nonActionableEvidence: enabled && !isActionableFeedFailure(feed) && Boolean(lastError || status === 'waiting_prerequisite'),
    nextAction: nextAction(status, lastError),
  }
}

function feedTargetEvidence(ds: DataStore, feed: FeedConfig, resolvedCodes: string[]): Record<string, unknown> {
  const target = feedTarget(feed.feed_type)
  if (!target) {
    return {
      feedType: feed.feed_type,
      canonicalTable: null,
      readbackAction: null,
      rowCount: null,
      symbolCount: resolvedCodes.length,
      latestSourceTime: null,
      latestFetchedAt: null,
      cacheStatus: 'not-governed',
      nextAction: 'Classify this feed target before treating it as reusable data.',
    }
  }
  const stats = tableStats(ds, target.table, target.dateColumn, target.fetchedAtColumn, target.codeColumn, resolvedCodes)
  const minRows = targetMinRows(target, resolvedCodes)
  const cacheDecision = shouldReuseRowCountCache({
    rowCount: stats.rowCount,
    minRows,
    label: `${target.interfaceId} readback`,
  })
  return {
    feedType: feed.feed_type,
    interfaceId: target.interfaceId,
    canonicalSchema: target.schema,
    canonicalTable: target.table,
    readbackAction: target.readbackAction,
    rowCount: stats.rowCount,
    symbolCount: stats.symbolCount,
    minRows,
    readbackVerified: cacheDecision.reusable,
    cacheDecision,
    earliestSourceTime: stats.earliestSourceTime,
    latestSourceTime: stats.latestSourceTime,
    latestFetchedAt: stats.latestFetchedAt,
    cacheStatus: cacheDecision.reusable ? 'local-reusable' : 'missing-local-rows',
    nextAction: cacheDecision.reusable
      ? `Use ${target.readbackAction} before running this feed again.`
      : 'Run the configured feed only when scope is valid and freshness/coverage requires it.',
  }
}

function tableStats(
  ds: DataStore,
  table: string,
  dateColumn: string,
  fetchedAtColumn: string | null,
  codeColumn: string | null,
  resolvedCodes: string[],
): { rowCount: number; symbolCount: number; earliestSourceTime: string | null; latestSourceTime: string | null; latestFetchedAt: string | null } {
  const codeFilter = codeColumn && resolvedCodes.length > 0
    ? ` WHERE ${codeColumn} IN (${resolvedCodes.map(() => '?').join(',')})`
    : ''
  const params = codeColumn && resolvedCodes.length > 0 ? resolvedCodes : []
  const fetchedExpr = fetchedAtColumn ? `MAX(${fetchedAtColumn})` : 'NULL'
  try {
    const row = ds.query<Record<string, unknown>>(
      `SELECT COUNT(*) as row_count, ${codeColumn ? `COUNT(DISTINCT ${codeColumn})` : 'NULL'} as symbol_count, MIN(${dateColumn}) as earliest_source_time, MAX(${dateColumn}) as latest_source_time, ${fetchedExpr} as latest_fetched_at FROM ${table}${codeFilter}`,
      ...params,
    )[0] ?? {}
    return {
      rowCount: Number(row.row_count ?? 0),
      symbolCount: Number(row.symbol_count ?? resolvedCodes.length),
      earliestSourceTime: stringOrNull(row.earliest_source_time),
      latestSourceTime: stringOrNull(row.latest_source_time),
      latestFetchedAt: stringOrNull(row.latest_fetched_at),
    }
  } catch (error) {
    return {
      rowCount: 0,
      symbolCount: resolvedCodes.length,
      earliestSourceTime: null,
      latestSourceTime: null,
      latestFetchedAt: null,
    }
  }
}

function targetMinRows(
  target: NonNullable<ReturnType<typeof feedTarget>>,
  resolvedCodes: string[],
): number {
  if (target.codeColumn && resolvedCodes.length > 0) return resolvedCodes.length
  return 1
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null
  const text = String(value)
  return text.length > 0 ? text : null
}

function feedTarget(feedType: string): {
  interfaceId: string
  schema: string
  table: string
  codeColumn: string | null
  dateColumn: string
  fetchedAtColumn: string | null
  readbackAction: string
} | null {
  switch (feedType) {
    case 'stock_list':
      return { interfaceId: 'stock.identity_list', schema: 'stock_list', table: 'stock_list', codeColumn: 'code', dateColumn: 'updated_at', fetchedAtColumn: 'updated_at', readbackAction: 'stock_list' }
    case 'kline_daily':
      return { interfaceId: 'stock.daily_kline', schema: 'kline_daily', table: 'kline_daily', codeColumn: 'code', dateColumn: 'date', fetchedAtColumn: null, readbackAction: 'query_kline' }
    case 'fundamental':
      return { interfaceId: 'stock.fundamentals', schema: 'fundamental', table: 'fundamental', codeColumn: 'code', dateColumn: 'report_date', fetchedAtColumn: 'updated_at', readbackAction: 'query_fundamental' }
    case 'money_flow':
      return { interfaceId: 'stock.money_flow', schema: 'money_flow', table: 'money_flow', codeColumn: 'code', dateColumn: 'date', fetchedAtColumn: null, readbackAction: 'query_money_flow' }
    case 'fund_list':
      return { interfaceId: 'fund.identity_list', schema: 'fund_list', table: 'fund_list', codeColumn: 'code', dateColumn: 'updated_at', fetchedAtColumn: 'updated_at', readbackAction: 'query_fund_list' }
    case 'fund_nav':
      return { interfaceId: 'fund.nav_history', schema: 'fund_nav', table: 'fund_nav', codeColumn: 'code', dateColumn: 'date', fetchedAtColumn: 'fetched_at', readbackAction: 'query_fund_nav' }
    case 'fund_money_yield':
      return { interfaceId: 'fund.money_yield', schema: 'fund_money_yield', table: 'fund_money_yield', codeColumn: 'code', dateColumn: 'date', fetchedAtColumn: 'fetched_at', readbackAction: 'query_fund_money_yield' }
    case 'fund_holding':
      return { interfaceId: 'fund.holding', schema: 'fund_holding', table: 'fund_holding', codeColumn: 'fund_code', dateColumn: 'report_date', fetchedAtColumn: null, readbackAction: 'query_fund_holding' }
    case 'fund_performance_metrics':
      return { interfaceId: 'fund.performance_metrics', schema: 'fund_performance_metrics', table: 'fund_performance_metrics', codeColumn: 'code', dateColumn: 'metric_date', fetchedAtColumn: 'fetched_at', readbackAction: 'query_fund_performance' }
    case 'fund_manager':
      return { interfaceId: 'fund.manager', schema: 'fund_manager', table: 'fund_manager', codeColumn: null, dateColumn: 'updated_at', fetchedAtColumn: 'updated_at', readbackAction: 'query_fund_manager' }
    case 'etf_quotes':
      return { interfaceId: 'fund.etf_quote', schema: 'quote_snapshot', table: 'quote_snapshot', codeColumn: 'code', dateColumn: 'timestamp', fetchedAtColumn: 'fetched_at', readbackAction: 'query_etf_quote' }
    case 'index_components':
      return { interfaceId: 'index.constituents', schema: 'index_constituent', table: 'index_constituent', codeColumn: 'index_code', dateColumn: 'as_of_date', fetchedAtColumn: 'fetched_at', readbackAction: 'query_index_constituents' }
    case 'index_kline':
      return { interfaceId: 'index.daily_kline', schema: 'kline_daily', table: 'kline_daily', codeColumn: 'code', dateColumn: 'date', fetchedAtColumn: null, readbackAction: 'query_kline' }
    case 'calendar':
      return { interfaceId: 'calendar.trade_days', schema: 'trade_calendar', table: 'trade_calendar', codeColumn: 'market', dateColumn: 'date', fetchedAtColumn: null, readbackAction: 'query_trade_calendar' }
    case 'sector':
    case 'industry':
      return { interfaceId: 'market.sector_ranking', schema: 'sector_ranking', table: 'sector_ranking', codeColumn: 'code', dateColumn: 'date', fetchedAtColumn: null, readbackAction: 'query_sector_ranking' }
    case 'limit_pool':
      return { interfaceId: 'market.limit_pool', schema: 'limit_pool', table: 'limit_pool', codeColumn: 'code', dateColumn: 'date', fetchedAtColumn: 'fetched_at', readbackAction: 'query_limit_pool' }
    case 'northbound':
      return { interfaceId: 'market.northbound_flow', schema: 'northbound', table: 'northbound', codeColumn: null, dateColumn: 'date', fetchedAtColumn: null, readbackAction: 'query_northbound' }
    default:
      return null
  }
}

function parseJsonArray(value: string | null): unknown[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function nextAction(status: string, error: string | null): string {
  if (status === 'waiting_prerequisite') return 'Wait for prerequisite feed task to complete, then run this feed again through Data Manager.'
  if (error && isStaleOrRecoveredDataFeedError(error.toLowerCase())) return 'No provider retry is needed for this stale recovered feed marker; inspect current feed/task status before taking action.'
  if (error && /needs codes/i.test(error)) return 'Add watchlist or scope_codes before running this feed.'
  if (status === 'failed' || status === 'error') return 'Inspect API Health and Data Manager task evidence before retrying the feed.'
  if (status === 'running') return 'Wait for current feed task evidence before enqueueing another run.'
  return 'Use local readback/cache first; run the configured feed only when freshness or coverage requires it.'
}
