import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { normalizeFundCategory, supportsMoneyFundYield, supportsOrdinaryFundNav } from '../fund-category'

export interface FeedScopeConfig {
  feed_type: string
  scope: string
  scope_codes: string | null
}

export interface FeedCodeStore {
  queryStockList?(filter?: { market?: string; industry?: string; type?: string }): Array<{ code?: string | null }>
  queryFundList?(opts?: { type?: string; limit?: number }): Array<Record<string, unknown>>
  queryIndexConstituents?(opts?: { indexCode?: string; limit?: number }): Array<{ stock_code?: string | null }>
}

const ALL_FUND_NAV_LIMIT = 300
const ALL_MONEY_FUND_LIMIT = 200
const ALL_FUND_HOLDING_LIMIT = 80

export function resolveFeedCodes(config: FeedScopeConfig, basePath: string): string[] {
  const explicit = parseScopeCodes(config.scope_codes)
  if (explicit.length > 0) return explicit
  if (config.scope === 'preset') return explicit
  if (config.scope !== 'watchlist') return []
  if (isFundFeed(config.feed_type)) return readFundWatchlistCodes(basePath)
  return readStockWatchlistCodes(basePath)
}

export function resolveFeedCodesWithStore(config: FeedScopeConfig, basePath: string, store: FeedCodeStore): string[] {
  const explicit = parseScopeCodes(config.scope_codes)
  if (explicit.length > 0) return explicit
  if (config.scope === 'preset' || config.scope === 'custom') return explicit
  if (config.scope === 'watchlist') return resolveFeedCodes(config, basePath)
  if (config.scope === 'all') return resolveAllFeedCodes(config, store)
  if (config.scope === 'csi300') return resolveIndexScopeCodes(store, '000300')
  if (config.scope === 'csi500') return resolveIndexScopeCodes(store, '000905')
  return []
}

export function missingFeedScopePrerequisite(config: FeedScopeConfig): { taskType: string; code: string | null; params: Record<string, unknown>; reason: string } | null {
  if (config.scope === 'all') {
    if (isFundFeed(config.feed_type)) return { taskType: 'fund_list', code: null, params: { source: 'feed-scope' }, reason: 'fund_list is required to resolve all-fund feed scope' }
    return { taskType: 'stock_list', code: null, params: { market: 'A', source: 'feed-scope' }, reason: 'stock_list is required to resolve all-stock feed scope' }
  }
  if (config.scope === 'csi300') return { taskType: 'index_components', code: '000300', params: { source: 'feed-scope' }, reason: 'CSI300 constituents are required to resolve this feed scope' }
  if (config.scope === 'csi500') return { taskType: 'index_components', code: '000905', params: { source: 'feed-scope' }, reason: 'CSI500 constituents are required to resolve this feed scope' }
  return null
}

export function parseScopeCodes(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return uniqueCodes(parsed)
  } catch {}
  return uniqueCodes(value.split(/[,\s]+/))
}

export function readFundWatchlistCodes(basePath: string): string[] {
  const unified = readJsonFromFirstExisting([
    join(basePath, 'watchlists.json'),
    join(basePath, 'memory', 'watchlists.json'),
    join(basePath, 'memory', 'watchlist.json'),
  ])
  const unifiedItems = Array.isArray(unified?.items)
    ? unified.items as Array<{ symbol?: string; code?: string; status?: string; type?: string }>
    : []
  const unifiedCodes = uniqueCodes(unifiedItems
    .filter((item) => item.status !== 'exited' && isFundLikeWatchType(item.type))
    .map((item) => item.symbol ?? item.code))
  if (unifiedCodes.length > 0) return unifiedCodes

  const legacy = readJsonFromFirstExisting([
    join(basePath, 'fund_watchlists.json'),
    join(basePath, 'memory', 'fund_watchlists.json'),
  ])
  const items = Array.isArray(legacy?.items) ? legacy.items as Array<{ code?: string }> : []
  return uniqueCodes(items.map((item) => item.code))
}

export function readStockWatchlistCodes(basePath: string): string[] {
  const data = readJsonFromFirstExisting([
    join(basePath, 'watchlists.json'),
    join(basePath, 'memory', 'watchlists.json'),
    join(basePath, 'memory', 'watchlist.json'),
  ])
  const items = Array.isArray(data?.items) ? data.items as Array<{ symbol?: string; code?: string; status?: string; type?: string }> : []
  return uniqueCodes(items
    .filter((item) => item.status !== 'exited' && !isFundLikeWatchType(item.type))
    .map((item) => item.symbol ?? item.code))
}

function readJsonFromFirstExisting(paths: string[]): any {
  for (const path of paths) {
    if (!existsSync(path)) continue
    try {
      return JSON.parse(readFileSync(path, 'utf-8'))
    } catch {
      return null
    }
  }
  return null
}

function uniqueCodes(values: Array<unknown>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)))
}

function isFundLikeWatchType(type: string | undefined): boolean {
  return type === 'fund' || type === 'etf'
}

function isFundFeed(feedType: string): boolean {
  return feedType.startsWith('fund_')
}

function resolveAllFeedCodes(config: FeedScopeConfig, store: FeedCodeStore): string[] {
  if (isFundFeed(config.feed_type)) {
    return resolveAllFundFeedCodes(config.feed_type, store)
  }
  return uniqueCodes((store.queryStockList?.() ?? []).map((row) => row.code))
}

function resolveAllFundFeedCodes(feedType: string, store: FeedCodeStore): string[] {
  const limit = feedType === 'fund_holding'
    ? ALL_FUND_HOLDING_LIMIT
    : feedType === 'fund_money_yield'
      ? ALL_MONEY_FUND_LIMIT
      : ALL_FUND_NAV_LIMIT
  const rows = store.queryFundList?.({ limit: Math.max(limit * 3, limit) }) ?? []
  const filtered = rows.filter((row) => {
    const code = String(row.code ?? '').trim()
    if (!/^\d{6}$/.test(code)) return false
    const category = normalizeFundCategory(row)
    if (feedType === 'fund_money_yield') return supportsMoneyFundYield(category)
    if (feedType === 'fund_nav') return supportsOrdinaryFundNav(category)
    if (feedType === 'fund_holding') {
      return supportsOrdinaryFundNav(category) && category !== 'bond'
    }
    return true
  })
  return uniqueCodes(filtered.map((row) => row.code)).slice(0, limit)
}

function resolveIndexScopeCodes(store: FeedCodeStore, indexCode: string): string[] {
  return uniqueCodes((store.queryIndexConstituents?.({ indexCode, limit: 1000 }) ?? []).map((row) => row.stock_code))
}
