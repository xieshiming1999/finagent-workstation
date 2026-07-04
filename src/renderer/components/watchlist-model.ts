export type StockWatchlistSurfaceState = 'loading' | 'empty' | 'error' | 'cached'

export interface WatchGroup {
  id: string
  name: string
  type?: string
}

export interface StoredWatchItem {
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

export interface WatchlistData {
  groups: WatchGroup[]
  items: StoredWatchItem[]
}

export interface WatchItem {
  id: string
  code: string
  name: string
  price: number
  changePct: number
  change: number
  high: number
  low: number
  volume: number
  pe: number | null
  turnoverRate: number | null
  source?: string | null
  timestamp?: string | null
  fetchedAt?: string | null
  cacheStatus?: string | null
}

export interface StockWatchlistStateSummary {
  state: StockWatchlistSurfaceState
  rowCount: number
  savedCount: number
  hasFallbackRows: boolean
  hasQuoteError: boolean
}

export function visibleStockItems(data: WatchlistData): StoredWatchItem[] {
  return data.items.filter((item) => item.type === 'stock' && item.status !== 'exited')
}

export function buildFallbackStockItems(items: StoredWatchItem[]): WatchItem[] {
  return items.map(buildFallbackStockItem)
}

export function buildFallbackStockItem(item: StoredWatchItem): WatchItem {
  return {
    id: item.id,
    code: item.symbol,
    name: item.name || item.symbol,
    price: 0,
    changePct: 0,
    change: 0,
    high: 0,
    low: 0,
    volume: 0,
    pe: null,
    turnoverRate: null,
  }
}

export function classifyStockWatchlistState(input: {
  loading: boolean
  error?: string | null
  rows: WatchItem[]
  savedItems: StoredWatchItem[]
}): StockWatchlistStateSummary {
  const savedCount = input.savedItems.length
  if (input.loading) {
    return {
      state: 'loading',
      rowCount: input.rows.length,
      savedCount,
      hasFallbackRows: input.rows.some((row) => row.price === 0 && row.volume === 0),
      hasQuoteError: Boolean(input.error),
    }
  }
  if (input.error && input.rows.length === 0) {
    return { state: 'error', rowCount: 0, savedCount, hasFallbackRows: false, hasQuoteError: true }
  }
  if (input.rows.length === 0) {
    return { state: 'empty', rowCount: 0, savedCount, hasFallbackRows: false, hasQuoteError: Boolean(input.error) }
  }
  return {
    state: 'cached',
    rowCount: input.rows.length,
    savedCount,
    hasFallbackRows: input.rows.some((row) => row.price === 0 && row.volume === 0),
    hasQuoteError: Boolean(input.error),
  }
}
