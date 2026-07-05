import { afterEach, describe, expect, it, vi } from 'vitest'

describe('ETF quote fetcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes AkShare ETF sidecar rows to stock identities and quote snapshots', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        data: [
          { '代码': '510300', '名称': '沪深300ETF', '最新价': 4.2, '涨跌幅': 0.72, '成交量': 100000 },
        ],
      }),
    } as Response))
    vi.stubGlobal('fetch', fetchMock)

    const { fetchEtfQuotes } = await import('../../src/agent/data/fetchers/fetcher-etf')
    const result = await fetchEtfQuotes(10, 'akshare')

    expect(String(fetchMock.mock.calls[0][0])).toContain('/akshare/fund_etf_spot_em')
    expect(result.stocks).toEqual([
      expect.objectContaining({ code: '510300', name: '沪深300ETF', stock_type: 'etf' }),
    ])
    expect(result.quotes).toEqual([
      expect.objectContaining({ code: '510300', name: '沪深300ETF', price: 4.2, change_pct: 0.72, source: 'akshare:etf' }),
    ])
  })

  it('normalizes direct Sina ETF JSONP rows to stock identities and quote snapshots', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => `/*<script>location.href='//sina.com';</script>*/
IO.XSRV2.CallbackList['da_yPT46_Ll7K6WD']([{"symbol":"sz159998","name":"计算机ETF天弘","trade":"1.045","pricechange":"0.034","changepercent":"3.363","settlement":"1.011","open":"1.007","high":"1.045","low":"1.001","volume":"12345","amount":"67890"}])`,
    } as Response))
    vi.stubGlobal('fetch', fetchMock)

    const { fetchEtfQuotes } = await import('../../src/agent/data/fetchers/fetcher-etf')
    const result = await fetchEtfQuotes(10, 'sina')

    expect(String(fetchMock.mock.calls[0][0])).toContain('Market_Center.getHQNodeDataSimple')
    expect(result.stocks).toEqual([
      expect.objectContaining({ code: '159998', name: '计算机ETF天弘', stock_type: 'etf' }),
    ])
    expect(result.quotes).toEqual([
      expect.objectContaining({
        code: '159998',
        name: '计算机ETF天弘',
        price: 1.045,
        change: 0.034,
        change_pct: 3.363,
        source: 'sina:etf',
      }),
    ])
  })
})
