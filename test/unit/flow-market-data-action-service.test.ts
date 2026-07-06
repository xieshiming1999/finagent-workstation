import { describe, expect, it } from 'vitest'

import type { ToolContext } from '../../src/agent/tool'
import { FlowMarketDataActionService } from '../../src/domain/market/services/flow-market-data-action-service'
import { FlowMarketDataService } from '../../src/domain/market/services/flow-market-data-service'

const ctx = {} as ToolContext

describe('FlowMarketDataActionService', () => {
  it('routes flow actions through the flow domain service boundary', async () => {
    const service = new FlowMarketDataActionService(new FakeFlowMarketDataService())

    await expect(service.readAction(ctx, '600519', 20)).resolves.toContain('Fake Flow')
  })
})

class FakeFlowMarketDataService extends FlowMarketDataService {
  async readFlow(): Promise<string> {
    return 'Fake Flow'
  }
}
