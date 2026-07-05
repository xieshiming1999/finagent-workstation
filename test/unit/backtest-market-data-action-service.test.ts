import { describe, expect, it } from 'vitest'

import type { ToolContext } from '../../src/agent/tool'
import { BacktestMarketDataActionService } from '../../src/domain/market/services/backtest-market-data-action-service'
import { BacktestMarketDataService } from '../../src/domain/market/services/backtest-market-data-service'

const ctx = {} as ToolContext

describe('BacktestMarketDataActionService', () => {
  it('routes backtest actions through the backtest domain service boundary', async () => {
    const service = new BacktestMarketDataActionService(new FakeBacktestMarketDataService())

    await expect(service.readAction('backtest', { strategy: 'rsi' }, ctx, '600519', 20)).resolves.toBe('fake-backtest')
  })
})

class FakeBacktestMarketDataService extends BacktestMarketDataService {
  async readAction(): Promise<string> {
    return 'fake-backtest'
  }
}
