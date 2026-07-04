import type { ToolContext } from '../../../agent/tool'
import { fetchMoneyFlow, type MoneyFlowRow } from '../../../agent/data/fetchers/fetcher-money-flow'
import { fmtAmt } from '../../../agent/tools/market-data-utils'
import { FlowMarketDataRepository } from '../repositories/flow-market-data-repository'

export class FlowMarketDataService {
  private readonly repository = new FlowMarketDataRepository()

  async fetchFlow(
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<MoneyFlowRow[]> {
    const result = await fetchMoneyFlow(code, limit)
    if (result.provenance?.cacheStatus !== 'cache-hit' && result.data.length > 0) {
      this.repository.saveMoneyFlowRows(ctx, result.data)
    }
    return result.data
  }

  async readFlow(
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    if (!code) {
      throw new Error('code required for flow. Example: MarketData(action: "flow", code: "600519")')
    }

    const flows = await this.fetchFlow(ctx, code, limit)
    if (flows.length === 0) return `No money flow data for ${code}`

    const header = `Money Flow ${code} (${flows.length} days)\nDate\tMain\tLarge\tSupLarge\tMedium\tSmall`
    const rows = flows.map((flow) =>
      `${flow.date}\t${fmtAmt(flow.main_net)}\t${fmtAmt(flow.large_net)}\t${fmtAmt(flow.super_large_net)}\t${fmtAmt(flow.medium_net)}\t${fmtAmt(flow.small_net)}`,
    )
    return `${header}\n${rows.join('\n')}`
  }
}
