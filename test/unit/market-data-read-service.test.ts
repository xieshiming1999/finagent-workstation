import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('MarketDataReadService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.doUnmock('../../src/domain/market/repositories/local-market-data-repository')
  })

  it('checks reusable quote storage only and reports misses without fetching', async () => {
    const getRecentQuotes = vi.fn(() => new Map([
      ['600519', { code: '600519', name: '茅台' }],
    ]))
    const getLatestQuotes = vi.fn(() => new Map())
    const saveQuotes = vi.fn()

    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        getRecentQuotes = getRecentQuotes
        getLatestQuotes = getLatestQuotes
        saveQuotes = saveQuotes
        queryKline = vi.fn()
        saveKline = vi.fn()
      },
    }))

    const { MarketDataReadService } = await import('../../src/domain/market/services/market-data-read-service')
    const service = new MarketDataReadService()
    const result = service.readQuotes({ basePath: '/tmp' } as any, ['600519', '000001'])

    expect(result.status).toBe('miss')
    expect(result.cachedCount).toBe(1)
    expect(result.freshCount).toBe(0)
    expect(result.missingCodes).toEqual(['000001'])
    expect(result.quotes.map((q) => q.code)).toEqual(['600519'])
    expect(result.provenance).toEqual([
      expect.objectContaining({
        interfaceId: 'stock.quote',
        capabilityId: 'local.cache',
        provider: 'local',
        cacheStatus: 'cache-hit',
      }),
    ])
    expect(saveQuotes).not.toHaveBeenCalled()
  })

  it('uses local daily kline when local coverage is sufficient', async () => {
    const queryKline = vi.fn(() => Array.from({ length: 12 }, (_, index) => ({
        date: dateDaysAgo(11 - index),
        open: 10,
        close: 11,
        high: 12,
        low: 9,
        volume: 1000,
        amount: 2000,
        change_pct: 1.2,
        turnover_rate: 3.4,
      })))
    const saveKline = vi.fn()

    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        getRecentQuotes = vi.fn()
        getLatestQuotes = vi.fn()
        saveQuotes = vi.fn()
        queryKline = queryKline
        saveKline = saveKline
      },
    }))

    const { MarketDataReadService } = await import('../../src/domain/market/services/market-data-read-service')
    const service = new MarketDataReadService()
    const result = service.readKline({ basePath: '/tmp' } as any, '600519', {
      period: 'daily',
      adjust: 'qfq',
      limit: 10,
    })

    expect(result.status).toBe('hit')
    expect(result.source).toBe('local')
    expect(result.bars).toHaveLength(12)
    expect(result.reason).toContain('latest bar')
    expect(result.provenance).toEqual(expect.objectContaining({
      interfaceId: 'stock.daily_kline',
      capabilityId: 'local.cache',
      provider: 'local',
      cacheStatus: 'cache-hit',
    }))
    expect(saveKline).not.toHaveBeenCalled()
  })

  it('treats old daily kline coverage as stale even when row count is sufficient', async () => {
    const queryKline = vi.fn(() => Array.from({ length: 60 }, (_, index) => ({
        date: dateDaysAgo(120 - index),
        open: 10,
        close: 11,
        high: 12,
        low: 9,
        volume: 1000,
        amount: 2000,
        change_pct: 1.2,
        turnover_rate: 3.4,
      })))

    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        getRecentQuotes = vi.fn()
        getLatestQuotes = vi.fn()
        saveQuotes = vi.fn()
        queryKline = queryKline
        saveKline = vi.fn()
      },
    }))

    const { MarketDataReadService } = await import('../../src/domain/market/services/market-data-read-service')
    const service = new MarketDataReadService()
    const result = service.readKline({ basePath: '/tmp' } as any, '600519', {
      period: 'daily',
      adjust: 'qfq',
      limit: 60,
    })

    expect(result.status).toBe('stale')
    expect(result.reason).toContain('older than')
    expect(result.coverage.rowCount).toBe(60)
  })
})

describe('MarketDataResolveService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('fetches and persists quote misses through the orchestration layer', async () => {
    const saveQuotes = vi.fn()
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        saveQuotes = saveQuotes
        saveKline = vi.fn()
      },
    }))

    const { MarketDataResolveService } = await import('../../src/domain/market/services/market-data-resolve-service')
    const readService = {
      readQuotes: vi.fn(() => ({
        quotes: [{ code: '600519', name: '茅台' }],
        cachedCount: 1,
        freshCount: 0,
        freshSources: [],
        status: 'miss',
        missingCodes: ['000001'],
        staleCodes: [],
        reason: 'no reusable quote rows for: 000001',
      })),
    }
    const fetchService = {
      readQuotes: vi.fn(async () => ({
        batches: [{
          source: 'tdx',
          quotes: [{ code: '000001', name: '平安银行' }],
          provenance: {
            interfaceId: 'stock.quote',
            capabilityId: 'tdx.quote',
            provider: 'tdx',
            cacheStatus: 'provider-hit',
          },
        }],
      })),
    }
    const service = new MarketDataResolveService(readService as any, fetchService as any)
    const result = await service.readQuotes({ basePath: '/tmp' } as any, ['600519', '000001'])

    expect(fetchService.readQuotes).toHaveBeenCalledWith(['000001'])
    expect(saveQuotes).toHaveBeenCalledWith(
      { basePath: '/tmp' },
      [{ code: '000001', name: '平安银行' }],
      'tdx',
    )
    expect(result.cachedCount).toBe(1)
    expect(result.freshCount).toBe(1)
    expect(result.quotes.map((q) => q.code)).toEqual(['600519', '000001'])
    expect(result.provenance).toEqual([
      expect.objectContaining({ interfaceId: 'stock.quote', provider: 'tdx', cacheStatus: 'provider-hit' }),
    ])
  })

  it('fetches stale cache entries through the orchestration layer', async () => {
    const { MarketDataResolveService } = await import('../../src/domain/market/services/market-data-resolve-service')
    const readService = {
      readQuotes: vi.fn(() => ({
        quotes: [],
        cachedCount: 0,
        freshCount: 0,
        freshSources: [],
        status: 'stale',
        missingCodes: ['600519'],
        staleCodes: ['600519'],
        reason: 'some quotes exist but are older than ttl',
      })),
    }
    const fetchService = {
      readQuotes: vi.fn(async () => ({
        batches: [{ source: 'tdx', quotes: [{ code: '600519', name: '茅台' }] }],
      })),
    }
    const service = new MarketDataResolveService(readService as any, fetchService as any)
    const result = await service.readQuotes({ basePath: '/tmp' } as any, ['600519'])

    expect(fetchService.readQuotes).toHaveBeenCalledWith(['600519'])
    expect(result.freshCount).toBe(1)
    expect(result.staleCodes).toEqual(['600519'])
  })

  it('uses cache hits without provider calls', async () => {
    const { MarketDataResolveService } = await import('../../src/domain/market/services/market-data-resolve-service')
    const readService = {
      readQuotes: vi.fn(() => ({
        quotes: [{ code: '600519', name: '茅台' }],
        cachedCount: 1,
        freshCount: 0,
        freshSources: [],
        status: 'hit',
        missingCodes: [],
        staleCodes: [],
        reason: 'all requested quotes found',
      })),
    }
    const fetchService = { readQuotes: vi.fn() }
    const service = new MarketDataResolveService(readService as any, fetchService as any)
    const result = await service.readQuotes({ basePath: '/tmp' } as any, ['600519'])

    expect(fetchService.readQuotes).not.toHaveBeenCalled()
    expect(result.quotes).toEqual([{ code: '600519', name: '茅台' }])
  })

  it('cache-only policy returns misses without provider calls', async () => {
    const { MarketDataResolveService } = await import('../../src/domain/market/services/market-data-resolve-service')
    const readService = {
      readQuotes: vi.fn(() => ({
        quotes: [],
        cachedCount: 0,
        freshCount: 0,
        freshSources: [],
        status: 'miss',
        missingCodes: ['000001'],
        staleCodes: [],
        reason: 'miss',
      })),
    }
    const fetchService = { readQuotes: vi.fn() }
    const service = new MarketDataResolveService(readService as any, fetchService as any)
    const result = await service.readQuotes({ basePath: '/tmp' } as any, ['000001'], { mode: 'cache-only' })

    expect(fetchService.readQuotes).not.toHaveBeenCalled()
    expect(result.status).toBe('miss')
    expect(result.quotes).toEqual([])
  })

  it('live-only policy skips storage and calls providers directly', async () => {
    const { MarketDataResolveService } = await import('../../src/domain/market/services/market-data-resolve-service')
    const readService = { readQuotes: vi.fn() }
    const fetchService = {
      readQuotes: vi.fn(async () => ({
        batches: [{ source: 'tdx', quotes: [{ code: '600519', name: '茅台' }] }],
      })),
    }
    const service = new MarketDataResolveService(readService as any, fetchService as any)
    const result = await service.readQuotes({ basePath: '/tmp' } as any, ['600519'], { mode: 'live-only' })

    expect(readService.readQuotes).not.toHaveBeenCalled()
    expect(fetchService.readQuotes).toHaveBeenCalledWith(['600519'])
    expect(result.freshCount).toBe(1)
    expect(result.quotes).toEqual([{ code: '600519', name: '茅台' }])
  })

  it('fetches stale daily kline coverage through the governed provider path', async () => {
    const { MarketDataResolveService } = await import('../../src/domain/market/services/market-data-resolve-service')
    const readService = {
      readKline: vi.fn(() => ({
        bars: Array.from({ length: 60 }, () => ({
          date: '2026-03-27',
          open: 10,
          close: 11,
          high: 12,
          low: 9,
          volume: 1000,
          amount: 2000,
          changePct: 1.2,
          turnoverRate: 3.4,
        })),
        source: 'local',
        period: 'daily',
        adjust: 'qfq',
        status: 'stale',
        reason: 'local kline latest bar 2026-03-27 is older than 7 days',
        coverage: { rowCount: 60, requiredRows: 10 },
      })),
    }
    const fetchService = {
      readKline: vi.fn(async () => ({
        bars: [{
          date: dateDaysAgo(0),
          open: 20,
          close: 21,
          high: 22,
          low: 19,
          volume: 2000,
          amount: 4000,
          changePct: 2.3,
          turnoverRate: 4.5,
        }],
        source: 'tdx',
        provenance: {
          interfaceId: 'stock.daily_kline',
          capabilityId: 'tdx.stock.daily_kline',
          provider: 'tdx',
          cacheStatus: 'provider-hit',
        },
      })),
    }
    const service = new MarketDataResolveService(readService as any, fetchService as any)
    const result = await service.readKline({ basePath: '/tmp' } as any, '600519', {
      period: 'daily',
      adjust: 'qfq',
      limit: 60,
    })

    expect(fetchService.readKline).toHaveBeenCalledWith('600519', {
      period: 'daily',
      adjust: 'qfq',
      limit: 60,
    })
    expect(result.source).toBe('tdx')
    expect(result.reason).toContain('after stale')
    expect(result.bars[0].date).toBe(dateDaysAgo(0))
  })

  it('normalizes core index K-line requests to unadjusted governed index readback', async () => {
    const saveKline = vi.fn()
    vi.doMock('../../src/domain/market/repositories/local-market-data-repository', () => ({
      LocalMarketDataRepository: class {
        saveQuotes = vi.fn()
        saveKline = saveKline
      },
    }))
    const { MarketDataResolveService } = await import('../../src/domain/market/services/market-data-resolve-service')
    const readService = {
      readKline: vi.fn(() => ({
        bars: [],
        source: 'local',
        period: 'daily',
        adjust: 'none',
        status: 'miss',
        reason: 'no local index kline rows',
        coverage: { rowCount: 0, requiredRows: 10 },
      })),
    }
    const fetchService = {
      readKline: vi.fn(async () => ({
        bars: [{
          date: '2026-06-11',
          open: 4000,
          close: 4050,
          high: 4100,
          low: 3990,
          volume: 1000,
          amount: 2000,
          changePct: 1.2,
          turnoverRate: 0.1,
        }],
        source: 'tdx',
        provenance: {
          interfaceId: 'index.daily_kline',
          capabilityId: 'tdx.index.daily_kline',
          provider: 'tdx',
          canonicalSchema: 'kline_daily',
          canonicalTable: 'kline_daily',
          cacheStatus: 'provider-hit',
        },
      })),
    }
    const service = new MarketDataResolveService(readService as any, fetchService as any)
    const result = await service.readKline({ basePath: '/tmp' } as any, '000300', {
      period: 'daily',
      adjust: 'qfq',
      limit: 60,
    })

    expect(readService.readKline).toHaveBeenCalledWith(
      { basePath: '/tmp' },
      '000300',
      expect.objectContaining({ period: 'daily', adjust: 'none', limit: 60 }),
    )
    expect(fetchService.readKline).toHaveBeenCalledWith('000300', {
      period: 'daily',
      adjust: 'none',
      limit: 60,
    })
    expect(saveKline).toHaveBeenCalledWith(
      { basePath: '/tmp' },
      [expect.objectContaining({ code: '000300', adjust: 'none', source: 'tdx' })],
    )
    expect(result.adjust).toBe('none')
    expect(result.provenance).toMatchObject({ interfaceId: 'index.daily_kline' })
  })
})

function dateDaysAgo(days: number): string {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return date.toISOString().slice(0, 10)
}
