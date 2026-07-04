import type { FundSuggestion } from './watchlist-picker-model'

export interface StoredFundItem {
  id: string
  code: string
  name: string
  addedAt: string
}

export interface FundWatchlistRow extends FundSuggestion {
  code: string
  name: string
  source?: string | null
  provider_time?: string | null
  fetched_at?: string | null
  updated_at?: string | null
  cache_status?: string | null
}

export interface FundWatchlistData {
  items: StoredFundItem[]
}

export interface UnifiedWatchGroup {
  id: string
  name: string
  type?: string
}

export interface UnifiedWatchItem {
  id: string
  groupId: string
  symbol: string
  name: string
  type: string
  status: string
  source: string
  tags: string[]
  priceAtAdd: number
  addedAt: string
}

export interface UnifiedWatchlistData {
  groups: UnifiedWatchGroup[]
  items: UnifiedWatchItem[]
}

export const UNIFIED_WATCHLIST_PATH = 'watchlists.json'
export const LEGACY_FUND_WATCHLIST_PATH = 'fund_watchlists.json'
export const DEFAULT_STOCK_GROUP_ID = 'default'
export const DEFAULT_FUND_GROUP_ID = 'fund-default'

export function emptyUnifiedWatchlist(defaultStockGroupName = 'Default'): UnifiedWatchlistData {
  return {
    groups: [{ id: DEFAULT_STOCK_GROUP_ID, name: defaultStockGroupName, type: 'stock' }],
    items: [],
  }
}

export function normalizeUnifiedWatchlist(
  value: unknown,
  defaultStockGroupName = 'Default',
  defaultFundGroupName = 'Fund Watchlist',
): UnifiedWatchlistData {
  const raw = value as Partial<UnifiedWatchlistData> | null | undefined
  const groups = Array.isArray(raw?.groups)
    ? raw.groups
        .filter((group): group is UnifiedWatchGroup => typeof group?.id === 'string' && typeof group?.name === 'string')
        .map((group) => ({ id: group.id, name: group.name, type: group.type }))
    : []
  const items = Array.isArray(raw?.items)
    ? raw.items
        .filter((item): item is UnifiedWatchItem => typeof item?.id === 'string' && typeof item?.symbol === 'string')
        .map((item) => ({
          id: item.id,
          groupId: item.groupId || defaultGroupIdForType(groups, item.type),
          symbol: cleanWatchCode(item.symbol),
          name: item.name ?? '',
          type: item.type || 'stock',
          status: item.status || 'watching',
          source: item.source || 'manual',
          tags: Array.isArray(item.tags) ? item.tags : [],
          priceAtAdd: Number.isFinite(Number(item.priceAtAdd)) ? Number(item.priceAtAdd) : 0,
          addedAt: item.addedAt || new Date(0).toISOString(),
        }))
    : []

  const next: UnifiedWatchlistData = {
    groups: groups.length > 0 ? groups : emptyUnifiedWatchlist(defaultStockGroupName).groups,
    items,
  }
  ensureGroup(next, DEFAULT_STOCK_GROUP_ID, defaultStockGroupName, 'stock')
  ensureGroup(next, DEFAULT_FUND_GROUP_ID, defaultFundGroupName, 'fund')
  return next
}

export function fundItemsFromUnified(data: UnifiedWatchlistData): StoredFundItem[] {
  return data.items
    .filter((item) => isFundLike(item.type) && item.status !== 'exited')
    .map((item) => ({
      id: item.id,
      code: cleanWatchCode(item.symbol),
      name: item.name || cleanWatchCode(item.symbol),
      addedAt: item.addedAt,
    }))
    .filter((item) => item.code.length > 0)
}

export function mergeLegacyFundWatchlist(
  unified: UnifiedWatchlistData,
  legacy: FundWatchlistData | null | undefined,
  defaultFundGroupName = 'Fund Watchlist',
): { data: UnifiedWatchlistData; changed: boolean } {
  const next = cloneUnifiedWatchlist(unified)
  const groupId = ensureGroup(next, DEFAULT_FUND_GROUP_ID, defaultFundGroupName, 'fund')
  const existing = new Set(next.items.filter((item) => isFundLike(item.type)).map((item) => cleanWatchCode(item.symbol)))
  let changed = false
  for (const item of legacy?.items ?? []) {
    const code = cleanWatchCode(item.code)
    if (!code || existing.has(code)) continue
    next.items.push({
      id: item.id || fundWatchId(),
      groupId,
      symbol: code,
      name: item.name || code,
      type: 'fund',
      status: 'watching',
      source: 'legacy-fund-watchlist',
      tags: [],
      priceAtAdd: 0,
      addedAt: item.addedAt || new Date().toISOString(),
    })
    existing.add(code)
    changed = true
  }
  return { data: next, changed }
}

export function upsertFundInUnified(
  unified: UnifiedWatchlistData,
  fund: { code: string; name?: string | null },
  defaultFundGroupName = 'Fund Watchlist',
  source = 'manual',
): { data: UnifiedWatchlistData; status: 'added' | 'exists' } {
  const code = cleanWatchCode(fund.code)
  if (!code) return { data: unified, status: 'exists' }
  const next = cloneUnifiedWatchlist(unified)
  if (next.items.some((item) => isFundLike(item.type) && item.status !== 'exited' && cleanWatchCode(item.symbol) === code)) {
    return { data: next, status: 'exists' }
  }
  const groupId = ensureGroup(next, DEFAULT_FUND_GROUP_ID, defaultFundGroupName, 'fund')
  next.items.push({
    id: fundWatchId(),
    groupId,
    symbol: code,
    name: fund.name || code,
    type: 'fund',
    status: 'watching',
    source,
    tags: [],
    priceAtAdd: 0,
    addedAt: new Date().toISOString(),
  })
  return { data: next, status: 'added' }
}

export function removeFundFromUnified(unified: UnifiedWatchlistData, id: string): UnifiedWatchlistData {
  return {
    groups: unified.groups.map((group) => ({ ...group })),
    items: unified.items.filter((item) => !(isFundLike(item.type) && item.id === id)).map((item) => ({ ...item, tags: [...item.tags] })),
  }
}

export function buildFundWatchlistRows(
  storedItems: StoredFundItem[],
  fetchedRows: FundWatchlistRow[] | undefined,
): FundWatchlistRow[] {
  const fetchedByCode = new Map((fetchedRows ?? []).filter((row) => row.code).map((row) => [row.code, row]))
  return storedItems.map((item) => {
    const fetched = fetchedByCode.get(item.code)
    if (fetched) {
      return {
        ...fetched,
        name: fetched.name || item.name || item.code,
      }
    }
    return {
      code: item.code,
      name: item.name || item.code,
    }
  })
}

export function cleanWatchCode(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\.\w+$/i, '')
}

function isFundLike(type: string | null | undefined): boolean {
  return type === 'fund' || type === 'etf'
}

function defaultGroupIdForType(groups: UnifiedWatchGroup[], type: string | null | undefined): string {
  return groups.find((group) => group.type === type)?.id ?? groups[0]?.id ?? DEFAULT_STOCK_GROUP_ID
}

function ensureGroup(data: UnifiedWatchlistData, id: string, name: string, type: string): string {
  const existing = data.groups.find((group) => group.id === id) ?? data.groups.find((group) => group.type === type)
  if (existing) return existing.id
  data.groups.push({ id, name, type })
  return id
}

function cloneUnifiedWatchlist(data: UnifiedWatchlistData): UnifiedWatchlistData {
  return {
    groups: data.groups.map((group) => ({ ...group })),
    items: data.items.map((item) => ({ ...item, tags: [...item.tags] })),
  }
}

function fundWatchId(): string {
  return `fund-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}
