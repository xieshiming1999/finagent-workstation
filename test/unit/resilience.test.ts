import { describe, it, expect, beforeEach } from 'vitest'
import { RateLimiter, CircuitBreaker, ApiStats } from '../../src/agent/data/resilience'

describe('RateLimiter', () => {
  it('enforces minimum interval', async () => {
    const limiter = new RateLimiter(50, 0)
    const start = Date.now()
    await limiter.wait()
    await limiter.wait()
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(45)
  })
})

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker

  beforeEach(() => {
    cb = new CircuitBreaker(3, 100)
  })

  it('starts closed', () => {
    expect(cb.isOpen('test')).toBe(false)
  })

  it('opens after threshold failures', () => {
    cb.recordFailure('test')
    cb.recordFailure('test')
    expect(cb.isOpen('test')).toBe(false)
    cb.recordFailure('test')
    expect(cb.isOpen('test')).toBe(true)
  })

  it('resets on success', () => {
    cb.recordFailure('test')
    cb.recordFailure('test')
    cb.recordSuccess('test')
    cb.recordFailure('test')
    expect(cb.isOpen('test')).toBe(false)
  })

  it('transitions to half-open after cooldown', async () => {
    cb.recordFailure('test')
    cb.recordFailure('test')
    cb.recordFailure('test')
    expect(cb.isOpen('test')).toBe(true)
    await new Promise((r) => setTimeout(r, 120))
    expect(cb.isOpen('test')).toBe(false)
  })
})

describe('ApiStats', () => {
  it('records and summarizes', () => {
    const stats = new ApiStats()
    stats.record({ source: 'eastmoney', url: 'http://test', status: 200, durationMs: 100, success: true, timestamp: new Date().toISOString() })
    stats.record({ source: 'eastmoney', url: 'http://test', status: 500, durationMs: 200, success: false, error: 'timeout', timestamp: new Date().toISOString() })
    const summary = stats.getSummary()
    expect(summary.eastmoney.total).toBe(2)
    expect(summary.eastmoney.success).toBe(1)
    expect(summary.eastmoney.failRate).toBe(50)
  })
})
