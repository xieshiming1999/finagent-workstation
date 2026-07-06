import { afterEach, describe, expect, it, vi } from 'vitest'

describe('provider endpoint routing contracts', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('classifies EastMoney-backed AkShare functions through the shared provider hint map', async () => {
    const { providerForAkshareFunc, providerForAksharePath } = await import('../../src/agent/data/akshare-provider-hints')

    expect(providerForAkshareFunc('stock_zt_pool_em')).toBe('eastmoney')
    expect(providerForAkshareFunc('fund_open_fund_rank_em')).toBe('eastmoney')
    expect(providerForAkshareFunc('fund_portfolio_hold_em')).toBe('eastmoney')
    expect(providerForAkshareFunc('fund_etf_hist_em')).toBe('eastmoney')
    expect(providerForAkshareFunc('stock_hk_spot_em')).toBe('eastmoney')
    expect(providerForAkshareFunc('stock_us_spot_em')).toBe('eastmoney')
    expect(providerForAkshareFunc('stock_individual_info_em')).toBe('eastmoney')
    expect(providerForAksharePath('/akshare/stock_zh_a_spot_em?symbol=all')).toBe('eastmoney')
    expect(providerForAkshareFunc('macro_china_gdp')).toBeUndefined()
  })

  it('uses validated gotdx index bars before direct EastMoney and AkShare compatibility routes', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input)
      calls.push(url)
      return jsonResponse({
        List: [
          { DateTime: '2026-06-11 15:00:00', Open: 15000, High: 15100, Low: 14950, Close: 15050, Vol: 1000, Amount: 2000 },
        ],
      })
    }))

    const { fetchIndexKline } = await import('../../src/agent/data/fetchers/fetcher-index-kline')
    const result = await fetchIndexKline('399001', { start: '2026-01-01', end: '2026-06-12' })

    expect(result.data).toHaveLength(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('127.0.0.1:19801/index_bars')
    expect(calls[0]).toContain('code=399001')
    expect(calls[0]).toContain('market=0')
    expect(result.source).toBe('tdx')
  })

  it('falls back to direct EastMoney index K-line route when gotdx is unavailable', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('127.0.0.1:19801/index_bars')) {
        return jsonResponse({ error: 'TDX unavailable' }, 503)
      }
      return jsonResponse({
        data: {
          klines: [
            '2026-06-11,4000,4050,4100,3990,1000,2000,50,1.2,0.1,0',
          ],
        },
      })
    }))

    const { fetchIndexKline } = await import('../../src/agent/data/fetchers/fetcher-index-kline')
    const result = await fetchIndexKline('399001', { start: '2026-01-01', end: '2026-06-12' })

    expect(result.data).toHaveLength(1)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('127.0.0.1:19801/index_bars')
    expect(calls[1]).toContain('push2his.eastmoney.com/api/qt/stock/kline/get')
    expect(calls[1]).toContain('secid=0.399001')
    expect(calls[1]).not.toContain('/akshare/stock_zh_index_daily_em')
    expect(result.source).toBe('eastmoney')
    expect(result.data[0]).toMatchObject({ code: '399001', close: 4050, source: 'eastmoney' })
  })

  it('falls back to push2delay ulist snapshot when single-stock money-flow history is blocked', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('stock_individual_fund_flow?')) {
        return jsonResponse({ error: 'push2his blocked' }, 500)
      }
      if (url.includes('push2delay.eastmoney.com/api/qt/ulist.np/get')) {
        return jsonResponse({
          data: {
            diff: [{
              f12: '600519',
              f2: 1291.91,
              f3: 1.01,
              f62: 500000,
              f66: 300000,
              f72: 200000,
              f78: -50000,
              f84: -10000,
              f124: 1781251908,
            }],
          },
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }))

    const { fetchMoneyFlow } = await import('../../src/agent/data/fetchers/fetcher-money-flow')
    const result = await fetchMoneyFlow('600519')

    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('stock_individual_fund_flow?')
    expect(calls[1]).toContain('push2delay.eastmoney.com/api/qt/ulist.np/get')
    expect(calls[1]).toContain('secids=1.600519')
    expect(result.source).toBe('eastmoney:ulist_fallback')
    expect(result.data[0]).toMatchObject({
      code: '600519',
      main_net: 500000,
      close_price: 1291.91,
      change_pct: 1.01,
      source: 'eastmoney:ulist_fallback',
    })
    expect(result.provenance).toMatchObject({
      interfaceId: 'stock.money_flow',
      capabilityId: 'eastmoney.stock.money_flow',
      provider: 'eastmoney',
      canonicalSchema: 'money_flow',
      canonicalTable: 'money_flow',
      cacheStatus: 'provider-hit',
      cacheMode: 'cache-first',
      cacheDecision: expect.stringContaining('no reusable cache rows matched the requirement'),
    })
  })

  it('honors strict provider constraints while preserving provider provenance', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('stock_individual_fund_flow?')) {
        return jsonResponse({
          data: [{
            日期: '2026-06-11',
            '主力净流入-净额': 123,
            '小单净流入-净额': -1,
            '中单净流入-净额': 2,
            '大单净流入-净额': 3,
            '超大单净流入-净额': 4,
            收盘价: 100,
            涨跌幅: 1.5,
          }],
        })
      }
      throw new Error(`unexpected URL ${url}`)
    }))

    const { fetchMoneyFlow } = await import('../../src/agent/data/fetchers/fetcher-money-flow')
    const result = await fetchMoneyFlow('600519', 30, { provider: 'akshare', providerMode: 'strict' })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('stock_individual_fund_flow?')
    expect(calls[0]).not.toContain('_provider=eastmoney')
    expect(result.source).toBe('akshare')
    expect(result.data[0]).toMatchObject({ source: 'akshare', main_net: 123 })
    expect(result.provenance).toMatchObject({
      interfaceId: 'stock.money_flow',
      capabilityId: 'akshare.stock.money_flow',
      provider: 'akshare',
      source: 'akshare',
      canonicalSchema: 'money_flow',
      canonicalTable: 'money_flow',
      cacheMode: 'cache-first',
      cacheDecision: expect.stringContaining('no reusable cache rows matched the requirement'),
    })
  })

  it('rejects strict providers that are not eligible for the interface', async () => {
    const { fetchMoneyFlow } = await import('../../src/agent/data/fetchers/fetcher-money-flow')

    await expect(fetchMoneyFlow('600519', 30, { provider: 'tushare', providerMode: 'strict' }))
      .rejects.toThrow(/stock money flow interface providers failed.*tushare:disabled/)
  })

  it('uses direct EastMoney fund list, NAV, and performance before AkShare wrappers', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('fundcode_search.js')) {
        return {
          ok: true,
          status: 200,
          text: async () => 'var r = [["000001","HXCZHH","华夏成长混合","混合型-灵活","HUAXIACHENGZHANGHUNHE"]];',
        } as Response
      }
      if (url.includes('fund.eastmoney.com/pingzhongdata/000001.js')) {
        return {
          ok: true,
          status: 200,
          text: async () => 'var Data_netWorthTrend = [{"x":1781136000000,"y":1.234,"equityReturn":0.12,"unitMoney":""}];',
        } as Response
      }
      if (url.includes('fund.eastmoney.com/pingzhongdata/000009.js')) {
        return {
          ok: true,
          status: 200,
          text: async () => 'var Data_millionCopiesIncome = [[1781136000000,0.4567]]; var Data_sevenDaysYearIncome = [[1781136000000,1.234]];',
        } as Response
      }
      if (url.includes('fund.eastmoney.com/data/rankhandler.aspx')) {
        return {
          ok: true,
          status: 200,
          text: async () => 'var rankData = {datas:["000001,华夏成长混合,HXCZHH,2026-06-18,1.234,1.234,0.1,1.2,3.4,5.6,7.8,9.1,10.2,,6.5,20.1,2001-12-18,1,20.1"],allRecords:1,pageIndex:1,pageNum:1,allPages:1,allNum:1};',
        } as Response
      }
      throw new Error(`unexpected URL ${url}`)
    }))

    const { fetchFundList, fetchFundPerformanceMetrics } = await import('../../src/agent/data/fetchers/fetcher-fund-list')
    const { fetchFundMoneyYield } = await import('../../src/agent/data/fetchers/fetcher-fund-money-yield')
    const { fetchFundNav } = await import('../../src/agent/data/fetchers/fetcher-fund-nav')

    const fundList = await fetchFundList()
    expect(fundList.data[0]).toMatchObject({ code: '000001', name: '华夏成长混合', fund_type: '混合型-灵活' })
    expect(fundList.provenance).toMatchObject({
      interfaceId: 'fund.identity_list',
      capabilityId: 'eastmoney.fund.identity_list',
      provider: 'eastmoney',
      cacheStatus: 'provider-hit',
    })
    const nav = await fetchFundNav('000001')
    expect(nav.data[0]).toMatchObject({ code: '000001', date: '2026-06-11', nav: 1.234, daily_return: 0.12, source: 'eastmoney' })
    expect(nav.provenance).toMatchObject({
      interfaceId: 'fund.nav_history',
      capabilityId: 'eastmoney.fund.nav_history',
      provider: 'eastmoney',
      cacheStatus: 'provider-hit',
    })
    const moneyYield = await fetchFundMoneyYield('000009')
    expect(moneyYield.data[0]).toMatchObject({
      code: '000009',
      date: '2026-06-11',
      million_copies_income: 0.4567,
      seven_day_annualized_yield: 1.234,
      source: 'eastmoney',
    })
    expect(moneyYield.provenance).toMatchObject({
      interfaceId: 'fund.money_yield_history',
      capabilityId: 'eastmoney.fund.money_yield_history',
      provider: 'eastmoney',
      canonicalSchema: 'fund_money_yield',
      canonicalTable: 'fund_money_yield',
      cacheStatus: 'provider-hit',
    })
    const performance = await fetchFundPerformanceMetrics({ skipCache: true })
    expect(performance.data[0]).toMatchObject({
      code: '000001',
      metric_date: '2026-06-18',
      provider: 'eastmoney',
      capability_id: 'eastmoney.fund.performance_metrics',
      source_action: 'rankhandler.aspx',
      nav: 1.234,
      return_ytd: 6.5,
      return_since_inception: 20.1,
    })
    expect(performance.provenance).toMatchObject({
      interfaceId: 'fund.performance_metrics',
      capabilityId: 'eastmoney.fund.performance_metrics',
      provider: 'eastmoney',
      cacheStatus: 'provider-hit',
    })
    expect(calls).toHaveLength(4)
    expect(calls[0]).toContain('fund.eastmoney.com/js/fundcode_search.js')
    expect(calls[1]).toContain('fund.eastmoney.com/pingzhongdata/000001.js')
    expect(calls[2]).toContain('fund.eastmoney.com/pingzhongdata/000009.js')
    expect(calls[3]).toContain('fund.eastmoney.com/data/rankhandler.aspx')
    expect(calls.every((url) => !url.includes('_provider=eastmoney'))).toBe(true)
  })

  it('uses direct EastMoney fund holding and manager feeds before AkShare wrappers', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('FundArchivesDatas.aspx')) {
        return {
          ok: true,
          status: 200,
          text: async () => "var apidata={ content:\"<div><h4 class='t'><label>测试&nbsp;&nbsp;2026年1季度股票投资明细</label><label>截止至：<font class='px12'>2026-03-31</font></label></h4><table><tbody><tr><td>1</td><td><a href='//quote.eastmoney.com/unify/r/1.600519'>600519</a></td><td class='tol'><a href='//quote.eastmoney.com/unify/r/1.600519'>贵州茅台</a></td><td class='xglj'></td><td class='tor'>5.33%</td><td class='tor'>275.79</td><td class='tor'>13,392.49</td></tr></tbody></table></div>\"};",
        } as Response
      }
      if (url.includes('FundDataPortfolio_Interface.aspx')) {
        return {
          ok: true,
          status: 200,
          text: async () => 'var returnjson= {data:[["m1","张三","c1","测试基金","000001,000002","基金A,基金B","365","12.3%","000001","基金A","100.5亿元","12.3%"]],record:1,pages:1,curpage:1}',
        } as Response
      }
      throw new Error(`unexpected URL ${url}`)
    }))

    const { fetchFundHolding } = await import('../../src/agent/data/fetchers/fetcher-fund-holding')
    const { fetchFundManagers } = await import('../../src/agent/data/fetchers/fetcher-fund-manager')

    const holding = await fetchFundHolding('000001', { skipCache: true })
    expect(holding.data[0]).toMatchObject({
      fund_code: '000001',
      stock_code: '600519',
      stock_name: '贵州茅台',
      hold_pct: 5.33,
      hold_value: 13392.49,
      source: 'eastmoney',
    })
    expect(holding.provenance).toMatchObject({
      interfaceId: 'fund.holding',
      capabilityId: 'eastmoney.fund.holding',
      provider: 'eastmoney',
    })
    const managers = await fetchFundManagers({ skipCache: true })
    expect(managers.data[0]).toMatchObject({
      manager_id: 'm1',
      name: '张三',
      company: '测试基金',
      total_size: 100.5,
      fund_count: 2,
      best_return: 12.3,
      source: 'eastmoney',
    })
    expect(managers.provenance).toMatchObject({
      interfaceId: 'fund.manager',
      capabilityId: 'eastmoney.fund.manager',
      provider: 'eastmoney',
    })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('fundf10.eastmoney.com/FundArchivesDatas.aspx')
    expect(calls[0]).not.toContain('_provider=eastmoney')
    expect(calls[1]).toContain('fund.eastmoney.com/Data/FundDataPortfolio_Interface.aspx')
    expect(calls[1]).not.toContain('_provider=eastmoney')
  })

  it('keeps stock-list fallback explicit: TDX, Sina, direct EastMoney, then AkShare wrapper', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('127.0.0.1:19801/stock_list')) return jsonResponse({ List: [] })
      if (url.includes('Market_Center.getHQNodeData')) return jsonResponse([])
      if (url.includes('push2delay.eastmoney.com/api/qt/clist/get')) {
        return jsonResponse({ data: { diff: [{ f12: '600519', f14: '贵州茅台' }] } })
      }
      throw new Error(`unexpected URL ${url}`)
    }))

    const { fetchStockListA } = await import('../../src/agent/data/fetchers/fetcher-stock-list')
    const result = await fetchStockListA()

    expect(result.data[0]).toMatchObject({ code: '600519', name: '贵州茅台', market: 'SH' })
    expect(calls.some((url) => url.includes('127.0.0.1:19801/stock_list'))).toBe(true)
    expect(calls.some((url) => url.includes('Market_Center.getHQNodeData'))).toBe(true)
    expect(calls.some((url) => url.includes('push2delay.eastmoney.com/api/qt/clist/get'))).toBe(true)
    expect(calls.some((url) => url.includes('/akshare/stock_zh_a_spot_em'))).toBe(false)
    expect(result.provenance).toMatchObject({
      interfaceId: 'stock.identity_list',
      capabilityId: 'eastmoney.stock.identity_list',
      provider: 'eastmoney',
      cacheStatus: 'provider-hit',
    })
  })

  it('uses explicit EastMoney sidecar hints for HK and US stock lists', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('stock_hk_spot_em')) return jsonResponse({ data: [{ 代码: '00700', 名称: '腾讯控股' }] })
      if (url.includes('stock_us_spot_em')) return jsonResponse({ data: [{ 代码: 'AAPL', 名称: 'Apple' }] })
      throw new Error(`unexpected URL ${url}`)
    }))

    const { fetchStockListHK, fetchStockListUS } = await import('../../src/agent/data/fetchers/fetcher-stock-list')
    expect((await fetchStockListHK()).data[0]).toMatchObject({ code: '00700', market: 'HK' })
    expect((await fetchStockListUS()).data[0]).toMatchObject({ code: 'AAPL', market: 'US' })
    expect(calls).toHaveLength(2)
    expect(calls.every((url) => url.includes('_provider=eastmoney'))).toBe(true)
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}
