import { describe, expect, it } from 'vitest'

import type { ToolContext } from '../../src/agent/tool'
import { TdxMarketDataActionService } from '../../src/domain/market/services/tdx-market-data-action-service'
import { TdxMarketDataService } from '../../src/domain/market/services/tdx-market-data-service'

const ctx = {} as ToolContext

describe('TdxMarketDataActionService', () => {
  it('routes tdx direct actions through the tdx domain service boundary', async () => {
    const service = new TdxMarketDataActionService(new FakeTdxMarketDataService())

    await expect(service.readAction('tdx_count', {}, ctx, '', 20)).resolves.toContain('"source": "fake-tdx-service"')
  })
})

class FakeTdxMarketDataService extends TdxMarketDataService {
  async readDirectAction(): Promise<unknown> {
    return {
      action: 'tdx_count',
      source: 'fake-tdx-service',
      count: 1,
    }
  }
}
