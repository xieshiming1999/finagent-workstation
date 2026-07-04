import type { ToolContext } from '../../../agent/tool'
import { getConfiguredToken, tushareParams } from '../../../agent/tools/market-data-utils'
import {
  DefaultTushareMarketDataProvider,
  type TushareMarketDataProvider,
} from '../providers/tushare-market-data-provider'
import { TushareMarketDataRepository } from '../repositories/tushare-market-data-repository'

export interface TushareMarketDataResult {
  action: 'tushare'
  source: 'tushare'
  api_name: string
  count: number
  ingestion: unknown
  data: Array<Record<string, unknown>>
  truncated: boolean
}

export class TushareMarketDataService {
  private readonly repository = new TushareMarketDataRepository()
  constructor(
    private readonly provider: TushareMarketDataProvider = new DefaultTushareMarketDataProvider(),
  ) {}

  async fetchRows(
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<TushareMarketDataResult> {
    const apiName = String(input.api_name ?? input.apiName ?? '')
    if (!apiName) {
      throw new Error(
        'api_name required. Example: MarketData(action:"tushare", api_name:"daily", params:{ts_code:"600519.SH"})',
      )
    }
    const token = getConfiguredToken(ctx, 'TUSHARE_TOKEN')
    if (!token) {
      throw new Error(
        'KEY_MISSING: TUSHARE_TOKEN is not configured. Set it in Settings -> Finance before using Tushare.',
      )
    }

    const params = tushareParams(input)
    const fields = input.fields ? String(input.fields) : undefined
    const startedAt = Date.now()
    try {
      const rows = await this.provider.readRows(token, apiName, params, fields)
      let ingestion: unknown = null
      try {
        ingestion = this.repository.ingest(ctx, {
          provider: 'tushare',
          endpoint: apiName,
          payload: { data: rows },
          params,
          code: typeof params.ts_code === 'string' ? params.ts_code : code || undefined,
          source: 'tushare',
        })
      } catch {}
      return {
        action: 'tushare',
        source: 'tushare',
        api_name: apiName,
        count: rows.length,
        ingestion: ingestion ?? { persisted: false, reason: 'schema not registered' },
        data: rows.slice(0, limit),
        truncated: rows.length > limit,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.repository.recordApiCall(ctx, {
        source: 'tushare',
        tool: 'MarketData',
        action: 'tushare',
        endpoint: apiName,
        status: 0,
        success: false,
        duration_ms: Date.now() - startedAt,
        error: message,
      })
      if (message.startsWith('TUSHARE_RATE_LIMIT')) {
        throw new Error(
          `${message}\nDo not retry immediately. Query local DataStore coverage/query_* first, or wait for the endpoint frequency window.`,
        )
      }
      throw new Error(`Tushare call failed: ${message}`)
    }
  }

  async readAction(
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    return JSON.stringify(await this.fetchRows(input, ctx, code, limit), null, 2)
  }
}
