import { describe, expect, it } from 'vitest'

import type { ToolContext } from '../../src/agent/tool'
import { YahooMarketDataActionService } from '../../src/domain/market/services/yahoo-market-data-action-service'
import { YahooMarketDataService } from '../../src/domain/market/services/yahoo-market-data-service'

const ctx = {} as ToolContext

describe('YahooMarketDataActionService', () => {
  it('routes yahoo actions through the yahoo domain service boundary', async () => {
    const service = new YahooMarketDataActionService(new FakeYahooMarketDataService())

    await expect(service.readAction('yahoo_history', {}, ctx, 'AAPL', 20)).resolves.toBe('fake-yahoo-service')
  })
})

class FakeYahooMarketDataService extends YahooMarketDataService {
  async readAction(): Promise<string> {
    return 'fake-yahoo-service'
  }
}
