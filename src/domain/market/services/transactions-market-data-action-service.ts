import type { ToolContext } from '../../../agent/tool'
import { toolError } from '../../../agent/tool'
import { recordDirectApiFailure } from '../../../agent/tools/market-data-utils'
import { TransactionsMarketDataService } from './transactions-market-data-service'

export class TransactionsMarketDataActionService {
  constructor(private readonly service: TransactionsMarketDataService = new TransactionsMarketDataService()) {}

  async readAction(
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    const startedAt = Date.now()
    try {
      const result = await this.service.readTransactions(ctx, code, limit, input, {
        provider: typeof input.provider === 'string' ? input.provider : undefined,
        providerMode: input.providerMode as any,
        cacheMode: input.cacheMode as any,
        allowFallback: input.allowFallback as boolean | undefined,
        allowDegraded: input.allowDegraded as boolean | undefined,
      })
      return JSON.stringify(result, null, 2).slice(0, 30000)
    } catch (e) {
      recordDirectApiFailure(ctx, { source: 'data-api', action: 'transactions', endpoint: 'stock.transactions', startedAt, error: e })
      return toolError(`transactions request failed: ${e}`)
    }
  }
}
