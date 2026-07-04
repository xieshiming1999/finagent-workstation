import { BacktestMarketDataActionService } from './backtest-market-data-action-service'
import { BacktestMarketDataService } from './backtest-market-data-service'
import { EastmoneyMarketDataActionService } from './eastmoney-market-data-action-service'
import { FlowMarketDataActionService } from './flow-market-data-action-service'
import { FlowMarketDataService } from './flow-market-data-service'
import { MarketDataActionService } from './market-data-action-service'
import { MarketDataReadActionService } from './market-data-read-action-service'
import { MarketDataResolveService } from './market-data-resolve-service'
import { ScanMarketDataActionService } from './scan-market-data-action-service'
import { ScanMarketDataService } from './scan-market-data-service'
import { TdxMarketDataActionService } from './tdx-market-data-action-service'
import { TransactionsMarketDataActionService } from './transactions-market-data-action-service'
import { TushareMarketDataActionService } from './tushare-market-data-action-service'
import { TushareMarketDataService } from './tushare-market-data-service'
import { YahooMarketDataActionService } from './yahoo-market-data-action-service'

export class MarketDataActionServiceFactory {
  static create(): MarketDataActionService {
    return new MarketDataActionService(
      new MarketDataReadActionService(new MarketDataResolveService()),
      new FlowMarketDataActionService(new FlowMarketDataService()),
      new BacktestMarketDataActionService(new BacktestMarketDataService()),
      new ScanMarketDataActionService(new ScanMarketDataService()),
      new TushareMarketDataActionService(new TushareMarketDataService()),
      new EastmoneyMarketDataActionService(),
      new YahooMarketDataActionService(),
      new TransactionsMarketDataActionService(),
      new TdxMarketDataActionService(),
    )
  }
}
