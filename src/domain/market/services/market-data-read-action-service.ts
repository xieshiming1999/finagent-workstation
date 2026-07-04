import type { ToolContext } from '../../../agent/tool'
import { toolError } from '../../../agent/tool'
import type { CachePolicyMode } from '../../../agent/data/cache-policy'
import { formatQuote } from '../../../agent/tools/market-data-utils'
import { MarketDataResolveService } from './market-data-resolve-service'

export class MarketDataReadActionService {
  constructor(
    private readonly readService: MarketDataResolveService = new MarketDataResolveService(),
  ) {}

  async readAction(
    action: string,
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    switch (action) {
      case 'quote':
        return this.readQuote(ctx, input, code)
      case 'kline':
        return this.readKline(ctx, input, code, limit)
      default:
        return toolError(`Unsupported read action: ${action}`)
    }
  }

  private async readQuote(ctx: ToolContext, input: Record<string, unknown>, code: string): Promise<string> {
    if (!code) {
      return toolError('code required for quote. Example: MarketData(action: "quote", code: "600519") or MarketData(action: "quote", code: "600519,000001")')
    }
    const codes = code.includes(',') ? code.split(',').map((c) => c.trim()) : [code]
    const result = await this.readService.readQuotes(ctx, codes, cachePolicyFromInput(input))
    if (result.quotes.length === 0) return 'No quote data returned'
    const freshSources = result.freshSources.join(', ') || 'none'
    const header = result.cachedCount > 0 || result.freshCount > 0
      ? `Quote data (${result.cachedCount} from local quote_snapshot cache, ${result.freshCount} fresh; fresh source: ${freshSources})\n`
      : ''
    return header + result.quotes.map(formatQuote).join('\n---\n')
  }

  private async readKline(
    ctx: ToolContext,
    input: Record<string, unknown>,
    code: string,
    limit: number,
  ): Promise<string> {
    if (!code) return toolError('code required for kline. Example: MarketData(action: "kline", code: "600519")')
    const period = String(input.period ?? 'daily')
    if (period !== 'daily') {
      return toolError(
        `MarketData(action:"kline") currently supports only governed daily K-line in FinAgent Workstation; requested period "${period}" is not registered with a canonical interface/readback path. Use period:"daily", yahoo_history for global daily ranges, or an explicit TDX diagnostic action when validating a provider contract.`,
      )
    }
    const adjust = String(input.adjust ?? 'qfq')
    const result = await this.readService.readKline(ctx, code, { period, adjust, limit, policy: cachePolicyFromInput(input) })
    return JSON.stringify({
      contract: 'market-kline-result-v1',
      action: 'kline',
      code,
      period: result.period,
      adjust: result.adjust,
      source: result.source,
      status: result.status,
      reason: result.reason ?? null,
      rows: result.bars,
      provenance: result.provenance ?? null,
    }, null, 2)
  }
}

function cachePolicyFromInput(input: Record<string, unknown>): { mode?: CachePolicyMode } {
  const value = input.cacheMode
  if (value === 'cache-first' || value === 'live-only' || value === 'cache-only') return { mode: value }
  return {}
}
