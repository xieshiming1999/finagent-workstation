import type { ToolContext } from '../../../agent/tool'
import type * as dm from '../../../agent/data/data-manager'
import type { MoneyFlowRow } from '../../../agent/data/fetchers/fetcher-money-flow'
import { getLocalStore } from '../../../agent/tools/market-data-utils'

export class FlowMarketDataRepository {
  saveMoneyFlow(
    ctx: ToolContext,
    code: string,
    flows: dm.MoneyFlow[],
  ): void {
    if (flows.length === 0) return
    try {
      getLocalStore(ctx).saveMoneyFlow(
        flows.map((flow) => ({
          code,
          date: flow.date,
          main_net: flow.mainNetInflow,
          small_net: flow.smallNetInflow,
          medium_net: flow.mediumNetInflow,
          large_net: flow.largeNetInflow,
          super_large_net: flow.superLargeNetInflow,
          close_price: flow.closePrice,
          change_pct: flow.changePct,
          source: 'eastmoney',
        })),
      )
    } catch {}
  }

  saveMoneyFlowRows(ctx: ToolContext, rows: MoneyFlowRow[]): void {
    if (rows.length === 0) return
    try {
      getLocalStore(ctx).saveMoneyFlow(rows.map((row) => ({ ...row })))
    } catch {}
  }
}
