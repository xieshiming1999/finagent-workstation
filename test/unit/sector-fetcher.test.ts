import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSectorRanking } from '../../src/agent/data/fetchers/fetcher-sector'

describe('sector ranking fetcher', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('routes strict TDX sector ranking through gotdx MAC board list', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-04T10:00:00.000Z'))
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('http://127.0.0.1:19801/mac/board_list')
      return {
        ok: true,
        json: async () => ({
          List: [
            {
              Code: 'BK0475',
              Name: '白酒',
              Price: 101.5,
              PreClose: 100,
              SymbolName: '贵州茅台',
              SymbolRiseSpeed: 2.2,
            },
          ],
        }),
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchSectorRanking('industry', {
      provider: 'tdx',
      providerMode: 'strict',
      cacheMode: 'live-only',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.data).toEqual([
      {
        date: '2026-06-04',
        sector_type: 'industry',
        code: 'BK0475',
        name: '白酒',
        change_pct: 1.5,
        turnover_rate: null,
        up_count: 0,
        down_count: 0,
        leading_stock: '贵州茅台',
        leading_pct: 2.2,
        rank: 1,
        source: 'tdx:mac',
      },
    ])
    expect(result.provenance).toMatchObject({
      interfaceId: 'market.sector_ranking',
      capabilityId: 'tdx.market.sector_ranking',
      provider: 'tdx',
      source: 'tdx:mac',
      canonicalSchema: 'sector_rank',
      canonicalTable: 'sector_ranking',
      cacheStatus: 'provider-hit',
      cacheMode: 'live-only',
    })
  })

  it('routes strict Sina sector ranking through the direct Sina capability', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-22T10:00:00.000Z'))
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('newSinaHy.php')
      return new Response(
        'var S_Finance_bankuai_sinaindustry = {"new_blhy":"new_blhy,玻璃行业,19,22.58,0.58,2.63,1320,31020,sz300196,10.48,32.99,3.13,长海股份"}',
        {
          status: 200,
          headers: { 'content-type': 'text/javascript; charset=utf-8' },
        },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchSectorRanking('industry', {
      provider: 'sina',
      providerMode: 'strict',
      cacheMode: 'live-only',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.data).toEqual([
      {
        date: '2026-06-22',
        sector_type: 'industry',
        code: 'new_blhy',
        name: '玻璃行业',
        change_pct: 2.63,
        turnover_rate: null,
        up_count: 0,
        down_count: 0,
        leading_stock: '长海股份',
        leading_pct: 10.48,
        rank: 1,
        source: 'sina',
      },
    ])
    expect(result.provenance).toMatchObject({
      interfaceId: 'market.sector_ranking',
      capabilityId: 'sina.market.sector_ranking',
      provider: 'sina',
      source: 'sina',
      canonicalSchema: 'sector_rank',
      canonicalTable: 'sector_ranking',
      cacheStatus: 'provider-hit',
      cacheMode: 'live-only',
    })
  })

  it('routes strict Sina concept ranking through the board-ranking interface', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-22T10:00:00.000Z'))
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('newFLJK.php?param=class')
      return new Response(
        'var S_Finance_bankuai_sinahygn = {"gn_gfgn":"gn_gfgn,固废处理,15,18.0,0.42,2.39,880,16000,sz300070,9.91,12.0,1.1,碧水源"}',
        {
          status: 200,
          headers: { 'content-type': 'text/javascript; charset=utf-8' },
        },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchSectorRanking('concept', {
      interfaceId: 'market.board_ranking',
      provider: 'sina',
      providerMode: 'strict',
      cacheMode: 'live-only',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.data).toEqual([
      {
        date: '2026-06-22',
        sector_type: 'concept',
        code: 'gn_gfgn',
        name: '固废处理',
        change_pct: 2.39,
        turnover_rate: null,
        up_count: 0,
        down_count: 0,
        leading_stock: '碧水源',
        leading_pct: 9.91,
        rank: 1,
        source: 'sina',
      },
    ])
    expect(result.provenance).toMatchObject({
      interfaceId: 'market.board_ranking',
      capabilityId: 'sina.market.board_ranking',
      provider: 'sina',
      source: 'sina',
      canonicalSchema: 'sector_rank',
      canonicalTable: 'sector_ranking',
      cacheStatus: 'provider-hit',
      cacheMode: 'live-only',
    })
  })
})
