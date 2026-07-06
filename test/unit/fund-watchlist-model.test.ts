import { describe, expect, it } from 'vitest'
import {
  buildFundWatchlistRows,
  fundItemsFromUnified,
  mergeLegacyFundWatchlist,
  normalizeUnifiedWatchlist,
  removeFundFromUnified,
  upsertFundInUnified,
  type StoredFundItem,
} from '../../src/renderer/components/fund-watchlist-model'

describe('fund watchlist row model', () => {
  const stored: StoredFundItem[] = [
    { id: 'f1', code: '110022', name: '易方达消费行业', addedAt: '2026-06-15T00:00:00.000Z' },
    { id: 'f2', code: '000001', name: '', addedAt: '2026-06-15T00:00:00.000Z' },
  ]

  it('preserves saved fund rows when cached NAV data is missing', () => {
    expect(buildFundWatchlistRows(stored, undefined)).toEqual([
      { code: '110022', name: '易方达消费行业' },
      { code: '000001', name: '000001' },
    ])
  })

  it('merges fetched fund rows without dropping saved rows', () => {
    const rows = buildFundWatchlistRows(stored, [
      { code: '110022', name: '', nav: 1.2345, daily_return: 0.12, source: 'akshare', provider_time: '2026-06-16', cache_status: 'cache' },
    ])

    expect(rows).toEqual([
      { code: '110022', name: '易方达消费行业', nav: 1.2345, daily_return: 0.12, source: 'akshare', provider_time: '2026-06-16', cache_status: 'cache' },
      { code: '000001', name: '000001' },
    ])
  })

  it('projects fund and ETF rows from the unified watchlist without leaking stock rows', () => {
    const unified = normalizeUnifiedWatchlist({
      groups: [
        { id: 'default', name: 'Stock Watchlist', type: 'stock' },
        { id: 'fund-default', name: 'Fund Watchlist', type: 'fund' },
      ],
      items: [
        { id: 's1', groupId: 'default', symbol: '600519', name: '贵州茅台', type: 'stock', status: 'watching', source: 'manual', tags: [], priceAtAdd: 0, addedAt: '2026-06-15T00:00:00.000Z' },
        { id: 'f1', groupId: 'fund-default', symbol: '110022.OF', name: '易方达消费行业', type: 'fund', status: 'watching', source: 'manual', tags: [], priceAtAdd: 0, addedAt: '2026-06-15T00:00:00.000Z' },
        { id: 'e1', groupId: 'fund-default', symbol: '510300', name: '沪深300ETF', type: 'etf', status: 'watching', source: 'manual', tags: [], priceAtAdd: 0, addedAt: '2026-06-15T00:00:00.000Z' },
        { id: 'f2', groupId: 'fund-default', symbol: '000001', name: '已退出基金', type: 'fund', status: 'exited', source: 'manual', tags: [], priceAtAdd: 0, addedAt: '2026-06-15T00:00:00.000Z' },
      ],
    })

    expect(fundItemsFromUnified(unified).map((item) => item.code)).toEqual(['110022', '510300'])
  })

  it('migrates legacy fund watchlist rows into unified watchlists without duplicating existing funds', () => {
    const unified = normalizeUnifiedWatchlist({
      groups: [{ id: 'default', name: 'Stock Watchlist', type: 'stock' }],
      items: [
        { id: 'f0', groupId: 'fund-default', symbol: '110022', name: '易方达消费行业', type: 'fund', status: 'watching', source: 'manual', tags: [], priceAtAdd: 0, addedAt: '2026-06-15T00:00:00.000Z' },
      ],
    })

    const merged = mergeLegacyFundWatchlist(unified, {
      items: [
        { id: 'legacy-1', code: '110022', name: '重复基金', addedAt: '2026-06-15T00:00:00.000Z' },
        { id: 'legacy-2', code: '000001', name: '华夏成长混合', addedAt: '2026-06-15T00:00:00.000Z' },
      ],
    })

    expect(merged.changed).toBe(true)
    expect(fundItemsFromUnified(merged.data).map((item) => item.code)).toEqual(['110022', '000001'])
    expect(merged.data.items.find((item) => item.id === 'legacy-2')?.source).toBe('legacy-fund-watchlist')
  })

  it('adds and removes funds in the unified watchlist model', () => {
    const unified = normalizeUnifiedWatchlist({ groups: [], items: [] })
    const added = upsertFundInUnified(unified, { code: '110022.OF', name: '易方达消费行业' })
    const duplicate = upsertFundInUnified(added.data, { code: '110022', name: '重复' })

    expect(added.status).toBe('added')
    expect(duplicate.status).toBe('exists')
    expect(fundItemsFromUnified(duplicate.data).map((item) => item.code)).toEqual(['110022'])

    const fundId = fundItemsFromUnified(duplicate.data)[0].id
    expect(fundItemsFromUnified(removeFundFromUnified(duplicate.data, fundId))).toEqual([])
  })
})
