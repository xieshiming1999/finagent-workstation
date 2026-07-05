import { describe, expect, it } from 'vitest'
import {
  decideRequirementCacheRead,
  shouldReadRequirementCache,
  shouldReuseKlineCache,
  shouldReuseQuoteCache,
  shouldReuseRowCountCache,
} from '../../src/agent/data/data-api-cache-policy'

describe('data API cache reuse policy', () => {
  it('uses source quote timestamp, not ingest timestamp', () => {
    const now = Date.parse('2026-06-17T10:00:00.000Z')
    expect(shouldReuseQuoteCache({
      sourceTimestamp: '2026-06-17T09:59:45.000Z',
      maxAgeMs: 30_000,
      nowMs: now,
    })).toMatchObject({ reusable: true })

    expect(shouldReuseQuoteCache({
      sourceTimestamp: '2026-06-17T09:00:00.000Z',
      maxAgeMs: 30_000,
      nowMs: now,
    })).toMatchObject({ reusable: false })
  })

  it('uses K-line date coverage for requested windows', () => {
    expect(shouldReuseKlineCache({
      rowCount: 10,
      minRows: 10,
      earliestDate: '2026-06-01',
      latestDate: '2026-06-12',
      start: '2026-06-01',
      end: '2026-06-12',
    })).toMatchObject({ reusable: true })

    expect(shouldReuseKlineCache({
      rowCount: 10,
      minRows: 10,
      earliestDate: '2026-06-01',
      latestDate: '2026-06-10',
      start: '2026-06-01',
      end: '2026-06-12',
    })).toMatchObject({ reusable: false })
  })

  it('keeps provider constraints separate from cache bypass policy', () => {
    expect(shouldReadRequirementCache({ cacheMode: 'cache-first' })).toBe(true)
    expect(shouldReadRequirementCache({ cacheMode: 'live-only' })).toBe(false)
    expect(shouldReadRequirementCache({ provider: 'tdx', providerMode: 'strict' })).toBe(true)
    expect(shouldReadRequirementCache({ provider: 'tdx', providerMode: 'preferred' })).toBe(true)
    expect(decideRequirementCacheRead({ cacheMode: 'live-only' })).toMatchObject({
      readCache: false,
      mode: 'live-only',
      reason: expect.stringContaining('bypasses'),
    })
    expect(decideRequirementCacheRead({ provider: 'tdx', providerMode: 'strict' })).toMatchObject({
      readCache: true,
      mode: 'cache-first',
      reason: expect.stringContaining('cache-first reads reusable local data before provider routing'),
    })
  })

  it('uses row-count thresholds for reusable identity datasets', () => {
    expect(shouldReuseRowCountCache({
      rowCount: 100,
      minRows: 100,
      label: 'stock identity',
    })).toMatchObject({ reusable: true })

    expect(shouldReuseRowCountCache({
      rowCount: 99,
      minRows: 100,
      label: 'stock identity',
    })).toMatchObject({ reusable: false })
  })
})
