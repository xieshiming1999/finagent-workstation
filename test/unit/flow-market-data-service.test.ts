import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('FlowMarketDataService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('persists provider-hit money flow rows through the repository boundary', async () => {
    const saveMoneyFlowRows = vi.fn()
    vi.doMock('../../src/domain/market/repositories/flow-market-data-repository', () => ({
      FlowMarketDataRepository: class {
        saveMoneyFlowRows = saveMoneyFlowRows
      },
    }))
    vi.doMock('../../src/agent/data/fetchers/fetcher-money-flow', () => ({
      fetchMoneyFlow: vi.fn(async () => ({
        data: [
          {
            code: '600519',
            date: '2026-06-06',
            main_net: 1000000,
            small_net: -100000,
            medium_net: 200000,
            large_net: 300000,
            super_large_net: 700000,
            close_price: 1281.91,
            change_pct: 1.2,
            source: 'eastmoney',
          },
        ],
        source: 'eastmoney',
        fetchedAt: '2026-06-06T15:00:00.000Z',
        provenance: { cacheStatus: 'provider-hit' },
      })),
    }))

    const { FlowMarketDataService } = await import('../../src/domain/market/services/flow-market-data-service')
    const service = new FlowMarketDataService()
    const result = await service.readFlow({ basePath: '/tmp' } as any, '600519', 5)

    expect(result).toContain('Money Flow 600519 (1 days)')
    expect(saveMoneyFlowRows).toHaveBeenCalledWith(
      { basePath: '/tmp' },
      expect.arrayContaining([expect.objectContaining({ date: '2026-06-06', main_net: 1000000, source: 'eastmoney' })]),
    )
  })

  it('returns a stable empty-result message', async () => {
    vi.doMock('../../src/agent/data/fetchers/fetcher-money-flow', () => ({
      fetchMoneyFlow: vi.fn(async () => ({
        data: [],
        source: 'local',
        fetchedAt: '2026-06-06T15:00:00.000Z',
        provenance: { cacheStatus: 'cache-hit' },
      })),
    }))

    const { FlowMarketDataService } = await import('../../src/domain/market/services/flow-market-data-service')
    const service = new FlowMarketDataService()

    await expect(service.readFlow({ basePath: '/tmp' } as any, '600519', 5)).resolves.toBe(
      'No money flow data for 600519',
    )
  })
})
