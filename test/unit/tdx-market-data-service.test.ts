import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('TdxMarketDataService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.doUnmock('../../src/domain/market/providers/tdx-market-provider')
  })

  it('persists direct tdx actions through the repository boundary', async () => {
    const ingest = vi.fn()
    vi.doMock('../../src/domain/market/repositories/tdx-market-data-repository', () => ({
      TdxMarketDataRepository: class {
        ingest = ingest
        normalizeBlockRows = vi.fn()
      },
    }))
    vi.doMock('../../src/domain/market/providers/tdx-market-provider', () => ({
      DefaultTdxMarketProvider: class {
        fetchDirectAction = vi.fn(async () => ({ List: [{ code: '600519' }] }))
        fetchBlock = vi.fn()
        fetchCompanyCategories = vi.fn()
        fetchCompanyContent = vi.fn()
        fetchExAction = vi.fn()
      },
    }))

    const { TdxMarketDataService } = await import('../../src/domain/market/services/tdx-market-data-service')
    const service = new TdxMarketDataService()
    const result = await service.readDirectAction(
      { basePath: '/tmp' } as any,
      'tdx_tick_chart',
      { market: 1 },
      '600519',
      50,
    )

    expect(result).toEqual({ List: [{ code: '600519' }] })
    expect(ingest).toHaveBeenCalledWith(
      { basePath: '/tmp' },
      expect.objectContaining({
        provider: 'tdx',
        endpoint: 'tick_chart',
        code: '600519',
        source: 'tdx',
      }),
    )
  })

  it('normalizes and filters block rows before ingest', async () => {
    const ingest = vi.fn()
    const normalizeBlockRows = vi.fn((_filename: string, rows: Array<Record<string, unknown>>) => rows.map((row) => ({
      ...row,
      BlockCode: 'block_gn.dat:白酒',
      BlockName: '白酒',
      Type: 'gn',
      Code: String(row.Code ?? row.code ?? ''),
    })))
    vi.doMock('../../src/domain/market/repositories/tdx-market-data-repository', () => ({
      TdxMarketDataRepository: class {
        ingest = ingest
        normalizeBlockRows = normalizeBlockRows
      },
    }))
    vi.doMock('../../src/domain/market/providers/tdx-market-provider', () => ({
      DefaultTdxMarketProvider: class {
        fetchDirectAction = vi.fn()
        fetchBlock = vi.fn(async () => ({
          List: [
            { code: '600519', blockName: '白酒' },
            { code: '000001', blockName: '银行' },
          ],
        }))
        fetchCompanyCategories = vi.fn()
        fetchCompanyContent = vi.fn()
        fetchExAction = vi.fn()
      },
    }))

    const { TdxMarketDataService } = await import('../../src/domain/market/services/tdx-market-data-service')
    const service = new TdxMarketDataService()
    const result = await service.readBlock(
      { basePath: '/tmp' } as any,
      { filename: 'block_gn.dat', blockName: '白酒' },
      '600519',
    )

    expect(normalizeBlockRows).toHaveBeenCalled()
    expect(result.List).toEqual([
      expect.objectContaining({ Code: '600519', BlockCode: 'block_gn.dat:白酒' }),
    ])
    expect(ingest).toHaveBeenCalledWith(
      { basePath: '/tmp' },
      expect.objectContaining({
        provider: 'tdx',
        endpoint: 'block',
        code: '600519',
      }),
    )
  })
})
