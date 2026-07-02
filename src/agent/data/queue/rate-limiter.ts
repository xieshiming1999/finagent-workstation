const DEFAULT_MIN_INTERVAL = 2500
const DEFAULT_MAX_JITTER = 1000

interface SourceConfig {
  minIntervalMs: number
  maxJitterMs: number
  maxConcurrent: number
  lastCallTime: number
  activeCount: number
}

const sources = new Map<string, SourceConfig>()

function getSourceConfig(source: string): SourceConfig {
  let config = sources.get(source)
  if (!config) {
    config = {
      minIntervalMs: DEFAULT_MIN_INTERVAL,
      maxJitterMs: DEFAULT_MAX_JITTER,
      maxConcurrent: 1,
      lastCallTime: 0,
      activeCount: 0,
    }
    sources.set(source, config)
  }
  return config
}

export function configureSource(source: string, opts: { minIntervalMs?: number; maxJitterMs?: number; maxConcurrent?: number }): void {
  const config = getSourceConfig(source)
  if (opts.minIntervalMs !== undefined) config.minIntervalMs = opts.minIntervalMs
  if (opts.maxJitterMs !== undefined) config.maxJitterMs = opts.maxJitterMs
  if (opts.maxConcurrent !== undefined) config.maxConcurrent = opts.maxConcurrent
}

export async function rateLimitedFetch<T>(source: string, fn: () => Promise<T>): Promise<T> {
  const config = getSourceConfig(source)

  // Wait for concurrent slot
  while (config.activeCount >= config.maxConcurrent) {
    await sleep(200)
  }

  // Wait for rate limit
  const elapsed = Date.now() - config.lastCallTime
  const required = config.minIntervalMs + Math.random() * config.maxJitterMs
  if (elapsed < required) {
    await sleep(required - elapsed)
  }

  config.activeCount++
  config.lastCallTime = Date.now()
  try {
    const result = await fn()
    // Successful call — gradually recover interval if it was elevated
    if (config.minIntervalMs > getSourceConfig(source).minIntervalMs * 2) {
      config.minIntervalMs = Math.max(config.minIntervalMs * 0.9, DEFAULT_MIN_INTERVAL)
    }
    return result
  } catch (e) {
    // Check for 429 or rate-limit error — dynamically increase interval
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many')) {
      config.minIntervalMs = Math.min(config.minIntervalMs * 2, 30000) // double interval, max 30s
      console.log(`[RateLimiter] ${source} rate limited, increasing interval to ${config.minIntervalMs}ms`)
    }
    throw e
  } finally {
    config.activeCount--
  }
}

export function getSourceStatus(): Array<{ source: string; minInterval: number; active: number; lastCall: number; status: 'online' | 'degraded' | 'offline'; errorCount: number }> {
  const result: Array<{ source: string; minInterval: number; active: number; lastCall: number; status: 'online' | 'degraded' | 'offline'; errorCount: number }> = []
  for (const [source, config] of sources) {
    const defaultInterval = ({ akshare: 1000, yfinance: 1500, tdx: 500 } as Record<string, number>)[source] ?? DEFAULT_MIN_INTERVAL
    const elevated = config.minIntervalMs > defaultInterval * 1.5
    const status = config.minIntervalMs >= 15000 ? 'offline' : elevated ? 'degraded' : 'online'
    result.push({
      source,
      minInterval: config.minIntervalMs,
      active: config.activeCount,
      lastCall: config.lastCallTime,
      status,
      errorCount: elevated ? Math.round(Math.log2(config.minIntervalMs / defaultInterval)) : 0,
    })
  }
  return result
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Pre-configure known sources
configureSource('akshare', { minIntervalMs: 1000, maxJitterMs: 500, maxConcurrent: 3 })
configureSource('yfinance', { minIntervalMs: 1500, maxJitterMs: 500, maxConcurrent: 2 })
configureSource('tdx', { minIntervalMs: 500, maxJitterMs: 200, maxConcurrent: 2 })
