export type DataApiCacheMode = 'cache-first' | 'live-only' | 'cache-only'

export interface CacheReuseDecision {
  reusable: boolean
  reason: string
}

export interface RequirementCacheReadDecision {
  readCache: boolean
  mode: DataApiCacheMode
  reason: string
}

export interface QuoteCacheReuseInput {
  sourceTimestamp?: string | null
  maxAgeMs: number
  nowMs?: number
}

export interface KlineCacheReuseInput {
  rowCount: number
  minRows: number
  earliestDate?: string | null
  latestDate?: string | null
  start?: string
  end?: string
}

export interface RowCountCacheReuseInput {
  rowCount: number
  minRows: number
  label: string
}

export function shouldReadRequirementCache(opts: {
  cacheMode?: DataApiCacheMode
  provider?: unknown
  providerMode?: string
}): boolean {
  return decideRequirementCacheRead(opts).readCache
}

export function decideRequirementCacheRead(opts: {
  cacheMode?: DataApiCacheMode
  provider?: unknown
  providerMode?: string
}): RequirementCacheReadDecision {
  const mode = opts.cacheMode ?? 'cache-first'
  if (mode === 'live-only') {
    return { readCache: false, mode, reason: 'live-only bypasses reusable local data' }
  }
  return { readCache: true, mode, reason: `${mode} reads reusable local data before provider routing` }
}

export function shouldReuseQuoteCache(input: QuoteCacheReuseInput): CacheReuseDecision {
  if (!input.sourceTimestamp) return { reusable: false, reason: 'missing source quote timestamp' }
  const sourceMs = Date.parse(input.sourceTimestamp)
  if (!Number.isFinite(sourceMs)) return { reusable: false, reason: `invalid source quote timestamp: ${input.sourceTimestamp}` }
  const nowMs = input.nowMs ?? Date.now()
  if (sourceMs > nowMs + 60_000) return { reusable: false, reason: 'source quote timestamp is in the future' }
  const ageMs = nowMs - sourceMs
  if (ageMs > input.maxAgeMs) return { reusable: false, reason: `source quote timestamp is stale by ${ageMs}ms` }
  return { reusable: true, reason: 'source quote timestamp is fresh' }
}

export function shouldReuseKlineCache(input: KlineCacheReuseInput): CacheReuseDecision {
  if (input.rowCount < input.minRows) return { reusable: false, reason: `only ${input.rowCount}/${input.minRows} required K-line rows` }
  if (input.start && (!input.earliestDate || input.earliestDate > input.start)) {
    return { reusable: false, reason: `K-line cache starts at ${input.earliestDate ?? 'none'}, after requested ${input.start}` }
  }
  if (input.end && (!input.latestDate || input.latestDate < input.end)) {
    return { reusable: false, reason: `K-line cache ends at ${input.latestDate ?? 'none'}, before requested ${input.end}` }
  }
  return { reusable: true, reason: 'K-line date coverage satisfies request' }
}

export function shouldReuseRowCountCache(input: RowCountCacheReuseInput): CacheReuseDecision {
  if (input.rowCount < input.minRows) {
    return { reusable: false, reason: `only ${input.rowCount}/${input.minRows} required ${input.label} rows` }
  }
  return { reusable: true, reason: `${input.label} row count satisfies request` }
}
