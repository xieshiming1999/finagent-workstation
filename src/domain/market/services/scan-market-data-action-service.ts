import { toolError } from '../../../agent/tool'
import type { ToolContext } from '../../../agent/tool'
import { getLocalStore } from '../../../agent/tools/market-data-utils'
import { ScanMarketDataService } from './scan-market-data-service'

export class ScanMarketDataActionService {
  constructor(
    private readonly service: ScanMarketDataService = new ScanMarketDataService(),
  ) {}

  async readAction(
    code: string,
    input: Record<string, unknown>,
    ctx?: ToolContext,
  ): Promise<string> {
    try {
      return await this.service.readScan(code, input, ctx ? getLocalStore(ctx) : undefined)
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error))
    }
  }
}
