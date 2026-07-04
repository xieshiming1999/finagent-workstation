import type { ToolContext } from '../../../agent/tool'
import { toolError } from '../../../agent/tool'
import { recordDirectApiFailure } from '../../../agent/tools/market-data-utils'
import { TdxMarketDataService } from './tdx-market-data-service'

export class TdxMarketDataActionService {
  constructor(
    private readonly service: TdxMarketDataService = new TdxMarketDataService(),
  ) {}

  async readAction(
    action: string,
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    if (action === 'tdx_block') return this.handleTdxBlock(input, ctx, code)
    if (action === 'tdx_company_info') return this.handleTdxCompanyInfo(ctx, code)
    if (action.startsWith('tdx_')) return this.handleTdxDirectAction(action, input, ctx, code, limit)
    if (action.startsWith('ex_')) return this.handleExAction(action, input, ctx, code, limit)
    return toolError(`Unsupported TDX action: ${action}`)
  }

  private async handleTdxDirectAction(
    action: string,
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    const startedAt = Date.now()
    const tdxAction = action === 'tdx_sampling' ? 'chart_sampling' : action.replace('tdx_', '')
    try {
      const data = await this.service.readDirectAction(ctx, action, input, code, limit)
      return JSON.stringify(data, null, 2).slice(0, 30000)
    } catch (e) {
      recordDirectApiFailure(ctx, { source: 'tdx', action: 'tdx', endpoint: tdxAction, startedAt, error: e })
      return toolError(`TDX request failed: ${e}`)
    }
  }

  private async handleTdxBlock(
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
  ): Promise<string> {
    const startedAt = Date.now()
    try {
      const result = await this.service.readBlock(ctx, input, code)
      return JSON.stringify(result, null, 2)
    } catch (e) {
      recordDirectApiFailure(ctx, { source: 'tdx', action: 'tdx', endpoint: 'block', startedAt, error: e })
      return toolError(`TDX block request failed: ${e}`)
    }
  }

  private async handleTdxCompanyInfo(
    ctx: ToolContext,
    code: string,
  ): Promise<string> {
    const startedAt = Date.now()
    try {
      const result = await this.service.readCompanyInfo(ctx, code)
      return JSON.stringify(result, null, 2)
    } catch (e) {
      recordDirectApiFailure(ctx, { source: 'tdx', action: 'tdx', endpoint: 'company_info', startedAt, error: e })
      return toolError(`TDX company_info request failed: ${e}`)
    }
  }

  private async handleExAction(
    action: string,
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    const startedAt = Date.now()
    const exAction = action === 'ex_sampling' ? 'chart_sampling' : action === 'ex_count' ? 'count' : action.replace('ex_', '')
    try {
      const data = await this.service.readExAction(ctx, action, input, code, limit)
      return JSON.stringify(data, null, 2).slice(0, 30000)
    } catch (e) {
      recordDirectApiFailure(ctx, { source: 'tdx:ex', action: 'ex', endpoint: exAction, startedAt, error: e })
      return toolError(`ExQuote request failed: ${e}`)
    }
  }
}
