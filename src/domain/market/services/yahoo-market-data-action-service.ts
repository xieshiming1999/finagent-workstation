import type { ToolContext } from '../../../agent/tool'
import { toolError } from '../../../agent/tool'
import { YahooMarketDataService } from './yahoo-market-data-service'

export class YahooMarketDataActionService {
  constructor(
    private readonly service: YahooMarketDataService = new YahooMarketDataService(),
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
