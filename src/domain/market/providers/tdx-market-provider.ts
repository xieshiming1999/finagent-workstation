import { getGotdxUrl } from '../../../main/sidecar'

export interface TdxMarketProvider {
  fetchDirectAction(
    action: string,
    input: Record<string, unknown>,
    code: string,
    limit: number,
  ): Promise<unknown>
  fetchBlock(filename: string): Promise<Record<string, unknown>>
  fetchCompanyCategories(code: string): Promise<Record<string, unknown>>
  fetchCompanyContent(code: string, filename: string): Promise<string>
  fetchExAction(
    action: string,
    input: Record<string, unknown>,
    code: string,
    limit: number,
  ): Promise<unknown>
}

export class DefaultTdxMarketProvider implements TdxMarketProvider {
  private requireTdxUrl(): string {
    const tdxUrl = getGotdxUrl()
    if (!tdxUrl) throw new Error('gotdx sidecar not running. TDX data unavailable.')
    return tdxUrl
  }

  async fetchDirectAction(
    action: string,
    input: Record<string, unknown>,
    code: string,
    limit: number,
  ): Promise<unknown> {
    const tdxUrl = this.requireTdxUrl()
    const endpoint = action === 'tdx_sampling' ? 'chart_sampling' : action.replace('tdx_', '')
    const params = new URLSearchParams()
    if (code) params.set('code', code)
    if (typeof input.market === 'string' || typeof input.market === 'number') {
      params.set('market', String(input.market))
    }
    params.set('limit', String(limit))
    const res = await fetch(`${tdxUrl}/api/${endpoint}?${params.toString()}`)
    if (!res.ok) throw new Error(`TDX error: HTTP ${res.status}`)
    return res.json()
  }

  async fetchBlock(filename: string): Promise<Record<string, unknown>> {
    const tdxUrl = this.requireTdxUrl()
    const params = new URLSearchParams()
    params.set('filename', filename)
    const res = await fetch(`${tdxUrl}/api/block?${params.toString()}`)
    if (!res.ok) throw new Error(`TDX block error: HTTP ${res.status}`)
    return res.json()
  }

  async fetchCompanyCategories(code: string): Promise<Record<string, unknown>> {
    const tdxUrl = this.requireTdxUrl()
    const params = new URLSearchParams()
    params.set('code', code)
    const res = await fetch(`${tdxUrl}/api/company_categories?${params.toString()}`)
    if (!res.ok) throw new Error(`TDX company_categories error: HTTP ${res.status}`)
    return res.json()
  }

  async fetchCompanyContent(code: string, filename: string): Promise<string> {
    const tdxUrl = this.requireTdxUrl()
    const params = new URLSearchParams()
    params.set('code', code)
    params.set('filename', filename)
    const res = await fetch(`${tdxUrl}/api/company_content?${params.toString()}`)
    if (!res.ok) throw new Error(`TDX company_content error: HTTP ${res.status}`)
    return res.text()
  }

  async fetchExAction(
    action: string,
    input: Record<string, unknown>,
    code: string,
    limit: number,
  ): Promise<unknown> {
    const tdxUrl = this.requireTdxUrl()
    const endpoint =
      action === 'ex_sampling'
        ? 'chart_sampling'
        : action === 'ex_count'
          ? 'count'
          : action.replace('ex_', '')
    const market = String(input.market ?? 'sh')
    const params = new URLSearchParams()
    if (code) params.set('code', code)
    if (market) params.set('market', market)
    if (input.category != null) params.set('category', String(input.category))
    if (input.detail != null) params.set('detail', String(input.detail))
    params.set('limit', String(limit))
    const res = await fetch(`${tdxUrl}/api/ex/${endpoint}?${params.toString()}`)
    if (!res.ok) throw new Error(`ExQuote error: HTTP ${res.status}`)
    return res.json()
  }
}
