import type { ToolContext } from '../../../agent/tool'
import {
  DefaultTdxMarketProvider,
  type TdxMarketProvider,
} from '../providers/tdx-market-provider'
import { TdxMarketDataRepository } from '../repositories/tdx-market-data-repository'

export class TdxMarketDataService {
  private readonly repository = new TdxMarketDataRepository()
  constructor(private readonly provider: TdxMarketProvider = new DefaultTdxMarketProvider()) {}

  async readDirectAction(
    ctx: ToolContext,
    action: string,
    input: Record<string, unknown>,
    code: string,
    limit: number,
  ): Promise<unknown> {
    const endpoint = action === 'tdx_sampling' ? 'chart_sampling' : action.replace('tdx_', '')
    const data = await this.provider.fetchDirectAction(action, input, code, limit)
    this.repository.ingest(ctx, {
      provider: 'tdx',
      endpoint,
      payload: data,
      params: { ...input, limit },
      code: code || undefined,
      source: 'tdx',
    })
    return data
  }

  async readBlock(
    ctx: ToolContext,
    input: Record<string, unknown>,
    code: string,
  ): Promise<Record<string, unknown>> {
    const filename = String(input.filename ?? 'block_gn.dat')
    const blockName = input.blockName ? String(input.blockName) : ''
    const targetCode = code.trim()
    const data = await this.provider.fetchBlock(filename)
    const rawList = Array.isArray(data?.List) ? (data.List as Array<Record<string, unknown>>) : []
    const normalizedList = this.repository.normalizeBlockRows(filename, rawList)
    const filtered = normalizedList.filter((row) => {
      if (blockName && row.BlockName !== blockName) return false
      if (targetCode && row.Code !== targetCode) return false
      return true
    })
    this.repository.ingest(ctx, {
      provider: 'tdx',
      endpoint: 'block',
      payload: { List: filtered },
      params: { ...input, filename, blockName: blockName || undefined },
      code: targetCode || undefined,
      source: 'tdx',
    })
    return {
      action: 'tdx_block',
      source: 'tdx',
      filename,
      ...(blockName ? { blockName } : {}),
      ...(targetCode ? { code: targetCode } : {}),
      note: 'Raw TDX block files expose filename + block name/type + member code. block_code is persisted as "<filename>:<block_name>".',
      List: filtered,
    }
  }

  async readCompanyInfo(
    ctx: ToolContext,
    code: string,
  ): Promise<Record<string, unknown>> {
    if (!code) throw new Error('code required. Example: MarketData(action: "tdx_company_info", code: "600519")')
    const categories = await this.provider.fetchCompanyCategories(code)
    this.repository.ingest(ctx, {
      provider: 'tdx',
      endpoint: 'company_categories',
      payload: categories,
      code,
      source: 'tdx',
    })

    const list = Array.isArray(categories?.List) ? (categories.List as Array<Record<string, unknown>>) : []
    let firstContent: string | null = null
    if (list.length > 0) {
      for (const [index, item] of list.entries()) {
        const filename = String(item.filename ?? item.Filename ?? '')
        const title = String(item.title ?? item.Title ?? item.name ?? item.Name ?? '').trim()
        if (!filename) continue
        const content = await this.provider.fetchCompanyContent(code, filename)
        const preview = content.length > 2000 ? content.slice(0, 2000) : content
        if (index === 0) firstContent = preview
        this.repository.ingest(ctx, {
          provider: 'tdx',
          endpoint: 'company_content',
          payload: content,
          params: { filename, title },
          code,
          source: 'tdx',
        })
      }
    }
    return {
      action: 'tdx_company_info',
      source: 'tdx',
      code,
      categories: list,
      first_content: firstContent,
    }
  }

  async readExAction(
    ctx: ToolContext,
    action: string,
    input: Record<string, unknown>,
    code: string,
    limit: number,
  ): Promise<unknown> {
    const endpoint = action === 'ex_sampling' ? 'chart_sampling' : action === 'ex_count' ? 'count' : action.replace('ex_', '')
    const market = String(input.market ?? 'sh')
    const data = await this.provider.fetchExAction(action, input, code, limit)
    const exData = data as any
    this.repository.ingest(ctx, {
      provider: 'tdx',
      endpoint: `ex/${endpoint}`,
      payload: endpoint === 'table' && typeof exData?.data === 'string' ? exData.data : data,
      params: { ...input, limit, market },
      code: code || undefined,
      source: 'tdx:ex',
    })
    return data
  }
}
