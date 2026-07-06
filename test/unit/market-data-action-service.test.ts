import { describe, expect, it } from 'vitest'

import type { ToolContext } from '../../src/agent/tool'
import { BacktestMarketDataActionService } from '../../src/domain/market/services/backtest-market-data-action-service'
import { BacktestMarketDataService } from '../../src/domain/market/services/backtest-market-data-service'
import { EastmoneyMarketDataActionService } from '../../src/domain/market/services/eastmoney-market-data-action-service'
import { FlowMarketDataActionService } from '../../src/domain/market/services/flow-market-data-action-service'
import { FlowMarketDataService } from '../../src/domain/market/services/flow-market-data-service'
import { MarketDataActionService } from '../../src/domain/market/services/market-data-action-service'
import { MarketDataReadActionService } from '../../src/domain/market/services/market-data-read-action-service'
import { MarketDataResolveService } from '../../src/domain/market/services/market-data-resolve-service'
import { ScanMarketDataActionService } from '../../src/domain/market/services/scan-market-data-action-service'
import { ScanMarketDataService } from '../../src/domain/market/services/scan-market-data-service'
import { TdxMarketDataActionService } from '../../src/domain/market/services/tdx-market-data-action-service'
import { TushareMarketDataActionService } from '../../src/domain/market/services/tushare-market-data-action-service'
import { TushareMarketDataService } from '../../src/domain/market/services/tushare-market-data-service'
import { TransactionsMarketDataActionService } from '../../src/domain/market/services/transactions-market-data-action-service'
import { YahooMarketDataActionService } from '../../src/domain/market/services/yahoo-market-data-action-service'

const ctx = {} as ToolContext

describe('MarketDataActionService', () => {
  it('routes quote-family actions through the read action boundary', async () => {
    const service = new MarketDataActionService(
      new FakeReadActionService(),
      new FlowMarketDataActionService(new FlowMarketDataService()),
      new BacktestMarketDataActionService(new BacktestMarketDataService()),
      new ScanMarketDataActionService(new ScanMarketDataService()),
      new TushareMarketDataActionService(new TushareMarketDataService()),
    )

    await expect(service.call('quote', { code: '600519' }, ctx)).resolves.toContain('Fake Quote')
  })

  it('routes flow actions through the flow action boundary', async () => {
    const service = new MarketDataActionService(
      new FakeReadActionService(),
      new FakeFlowActionService(),
      new BacktestMarketDataActionService(new BacktestMarketDataService()),
      new ScanMarketDataActionService(new ScanMarketDataService()),
      new TushareMarketDataActionService(new TushareMarketDataService()),
    )

    await expect(service.call('flow', { code: '600519' }, ctx)).resolves.toBe('fake-flow')
  })

  it('routes broad flow actions without code to flow_rank instead of failing code validation', async () => {
    const service = new MarketDataActionService(
      new FakeReadActionService(),
      new FakeFlowActionService(),
      new BacktestMarketDataActionService(new BacktestMarketDataService()),
      new ScanMarketDataActionService(new ScanMarketDataService()),
      new TushareMarketDataActionService(new TushareMarketDataService()),
      new FakeEastmoneyActionService(),
    )

    await expect(service.call('flow', { limit: 20 }, ctx)).resolves.toBe('fake-eastmoney:flow_rank')
  })

  it('routes tdx handler actions through the tdx boundary', async () => {
    const service = new MarketDataActionService(
      new FakeReadActionService(),
      new FlowMarketDataActionService(new FlowMarketDataService()),
      new BacktestMarketDataActionService(new BacktestMarketDataService()),
      new ScanMarketDataActionService(new ScanMarketDataService()),
      new TushareMarketDataActionService(new TushareMarketDataService()),
      new FakeEastmoneyActionService(),
      new FakeYahooActionService(),
      new TransactionsMarketDataActionService(),
      new FakeTdxActionService(),
    )

    await expect(service.call('tdx_count', {}, ctx)).resolves.toBe('fake-tdx')
  })

  it('routes yahoo handler actions through the yahoo boundary', async () => {
    const service = new MarketDataActionService(
      new FakeReadActionService(),
      new FlowMarketDataActionService(new FlowMarketDataService()),
      new BacktestMarketDataActionService(new BacktestMarketDataService()),
      new ScanMarketDataActionService(new ScanMarketDataService()),
      new TushareMarketDataActionService(new TushareMarketDataService()),
      new EastmoneyMarketDataActionService(),
      new FakeYahooActionService(),
      new TdxMarketDataActionService(),
    )

    await expect(service.call('yahoo_history', { code: 'AAPL' }, ctx)).resolves.toBe('fake-yahoo')
  })

  it('routes eastmoney handler actions through the eastmoney boundary', async () => {
    const service = new MarketDataActionService(
      new FakeReadActionService(),
      new FlowMarketDataActionService(new FlowMarketDataService()),
      new BacktestMarketDataActionService(new BacktestMarketDataService()),
      new ScanMarketDataActionService(new ScanMarketDataService()),
      new TushareMarketDataActionService(new TushareMarketDataService()),
      new FakeEastmoneyActionService(),
      new YahooMarketDataActionService(),
      new TdxMarketDataActionService(),
    )

    await expect(service.call('sector', {}, ctx)).resolves.toBe('fake-eastmoney:sector')
  })

  it('routes scan actions through the scan action boundary', async () => {
    const service = new MarketDataActionService(
      new FakeReadActionService(),
      new FlowMarketDataActionService(new FlowMarketDataService()),
      new BacktestMarketDataActionService(new BacktestMarketDataService()),
      new FakeScanActionService(),
      new TushareMarketDataActionService(new TushareMarketDataService()),
    )

    await expect(service.call('scan', { code: 'NASDAQ:AAPL' }, ctx)).resolves.toBe('fake-scan')
  })

  it('routes tushare actions through the tushare action boundary', async () => {
    const service = new MarketDataActionService(
      new FakeReadActionService(),
      new FlowMarketDataActionService(new FlowMarketDataService()),
      new BacktestMarketDataActionService(new BacktestMarketDataService()),
      new ScanMarketDataActionService(new ScanMarketDataService()),
      new FakeTushareActionService(),
    )

    await expect(service.call('tushare', { api_name: 'daily' }, ctx)).resolves.toBe('fake-tushare')
  })

  it('routes backtest actions through the backtest action boundary', async () => {
    const service = new MarketDataActionService(
      new FakeReadActionService(),
      new FlowMarketDataActionService(new FlowMarketDataService()),
      new FakeBacktestActionService(),
      new ScanMarketDataActionService(new ScanMarketDataService()),
      new TushareMarketDataActionService(new TushareMarketDataService()),
    )

    await expect(service.call('backtest', { code: '600519' }, ctx)).resolves.toBe('fake-backtest')
  })
})

class FakeReadActionService extends MarketDataReadActionService {
  constructor() {
    super(new MarketDataResolveService())
  }

  async readAction(): Promise<string> {
    return 'Fake Quote'
  }
}

class FakeYahooActionService extends YahooMarketDataActionService {
  async readAction(): Promise<string> {
    return 'fake-yahoo'
  }
}

class FakeTdxActionService extends TdxMarketDataActionService {
  async readAction(): Promise<string> {
    return 'fake-tdx'
  }
}

class FakeEastmoneyActionService extends EastmoneyMarketDataActionService {
  async readAction(action: string): Promise<string> {
    return `fake-eastmoney:${action}`
  }
}

class FakeFlowActionService extends FlowMarketDataActionService {
  constructor() {
    super(new FlowMarketDataService())
  }

  async readAction(): Promise<string> {
    return 'fake-flow'
  }
}

class FakeScanActionService extends ScanMarketDataActionService {
  constructor() {
    super(new ScanMarketDataService())
  }

  async readAction(): Promise<string> {
    return 'fake-scan'
  }
}

class FakeTushareActionService extends TushareMarketDataActionService {
  constructor() {
    super(new TushareMarketDataService())
  }

  async readAction(): Promise<string> {
    return 'fake-tushare'
  }
}

class FakeBacktestActionService extends BacktestMarketDataActionService {
  constructor() {
    super(new BacktestMarketDataService())
  }

  async readAction(): Promise<string> {
    return 'fake-backtest'
  }
}
