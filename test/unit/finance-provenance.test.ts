import { describe, expect, it } from 'vitest'
import { formatFinanceProvenance } from '../../src/renderer/components/finance-provenance'

const labels = {
  source: 'src',
  asOf: 'as of',
  fetched: 'fetched',
  updated: 'updated',
  cache: 'cache',
  fresh: 'fresh',
}

describe('finance provenance formatter', () => {
  it('formats source, provider time, fetched time, and cache status compactly', () => {
    expect(formatFinanceProvenance({
      source: 'tdx',
      timestamp: '2026-06-16T09:31:10',
      fetchedAt: '2026-06-16T09:31:12',
      cacheStatus: 'cache',
    }, labels)).toBe('src: tdx · as of: 2026-06-16 09:31')
  })

  it('uses updated time when fetched time is not available', () => {
    expect(formatFinanceProvenance({
      source: 'fund_list',
      nav_date: '2026-06-13',
      updated_at: '2026-06-16T15:30:00',
      cache_status: 'cached',
    }, labels)).toBe('src: fund_list · as of: 2026-06-13')
  })
})
