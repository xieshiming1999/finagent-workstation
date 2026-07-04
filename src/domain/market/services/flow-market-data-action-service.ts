import type { ToolContext } from '../../../agent/tool'
import { toolError } from '../../../agent/tool'
import { FlowMarketDataService } from './flow-market-data-service'

export class FlowMarketDataActionService {
  constructor(
    private readonly service: FlowMarketDataService = new FlowMarketDataService(),
  ) {}

  async readAction(
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    try {
      return await this.service.readFlow(ctx, code, limit)
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error))
    }
  }
}
