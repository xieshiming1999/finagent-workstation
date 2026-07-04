import type { ToolContext } from '../../../agent/tool'
import { toolError } from '../../../agent/tool'
import { TushareMarketDataService } from './tushare-market-data-service'

export class TushareMarketDataActionService {
  constructor(
    private readonly service: TushareMarketDataService = new TushareMarketDataService(),
  ) {}

  async readAction(
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    try {
      return await this.service.readAction(input, ctx, code, limit)
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error))
    }
  }
}
