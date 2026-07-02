export interface FetchProvenance {
  interfaceId?: string
  capabilityId?: string
  provider?: string
  source?: string
  cachedProvider?: string
  cachedSource?: string
  cachedCapabilityId?: string
  endpoint?: string
  canonicalSchema?: string
  canonicalTable?: string
  cacheStatus?: 'cache-hit' | 'provider-hit' | 'output-only'
  cacheMode?: 'cache-first' | 'live-only' | 'cache-only'
  cacheDecision?: string
  providerMode?: 'auto' | 'preferred' | 'strict'
  requestedProvider?: string
  allowFallback?: boolean
  asOf?: string
  fetchedAt?: string
  quality?: string
}

export interface FetchResult<T> {
  data: T[]
  source: string
  fetchedAt: string
  provenance?: FetchProvenance
}

export interface FetchProgress {
  fetched: number
  total: number
  lastDate?: string
  message?: string
}

export type DataSource = 'akshare' | 'yfinance' | 'tdx' | 'tradingview' | 'cache'
