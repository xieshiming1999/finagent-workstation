import type { ToolContext } from '../tool'
import type { MarketDataTool } from './market-data'
import { MARKET_DATA_HELP_TEXT } from './market-data-help'
import { getSourceStatus } from '../data/queue/rate-limiter'
import { providerOrder } from '../data/provider-policy'

export async function callMarketDataAction(
  tool: MarketDataTool,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const action = String(input.action)

  switch (action) {
    case 'sources':
      return JSON.stringify(buildProviderSourceStatus(), null, 2)

    case 'help':
      return MARKET_DATA_HELP_TEXT

    default:
      return tool.actionService.call(action, input, ctx)
  }
}

function buildProviderSourceStatus() {
  const allGates = {
    windConfigured: true,
    windQuotaAvailable: true,
    tushareConfigured: true,
    tusharePermissionLikely: true,
    allowAkshareCompatibility: true,
  } as const
  return {
    action: 'sources',
    interfaceId: 'provider.source_status',
    provider: 'local',
    providerId: 'local',
    capabilityId: 'local.provider.source_status',
    cacheStatus: 'local-evidence',
    cacheDecision:
      'sources reads local provider policy, rate-limiter, and configuration evidence; it does not refresh provider data',
    cacheMode: 'cache-first',
    cachePolicyMode: 'cacheFirst',
    canonicalSchema: 'provider_source_status',
    canonicalTable: 'provider_source_status',
    readbackAction: 'sources',
    availableSources: [
      'tdx',
      'eastmoneyDirect',
      'akshare',
      'wind',
      'tushare',
      'sina',
      'tencent',
      'yfinance',
    ],
    rateLimiter: getSourceStatus(),
    provider_policy: {
      quote: providerOrder('quote', allGates),
      indexQuote: providerOrder('indexQuote', allGates),
      kline: providerOrder('kline', allGates),
      indexKline: providerOrder('indexKline', allGates),
      sector: providerOrder('sector', allGates),
      fundamental: providerOrder('fundamental', allGates),
      fund: providerOrder('fund', allGates),
      moneyFlow: providerOrder('moneyFlow', allGates),
    },
    storage_policy: {
      note: 'Reusable local storage is read before provider routing by resolve services; it is not a FinanceProvider.',
    },
    tip: 'Use data_health, coverage, and query_api_calls before retrying provider failures.',
  }
}
