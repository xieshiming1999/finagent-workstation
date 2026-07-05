import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('fetchFundamental', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('routes strict TDX daily valuation through the data API interface', async () => {
    const fetchDirectAction = vi.fn(async () => ({
      updatedDate: '2026-06-05',
      operatingRevenue: 174100000000,
      netProfit: 86000000000,
      totalAssets: 300000000000,
      currentLiabilities: 30000000000,
      longTermLiabilities: 20000000000,
    }))
    vi.doMock('../../src/domain/market/providers/tdx-market-provider', () => ({
      DefaultTdxMarketProvider: class {
        fetchDirectAction = fetchDirectAction
      },
    }))

    const { fetchFundamental } = await import('../../src/agent/data/fetchers/fetcher-fundamental')
    const result = await fetchFundamental('600519', {
      provider: 'tdx',
      providerMode: 'strict',
      cacheMode: 'live-only',
      allowFallback: false,
    })

    expect(fetchDirectAction).toHaveBeenCalledWith('tdx_finance', {}, '600519', 1)
    expect(result).toMatchObject({
      source: 'tdx',
      provenance: {
        interfaceId: 'stock.daily_valuation',
        capabilityId: 'tdx.stock.daily_valuation',
        provider: 'tdx',
        source: 'tdx',
        canonicalSchema: 'fundamental',
        canonicalTable: 'fundamental',
        cacheStatus: 'provider-hit',
      },
    })
    expect(result.data).toEqual([
      expect.objectContaining({
        code: '600519',
        report_date: '2026-06-05',
        revenue: 174100000000,
        net_profit: 86000000000,
        total_assets: 300000000000,
        total_liabilities: 50000000000,
        debt_ratio: 16.666666666666664,
        source: 'tdx',
      }),
    ])
  })

  it('falls back to EastMoney when AkShare returns no fundamental rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/akshare/stock_financial_analysis_indicator')) {
        return {
          ok: true,
          json: async () => ({ data: [] }),
        }
      }
      if (url.includes('/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew')) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                REPORT_DATE: '2026-03-31 00:00:00',
                TOTALOPERATEREVE: 22838024164.27,
                TOTALOPERATEREVETZ: 33.666963608643,
                PARENTNETPROFIT: 8062764940.78,
                PARENTNETPROFITTZ: 82.567785670964,
                XSMLL: 81.4343854062,
                XSJLL: 36.4470249653,
                ROEJQ: 6.5,
                ZCFZL: 21.1,
              },
            ],
          }),
        }
      }
      if (url.includes('/api/qt/stock/get')) {
        return {
          ok: true,
          json: async () => ({
            data: {
              f9: '-',
              f23: '-',
              f115: 0,
              f162: 889,
              f167: 224,
            },
          }),
        }
      }
      throw new Error(`unexpected fetch ${url}`)
    }) as unknown as typeof fetch)

    const { fetchFundamental } = await import('../../src/agent/data/fetchers/fetcher-fundamental')
    const result = await fetchFundamental('000858', { cacheMode: 'live-only' })

    expect(result).toMatchObject({
      source: 'eastmoney',
      provenance: {
        interfaceId: 'stock.daily_valuation',
        capabilityId: 'eastmoney.stock.daily_valuation',
        provider: 'eastmoney',
        canonicalSchema: 'fundamental',
        canonicalTable: 'fundamental',
      },
    })
    expect(result.data).toEqual([
      expect.objectContaining({
        code: '000858',
        report_date: '2026-03-31',
        revenue: 22838024164.27,
        revenue_yoy: 33.666963608643,
        net_profit: 8062764940.78,
        profit_yoy: 82.567785670964,
        gross_margin: 81.4343854062,
        net_margin: 36.4470249653,
        roe: 6.5,
        debt_ratio: 21.1,
        pe_ttm: 8.89,
        pb: 2.24,
        source: 'eastmoney:earnings',
      }),
    ])
  })
})
