import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'
import { loadConfig } from '../../main/config'
import { researchToolCopy } from '../runtime-copy'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ArtifactRegistry } from '../artifact-registry'
import { financeNews } from './data-store-tool-remote-finance-news'

let paidSearchCount = 0

function researchSourceLabel(key: 'eastmoney' | 'sina' | 'baidu' | 'guba' | 'multiNews'): string {
  return researchToolCopy.sourceLabel(key)
}

export class ResearchTool implements Tool {
  name = 'Research'
  description = 'Research tool for search engines, financial news, social sentiment, and web fetch. Use action="help". Paid search uses monthly-limited Brave/Tavily keys.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['providers', 'search', 'news', 'sentiment', 'fetch', 'help'] },
      query: { type: 'string', description: 'Search query' },
      provider: {
        type: 'string',
        enum: ['auto', 'brave', 'tavily'],
        description: '(search) Search engine to use. auto = round-robin between configured providers.',
      },
      symbols: { type: 'array', items: { type: 'string' }, description: '(sentiment) Stock symbols' },
      url: { type: 'string', description: '(fetch) URL to fetch' },
      method: { type: 'string', description: '(fetch) HTTP method: GET/POST' },
      headers: { type: 'object', description: '(fetch) Custom headers' },
      body: { type: 'string', description: '(fetch) POST body' },
      maxLength: { type: 'number', description: '(fetch) Max content length (default 50000)' },
    },
    required: ['action'],
  }

  needsPermissions(): boolean { return false }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.action) return researchToolCopy.missingAction()
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'help')
    switch (action) {
      case 'help': return researchToolCopy.helpText()
      case 'providers': return this.providers(input, ctx.basePath)
      case 'search': return await this.search(input, ctx.basePath)
      case 'news': return await this.news(input, ctx)
      case 'sentiment': return await this.sentiment(input, ctx.basePath)
      case 'fetch': return await this.fetchAction(input, ctx.basePath)
      default:
        return toolError(researchToolCopy.unknownAction(action))
    }
  }

  // ─── Web Search ───

  private async search(input: Record<string, unknown>, basePath: string): Promise<string> {
    const query = input.query as string | undefined
    const provider = String(input.provider ?? 'auto').toLowerCase()
    if (!query) {
      return toolError(researchToolCopy.missingSearchQuery())
    }
    if (!['auto', 'brave', 'tavily'].includes(provider)) {
      return toolError(researchToolCopy.invalidSearchProvider())
    }

    const config = loadConfig(basePath)
    const braveKey = config.apiKeys?.BRAVE_SEARCH_KEY
    const tavilyKey = config.apiKeys?.TAVILY_API_KEY
    const hasBrave = !!braveKey
    const hasTavily = !!tavilyKey

    if (!hasBrave && !hasTavily) {
      return researchToolCopy.searchKeyMissing()
    }

    const fetchedAt = new Date().toISOString()
    const errors: string[] = []
    const routeTried: string[] = []
    const successResult = (providerUsed: 'brave' | 'tavily', results: any[]) => {
      const searchEngine = providerUsed === 'brave' ? 'Brave' : 'Tavily'
      registerResearchArtifact(basePath, {
        action: 'search',
        query,
        source: searchEngine,
        evidence: results,
      })
      return JSON.stringify({
        tool: 'Research',
        capability: 'search-engine',
        action: 'search',
        query,
        providerRequested: provider,
        providerUsed,
        searchEngine,
        quotaClass: 'paid-monthly-limited',
        routeTried,
        fetchedAt,
        source: searchEngine,
        count: results.length,
        results,
      }, null, 2)
    }
    const providers: Array<{ id: 'brave' | 'tavily'; call: () => Promise<any[]> }> = []
    if (provider === 'brave') {
      if (!hasBrave) return toolError('Brave Search is not configured. Add BRAVE_SEARCH_KEY in Settings.')
      providers.push({ id: 'brave', call: () => braveSearch(query, braveKey!) })
    } else if (provider === 'tavily') {
      if (!hasTavily) return toolError('Tavily Search is not configured. Add TAVILY_API_KEY in Settings.')
      providers.push({ id: 'tavily', call: () => tavilySearch(query, tavilyKey!) })
    } else if (paidSearchCount % 2 === 0) {
      if (hasBrave) providers.push({ id: 'brave', call: () => braveSearch(query, braveKey!) })
      if (hasTavily) providers.push({ id: 'tavily', call: () => tavilySearch(query, tavilyKey!) })
      paidSearchCount++
    } else {
      if (hasTavily) providers.push({ id: 'tavily', call: () => tavilySearch(query, tavilyKey!) })
      if (hasBrave) providers.push({ id: 'brave', call: () => braveSearch(query, braveKey!) })
      paidSearchCount++
    }

    for (const searchProvider of providers) {
      routeTried.push(searchProvider.id)
      try {
        const results = await searchProvider.call()
        if (results.length > 0) {
          return successResult(searchProvider.id, results)
        }
      } catch (e) { errors.push(`${searchProvider.id}: ${String(e)}`) }
    }

    return toolError(
      researchToolCopy.searchFailed(errors.join('; ')),
    )
  }

  private providers(_input: Record<string, unknown>, basePath: string): string {
    const config = loadConfig(basePath)
    const hasBrave = Boolean(config.apiKeys?.BRAVE_SEARCH_KEY)
    const hasTavily = Boolean(config.apiKeys?.TAVILY_API_KEY)
    return JSON.stringify({
      tool: 'Research',
      action: 'providers',
      searchEngines: [
        {
          provider: 'brave',
          label: 'Brave Search API',
          kind: 'search-engine',
          quotaClass: 'paid-monthly-limited',
          configured: hasBrave,
          available: hasBrave,
        },
        {
          provider: 'tavily',
          label: 'Tavily Search API',
          kind: 'search-engine',
          quotaClass: 'paid-monthly-limited',
          configured: hasTavily,
          available: hasTavily,
        },
      ],
      newsSources: [
        { provider: 'baidu-finance', label: researchSourceLabel('baidu'), kind: 'news-source' },
        { provider: 'eastmoney-news', label: researchSourceLabel('eastmoney'), kind: 'news-source' },
        { provider: 'sina-finance', label: researchSourceLabel('sina'), kind: 'news-source' },
      ],
    }, null, 2)
  }

  // ─── News ───

  private async news(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const query = input.query as string | undefined
    if (!query) {
      return toolError(researchToolCopy.missingNewsQuery())
    }
    const basePath = ctx.basePath

    const results: any[] = []
    const errors: string[] = []

    // Source 1: Baidu Finance
    try {
      const r = await fetchJSON(`https://gushitong.baidu.com/opendata?query=${encodeURIComponent(query)}&resource_id=5352&pn=0&rn=10`, {
        headers: { Referer: 'https://gushitong.baidu.com' },
      })
      const data = r?.Result ?? []
      for (const group of data) {
        const list = group?.DisplayData?.resultData?.tplData?.result?.list ?? []
        for (const item of list) {
          results.push({ title: item.title ?? '', url: item.url ?? '', source: item.media_name ?? researchSourceLabel('baidu'), date: item.publish_time ?? '' })
        }
      }
    } catch (e) { errors.push(`Baidu: ${e}`) }

    // Source 2: EastMoney
    try {
      const param = JSON.stringify({ uid: '', keyword: query, type: ['cmsArticleWebOld'], client: 'web', clientVersion: 'curr', param: { cmsArticleWebOld: { searchScope: 'default', sort: 'default', pageIndex: 1, pageSize: 10 } } })
      const res = await fetch(`https://search-api-web.eastmoney.com/search/jsonp?cb=jQuery&param=${encodeURIComponent(param)}`)
      let body = await res.text()
      if (body.startsWith('jQuery')) body = body.slice(body.indexOf('(') + 1, body.lastIndexOf(')'))
      const json = JSON.parse(body)
      const articles = json?.result?.cmsArticleWebOld ?? []
      for (const a of articles.slice(0, 10)) {
        results.push({ title: a.title ?? '', url: a.url ?? '', source: researchSourceLabel('eastmoney'), date: a.date ?? '' })
      }
    } catch (e) { errors.push(`EastMoney: ${e}`) }

    // Source 3: Sina Finance, routed through governed news.finance_feed.
    try {
      const response = await financeNews({
        query,
        keyword: query,
        provider: 'sina',
        cacheMode: 'live-only',
        limit: 10,
      }, ctx)
      const parsed = JSON.parse(response) as { data?: Array<Record<string, unknown>>; provenance?: Record<string, unknown> }
      for (const item of (parsed.data ?? []).slice(0, 10)) {
        const title = stringField(item.title)
        if (!title) continue
        results.push({
          title,
          url: stringField(item.url),
          source: stringField(item.source) || researchSourceLabel('sina'),
          date: stringField(item.published_at) || stringField(item.date),
          interfaceId: parsed.provenance?.interfaceId ?? 'news.finance_feed',
          provider: parsed.provenance?.provider ?? 'sina',
          capabilityId: parsed.provenance?.capabilityId ?? 'sina.news.finance_feed',
          cacheStatus: parsed.provenance?.cacheStatus,
        })
      }
    } catch (e) {
      errors.push(`Sina(news.finance_feed): ${e}`)
    }

    // Deduplicate
    const seen = new Set<string>()
    const deduped = results.filter((r) => {
      const title = (r.title ?? '').trim()
      if (!title || seen.has(title)) return false
      seen.add(title)
      return true
    })

    registerResearchArtifact(basePath, {
      action: 'news',
      query,
      source: researchSourceLabel('multiNews'),
      evidence: deduped.slice(0, 20),
      unverifiedItems: errors,
    })

    return JSON.stringify({
      action: 'news', source: researchSourceLabel('multiNews'), query,
      count: deduped.length,
      results: deduped.slice(0, 20),
      ...(errors.length > 0 ? { errors } : {}),
    }, null, 2)
  }

  // ─── Sentiment ───

  private async sentiment(input: Record<string, unknown>, basePath?: string): Promise<string> {
    const symbols = (input.symbols as string[]) ?? []
    if (symbols.length === 0) {
      return toolError(researchToolCopy.missingSentimentSymbols())
    }

    const results: any[] = []
    for (const symbol of symbols) {
      const data: Record<string, unknown> = { symbol }

      // StockTwits (US stocks)
      try {
        const r = await fetchJSON(`https://api.stocktwits.com/api/2/streams/symbol/${symbol}.json`)
        const messages = r?.messages ?? []
        let bullish = 0, bearish = 0
        for (const msg of messages) {
          const s = msg?.entities?.sentiment?.basic
          if (s === 'Bullish') bullish++
          if (s === 'Bearish') bearish++
        }
        data.stocktwits = {
          messages: messages.length, bullish, bearish,
          ratio: bullish + bearish > 0 ? +((bullish / (bullish + bearish)) * 100).toFixed(1) : null,
        }
      } catch { /* skip */ }

      // Guba exposes post titles but no typed sentiment label. Preserve the
      // observations without guessing their meaning from words in the title.
      const cleanCode = symbol.replace(/\.(SH|SZ|BJ)$/i, '').replace(/^(SH|SZ|BJ)/i, '')
      if (/^\d{6}$/.test(cleanCode)) {
        try {
          const res = await fetch(`https://guba.eastmoney.com/list,${cleanCode}.html`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
          })
          const html = await res.text()
          const titles = [...html.matchAll(/title="([^"]{4,})"/g)].map((m) => m[1])
            .filter((t) => !t.includes('东方财富') && !t.includes('股吧')).slice(0, 30)
          data.guba = buildUnclassifiedGubaObservation(titles, researchSourceLabel('guba'))
        } catch { /* skip */ }
      }

      results.push(data)
    }

    if (basePath) {
      registerResearchArtifact(basePath, {
        action: 'sentiment',
        query: symbols.join(', '),
        source: researchToolCopy.sentimentSourceSummary(researchSourceLabel('guba')),
        evidence: results,
      })
    }
    return JSON.stringify({ action: 'sentiment', source: researchToolCopy.sentimentSourceSummary(researchSourceLabel('guba')), data: results }, null, 2)
  }

  // ─── Fetch ───

  private async fetchAction(input: Record<string, unknown>, basePath: string): Promise<string> {
    let url = input.url as string | undefined
    if (!url) {
      return toolError(researchToolCopy.missingFetchUrl())
    }

    // API key injection
    if (url.includes('api.stlouisfed.org') && !url.includes('api_key=')) {
      const config = loadConfig(basePath)
      const fredKey = config.apiKeys?.FRED_API_KEY
      if (!fredKey) {
        return toolError(researchToolCopy.missingFredKey())
      }
      url += (url.includes('?') ? '&' : '?') + `api_key=${fredKey}`
    }

    const method = String(input.method ?? 'GET').toUpperCase()
    const customHeaders = (input.headers ?? {}) as Record<string, string>
    const body = input.body as string | undefined
    const maxLength = Number(input.maxLength ?? 50_000)

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      ...customHeaders,
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: method === 'POST' ? body : undefined,
        signal: controller.signal,
      })

      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        return toolError(`HTTP ${res.status}: ${errBody.slice(0, 200)}`)
      }

      const ct = res.headers.get('content-type') ?? ''
      let content = await res.text()

      if (ct.includes('html') || content.includes('<html') || content.includes('<!DOCTYPE')) {
        content = content
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      }

      if (content.length > maxLength) {
        content = `${content.slice(0, maxLength)}\n\n[Truncated: ${content.length} chars total, showing first ${maxLength}]`
      }

      registerResearchArtifact(basePath, {
        action: 'fetch',
        query: url,
        source: url,
        evidence: [{ url, method, contentType: ct, content: content.slice(0, Math.min(content.length, 4000)) }],
        draft: content.slice(0, Math.min(content.length, 2000)),
      })

      return content
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function buildUnclassifiedGubaObservation(titles: string[], source = 'EastMoney Guba'): Record<string, unknown> {
  return {
    source,
    posts: titles.length,
    classification: 'unclassified',
    classificationReason: 'The source does not provide a typed sentiment label.',
    topTitles: titles.slice(0, 5),
  }
}

async function braveSearch(query: string, apiKey: string): Promise<any[]> {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
  })
  if (!res.ok) throw new Error(`Brave ${res.status}`)
  const json = await res.json() as any
  return (json.web?.results ?? []).map((r: any) => ({
    title: r.title, url: r.url, content: r.description?.slice(0, 200) ?? '', engine: 'Brave',
  }))
}

async function tavilySearch(query: string, apiKey: string): Promise<any[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 8 }),
  })
  if (!res.ok) throw new Error(`Tavily ${res.status}`)
  const json = await res.json() as any
  return (json.results ?? []).map((r: any) => ({
    title: r.title, url: r.url, content: r.content?.slice(0, 200) ?? '', engine: 'Tavily',
  }))
}

async function fetchJSON(url: string, opts?: { headers?: Record<string, string> }): Promise<any> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', ...opts?.headers },
    signal: AbortSignal.timeout(15_000),
  })
  return await res.json()
}

type ResearchArtifactInput = {
  action: 'search' | 'news' | 'sentiment' | 'fetch'
  query: string
  source: string
  evidence: Array<Record<string, unknown>>
  unverifiedItems?: string[]
  draft?: string
}

function registerResearchArtifact(basePath: string, input: ResearchArtifactInput): void {
  const now = new Date()
  const id = `${input.action}-${slug(input.query)}-${now.getTime()}`
  const dir = join(basePath, 'memory', 'research')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${id}.json`)
  const citations = input.evidence
    .map((row) => ({ title: stringField(row.title) || stringField(row.url) || input.query, url: stringField(row.url), source: stringField(row.source) || input.source, date: stringField(row.date) }))
    .filter((row) => row.title || row.url || row.source)
  const payload = {
    id,
    action: input.action,
    query: input.query,
    createdAt: now.toISOString(),
    hypotheses: [`Research result for ${input.query}`],
    evidence: input.evidence,
    citations,
    unverifiedItems: input.unverifiedItems ?? [],
    draft: input.draft ?? null,
    source: input.source,
  }
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf-8')
  new ArtifactRegistry(basePath).register({
    kind: 'research',
    path,
    title: `${input.action}: ${input.query}`.slice(0, 120),
    source: input.source,
    id: `research:${id}`,
    ownerTask: 'research-workspace',
    verificationStatus: input.unverifiedItems?.length ? 'unverified' : 'verified',
    freshness: {
      sourceTime: now.toISOString(),
      fetchedAt: now.toISOString(),
      status: 'fresh',
    },
    provenance: {
      source: input.source,
      action: input.action,
      query: input.query,
      citationCount: citations.length,
    },
    metadata: {
      action: input.action,
      query: input.query,
      citations: citations.length,
      evidence: input.evidence.length,
      unverifiedItems: input.unverifiedItems?.length ?? 0,
      draft: Boolean(input.draft),
    },
  })
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'research'
}
