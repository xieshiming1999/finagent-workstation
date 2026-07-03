import type { Tool } from '../tool'
import { MarketDataActionService } from '../../domain/market/services/market-data-action-service'
import { MarketDataActionServiceFactory } from '../../domain/market/services/market-data-action-service-factory'
import { MARKET_DATA_SCHEMA, validateMarketDataInput } from './market-data-schema'
import { callMarketDataAction } from './market-data-dispatch'

export class MarketDataTool implements Tool {
  readonly actionService: MarketDataActionService

  name = 'MarketData'
  description = 'Fetch market data through requirement-level routes: A-share quotes/kline/flow/sector/valuation/chip, global prices/history/earnings (Yahoo), TradingView Scanner, TDX diagnostics, ExQuote, backtest with enhanced/composite/batch/optimize. Use action="help".'
  isReadOnly = true
  canParallel = true
  inputSchema = MARKET_DATA_SCHEMA

  constructor(
    actionService: MarketDataActionService = MarketDataActionServiceFactory.create(),
  ) {
    this.actionService = actionService
  }

  validateInput(input: Record<string, unknown>): string | null {
    return validateMarketDataInput(input)
  }

  async call(_id: string, input: Record<string, unknown>, ctx: Parameters<Tool['call']>[2]): Promise<string> {
    return callMarketDataAction(this, input, ctx)
  }
}
