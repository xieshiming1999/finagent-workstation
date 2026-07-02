export class RateLimiter {
  private lastCall = 0
  private minInterval: number
  private maxJitter: number

  constructor(minIntervalMs = 2000, maxJitterMs = 1000) {
    this.minInterval = minIntervalMs
    this.maxJitter = maxJitterMs
  }

  async wait(): Promise<void> {
    const now = Date.now()
    const elapsed = now - this.lastCall
    const needed = this.minInterval + Math.random() * this.maxJitter
    if (elapsed < needed) {
      await new Promise((r) => setTimeout(r, needed - elapsed))
    }
    this.lastCall = Date.now()
  }
}

type CircuitState = 'closed' | 'open' | 'half-open'

export class CircuitBreaker {
  private states: Map<string, { state: CircuitState; failures: number; openedAt: number }> = new Map()
  private failureThreshold: number
  private cooldownMs: number

  constructor(failureThreshold = 3, cooldownMs = 300_000) {
    this.failureThreshold = failureThreshold
    this.cooldownMs = cooldownMs
  }

  isOpen(name: string): boolean {
    const entry = this.states.get(name)
    if (!entry || entry.state === 'closed') return false
    if (entry.state === 'open' && Date.now() - entry.openedAt > this.cooldownMs) {
      entry.state = 'half-open'
      return false
    }
    return entry.state === 'open'
  }

  recordSuccess(name: string): void {
    this.states.set(name, { state: 'closed', failures: 0, openedAt: 0 })
  }

  recordFailure(name: string): void {
    const entry = this.states.get(name) ?? { state: 'closed' as CircuitState, failures: 0, openedAt: 0 }
    entry.failures++
    if (entry.failures >= this.failureThreshold) {
      entry.state = 'open'
      entry.openedAt = Date.now()
    }
    this.states.set(name, entry)
  }

  getStatus(): Record<string, { state: string; failures: number }> {
    const result: Record<string, { state: string; failures: number }> = {}
    for (const [name, entry] of this.states) {
      result[name] = { state: entry.state, failures: entry.failures }
    }
    return result
  }
}

export async function fetchWithRetry(
  url: string,
  opts: RequestInit = {},
  maxRetries = 3,
  timeoutMs = 15_000,
): Promise<Response> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal })
      clearTimeout(timer)
      if (res.ok || (res.status < 500 && res.status !== 429)) return res
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt + 1) * 1000))
      }
      lastError = new Error(`HTTP ${res.status}`)
    } catch (err) {
      clearTimeout(timer)
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt + 1) * 1000))
      }
    }
  }
  throw lastError ?? new Error('Request failed')
}

export interface ApiCallRecord {
  source: string
  url: string
  status: number
  durationMs: number
  success: boolean
  error?: string
  timestamp: string
  tool?: string
  action?: string
}

export class ApiStats {
  private records: ApiCallRecord[] = []
  private maxRecords = 1000
  private sink: ((entry: ApiCallRecord) => void) | null = null

  setSink(sink: ((entry: ApiCallRecord) => void) | null): void {
    this.sink = sink
  }

  record(entry: ApiCallRecord): void {
    this.records.push(entry)
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords)
    }
    if (this.sink) {
      try { this.sink(entry) } catch { /* stats persistence must not break tool calls */ }
    }
  }

  getSummary(): Record<string, { total: number; success: number; failRate: number; avgLatency: number }> {
    const bySource: Record<string, ApiCallRecord[]> = {}
    for (const r of this.records) {
      (bySource[r.source] ??= []).push(r)
    }
    const result: Record<string, { total: number; success: number; failRate: number; avgLatency: number }> = {}
    for (const [source, recs] of Object.entries(bySource)) {
      const successes = recs.filter((r) => r.success).length
      const avgLatency = recs.reduce((s, r) => s + r.durationMs, 0) / recs.length
      result[source] = {
        total: recs.length,
        success: successes,
        failRate: ((recs.length - successes) / recs.length) * 100,
        avgLatency: Math.round(avgLatency),
      }
    }
    return result
  }

  getRecent(minutes = 30): ApiCallRecord[] {
    const cutoff = Date.now() - minutes * 60_000
    return this.records.filter((r) => new Date(r.timestamp).getTime() > cutoff)
  }
}

export const globalRateLimiter = new RateLimiter(2000, 1000)
export const globalCircuitBreaker = new CircuitBreaker(3, 300_000)
export const globalApiStats = new ApiStats()
