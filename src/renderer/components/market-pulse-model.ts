import type { SnapshotLeaderItem } from '../../agent/data/market-snapshot'

export type ProductSurfaceState = 'loading' | 'empty' | 'error' | 'cached'

export interface HotStockItem {
  code: string
  name: string
  rank: number
  rankChange: number | null
  hotValue: number | null
  price: number | null
  changePct: number | null
  source?: string | null
  timestamp?: string | null
  fetchedAt?: string | null
  cacheStatus?: string | null
}

export interface SnapshotData {
  timestamp: string
  regime: string
  regimeReason: string
  limitUpCount: number
  limitDownCount: number
  sectorLeaders: SnapshotLeaderItem[]
  nonSectorMovers?: SnapshotLeaderItem[]
  failedSources?: string[]
  hotStocks: HotStockItem[]
}

export interface MarketPulseStateSummary {
  state: ProductSurfaceState
  hasCachedRows: boolean
  hasPartialFailure: boolean
  rowCount: number
}

export interface MarketPulseDataQuality {
  status: 'complete' | 'partial'
  failedSourceCount: number
  failedSources: string[]
  label: string
  detail: string | null
}

export function classifyMarketPulseState(input: {
  loading: boolean
  snapshot: SnapshotData | null
  error?: string | null
}): MarketPulseStateSummary {
  if (input.loading) {
    return { state: 'loading', hasCachedRows: false, hasPartialFailure: false, rowCount: 0 }
  }
  if (input.error && !input.snapshot) {
    return { state: 'error', hasCachedRows: false, hasPartialFailure: true, rowCount: 0 }
  }
  if (!input.snapshot) {
    return { state: 'empty', hasCachedRows: false, hasPartialFailure: false, rowCount: 0 }
  }
  const rowCount =
    input.snapshot.hotStocks.length +
    input.snapshot.sectorLeaders.length +
    (input.snapshot.nonSectorMovers?.length ?? 0)
  return {
    state: rowCount > 0 ? 'cached' : 'empty',
    hasCachedRows: rowCount > 0,
    hasPartialFailure: (input.snapshot.failedSources?.length ?? 0) > 0,
    rowCount,
  }
}

export function buildMarketPulseDataQuality(snapshot: SnapshotData): MarketPulseDataQuality {
  const failedSources = (snapshot.failedSources ?? [])
    .map((source) => source.trim())
    .filter((source) => source.length > 0)
  if (failedSources.length === 0) {
    return {
      status: 'complete',
      failedSourceCount: 0,
      failedSources: [],
      label: 'complete',
      detail: null,
    }
  }
  return {
    status: 'partial',
    failedSourceCount: failedSources.length,
    failedSources,
    label: `partial-data:${failedSources.length}`,
    detail: failedSources.join('\n'),
  }
}
