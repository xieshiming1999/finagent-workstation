import { describe, expect, it } from 'vitest'
import { getReusableDataSummary } from '../../src/agent/data/store/data-store-reuse'

class FakeStore {
  query<T = unknown>(sql: string): T[] {
    if (sql === 'PRAGMA table_info(quote_snapshot)') {
      return [{ name: 'source' }, { name: 'timestamp' }] as T[]
    }
    if (sql === 'PRAGMA table_info(kline_daily)') {
      return [{ name: 'source' }, { name: 'date' }] as T[]
    }
    if (sql === 'PRAGMA table_info(api_result_cache)') {
      return [{ name: 'created_at' }] as T[]
    }
    if (sql.includes('FROM quote_snapshot') && sql.includes('GROUP BY')) {
      return [
        { source: 'tdx', cnt: 12 },
        { source: 'sina', cnt: 3 },
      ] as T[]
    }
    if (sql.includes('FROM kline_daily') && sql.includes('GROUP BY')) {
      return [{ source: 'tdx', cnt: 8 }] as T[]
    }
    return []
  }

  one(sql: string): Record<string, unknown> | null {
    if (sql.includes('FROM quote_snapshot')) return { cnt: 15, latest: '2026-06-16T09:30:00' }
    if (sql.includes('FROM kline_daily')) return { cnt: 8, latest: '2026-06-15' }
    if (sql.includes('FROM api_result_cache')) return { cnt: 2, latest: '2026-06-16T09:00:00' }
    return { cnt: 0, latest: null }
  }

  exec(): void {}
}

describe('reusable data summary provenance', () => {
  it('adds source breakdown only for reusable tables that expose a source column', () => {
    const rows = getReusableDataSummary(new FakeStore())

    expect(rows.find((row) => row.name === 'quote_snapshot')).toMatchObject({
      count: 15,
      latest: '2026-06-16T09:30:00',
      sources: 'tdx:12, sina:3',
    })
    expect(rows.find((row) => row.name === 'kline_daily')).toMatchObject({
      count: 8,
      latest: '2026-06-15',
      sources: 'tdx:8',
    })
    expect(rows.find((row) => row.name === 'api_result_cache')?.sources).toBeNull()
  })
})
