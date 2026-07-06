import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('DefaultMarketDataProvider', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('routes direct readKline through governed daily K-line provenance', async () => {
    vi.doMock('../../src/agent/data/fetchers/fetcher-kline-daily', () => ({
      fetchKlineDaily: vi.fn(async () => ({
        source: 'tdx',
        data: [{
          date: '2026-06-24',
          open: 10,
          close: 11,
          high: 12,
          low: 9,
          volume: 1000,
          amount: 11000,
          change_pct: 1.2,
          turnover_rate: 3.4,
        }],
        provenance: {
          interfaceId: 'stock.daily_kline',
          capabilityId: 'tdx.stock.daily_kline',
          provider: 'tdx',
          cacheStatus: 'provider-hit',
        },
      })),
    }))

    const { DefaultMarketDataProvider } = await import('../../src/domain/market/providers/market-data-provider')
    const result = await new DefaultMarketDataProvider().readKline('600519', {
      period: 'daily',
      adjust: 'qfq',
      limit: 10,
    })

    expect(result.source).toBe('tdx')
    expect(result.provenance).toMatchObject({
      interfaceId: 'stock.daily_kline',
      capabilityId: 'tdx.stock.daily_kline',
      provider: 'tdx',
    })
    expect(result.bars).toEqual([
      expect.objectContaining({ date: '2026-06-24', close: 11 }),
    ])
  })

  it('rejects non-daily readKline periods instead of returning opaque fallback data', async () => {
    const { DefaultMarketDataProvider } = await import('../../src/domain/market/providers/market-data-provider')

    await expect(new DefaultMarketDataProvider().readKline('600519', {
      period: 'weekly',
      adjust: 'qfq',
      limit: 10,
    })).rejects.toThrow('MarketDataProvider.readKline supports only governed daily K-line')
  })
})
