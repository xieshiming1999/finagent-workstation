import {
  LEGACY_FUND_WATCHLIST_PATH,
  UNIFIED_WATCHLIST_PATH,
  emptyUnifiedWatchlist,
  mergeLegacyFundWatchlist,
  normalizeUnifiedWatchlist,
  upsertFundInUnified,
  type FundWatchlistData,
  type UnifiedWatchlistData,
} from './fund-watchlist-model'

interface StockWatchGroup {
  id: string
  name: string
  type?: string
}

interface StockWatchItem {
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

interface StockWatchlistData {
  groups: StockWatchGroup[]
  items: StockWatchItem[]
}

const WATCHLIST_PATH = UNIFIED_WATCHLIST_PATH
const DEFAULT_GROUP_ID = 'default'

export async function addStockToWatchlist(code: string, name: string, defaultGroupName: string): Promise<'added' | 'exists'> {
  const cleanCode = code.trim().replace(/\.(SH|SZ|BJ)$/i, '')
  if (!cleanCode) return 'exists'
  const data = await readStockWatchlist(defaultGroupName)
  if (data.items.some((item) => item.symbol === cleanCode && item.status !== 'exited')) return 'exists'
  const groupId = data.groups.find((group) => group.id === DEFAULT_GROUP_ID)?.id ?? data.groups[0]?.id ?? DEFAULT_GROUP_ID
  data.items.push({
    id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    groupId,
    symbol: cleanCode,
    name,
    type: 'stock',
    status: 'watching',
    source: 'pulse',
    tags: [],
    priceAtAdd: 0,
    addedAt: new Date().toISOString(),
  })
  await writeFile(WATCHLIST_PATH, data)
  window.dispatchEvent(new CustomEvent('watchlist:stock-updated'))
  return 'added'
}

export async function addFundToWatchlist(code: string, name: string): Promise<'added' | 'exists'> {
  const cleanCode = code.trim().replace(/\.\w+$/i, '')
  if (!cleanCode) return 'exists'
  const data = await readUnifiedWatchlist()
  const { data: next, status } = upsertFundInUnified(data, { code: cleanCode, name }, 'Fund Watchlist', 'pulse')
  if (status === 'exists') return 'exists'
  await writeFile(WATCHLIST_PATH, next)
  window.dispatchEvent(new CustomEvent('watchlist:fund-updated'))
  return status
}

async function readStockWatchlist(defaultGroupName: string): Promise<StockWatchlistData> {
  try {
    const result = await window.agent?.bridgeMessage({ id: 'pulse-stock-watchlist-load', type: 'readFile', path: WATCHLIST_PATH }) as any
    if (result?.content) {
      const parsed = JSON.parse(result.content)
      if (Array.isArray(parsed?.groups) && Array.isArray(parsed?.items)) return parsed
    }
  } catch {
    // use default
  }
  return {
    groups: [{ id: DEFAULT_GROUP_ID, name: defaultGroupName, type: 'stock' }],
    items: [],
  }
}

async function readUnifiedWatchlist(): Promise<UnifiedWatchlistData> {
  let data = emptyUnifiedWatchlist()
  try {
    const result = await window.agent?.bridgeMessage({ id: 'pulse-watchlist-load', type: 'readFile', path: WATCHLIST_PATH }) as any
    if (result?.content) {
      const parsed = JSON.parse(result.content)
      data = normalizeUnifiedWatchlist(parsed)
    }
  } catch {
    // keep default
  }
  const legacy = await readLegacyFundWatchlist()
  return mergeLegacyFundWatchlist(data, legacy).data
}

async function readLegacyFundWatchlist(): Promise<FundWatchlistData> {
  try {
    const result = await window.agent?.bridgeMessage({ id: 'pulse-fund-watchlist-legacy-load', type: 'readFile', path: LEGACY_FUND_WATCHLIST_PATH }) as any
    if (result?.content) {
      const parsed = JSON.parse(result.content)
      if (Array.isArray(parsed?.items)) return parsed
    }
  } catch {
    // no legacy file
  }
  return { items: [] }
}

async function writeFile(path: string, data: unknown): Promise<void> {
  await window.agent?.bridgeMessage({
    id: `pulse-watchlist-save-${Date.now()}`,
    type: 'writeFile',
    path,
    content: JSON.stringify(data, null, 2),
  })
}
