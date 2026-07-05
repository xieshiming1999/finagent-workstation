import { describe, expect, it, vi } from 'vitest'

import type { ToolContext } from '../../src/agent/tool'
import { EastmoneyMarketDataActionService } from '../../src/domain/market/services/eastmoney-market-data-action-service'
import { EastmoneyMarketDataService } from '../../src/domain/market/services/eastmoney-market-data-service'

const ctx = {} as ToolContext

describe('EastmoneyMarketDataActionService', () => {
  it('routes sector actions through the eastmoney domain service boundary', async () => {
    const persistence = { persist: vi.fn() }
    const service = new EastmoneyMarketDataActionService(new FakeEastmoneyMarketDataService(), persistence as any)

    await expect(service.readAction('sector', {}, ctx, '', 20)).resolves.toContain('Fake Sector')
    expect(persistence.persist).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ kind: 'sector_ranking' }),
    )
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
    }
  }
}
