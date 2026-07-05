import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('EastmoneyMarketDataService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.doUnmock('../../src/domain/market/providers/eastmoney-market-provider')
  })

  it('fetches sector constituents without requiring storage context', async () => {
    const fetchSectorStocks = vi.fn(async () => [
      { code: '600519', name: '茅台', price: 1500, changePct: 1.2, pe: 20, turnoverRate: 1.1 },
    ])

    vi.doMock('../../src/domain/market/providers/eastmoney-market-provider', () => ({
      DefaultEastmoneyMarketProvider: class {
        readSectorStocks = fetchSectorStocks
        readSectors = vi.fn()
        readLimitUp = vi.fn()
        readLimitDown = vi.fn()
        readDragonTiger = vi.fn()
        readNorthboundHolding = vi.fn()
        readNorthboundFlow = vi.fn()
        readHotRank = vi.fn()
        readFlowRank = vi.fn()
        readUnusual = vi.fn()
        readChip = vi.fn()
        readEtf = vi.fn()
        readEarnings = vi.fn()
      },
    }))

    const { EastmoneyMarketDataService } = await import('../../src/domain/market/services/eastmoney-market-data-service')
    const service = new EastmoneyMarketDataService()
    const result = await service.readSector({
      sectorCode: 'BK0475',
      sectorName: '白酒',
      type: 'industry',
    }, 10)

    expect(result.kind).toBe('sector_constituents')
    expect(fetchSectorStocks).toHaveBeenCalledWith({ code: 'BK0475', name: '白酒' }, 'industry', 10)
    expect(result.items).toEqual(expect.arrayContaining([expect.objectContaining({ code: '600519', name: '茅台' })]))
  })

  it('routes strict Sina sector constituents through direct node membership', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('Market_Center.getHQNodeData')
      expect(url).toContain('node=gn_gfgn')
      return {
        ok: true,
        json: async () => ([
          {
            symbol: 'sz300070',
            code: '300070',
            name: '碧水源',
            trade: '4.86',
            pricechange: 0.12,
            changepercent: 2.53,
            settlement: '4.74',
            open: '4.75',
            high: '4.90',
            low: '4.70',
            volume: 123456,
            amount: 654321,
            per: 21.2,
            pb: 1.8,
            mktcap: 1200000000,
            turnoverratio: 1.2,
          },
        ]),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const { EastmoneyMarketDataService } = await import('../../src/domain/market/services/eastmoney-market-data-service')
    const service = new EastmoneyMarketDataService()
    const result = await service.readSectorWithOptions({
      sectorCode: 'gn_gfgn',
      sectorName: '固废处理',
      type: 'concept',
    }, 20, {
      provider: 'sina',
      providerMode: 'strict',
      cacheMode: 'live-only',
      allowFallback: false,
    })

    expect(result).toMatchObject({
      kind: 'sector_constituents',
      sectorName: '固废处理',
      provenance: {
        interfaceId: 'market.board_members',
        capabilityId: 'sina.market.board_members',
        provider: 'sina',
        source: 'sina',
        canonicalSchema: 'industry_map',
        canonicalTable: 'industry_map',
        cacheStatus: 'provider-hit',
      },
    })
    expect(result.items).toEqual([
      expect.objectContaining({
        code: '300070',
        name: '碧水源',
        price: 4.86,
        changePct: 2.53,
        source: 'sina',
      }),
    ])
  })

  it('fetches flow rank and returns the derived period without persisting', async () => {
    const fetchFlowRanking = vi.fn(async () => [
      { code: '600519', name: '茅台', mainNetInflow: 1000, changePct: 2.5 },
    ])

    vi.doMock('../../src/domain/market/providers/eastmoney-market-provider', () => ({
      DefaultEastmoneyMarketProvider: class {
        readSectorStocks = vi.fn()
        readSectors = vi.fn()
        readLimitUp = vi.fn()
        readLimitDown = vi.fn()
        readDragonTiger = vi.fn()
        readNorthboundHolding = vi.fn()
        readNorthboundFlow = vi.fn()
        readHotRank = vi.fn()
        readFlowRank = fetchFlowRanking
        readUnusual = vi.fn()
        readChip = vi.fn()
        readEtf = vi.fn()
        readEarnings = vi.fn()
      },
    }))

    const { EastmoneyMarketDataService } = await import('../../src/domain/market/services/eastmoney-market-data-service')
    const service = new EastmoneyMarketDataService()
    const result = await service.readFlowRank(5)

    expect(result.kind).toBe('flow_rank')
    expect(result.period).toBe('5day')
    expect(result.items).toEqual(expect.arrayContaining([expect.objectContaining({ code: '600519', name: '茅台' })]))
  })

  it('routes strict AkShare flow rank through the requirement-level interface', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [{
          '代码': '601138',
          '名称': '工业富联',
          '涨跌幅': 9.97,
          '今日主力净流入-净额': 5092966912,
        }],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { EastmoneyMarketDataService } = await import('../../src/domain/market/services/eastmoney-market-data-service')
    const service = new EastmoneyMarketDataService()
    const result = await service.readFlowRankWithOptions(1, {
      provider: 'akshare',
      providerMode: 'strict',
      cacheMode: 'live-only',
      allowFallback: false,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/akshare/stock_individual_fund_flow_rank?'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(String(fetchMock.mock.calls[0][0])).toContain('_provider=eastmoney')
    expect(result).toMatchObject({
      kind: 'flow_rank',
      period: 'today',
      provenance: {
        interfaceId: 'market.flow_rank',
        capabilityId: 'akshare.market.flow_rank',
        provider: 'akshare',
        source: 'akshare:eastmoney',
        cacheStatus: 'provider-hit',
      },
    })
    expect(result.items).toEqual([
      { code: '601138', name: '工业富联', mainNetInflow: 5092966912, changePct: 9.97 },
    ])
  })

  it('routes strict AkShare hot rank and enriches missing names before returning canonical rows', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{
            '代码': '000725',
            '名称': '',
            '排名': 1,
            '排名变化': 0,
            '人气值': null,
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            diff: [{ f12: '000725', f14: '京东方A' }],
          },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { EastmoneyMarketDataService } = await import('../../src/domain/market/services/eastmoney-market-data-service')
    const service = new EastmoneyMarketDataService()
    const result = await service.readHotRankWithOptions(10, {
      provider: 'akshare',
      providerMode: 'strict',
      cacheMode: 'live-only',
      allowFallback: false,
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/akshare/stock_hot_rank_em?'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/api/qt/ulist.np/get?'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result).toMatchObject({
      kind: 'hot_rank',
      provenance: {
        interfaceId: 'market.hot_rank',
        capabilityId: 'akshare.market.hot_rank',
        provider: 'akshare',
        source: 'akshare:eastmoney',
        cacheStatus: 'provider-hit',
      },
    })
    expect(result.items).toEqual([
      { code: '000725', name: '京东方A', rank: 1, rankChange: 0, hotValue: null },
    ])
  })

  it('routes strict TDX unusual activity through the requirement-level interface', async () => {
    vi.doMock('../../src/main/sidecar', () => ({ getGotdxUrl: () => 'http://127.0.0.1:19801' }))
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        List: [{
          Code: '600519',
          Name: '贵州茅台',
          Time: '09:31:00',
          UnusualType: '快速上涨',
          Desc: '加速拉升',
          Price: 1288.5,
          ChangePct: 2.1,
        }],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { EastmoneyMarketDataService } = await import('../../src/domain/market/services/eastmoney-market-data-service')
    const service = new EastmoneyMarketDataService()
    const result = await service.readUnusualWithOptions({
      provider: 'tdx',
      providerMode: 'strict',
      cacheMode: 'live-only',
      allowFallback: false,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/unusual?'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result).toMatchObject({
      kind: 'unusual',
      provenance: {
        interfaceId: 'market.unusual_activity',
        capabilityId: 'tdx.market.unusual_activity',
        provider: 'tdx',
        source: 'tdx',
        cacheStatus: 'provider-hit',
      },
    })
    expect(result.items).toEqual([
      {
        code: '600519',
        name: '贵州茅台',
        price: 1288.5,
        changePct: 2.1,
        type: '快速上涨',
        time: '09:31:00',
        description: '加速拉升',
      },
    ])
  })

  it('fetches direct ETF rows without persisting them', async () => {
    const readEtf = vi.fn(async () => [
      { f12: '510300', f14: '沪深300ETF', f2: 3.21, f3: 1.23, f5: 123456 },
    ])

    vi.doMock('../../src/domain/market/providers/eastmoney-market-provider', () => ({
      DefaultEastmoneyMarketProvider: class {
        readSectorStocks = vi.fn()
        readSectors = vi.fn()
        readLimitUp = vi.fn()
        readLimitDown = vi.fn()
        readDragonTiger = vi.fn()
        readNorthboundHolding = vi.fn()
        readNorthboundFlow = vi.fn()
        readHotRank = vi.fn()
        readFlowRank = vi.fn()
        readUnusual = vi.fn()
        readChip = vi.fn()
        readEtf = readEtf
        readEarnings = vi.fn()
      },
    }))

    const { EastmoneyMarketDataService } = await import('../../src/domain/market/services/eastmoney-market-data-service')
    const service = new EastmoneyMarketDataService()
    const result = await service.readEtf(20)

    expect(result.kind).toBe('etf')
    expect(readEtf).toHaveBeenCalledWith(20)
    expect(result.items).toEqual(expect.arrayContaining([expect.objectContaining({ f12: '510300', f14: '沪深300ETF' })]))
  })
})

describe('EastmoneyMarketDataPersistenceService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.doUnmock('../../src/domain/market/repositories/eastmoney-market-data-repository')
  })

  it('persists flow rank result through the repository boundary', async () => {
    const saveFlowRank = vi.fn()
    const saveStockList = vi.fn()
    vi.doMock('../../src/domain/market/repositories/eastmoney-market-data-repository', () => ({
      EastmoneyMarketDataRepository: class {
        saveStockList = saveStockList
        saveFlowRank = saveFlowRank
      },
    }))

    const { EastmoneyMarketDataPersistenceService } = await import('../../src/domain/market/services/eastmoney-market-data-persistence-service')
    const service = new EastmoneyMarketDataPersistenceService()
    service.persist({ basePath: '/tmp' } as any, {
      kind: 'flow_rank',
      period: '5day',
      items: [{ code: '600519', name: '茅台', mainNetInflow: 1000 }],
    } as any)

    expect(saveStockList).toHaveBeenCalled()
    expect(saveFlowRank).toHaveBeenCalledWith(
      { basePath: '/tmp' },
      '5day',
      expect.arrayContaining([expect.objectContaining({ code: '600519', name: '茅台' })]),
      'eastmoney',
    )
  })

  it('persists routed flow rank source through the repository boundary', async () => {
    const saveFlowRank = vi.fn()
    const saveStockList = vi.fn()
    vi.doMock('../../src/domain/market/repositories/eastmoney-market-data-repository', () => ({
      EastmoneyMarketDataRepository: class {
        saveStockList = saveStockList
        saveFlowRank = saveFlowRank
      },
    }))

    const { EastmoneyMarketDataPersistenceService } = await import('../../src/domain/market/services/eastmoney-market-data-persistence-service')
    const service = new EastmoneyMarketDataPersistenceService()
    service.persist({ basePath: '/tmp' } as any, {
      kind: 'flow_rank',
      period: 'today',
      items: [{ code: '601138', name: '工业富联', mainNetInflow: 5092966912 }],
      provenance: { provider: 'akshare', source: 'akshare:eastmoney' },
    } as any)

    expect(saveFlowRank).toHaveBeenCalledWith(
      { basePath: '/tmp' },
      'today',
      expect.arrayContaining([expect.objectContaining({ code: '601138', name: '工业富联' })]),
      'akshare:eastmoney',
    )
  })

  it('persists routed hot rank source through the repository boundary', async () => {
    const saveHotRank = vi.fn()
    const saveStockList = vi.fn()
    vi.doMock('../../src/domain/market/repositories/eastmoney-market-data-repository', () => ({
      EastmoneyMarketDataRepository: class {
        saveStockList = saveStockList
        saveHotRank = saveHotRank
      },
    }))

    const { EastmoneyMarketDataPersistenceService } = await import('../../src/domain/market/services/eastmoney-market-data-persistence-service')
    const service = new EastmoneyMarketDataPersistenceService()
    service.persist({ basePath: '/tmp' } as any, {
      kind: 'hot_rank',
      items: [{ code: '000725', name: '京东方A', rank: 1, rankChange: 0, hotValue: null }],
      provenance: { provider: 'akshare', source: 'akshare:eastmoney' },
    } as any)

    expect(saveHotRank).toHaveBeenCalledWith(
      { basePath: '/tmp' },
      expect.arrayContaining([expect.objectContaining({ code: '000725', name: '京东方A' })]),
      'akshare:eastmoney',
    )
  })

  it('persists routed unusual activity source through the repository boundary', async () => {
    const saveUnusualActivity = vi.fn()
    const saveStockList = vi.fn()
    vi.doMock('../../src/domain/market/repositories/eastmoney-market-data-repository', () => ({
      EastmoneyMarketDataRepository: class {
        saveStockList = saveStockList
        saveUnusualActivity = saveUnusualActivity
      },
    }))

    const { EastmoneyMarketDataPersistenceService } = await import('../../src/domain/market/services/eastmoney-market-data-persistence-service')
    const service = new EastmoneyMarketDataPersistenceService()
    service.persist({ basePath: '/tmp' } as any, {
      kind: 'unusual',
      items: [{ code: '600519', name: '贵州茅台', price: 1288.5, changePct: 2.1, type: '快速上涨', time: '09:31:00', description: '加速拉升' }],
      provenance: { provider: 'tdx', source: 'tdx' },
    } as any)

    expect(saveUnusualActivity).toHaveBeenCalledWith(
      { basePath: '/tmp' },
      expect.arrayContaining([expect.objectContaining({ code: '600519', name: '贵州茅台' })]),
      'tdx',
    )
  })

  it('persists direct ETF result through the repository boundary', async () => {
    const saveEtfQuotes = vi.fn()
    vi.doMock('../../src/domain/market/repositories/eastmoney-market-data-repository', () => ({
      EastmoneyMarketDataRepository: class {
        saveEtfQuotes = saveEtfQuotes
      },
    }))

    const { EastmoneyMarketDataPersistenceService } = await import('../../src/domain/market/services/eastmoney-market-data-persistence-service')
    const service = new EastmoneyMarketDataPersistenceService()
    service.persist({ basePath: '/tmp' } as any, {
      kind: 'etf',
      items: [{ f12: '510300', f14: '沪深300ETF' }],
    } as any)

    expect(saveEtfQuotes).toHaveBeenCalledWith(
      { basePath: '/tmp' },
      expect.arrayContaining([expect.objectContaining({ f12: '510300', f14: '沪深300ETF' })]),
    )
  })
})
