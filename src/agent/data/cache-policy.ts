import type { FinanceDataTask } from './provider-policy'

export type CachePolicyMode = 'cache-first' | 'refresh-if-stale' | 'live-only' | 'cache-only'

export interface CachePolicy {
  mode: CachePolicyMode
  maxAgeMs?: number
  minRows?: number
  maxBarAgeDays?: number
}

const DEFAULT_POLICIES: Partial<Record<FinanceDataTask, CachePolicy>> = {
  quote: { mode: 'cache-first', maxAgeMs: 15_000 },
  kline: { mode: 'cache-first', minRows: 10, maxBarAgeDays: 7 },
  indexKline: { mode: 'cache-first', minRows: 10, maxBarAgeDays: 7 },
  fund: { mode: 'refresh-if-stale', maxAgeMs: 24 * 60 * 60 * 1000 },
}

export function cachePolicyFor(task: FinanceDataTask, override: Partial<CachePolicy> = {}): CachePolicy {
  return { mode: 'cache-first', ...(DEFAULT_POLICIES[task] ?? {}), ...override }
}

export function shouldReadCache(policy: CachePolicy): boolean {
  return policy.mode !== 'live-only'
}

export function shouldFetchAfterMiss(policy: CachePolicy): boolean {
  return policy.mode !== 'cache-only'
}
