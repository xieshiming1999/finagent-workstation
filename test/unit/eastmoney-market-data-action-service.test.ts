import { describe, expect, it, vi } from 'vitest'

import type { ToolContext } from '../../src/agent/tool'
import { EastmoneyMarketDataActionService } from '../../src/domain/market/services/eastmoney-market-data-action-service'
import { EastmoneyMarketDataService } from '../../src/domain/market/services/eastmoney-market-data-service'

const ctx = {} as ToolContext

describe('EastmoneyMarketDataActionService', () => {
  it('routes sector actions through the eastmoney domain service boundary', async () => {
    const persistence = { persist: vi.fn() }
    const service = new EastmoneyMarketDataActionService(new FakeEastmoneyMarketDataService(), persistence as any)

    const output = await service.readAction('sector', {}, ctx, '', 20)

    expect(output).toContain('Fake Sector')
    expect(output).toContain('Sector provenance:')
    expect(output).toContain('interface=market.sector_ranking')
    expect(output).toContain('cache=provider-hit')
    expect(output).toContain('asOf=2026-07-06')
    expect(persistence.persist).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ kind: 'sector_ranking' }),
    )
  })

  it('keeps flow-rank provenance visible in tool output', async () => {
    const persistence = { persist: vi.fn() }
    const service = new EastmoneyMarketDataActionService(new FakeEastmoneyMarketDataService(), persistence as any)

    const output = await service.readAction('flow_rank', {}, ctx, '', 20)

    expect(output).toContain('Fake Flow')
    expect(output).toContain('Flow-rank provenance:')
    expect(output).toContain('interface=market.flow_rank')
    expect(output).toContain('cache=provider-hit')
    expect(output).toContain('asOf=2026-07-06')
  })
})

class FakeEastmoneyMarketDataService extends EastmoneyMarketDataService {
  async readSectorWithOptions(): Promise<any> {
    return {
      kind: 'sector_ranking',
      sectorType: 'industry',
      sectors: [
        {
          code: 'BK001',
          name: 'Fake Sector',
          changePct: 1.23,
          upCount: 10,
          downCount: 2,
          leadingStock: 'FAKE',
        },
      ],
      provenance: {
        interfaceId: 'market.sector_ranking',
        provider: 'fake',
        source: 'fake',
        capabilityId: 'fake.market.sector_ranking',
        cacheStatus: 'provider-hit',
        asOf: '2026-07-06',
        fetchedAt: '2026-07-06T09:31:00+08:00',
        canonicalSchema: 'sector_rank',
        canonicalTable: 'sector_ranking',
        endpoint: 'fixture:sector',
      },
    }
  }

  async readFlowRankWithOptions(): Promise<any> {
    return {
      kind: 'flow_rank',
      period: '1d',
      items: [
        {
          code: '600000',
          name: 'Fake Flow',
          mainNetInflow: 123456,
          changePct: 1.2,
        },
      ],
      provenance: {
        interfaceId: 'market.flow_rank',
        provider: 'fake',
        source: 'fake',
        capabilityId: 'fake.market.flow_rank',
        cacheStatus: 'provider-hit',
        asOf: '2026-07-06',
        fetchedAt: '2026-07-06T09:31:00+08:00',
        canonicalSchema: 'flow_rank',
        canonicalTable: 'flow_rank',
        endpoint: 'fixture:flow_rank',
      },
    }
  }
}
