import { describe, expect, it } from 'vitest'
import {
  buildMarketPulseDataQuality,
  classifyMarketPulseState,
  type SnapshotData,
} from '../../src/renderer/components/market-pulse-model'
import {
  buildFallbackStockItems,
  classifyStockWatchlistState,
  visibleStockItems,
  type WatchlistData,
} from '../../src/renderer/components/watchlist-model'
import {
  buildPortfolioSummary,
  classifyPortfolioState,
} from '../../src/renderer/components/portfolio-model'

describe('OARI product surface state models', () => {
  it('classifies Stock Market Pulse loading, empty, error, and cached states', () => {
    expect(classifyMarketPulseState({ loading: true, snapshot: null }).state).toBe('loading')
    expect(classifyMarketPulseState({ loading: false, snapshot: null }).state).toBe('empty')
    expect(classifyMarketPulseState({ loading: false, snapshot: null, error: 'read failed' }).state).toBe('error')

    const snapshot: SnapshotData = {
      timestamp: '2026-06-17T09:30:00.000Z',
      regime: 'neutral',
      regimeReason: 'mixed breadth',
      limitUpCount: 10,
      limitDownCount: 2,
      failedSources: ['eastmoney'],
      sectorLeaders: [],
      hotStocks: [{
        code: '600519',
        name: '贵州茅台',
        rank: 1,
        rankChange: null,
        hotValue: null,
        price: 1281.91,
        changePct: 1.2,
      }],
    }

    expect(classifyMarketPulseState({ loading: false, snapshot })).toMatchObject({
      state: 'cached',
      hasCachedRows: true,
      hasPartialFailure: true,
      rowCount: 1,
    })

    const summaryOnlySnapshot: SnapshotData = {
      timestamp: '2026-06-22T06:50:00.000Z',
      regime: 'neutral',
      regimeReason: 'Mixed: 0 up / 0 down sectors',
      limitUpCount: 100,
      limitDownCount: 0,
      failedSources: ['hot-stock-quotes: skipped after recent transport failure'],
      sectorLeaders: [],
      nonSectorMovers: [],
      hotStocks: [],
    }

    expect(classifyMarketPulseState({ loading: false, snapshot: summaryOnlySnapshot })).toMatchObject({
      state: 'empty',
      hasCachedRows: false,
      hasPartialFailure: true,
      rowCount: 0,
    })
    expect(buildMarketPulseDataQuality(summaryOnlySnapshot)).toMatchObject({
      status: 'partial',
      failedSourceCount: 1,
      label: 'partial-data:1',
      detail: 'hot-stock-quotes: skipped after recent transport failure',
    })
    expect(buildMarketPulseDataQuality({ ...snapshot, failedSources: [] })).toMatchObject({
      status: 'complete',
      failedSourceCount: 0,
      detail: null,
    })
  })

  it('classifies Stock Watchlist saved, fallback, empty, and error states', () => {
    const watchlist: WatchlistData = {
      groups: [{ id: 'default', name: 'Default', type: 'stock' }],
      items: [
        {
          id: 'w-600519',
          groupId: 'default',
          symbol: '600519',
          name: '贵州茅台',
          type: 'stock',
          status: 'watching',
          source: 'manual',
          tags: [],
          priceAtAdd: 0,
          addedAt: '2026-06-17T00:00:00.000Z',
        },
      ],
    }
    const saved = visibleStockItems(watchlist)
    const fallbackRows = buildFallbackStockItems(saved)

    expect(classifyStockWatchlistState({ loading: true, rows: fallbackRows, savedItems: saved }).state).toBe('loading')
    expect(classifyStockWatchlistState({ loading: false, rows: [], savedItems: [] }).state).toBe('empty')
    expect(classifyStockWatchlistState({ loading: false, rows: [], savedItems: saved, error: 'quote failed' }).state).toBe('error')
    expect(classifyStockWatchlistState({ loading: false, rows: fallbackRows, savedItems: saved, error: 'quote failed' })).toMatchObject({
      state: 'cached',
      rowCount: 1,
      savedCount: 1,
      hasFallbackRows: true,
      hasQuoteError: true,
    })
  })

  it('classifies Portfolio/Risk loading, empty, error, and cached states', () => {
    expect(classifyPortfolioState({ loading: true, data: null }).state).toBe('loading')
    expect(classifyPortfolioState({ loading: false, data: null }).state).toBe('empty')
    expect(classifyPortfolioState({ loading: false, data: null, error: 'read failed' }).state).toBe('error')

    const summary = buildPortfolioSummary({
      cash: 10_000,
      initialCash: 100_000,
      positions: {
        '600519': { shares: 100, costPrice: 1000 },
      },
    }, [{ code: '600519', name: '贵州茅台', price: 1200 }])

    expect(summary).toMatchObject({
      totalValue: 120_000,
      totalAssets: 130_000,
      totalPnl: 20_000,
    })
    expect(classifyPortfolioState({ loading: false, data: summary })).toMatchObject({
      state: 'cached',
      positionCount: 1,
      hasReadError: false,
    })
  })
})
