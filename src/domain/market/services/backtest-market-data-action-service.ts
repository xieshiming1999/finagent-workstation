import type { ToolContext } from '../../../agent/tool'
import { toolError } from '../../../agent/tool'
import { BacktestMarketDataService } from './backtest-market-data-service'

export class BacktestMarketDataActionService {
  constructor(
    private readonly service: BacktestMarketDataService = new BacktestMarketDataService(),
  ) {}

  async readAction(
    action: string,
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    try {
      return await this.service.readAction(action, input, ctx, code, limit)
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error))
    }
  }
}
