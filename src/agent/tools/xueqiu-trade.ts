import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'

type FetchLike = typeof fetch

type PortfolioGroup = {
  name: string
  gid: number
  openStatus: number
  orderId: number
}

export class XueqiuTradeTool implements Tool {
  name = 'XueqiuTrade'
  description = 'Xueqiu simulated trading through MONI: discover portfolios, inspect performance/holdings/history, place buy/sell trades, and add cash transfers.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['help', 'portfolios', 'balance', 'position', 'history', 'preview_order', 'buy', 'sell', 'transfer_in', 'transfer_out'],
      },
      portfolio: { type: 'string', description: 'Portfolio name or gid. Defaults to first configured item.' },
      side: { type: 'string', description: '(preview_order) Order side: buy or sell.' },
      symbol: { type: 'string', description: 'Stock symbol, e.g. SH600519.' },
      shares: { type: 'number', description: 'Trade shares for buy/sell.' },
      price: { type: 'number', description: 'Trade price for buy/sell.' },
      amount: { type: 'number', description: 'Cash amount for transfer_in / transfer_out.' },
      date: { type: 'string', description: 'Trade date in YYYY-MM-DD. Defaults to today.' },
      market: { type: 'string', description: 'Transfer market code. Defaults to CHA.' },
      commission_rate: { type: 'number', description: 'Commission rate. Defaults to 1.' },
      tax_rate: { type: 'number', description: 'Tax rate. Defaults to 1.' },
      row: { type: 'number', description: 'History row limit. Defaults to 20.' },
    },
    required: ['action'],
  }

  private readonly fetchImpl: FetchLike
  private cookie = ''
  private configuredPortfolios: string[] = []
  private lastRequestAt = 0

  constructor(fetchImpl: FetchLike = fetch) {
    this.fetchImpl = fetchImpl
  }

  configure(cookie: string, portfolios: string[]) {
    this.cookie = cookie
    this.configuredPortfolios = portfolios
  }

  validateInput(input: Record<string, unknown>, ctx: ToolContext): string | null {
    const cookie = this.resolveCookie(ctx)
    if (!cookie) return 'XueqiuTrade not available. Set XQ_COOKIE in Settings > Finance > API Keys.'
    if (!input.action) return 'action is required. Available: help, portfolios, balance, position, history, preview_order, buy, sell, transfer_in, transfer_out'
    return null
  }

  needsPermissions(input: Record<string, unknown>): boolean {
    const action = String(input.action ?? 'help')
    return ['buy', 'sell', 'transfer_in', 'transfer_out'].includes(action)
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    this.cookie = this.resolveCookie(ctx)
    this.configuredPortfolios = this.resolveConfiguredPortfolios(ctx)
    const action = String(input.action ?? 'help')

    switch (action) {
      case 'help':
        return this.helpText()
      case 'portfolios':
        return JSON.stringify(await this.readPortfolios(), null, 2)
      case 'balance':
        return JSON.stringify(await this.readBalance(input), null, 2)
      case 'position':
        return JSON.stringify(await this.readPosition(input), null, 2)
      case 'history':
        return JSON.stringify(await this.readHistory(input), null, 2)
      case 'preview_order':
        return JSON.stringify(await this.previewOrder(input), null, 2)
      case 'buy':
        return JSON.stringify(await this.trade(input, 1), null, 2)
      case 'sell':
        return JSON.stringify(await this.trade(input, 2), null, 2)
      case 'transfer_in':
        return JSON.stringify(await this.transfer(input, 1), null, 2)
      case 'transfer_out':
        return JSON.stringify(await this.transfer(input, 2), null, 2)
      default:
        return toolError(`unknown action "${action}". Available: help, portfolios, balance, position, history, preview_order, buy, sell, transfer_in, transfer_out`)
    }
  }

  private helpText(): string {
    const configured = this.configuredPortfolios.length > 0 ? this.configuredPortfolios.join(', ') : '(not configured)'
    return [
      'Xueqiu simulated trading through the current MONI contract.',
      `Configured portfolios: ${configured}`,
      '',
      'Actions:',
      '- portfolios: list Xueqiu simulation groups with name/gid mapping',
      '- balance: show total asset/cash/market-value performance for one group',
      '- position: show holdings and return-composition data for one group',
      '- history: show recent stock trades and bank transfers',
      '- preview_order: validate and estimate an order without writing to Xueqiu',
      '- buy / sell: place simulated stock trades; require symbol, shares, price',
      '- transfer_in / transfer_out: add or remove cash; require amount',
      '- if a MONI write is rejected, stop the write workflow, read back position/history if needed, and report the provider rejection; do not retry the same write or use Portfolio fallback',
      '',
      'Sizing contract:',
      '- MONI uses explicit shares in this tested contract; do not impose the local Portfolio 100-share lot rule on XueqiuTrade sizing.',
      '- For sizing-only requests or prompts that say not to trade, read portfolios/balance/position/quote and answer with calculation only; do not ask execution confirmation, preview, buy, sell, or transfer.',
      '- If the user later explicitly authorizes execution, use preview_order first; preview is read-only evidence and cannot guarantee that transaction/add.json will accept the final write.',
      '',
      'Examples:',
      'XueqiuTrade(action: "portfolios")',
      'XueqiuTrade(action: "balance", portfolio: "finasimu")',
      'XueqiuTrade(action: "preview_order", portfolio: "finasimu", side: "buy", symbol: "SH600519", shares: 5, price: 1215)',
      'XueqiuTrade(action: "buy", portfolio: "finasimu", symbol: "SH600519", shares: 5, price: 1215)',
      'XueqiuTrade(action: "transfer_in", portfolio: "finasimu", amount: 10000)',
    ].join('\n')
  }

  private async readPortfolios() {
    const groups = await this.loadGroups()
    const configured = new Set(this.configuredPortfolios)
    return {
      source: 'xueqiu',
      tradeContract: this.tradeContract(),
      configured: this.configuredPortfolios,
      portfolios: groups.map((g) => ({
        name: g.name,
        gid: g.gid,
        configured: configured.has(g.name) || configured.has(String(g.gid)),
        openStatus: g.openStatus,
        order: g.orderId,
      })),
    }
  }

  private async readBalance(input: Record<string, unknown>) {
    const group = await this.resolvePortfolio(input)
    const payload = await this.getJson(this.snowxUrl('/MONI/performances.json', { gid: String(group.gid) }))
    return {
      source: 'xueqiu',
      tradeContract: this.tradeContract(),
      portfolio: { name: group.name, gid: group.gid },
      performances: payload?.result_data?.performances ?? [],
    }
  }

  private async readPosition(input: Record<string, unknown>) {
    const group = await this.resolvePortfolio(input)
    const holdings = await this.getJson(this.snowxUrl('/MONI/forchart/holdstock.json', { gid: String(group.gid), period: '1m' }))
    const roa = await this.getJson(this.snowxUrl('/MONI/forchart/roa.json', { gid: String(group.gid), period: '1m', market: 'ALL' }))
    return {
      source: 'xueqiu',
      tradeContract: this.tradeContract(),
      portfolio: { name: group.name, gid: group.gid },
      holdstock: holdings?.result_data ?? [],
      roa: roa?.result_data ?? {},
    }
  }

  private async readHistory(input: Record<string, unknown>) {
    const group = await this.resolvePortfolio(input)
    const row = Math.max(1, Math.min(1000, Number(input.row ?? 20)))
    const txParams: Record<string, string> = { gid: String(group.gid), row: String(row) }
    const rawSymbol = typeof input.symbol === 'string' ? input.symbol.trim() : ''
    if (rawSymbol) txParams.symbol = this.normalizeSymbol(rawSymbol)
    const transactions = await this.getJson(this.snowxUrl('/MONI/transaction/list.json', txParams))
    const transfers = await this.getJson(this.snowxUrl('/MONI/bank_transfer/query.json', { gid: String(group.gid), row: String(row) }))
    return {
      source: 'xueqiu',
      tradeContract: this.tradeContract(),
      portfolio: { name: group.name, gid: group.gid },
      transactions: this.withReadableTimes(transactions?.result_data ?? {}),
      bankTransfers: this.withReadableTimes(transfers?.result_data ?? {}),
    }
  }

  private async previewOrder(input: Record<string, unknown>) {
    const group = await this.resolvePortfolio(input)
    const rawSide = String(input.side ?? input.orderSide ?? '').trim().toLowerCase()
    const type = rawSide === 'sell' || rawSide === '2' ? 2 : rawSide === 'buy' || rawSide === '1' ? 1 : 0
    const rawSymbol = String(input.symbol ?? '').trim()
    const shares = Number(input.shares ?? 0)
    const price = Number(input.price ?? 0)
    if (!type || !rawSymbol || !(shares > 0) || !(price > 0)) {
      return toolError('side(buy/sell), symbol, shares, and price are required. Example: XueqiuTrade(action: "preview_order", portfolio: "finasimu", side: "buy", symbol: "SH600519", shares: 5, price: 1215)')
    }
    const symbol = this.normalizeSymbol(rawSymbol)
    const warnings: string[] = []
    await this.tryPreviewEvidence('search_symbol', warnings, () => this.searchSymbol(symbol))
    await this.tryPreviewEvidence('quote', warnings, () => this.loadQuote(symbol))
    const balance = await this.tryPreviewEvidence('balance', warnings, () =>
      this.readBalance({ ...input, portfolio: String(group.gid) })
    )
    const position = await this.tryPreviewEvidence('position', warnings, () =>
      this.readPosition({ ...input, portfolio: String(group.gid) })
    )
    const tradeValue = shares * price
    const commissionRate = Number(input.commission_rate ?? 1)
    const taxRate = Number(input.tax_rate ?? 1)
    return {
      source: 'xueqiu',
      action: 'preview_order',
      tradeContract: this.tradeContract(),
      sideEffect: false,
      portfolio: { name: group.name, gid: group.gid },
      order: {
        side: type === 1 ? 'buy' : 'sell',
        symbol,
        shares,
        price,
        date: this.resolveDate(input.date),
        commission_rate: commissionRate,
        tax_rate: taxRate,
      },
      estimated: {
        tradeValue: +tradeValue.toFixed(2),
        note: 'Xueqiu computes final commission/tax on write; preview does not call transaction/add.json.',
      },
      readbackEvidence: {
        balance: balance ?? null,
        position: position ?? null,
      },
      warnings,
      nextStep: 'If execution is still intended, ask for explicit confirmation before XueqiuTrade(action:"buy"|"sell").',
    }
  }

  private async tryPreviewEvidence<T>(
    label: string,
    warnings: string[],
    fn: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await fn()
    } catch (error) {
      warnings.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  private tradeContract(): Record<string, unknown> {
    return {
      executionSurface: 'xueqiu_moni_simulated_trade',
      shareSizing: 'explicit_shares',
      lotSize: 1,
      sizingOnlyBehavior: 'answer_without_preview_or_write_when_user_says_not_to_trade',
      sizingGuidance: [
        'For MONI sizing, cash can be mapped to any positive explicit share count such as 5, 8, 16, or 83 when price and cash allow it.',
        'Do not claim a portfolio cannot buy only because it cannot afford 100 shares; that is a local Portfolio or real-market assumption, not this XueqiuTrade contract.',
        'For sizing-only requests, give candidate share counts and the next confirmation fields without calling AskUserQuestion.',
      ],
      writeActions: ['buy', 'sell', 'transfer_in', 'transfer_out'],
      writeRequires: ['explicit_user_authorization', 'preview_order_before_write'],
      localPortfolioLotRuleApplies: false,
    }
  }

  private async trade(input: Record<string, unknown>, type: 1 | 2) {
    const group = await this.resolvePortfolio(input)
    const rawSymbol = String(input.symbol ?? '').trim()
    const shares = Number(input.shares ?? 0)
    const price = Number(input.price ?? 0)
    if (!rawSymbol || !(shares > 0) || !(price > 0)) {
      return toolError(`symbol / shares / price are required. Example: XueqiuTrade(action: "${type === 1 ? 'buy' : 'sell'}", portfolio: "finasimu", symbol: "SH600519", shares: 5, price: 1215)`)
    }
    const symbol = this.normalizeSymbol(rawSymbol)
    await this.searchSymbol(symbol)
    await this.loadQuote(symbol)
    const payload = new URLSearchParams({
      type: String(type),
      date: this.resolveDate(input.date),
      gid: String(group.gid),
      symbol,
      price: this.formatNumber(price),
      shares: this.formatNumber(shares),
      tax_rate: String(Number(input.tax_rate ?? 1)),
      commission_rate: String(Number(input.commission_rate ?? 1)),
    })
    const response = await this.postJson('https://tc.xueqiu.com/tc/snowx/MONI/transaction/add.json', payload, {
      action: type === 1 ? 'buy' : 'sell',
      endpoint: 'MONI/transaction/add.json',
      portfolio: group.name,
      gid: group.gid,
      symbol,
      shares,
      price,
      date: payload.get('date') ?? '',
      type,
    })
    const readback = await this.postWriteReadback(group, {
      kind: 'trade',
      symbol,
      row: 100,
    })
    return {
      source: 'xueqiu',
      portfolio: { name: group.name, gid: group.gid },
      action: type === 1 ? 'buy' : 'sell',
      sideEffect: true,
      executionStatus: 'executed',
      executionVenue: 'xueqiu_moni',
      message: response.msg,
      result: response.result_data,
      postTradeReadback: readback,
    }
  }

  private async transfer(input: Record<string, unknown>, type: 1 | 2) {
    const group = await this.resolvePortfolio(input)
    const amount = Number(input.amount ?? 0)
    if (!(amount > 0)) {
      return toolError(`amount is required. Example: XueqiuTrade(action: "${type === 1 ? 'transfer_in' : 'transfer_out'}", portfolio: "finasimu", amount: 10000)`)
    }
    const payload = new URLSearchParams({
      gid: String(group.gid),
      type: String(type),
      date: this.resolveDate(input.date),
      market: typeof input.market === 'string' && input.market.trim() ? input.market.trim() : 'CHA',
      amount: this.formatNumber(amount),
    })
    const response = await this.postJson('https://tc.xueqiu.com/tc/snowx/MONI/bank_transfer/add.json', payload, {
      action: type === 1 ? 'transfer_in' : 'transfer_out',
      endpoint: 'MONI/bank_transfer/add.json',
      portfolio: group.name,
      gid: group.gid,
      amount,
      date: payload.get('date') ?? '',
      market: payload.get('market') ?? '',
      type,
    })
    const readback = await this.postWriteReadback(group, {
      kind: 'transfer',
      row: 100,
    })
    return {
      source: 'xueqiu',
      portfolio: { name: group.name, gid: group.gid },
      action: type === 1 ? 'transfer_in' : 'transfer_out',
      sideEffect: true,
      executionStatus: 'executed',
      executionVenue: 'xueqiu_moni',
      message: response.msg,
      result: response.result_data,
      postTradeReadback: readback,
    }
  }

  private async postWriteReadback(
    group: PortfolioGroup,
    options: { kind: 'trade' | 'transfer'; symbol?: string; row?: number },
  ): Promise<Record<string, unknown>> {
    const warnings: string[] = []
    const row = String(Math.max(1, Math.min(1000, options.row ?? 100)))
    const balance = await this.tryPreviewEvidence('balance_after_write', warnings, () =>
      this.readBalance({ portfolio: String(group.gid) })
    )
    const history = await this.tryPreviewEvidence('history_after_write', warnings, () =>
      this.readHistory({
        portfolio: String(group.gid),
        row,
        ...(options.symbol ? { symbol: options.symbol } : {}),
      })
    )
    const position = options.kind === 'trade'
      ? await this.tryPreviewEvidence('position_after_write', warnings, () =>
        this.readPosition({ portfolio: String(group.gid) })
      )
      : null
    return {
      source: 'xueqiu',
      readbackAction: options.kind === 'trade'
        ? 'xueqiu_trade_balance_position_history_after_write'
        : 'xueqiu_transfer_balance_history_after_write',
      readbackStatus: warnings.length === 0 ? 'verified' : 'partial',
      portfolio: { name: group.name, gid: group.gid },
      balance: balance ?? null,
      position,
      history: history ?? null,
      warnings,
      fetchedAt: new Date().toISOString(),
    }
  }

  private resolveCookie(ctx: ToolContext): string {
    return this.cookie || String(ctx.getConfigValue?.('XQ_COOKIE') ?? '').trim()
  }

  private resolveConfiguredPortfolios(ctx: ToolContext): string[] {
    if (this.configuredPortfolios.length > 0) return this.configuredPortfolios
    const raw = String(ctx.getConfigValue?.('XQ_PORTFOLIO') ?? '').trim()
    return raw.split(',').map((s) => s.trim()).filter(Boolean)
  }

  private async loadGroups(): Promise<PortfolioGroup[]> {
    const payload = await this.getJson(this.snowxUrl('/MONI/trans_group/list.json'))
    const rows = Array.isArray(payload?.result_data?.trans_groups) ? payload.result_data.trans_groups : []
    return rows
      .map((row: any) => ({
        name: String(row?.name ?? ''),
        gid: Number(row?.gid ?? 0),
        openStatus: Number(row?.open_status ?? 0),
        orderId: Number(row?.order_id ?? 0),
      }))
      .filter((row: PortfolioGroup) => row.name && row.gid > 0)
  }

  private async resolvePortfolio(input: Record<string, unknown>): Promise<PortfolioGroup> {
    const groups = await this.loadGroups()
    if (groups.length === 0) return toolError('Xueqiu did not return any simulation portfolios.')
    const requested = typeof input.portfolio === 'string' && input.portfolio.trim() ? input.portfolio.trim() : ''
    const candidates = requested ? [requested, ...this.configuredPortfolios] : this.configuredPortfolios
    if (candidates.length === 0) return groups[0]
    for (const candidate of candidates) {
      const byName = groups.find((g) => g.name === candidate)
      if (byName) return byName
      const gid = Number(candidate)
      if (Number.isFinite(gid)) {
        const byGid = groups.find((g) => g.gid === gid)
        if (byGid) return byGid
      }
    }
    return toolError(`Portfolio "${candidates[0]}" not found. Use XueqiuTrade(action: "portfolios") to inspect available name/gid mappings.`)
  }

  private async searchSymbol(symbol: string): Promise<void> {
    const payload = await this.getJson(`https://xueqiu.com/query/v1/search/stock.json?code=${encodeURIComponent(symbol)}&size=10`)
    const rows = Array.isArray(payload?.stocks) ? payload.stocks : Array.isArray(payload?.data) ? payload.data : []
    if (rows.length === 0) toolError(`stock not found on Xueqiu: ${symbol}`)
  }

  private async loadQuote(symbol: string): Promise<void> {
    await this.getJson(`https://stock.xueqiu.com/v5/stock/batch/quote.json?symbol=${encodeURIComponent(symbol)}&extend=detail`)
  }

  private snowxUrl(path: string, params: Record<string, string> = {}): string {
    const url = new URL(`https://tc.xueqiu.com/tc/snowx${path}`)
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
    return url.toString()
  }

  private normalizeSymbol(input: string): string {
    const upper = input.trim().toUpperCase()
    if (upper.startsWith('SH') || upper.startsWith('SZ') || upper.startsWith('BJ') || upper.startsWith('HK') || /^[A-Z]+$/.test(upper)) return upper
    const clean = upper.replace(/\.(SH|SZ|BJ|HK)$/i, '')
    if (!/^\d{6}$/.test(clean)) return upper
    if (clean.startsWith('6') || clean.startsWith('9')) return `SH${clean}`
    if (clean.startsWith('43') || clean.startsWith('83') || clean.startsWith('87') || clean.startsWith('92')) return `BJ${clean}`
    return `SZ${clean}`
  }

  private resolveDate(raw: unknown): string {
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
    return new Date().toISOString().slice(0, 10)
  }

  private formatNumber(value: number): string {
    return Number.isInteger(value) ? String(Math.trunc(value)) : String(value)
  }

  private withReadableTimes(value: any): any {
    if (Array.isArray(value)) return value.map((item) => this.withReadableTimes(item))
    if (value == null || typeof value !== 'object') return value
    const out: Record<string, any> = {}
    for (const [key, raw] of Object.entries(value)) {
      out[key] = this.withReadableTimes(raw)
      if (['time', 'create_at', 'update_at', 'record_date'].includes(key)) {
        const millis = this.timestampMillis(raw)
        if (millis != null) {
          const date = new Date(millis)
          out[`${key}_iso`] = date.toISOString()
          out[`${key}_beijing`] = new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          }).format(date)
        }
      }
    }
    return out
  }

  private timestampMillis(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : null
    }
    return null
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt
    if (elapsed < 300) await new Promise((resolve) => setTimeout(resolve, 300 - elapsed))
    this.lastRequestAt = Date.now()
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Cookie: this.cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Origin: 'https://xueqiu.com',
      Referer: 'https://xueqiu.com/performance',
      ...extra,
    }
  }

  private async getJson(url: string): Promise<any> {
    await this.throttle()
    const res = await this.fetchImpl(url, { headers: this.headers() })
    if (!res.ok) return toolError(`HTTP ${res.status} calling ${url}`)
    const json = await res.json() as any
    this.ensureSuccess(json, { method: 'GET', endpoint: this.safeEndpoint(url) })
    return json
  }

  private async postJson(url: string, body: URLSearchParams, request?: Record<string, unknown>): Promise<any> {
    await this.throttle()
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body,
    })
    if (!res.ok) return toolError(`HTTP ${res.status} calling ${url}`)
    const json = await res.json() as any
    this.ensureSuccess(json, {
      method: 'POST',
      endpoint: this.safeEndpoint(url),
      request,
    })
    return json
  }

  private ensureSuccess(payload: any, context: { method: string; endpoint: string; request?: Record<string, unknown> }): void {
    const code = String(payload?.result_code ?? payload?.error_code ?? payload?.code ?? '')
    const msg = String(payload?.msg ?? payload?.error_description ?? '').trim()
    if (code === '400016' || code === 'LOGIN_REQUIRED') toolError('Xueqiu cookie expired. Update XQ_COOKIE in Settings > Finance.')
    if (payload?.success === false || (code && code !== '60000')) {
      toolError(JSON.stringify({
        error: 'xueqiu_provider_rejected_request',
        provider: 'xueqiu',
        surface: 'xueqiu_moni',
        method: context.method,
        endpoint: context.endpoint,
        resultCode: code || null,
        message: msg || null,
        success: payload?.success ?? null,
        request: context.request ?? null,
        responseShape: this.safePayloadSummary(payload),
        sideEffectStatus: context.method === 'POST'
          ? 'write_not_confirmed; read position/history before claiming any side effect'
          : 'read_rejected',
        nextAction: context.method === 'POST'
          ? 'Stop this write workflow, do not retry the same write, do not use Portfolio fallback, read back Xueqiu position/history if needed, and ask the user to verify XQ_COOKIE/session/portfolio/write permission.'
          : 'Use cache/readback if available or ask the user to verify Xueqiu session and provider availability.',
      }, null, 2))
    }
  }

  private safeEndpoint(url: string): string {
    try {
      const parsed = new URL(url)
      return `${parsed.host}${parsed.pathname}`
    } catch {
      return url.split('?')[0]
    }
  }

  private safePayloadSummary(payload: any): Record<string, unknown> {
    const resultData = payload?.result_data
    const summary: Record<string, unknown> = {
      keys: payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 20) : [],
    }
    if (resultData == null) {
      summary.resultData = null
    } else if (Array.isArray(resultData)) {
      summary.resultData = { type: 'array', length: resultData.length }
    } else if (typeof resultData === 'object') {
      summary.resultData = { type: 'object', keys: Object.keys(resultData).slice(0, 20) }
    } else {
      summary.resultData = resultData
    }
    return summary
  }
}
