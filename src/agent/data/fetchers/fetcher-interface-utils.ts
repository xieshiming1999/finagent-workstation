import type { FetchProvenance, FetchResult } from './base-fetcher'
import type { FinanceProvider } from '../provider-policy'
import {
  normalizeDataApiProvider,
  type DataApiProviderConstraint,
  type DataApiProviderMode,
} from '../data-api-interface-contract'

export interface DataApiFetchOptions {
  providers?: FinanceProvider[]
  provider?: FinanceProvider | string
  providerMode?: DataApiProviderMode
  interfaceId?: string
  cacheMode?: 'cache-first' | 'live-only' | 'cache-only'
  allowFallback?: boolean
  allowDegraded?: boolean
  skipCache?: boolean
  forceLive?: boolean
}

export function cacheModeFromFetchOptions(
  opts: DataApiFetchOptions = {},
): 'cache-first' | 'live-only' | 'cache-only' {
  return opts.skipCache ? 'live-only' : (opts.cacheMode ?? 'cache-first')
}

export function providerConstraintFromFetchOptions(
  opts: DataApiFetchOptions = {},
): DataApiProviderConstraint {
  const explicit = normalizeDataApiProvider(opts.provider)
  if (explicit) {
    return {
      provider: explicit,
      providerMode: opts.providerMode ?? 'strict',
      allowFallback: opts.allowFallback,
      allowDegraded: opts.allowDegraded,
    }
  }
  const legacyPreferred = opts.providers?.map((provider) => normalizeDataApiProvider(provider)).find(Boolean)
  const preferred = legacyPreferred
  if (!preferred) {
    return {
      allowFallback: opts.allowFallback,
      allowDegraded: opts.allowDegraded,
    }
  }
  return {
    provider: preferred,
    providerMode: opts.providerMode ?? 'preferred',
    allowFallback: opts.allowFallback,
    allowDegraded: opts.allowDegraded,
  }
}

export function strictCacheSourceFromFetchOptions(
  opts: DataApiFetchOptions = {},
): string | undefined {
  const provider = normalizeDataApiProvider(opts.provider)
  if (!provider || (opts.providerMode ?? 'strict') !== 'strict') return undefined
  return cacheSourceForProvider(provider)
}

export function cacheSourceForProvider(provider: string): string {
  if (provider === 'yahoo') return 'yfinance'
  if (provider === 'eastmoney') return 'eastmoney'
  return provider
}

export function withInterfaceProvenance<T>(
  result: FetchResult<T>,
  provenance: Omit<FetchProvenance, 'source' | 'fetchedAt'>,
): FetchResult<T> {
  return {
    ...result,
    provenance: {
      ...provenance,
      source: result.source,
      cacheStatus: provenance.cacheStatus ?? 'provider-hit',
      cacheMode: provenance.cacheMode,
      cacheDecision: provenance.cacheDecision,
      fetchedAt: result.fetchedAt,
    },
  }
}
