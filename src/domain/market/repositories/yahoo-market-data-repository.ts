import type { ToolContext } from '../../../agent/tool'
import { ingestEndpointResult } from '../../../agent/data/ingestion/registry'
import { getLocalStore } from '../../../agent/tools/market-data-utils'

type ApiCallInput = {
  source: string
  provider?: string | null
  interface_id?: string | null
  capability_id?: string | null
  tool: string
  action: string
  endpoint: string
  status: number
  success: boolean
  duration_ms: number
  error?: string
}

export class YahooMarketDataRepository {
  ingest(
    ctx: ToolContext,
    input: {
      provider: 'yfinance'
      endpoint: string
      payload: unknown
      params?: Record<string, unknown>
      code?: string
      source: string
    },
  ): void {
    try {
      ingestEndpointResult(getLocalStore(ctx), input)
    } catch {}
  }

  recordApiCall(ctx: ToolContext, input: ApiCallInput): void {
    getLocalStore(ctx).saveApiCall(input)
  }
}
