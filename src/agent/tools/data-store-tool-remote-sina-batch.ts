import { toolError } from '../tool'
import type { DataStore } from '../data/store/data-store'
import {
  normalizeSinaClassificationMemberBatch,
  normalizeSinaEsgRatingCollection,
  normalizeSinaFundDividendFactor,
  normalizeSinaIntradayOhlcvBars,
} from '../data/output-only-interfaces'

type SinaNode = { name: string; code: string; parent: string | null }
type FailedPage = { kind: string; nodeCode?: string; nodeName?: string; page: number; error: string; failureClass: string }

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

const SINA_HEADERS = {
  Referer: 'https://finance.sina.com.cn/',
  'User-Agent': 'Mozilla/5.0',
}

export async function sinaClassificationMembersBatch(input: Record<string, unknown>): Promise<string> {
  const maxNodes = clampInt(input.maxNodes ?? input.limit ?? 5, 1, 200)
  const pageSize = clampInt(input.pageSize ?? input.num ?? 80, 1, 80)
  const maxPagesPerNode = clampInt(input.maxPagesPerNode ?? 1, 1, 20)
  const startNodeIndex = clampInt(input.startNodeIndex ?? 0, 0, 10_000)
  const startPage = clampInt(input.startPage ?? 1, 1, 10_000)
  const timeout = clampInt(input.timeout ?? 20_000, 1_000, 60_000)
  const nodeFilter = String(input.node ?? input.nodeCode ?? '').trim()

  const nodes = await fetchClassificationNodes(timeout)
  const selected = nodes
    .filter((node) => !nodeFilter || node.code === nodeFilter || node.name.includes(nodeFilter))
    .slice(startNodeIndex, startNodeIndex + maxNodes)

  const rows: Record<string, unknown>[] = []
  const failedPages: FailedPage[] = []
  let fetchedPages = 0
  let nextNodeIndex = startNodeIndex
  let nextPage = startPage
  let completed = true

  for (let i = 0; i < selected.length; i += 1) {
    const node = selected[i]
    const nodeIndex = startNodeIndex + i
    const pageStart = i === 0 ? startPage : 1
    for (let page = pageStart; page < pageStart + maxPagesPerNode; page += 1) {
      try {
        const pageRows = await fetchClassificationMemberPage(node, page, pageSize, timeout)
        fetchedPages += 1
        if (pageRows.length === 0) {
          nextNodeIndex = nodeIndex + 1
          nextPage = 1
          break
        }
        rows.push(...pageRows)
        nextNodeIndex = nodeIndex
        nextPage = page + 1
        if (pageRows.length < pageSize) {
          nextNodeIndex = nodeIndex + 1
          nextPage = 1
          break
        }
      } catch (error) {
        failedPages.push({
          kind: 'classification_members',
          nodeCode: node.code,
          nodeName: node.name,
          page,
          error: errorMessage(error),
          failureClass: classifyFailure(errorMessage(error)),
        })
        completed = false
        nextNodeIndex = nodeIndex
        nextPage = page
        break
      }
    }
    if (failedPages.length > 0) break
  }

  if (nextNodeIndex < nodes.length && selected.length === maxNodes) completed = false
  return JSON.stringify(normalizeSinaClassificationMemberBatch({
    raw: {
      nodeCount: nodes.length,
      fetchedPages,
      completed,
      checkpoint: completed ? null : { nextNodeIndex, nextPage },
      failedPages,
      rows,
    },
    params: { maxNodes, pageSize, maxPagesPerNode, startNodeIndex, startPage, node: nodeFilter || null },
  }), null, 2)
}

export async function sinaEsgRatingCollection(input: Record<string, unknown>): Promise<string> {
  const pageSize = clampInt(input.pageSize ?? input.num ?? input.limit ?? 50, 1, 200)
  const startPage = clampInt(input.page ?? input.startPage ?? 1, 1, 10_000)
  const maxPages = clampInt(input.maxPages ?? 1, 1, 50)
  const timeout = clampInt(input.timeout ?? 20_000, 1_000, 60_000)
  const rows: Record<string, unknown>[] = []
  const failedPages: FailedPage[] = []
  let fetchedPages = 0
  let totalStocks: number | null = null
  let nextPage = startPage
  let completed = true

  for (let page = startPage; page < startPage + maxPages; page += 1) {
    try {
      const result = await fetchEsgPage(page, pageSize, timeout)
      fetchedPages += 1
      if (totalStocks == null) totalStocks = result.total
      rows.push(...result.rows)
      nextPage = page + 1
      if (result.rows.length === 0 || (result.total != null && page * pageSize >= result.total)) {
        completed = true
        break
      }
      completed = false
    } catch (error) {
      failedPages.push({
        kind: 'esg_rating_collection',
        page,
        error: errorMessage(error),
        failureClass: classifyFailure(errorMessage(error)),
      })
      completed = false
      nextPage = page
      break
    }
  }

  return JSON.stringify(normalizeSinaEsgRatingCollection({
    raw: {
      totalStocks,
      fetchedPages,
      completed,
      checkpoint: completed ? null : { nextPage },
      failedPages,
      rows,
    },
    params: { pageSize, startPage, maxPages },
  }), null, 2)
}

export async function sinaFundDividendFactor(input: Record<string, unknown>, ds?: DataStore): Promise<string> {
  const symbol = normalizeFundSymbol(input.symbol ?? input.code ?? input.fundCode)
  if (!symbol) return toolError('symbol/code/fundCode required for sina_fund_dividend_factor')
  const timeout = clampInt(input.timeout ?? 20_000, 1_000, 60_000)
  const raw = await fetchText(`https://finance.sina.com.cn/realstock/company/${symbol}/hfq.js`, timeout)
  const parsed = parseSinaPayload(raw)
  const result = normalizeSinaFundDividendFactor({
    symbol,
    raw: parsed,
    sourceAction: 'sina_fund_dividend_factor',
  })
  const rows = Array.isArray(result.data?.rows) ? result.data.rows : []
  const shouldPersist = input.persist !== false && ds != null
  if (shouldPersist && rows.length > 0) {
    const fetchedAt = new Date().toISOString()
    ds.saveFundDividendFactors(rows.map((row) => {
      const item = isObjectRecord(row) ? row : {}
      return {
        code: symbol,
        event_date: String(item.date ?? ''),
        dividend: item.dividend ?? null,
        factor: item.factor ?? null,
        source: 'sina',
        fetched_at: fetchedAt,
        raw_json: JSON.stringify(item.raw ?? item),
      }
    }).filter((row) => row.event_date))
  }
  return JSON.stringify({
    ...result,
    persistencePolicy: shouldPersist ? 'persisted' : result.persistencePolicy,
    canonicalSchema: 'fund_dividend_factor',
    canonicalTable: 'fund_dividend_factor',
    readbackAction: 'query_fund_dividend_factor',
    cacheStatus: shouldPersist ? 'provider-hit' : result.cacheStatus,
    persistedRows: shouldPersist ? rows.length : 0,
    warnings: shouldPersist
      ? ['Persisted through governed fund.dividend_factor interface; use query_fund_dividend_factor before repeating live Sina calls.']
      : result.warnings,
  }, null, 2)
}

export async function sinaIntradayOhlcvBars(input: Record<string, unknown>, ds?: DataStore): Promise<string> {
  const code = String(input.code ?? input.symbol ?? '').trim()
  if (!code) return toolError('code/symbol required for sina_intraday_ohlcv_bars')
  const symbol = normalizeStockSymbol(code)
  if (!symbol) return toolError('A-share stock code required for sina_intraday_ohlcv_bars')
  const scale = clampInt(input.scale ?? input.intervalMinutes ?? 5, 1, 240)
  const datalen = clampInt(input.datalen ?? input.limit ?? 240, 1, 1023)
  const timeout = clampInt(input.timeout ?? 20_000, 1_000, 60_000)
  const params = new URLSearchParams({
    symbol,
    scale: String(scale),
    ma: 'no',
    datalen: String(datalen),
  })
  const raw = await fetchText(`https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?${params}`, timeout)
  const parsed = parseSinaPayload(raw)
  const result = normalizeSinaIntradayOhlcvBars({
    symbol,
    raw: parsed,
    sourceAction: 'sina_intraday_ohlcv_bars',
  })
  const rows = Array.isArray(result.data?.bars) ? result.data.bars : []
  const shouldPersist = input.persist !== false && ds != null
  if (shouldPersist && rows.length > 0) {
    const fetchedAt = new Date().toISOString()
    ds.saveIntradayOhlcvBars(rows.map((row) => {
      const item = isObjectRecord(row) ? row : {}
      const barTime = String(item.time ?? '')
      return {
        code: symbol,
        bar_time: barTime,
        trade_date: barTime.slice(0, 10),
        interval_minutes: scale,
        open: item.open ?? null,
        high: item.high ?? null,
        low: item.low ?? null,
        close: item.close ?? null,
        volume: item.volume ?? null,
        source: 'sina',
        fetched_at: fetchedAt,
        raw_json: JSON.stringify(item),
      }
    }).filter((row) => row.bar_time))
  }
  return JSON.stringify({
    ...result,
    persistencePolicy: shouldPersist ? 'persisted' : result.persistencePolicy,
    canonicalSchema: 'intraday_ohlcv_bars',
    canonicalTable: 'intraday_ohlcv_bars',
    readbackAction: 'query_intraday_ohlcv_bars',
    cacheStatus: shouldPersist ? 'provider-hit' : result.cacheStatus,
    persistedRows: shouldPersist ? rows.length : 0,
    warnings: shouldPersist
      ? ['Persisted through governed market.intraday_ohlcv_bars interface; use query_intraday_ohlcv_bars before repeating live Sina calls.']
      : result.warnings,
  }, null, 2)
}

async function fetchClassificationNodes(timeout: number): Promise<SinaNode[]> {
  const url = 'http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodes'
  const raw = await fetchText(url, timeout)
  const tree = parseSinaPayload(raw)
  if (!Array.isArray(tree)) throw new Error('Sina classification tree JSON missing')
  const nodes: SinaNode[] = []
  const visit = (node: unknown, parent: string | null): void => {
    if (!Array.isArray(node)) return
    const name = typeof node[0] === 'string' ? stripHtml(node[0]) : null
    const code = typeof node[2] === 'string' ? node[2] : null
    if (name && code) nodes.push({ name, code, parent })
    for (const child of node) visit(child, name ?? parent)
  }
  visit(tree, null)
  return nodes.filter((node) => node.name && node.code)
}

async function fetchClassificationMemberPage(
  node: SinaNode,
  page: number,
  pageSize: number,
  timeout: number,
): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({
    page: String(page),
    num: String(pageSize),
    sort: 'symbol',
    asc: '1',
    node: node.code,
    symbol: '',
    _s_r_a: 'page',
  })
  const url = `http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?${params}`
  const raw = await fetchText(url, timeout)
  const json = parseSinaPayload(raw)
  if (!Array.isArray(json)) throw new Error('Sina classification member page is not an array')
  return json.map((item) => {
    const row = asRecord(item)
    return {
      nodeCode: node.code,
      nodeName: node.name,
      symbol: row.symbol ?? row.code ?? null,
      name: row.name ?? null,
      trade: row.trade ?? null,
      changePercent: row.changepercent ?? null,
      raw: row,
    }
  })
}

async function fetchEsgPage(page: number, pageSize: number, timeout: number): Promise<{ total: number | null; rows: Record<string, unknown>[] }> {
  const params = new URLSearchParams({ page: String(page), num: String(pageSize) })
  const raw = await fetchText(`https://global.finance.sina.com.cn/api/openapi.php/EsgService.getEsgStocks?${params}`, timeout)
  const json = asRecord(parseSinaPayload(raw))
  const info = asRecord(asRecord(asRecord(json.result).data).info)
  const stocks = Array.isArray(info.stocks) ? info.stocks : []
  const rows: Record<string, unknown>[] = []
  for (const stockRaw of stocks) {
    const stock = asRecord(stockRaw)
    const ratings = Array.isArray(stock.esg_info) ? stock.esg_info : []
    for (const ratingRaw of ratings) {
      const rating = asRecord(ratingRaw)
      rows.push({
        symbol: stock.symbol ?? null,
        market: stock.market ?? null,
        agency: rating.agency ?? null,
        agencyName: rating.agency_name ?? null,
        esgScore: rating.esg_score ?? null,
        esgDate: rating.esg_dt ?? null,
        remark: rating.remark ?? null,
        raw: { stock, rating },
      })
    }
  }
  const total = Number(info.total ?? info.count)
  return { total: Number.isFinite(total) ? total : null, rows }
}

async function fetchText(url: string, timeout: number): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: SINA_HEADERS,
  })
  if (!res.ok) throw new Error(`Sina HTTP ${res.status}`)
  return res.text()
}

function parseSinaPayload(body: string): unknown {
  const text = body.trim()
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/^[^(]*\(([\s\S]*)\)\s*;?$/)
    const inner = match ? match[1] : text.replace(/^var\s+\w+\s*=\s*/, '').replace(/;$/, '')
    try {
      return JSON.parse(inner)
    } catch {
      return Function(`"use strict"; return (${inner});`)()
    }
  }
}

function clampInt(value: unknown, min: number, max: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.max(min, Math.min(Math.floor(number), max))
}

function normalizeFundSymbol(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return ''
  if (/^(sh|sz)\d{6}$/.test(raw)) return raw
  if (!/^\d{6}$/.test(raw)) return ''
  return raw.startsWith('5') ? `sh${raw}` : `sz${raw}`
}

function normalizeStockSymbol(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return ''
  if (/^(sh|sz)\d{6}$/.test(raw)) return raw
  if (!/^\d{6}$/.test(raw)) return ''
  return raw.startsWith('6') ? `sh${raw}` : `sz${raw}`
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '').trim()
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function classifyFailure(error: string): string {
  const text = error.toLowerCase()
  if (text.includes('timeout') || text.includes('socket') || text.includes('fetch failed')) return 'transport_unstable'
  if (text.includes('http 401') || text.includes('http 403') || text.includes('permission') || text.includes('credential')) return 'credential_gated'
  if (text.includes('http 429') || text.includes('quota') || text.includes('rate')) return 'quota_gated'
  if (text.includes('parameter') || text.includes('invalid')) return 'invalid_parameters'
  if (text.includes('schema') || text.includes('json') || text.includes('array')) return 'schema_mismatch'
  return 'provider_unavailable'
}

export function invalidSinaBatchProvider(input: Record<string, unknown>): string | null {
  const provider = String(input.provider ?? 'sina').trim().toLowerCase()
  if (!provider || provider === 'sina') return null
  return toolError(`Sina batch actions require provider:"sina"; received provider:${provider}`)
}
