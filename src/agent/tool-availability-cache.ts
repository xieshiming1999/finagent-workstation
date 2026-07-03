/**
 * TTL-cached tool availability checks.
 * Caches the result of expensive check functions (e.g., probing Docker,
 * checking binary existence) for a configurable TTL.
 *
 * Reference: hermes-agent/tools/registry.py _check_fn_cached
 */

interface CachedCheck {
  result: boolean
  timestamp: number
}

const DEFAULT_TTL_MS = 30_000 // 30 seconds

export class ToolAvailabilityCache {
  private cache = new Map<string, CachedCheck>()
  private ttlMs: number

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs
  }

  /**
   * Check if a tool is available, using cache if fresh.
   * @param toolName Tool name as cache key
   * @param checkFn Function that probes availability (may be slow)
   */
  async check(toolName: string, checkFn: () => Promise<boolean>): Promise<boolean> {
    const cached = this.cache.get(toolName)
    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      return cached.result
    }

    try {
      const result = await checkFn()
      this.cache.set(toolName, { result, timestamp: Date.now() })
      return result
    } catch {
      this.cache.set(toolName, { result: false, timestamp: Date.now() })
      return false
    }
  }

  /** Invalidate a specific tool's cache */
  invalidate(toolName: string): void {
    this.cache.delete(toolName)
  }

  /** Clear all cached results */
  clear(): void {
    this.cache.clear()
  }
}

/** Global tool availability cache */
export const globalToolAvailabilityCache = new ToolAvailabilityCache()
