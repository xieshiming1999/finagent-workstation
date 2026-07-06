import { describe, expect, it } from 'vitest'

import type { ToolContext } from '../../src/agent/tool'
import { TushareMarketDataActionService } from '../../src/domain/market/services/tushare-market-data-action-service'
import { TushareMarketDataService } from '../../src/domain/market/services/tushare-market-data-service'

const ctx = {} as ToolContext

describe('TushareMarketDataActionService', () => {
  it('routes tushare actions through the tushare domain service boundary', async () => {
    const service = new TushareMarketDataActionService(new FakeTushareMarketDataService())

    await expect(service.readAction({ api_name: 'daily' }, ctx, '600519', 20)).resolves.toBe('fake-tushare')
  })
})

class FakeTushareMarketDataService extends TushareMarketDataService {
  async readAction(): Promise<string> {
    return 'fake-tushare'
  }
}
