import type { ToolContext } from '../../../agent/tool'
import { ingestEndpointResult } from '../../../agent/data/ingestion/registry'
import { getLocalStore } from '../../../agent/tools/market-data-utils'

type ApiCallInput = {
  source: string
  tool: string
  action: string
  endpoint: string
  status: number
  success: boolean
  duration_ms: number
  error?: string
}

export class TushareMarketDataRepository {
  ingest(
    ctx: ToolContext,
    input: {
      provider: 'tushare'
      endpoint: string
      payload: unknown
      params?: Record<string, unknown>
      code?: string
      source: string
    },
  ): unknown {
    return ingestEndpointResult(getLocalStore(ctx), input)
  }

  recordApiCall(ctx: ToolContext, input: ApiCallInput): void {
    getLocalStore(ctx).saveApiCall(input)
  }
}
