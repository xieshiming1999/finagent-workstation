import type { ToolContext } from '../tool'
import { toolError } from '../tool'
import type { DataStore } from '../data/store/data-store'
import { WindStructuredMarketDataService } from '../../domain/market/services/wind-structured-market-data-service'

type WindStructuredAction =
  | 'stock_risk_metrics'
  | 'fund_company_info'
  | 'fund_investor_holders'
  | 'fund_financials'
  | 'index_fundamentals'
  | 'index_profile'
  | 'bond_profile'
  | 'bond_market_data'
  | 'bond_issuer_financials'

export async function windStructuredAction(
  ds: DataStore,
  input: Record<string, unknown>,
  ctx: ToolContext,
  action: WindStructuredAction,
): Promise<string> {
  void ds
  const code = String(input.code ?? input.symbol ?? '')
  if (!code) {
    return toolError(`code/symbol required for ${action}`)
  }
  const service = new WindStructuredMarketDataService()
  try {
    return await service.readAction(
      action,
      input,
      ctx,
      code,
      Math.max(1, Math.min(Number(input.limit ?? 20), 200)),
    )
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error))
  }
}
