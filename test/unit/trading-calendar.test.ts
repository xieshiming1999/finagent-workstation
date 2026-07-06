import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import {
  latestTradingDay,
  loadCalendar,
  refreshCalendarFromDataApi,
  type TradingCalendar,
} from '../../src/main/trading-calendar'
import type { DataStore } from '../../src/agent/data/store/data-store'

const baseCalendar: TradingCalendar = {
  version: 1,
  dataYear: 2026,
  lastFetched: null,
  tradingDayCount: 0,
  tradingDays: [],
  overrides: {},
}

describe('trading calendar helpers', () => {
  it('uses the latest configured trading day at or before today', () => {
    const calendar = {
      ...baseCalendar,
      tradingDays: ['2026-06-01', '2026-06-02', '2026-06-04'],
    }

    expect(latestTradingDay(calendar, new Date(2026, 5, 3, 12))).toBe('2026-06-02')
  })

  it('falls back to previous weekday when no calendar is configured', () => {
    expect(latestTradingDay(baseCalendar, new Date(2026, 5, 7, 12))).toBe('2026-06-05')
  })

  it('refreshes through data API, persists rows, then updates calendar from canonical readback', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'trading-calendar-'))
    const savedRows: Array<Record<string, unknown>> = []
    const store = {
      isReady: true,
      saveCalendar: vi.fn((rows: Array<Record<string, unknown>>) => {
        savedRows.splice(0, savedRows.length, ...rows)
      }),
      queryCalendar: vi.fn(() => savedRows),
    } as unknown as DataStore
    const fetcher = vi.fn(async () => ({
      data: [
        { date: '2026-01-02', market: 'CN', is_trading_day: 1, year: 2026, month: 1 },
        { date: '2026-01-03', market: 'CN', is_trading_day: 0, year: 2026, month: 1 },
        { date: '2026-01-05', market: 'CN', is_trading_day: 1, year: 2026, month: 1 },
      ],
      source: 'szse',
      fetchedAt: '2026-06-17T00:00:00.000Z',
    }))

    try {
      const calendar = await refreshCalendarFromDataApi(basePath, store, 2026, fetcher)

      expect(fetcher).toHaveBeenCalledWith(2026, 'CN', {
        provider: 'szse',
        providerMode: 'strict',
        allowFallback: false,
        cacheMode: 'live-only',
      })
      expect(store.saveCalendar).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ date: '2026-01-02', market: 'CN' }),
      ]))
      expect(store.queryCalendar).toHaveBeenCalledWith({
        market: 'CN',
        start: '2026-01-01',
        end: '2026-12-31',
        limit: 400,
      })
      expect(calendar?.tradingDays).toEqual(['2026-01-02', '2026-01-05'])
      expect(loadCalendar(basePath).tradingDays).toEqual(['2026-01-02', '2026-01-05'])
    } finally {
      rmSync(basePath, { recursive: true, force: true })
    }
  })
})
