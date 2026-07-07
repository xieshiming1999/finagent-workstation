import type { ToolContext } from '../../../agent/tool'
import { toolError } from '../../../agent/tool'
import { BacktestMarketDataActionService } from './backtest-market-data-action-service'
import { EastmoneyMarketDataActionService } from './eastmoney-market-data-action-service'
import { FlowMarketDataActionService } from './flow-market-data-action-service'
import { MarketDataReadActionService } from './market-data-read-action-service'
import { ScanMarketDataActionService } from './scan-market-data-action-service'
import { TdxMarketDataActionService } from './tdx-market-data-action-service'
import { TushareMarketDataActionService } from './tushare-market-data-action-service'
import { TransactionsMarketDataActionService } from './transactions-market-data-action-service'
import { YahooMarketDataActionService } from './yahoo-market-data-action-service'

export class MarketDataActionService {
  constructor(
    private readonly readActionService: MarketDataReadActionService = new MarketDataReadActionService(),
    private readonly flowActionService: FlowMarketDataActionService = new FlowMarketDataActionService(),
    private readonly backtestActionService: BacktestMarketDataActionService = new BacktestMarketDataActionService(),
    private readonly scanActionService: ScanMarketDataActionService = new ScanMarketDataActionService(),
    private readonly tushareActionService: TushareMarketDataActionService = new TushareMarketDataActionService(),
    private readonly eastmoneyActionService: EastmoneyMarketDataActionService = new EastmoneyMarketDataActionService(),
    private readonly yahooActionService: YahooMarketDataActionService = new YahooMarketDataActionService(),
    private readonly transactionsActionService: TransactionsMarketDataActionService = new TransactionsMarketDataActionService(),
    private readonly tdxActionService: TdxMarketDataActionService = new TdxMarketDataActionService(),
  ) {}

  async call(
    action: string,
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<string> {
    const code = codeInput(input)
    const limit = Number(input.limit ?? 60)

    switch (action) {
      case 'quote':
      case 'kline':
        return this.readActionService.readAction(action, input, ctx, code, limit)

      case 'flow':
        if (!code) {
          return this.eastmoneyActionService.readAction('flow_rank', input, ctx, code, limit)
        }
        return this.flowActionService.readAction(ctx, code, limit)

      case 'sector':
      case 'limit_up':
      case 'dragon_tiger':
      case 'northbound':
      case 'hot_rank':
      case 'flow_rank':
      case 'limit_down':
      case 'unusual':
      case 'chip':
      case 'etf':
      case 'earnings':
        return this.eastmoneyActionService.readAction(action, input, ctx, code, limit)

      case 'transactions':
        return this.transactionsActionService.readAction(input, ctx, code, limit)

      case 'yahoo':
      case 'yahoo_history':
      case 'yahoo_earnings':
      case 'yahoo_news':
      case 'yahoo_options':
      case 'yahoo_actions':
        return this.yahooActionService.readAction(action, input, ctx, code, limit)

      case 'scan':
        return this.scanActionService.readAction(code, input, ctx)

      case 'tushare':
        return this.tushareActionService.readAction(input, ctx, code, limit)

      case 'backtest':
      case 'backtest_enhanced':
      case 'backtest_composite':
      case 'backtest_batch':
      case 'optimize_params':
      case 'custom_strategy_help':
      case 'custom_strategy_validate':
      case 'custom_strategy_backtest':
      case 'custom_strategy_observe':
      case 'custom_strategy_fund_backtest':
      case 'custom_strategy_rank':
      case 'custom_strategy_save':
      case 'custom_strategy_list':
      case 'custom_strategy_read':
      case 'custom_strategy_compare':
      case 'custom_strategy_run':
        return this.backtestActionService.readAction(action, input, ctx, code, limit)

      case 'tdx_tick_chart':
      case 'tdx_transactions':
      case 'tdx_finance':
      case 'tdx_xdxr':
      case 'tdx_unusual':
      case 'tdx_index_info':
      case 'tdx_count':
      case 'tdx_sampling':
      case 'tdx_stock_list':
      case 'tdx_block':
      case 'tdx_company_info':
      case 'ex_categories':
      case 'ex_count':
      case 'ex_sampling':
      case 'ex_table':
      case 'ex_kline':
      case 'ex_quote':
      case 'ex_list':
        return this.tdxActionService.readAction(action, input, ctx, code, limit)

      default:
        return toolError(`unknown action "${action}". Use action="help" for available actions.`)
    }
  }
}

function codeInput(input: Record<string, unknown>): string {
  const direct = input.code ?? input.symbol
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  if (typeof direct === 'number') return String(direct).trim()

  const list = input.codes ?? input.symbols
  if (Array.isArray(list)) {
    return list.map((value) => String(value).trim()).filter(Boolean).join(',')
  }
  if (typeof list === 'string') return list.trim()
  return ''
}
