import type { Quote } from './eastmoney-fetcher'
import type { KlineRow, StockInfo } from './store/data-store'

const TENCENT_REFERER = 'https://stockapp.finance.qq.com/mstats/'

export async function tencentQuotes(codes: string[]): Promise<Quote[]> {
  const symbols = codes.map((code) => tencentSymbol(code)).join(',')
  const text = await fetchTencentText(`https://qt.gtimg.cn/q=${symbols}`)
  return parseTencentQuoteText(text)
}

export async function tencentIndexQuotes(codes: string[]): Promise<Quote[]> {
  const symbols = codes.map((code) => tencentSymbol(code, true)).join(',')
  const text = await fetchTencentText(`https://qt.gtimg.cn/q=${symbols}`)
  return parseTencentQuoteText(text)
}

export async function tencentStockList(limit = 6000): Promise<StockInfo[]> {
  const rows: StockInfo[] = []
  const pageSize = 200
  for (let offset = 0; offset < limit; offset += pageSize) {
    const params = new URLSearchParams({
      _appver: '11.17.0',
      board_code: 'aStock',
      sort_type: 'price',
      direct: 'down',
      offset: String(offset),
      count: String(Math.min(pageSize, limit - offset)),
    })
    const res = await fetch(`https://proxy.finance.qq.com/cgi/cgi-bin/rank/hs/getBoardRankList?${params}`, {
      headers: { Referer: TENCENT_REFERER, 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`Tencent stock list HTTP ${res.status}`)
    const json = await res.json() as Record<string, unknown>
    const list = Array.isArray((json.data as Record<string, unknown> | undefined)?.rank_list)
      ? (json.data as { rank_list: Array<Record<string, unknown>> }).rank_list
      : []
    if (list.length === 0) break
    const now = new Date().toISOString()
    rows.push(...list.map((row) => {
      const code = cleanCode(String(row.code ?? ''))
      return {
        code,
        name: String(row.name ?? ''),
        market: marketForCode(code),
        industry: null,
        list_date: null,
        delist_date: null,
        stock_type: 'stock',
        updated_at: now,
      }
    }).filter((row) => row.code.length >= 6 && row.name))
    if (list.length < pageSize) break
  }
  if (rows.length === 0) throw new Error('Tencent stock list returned no rows')
  return rows
}

export async function tencentDailyKline(
  code: string,
  opts: { start?: string; end?: string; adjust?: string; index?: boolean } = {},
): Promise<KlineRow[]> {
  const adjust = opts.adjust ?? 'qfq'
  if (!['qfq', 'none', 'hfq'].includes(adjust)) {
    throw new Error('Tencent daily K-line supports qfq, hfq, or none in this route.')
  }
  const symbol = tencentSymbol(code, opts.index)
  const paramAdjust = adjust === 'none' ? '' : adjust
  const varName = adjust === 'none' ? 'kline_day' : `kline_day${adjust}`
  const params = new URLSearchParams({
    _var: varName,
    param: `${symbol},day,${opts.start ?? ''},${opts.end ?? ''},640,${paramAdjust}`,
    r: '0.1',
  })
  const text = await fetchTencentText(`https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?${params}`)
  const json = parseTencentJsonp(text)
  const data = (json.data as Record<string, unknown> | undefined)?.[symbol] as Record<string, unknown> | undefined
  const rawRows = firstArray(data, ['qfqday', 'hfqday', 'day'])
  const rows = rawRows.map((row) => {
    const parts = Array.isArray(row) ? row : []
    return {
      code: cleanCode(code),
      date: formatDate(String(parts[0] ?? '')),
      open: Number(parts[1] ?? 0),
      close: Number(parts[2] ?? 0),
      high: Number(parts[3] ?? 0),
      low: Number(parts[4] ?? 0),
      volume: Number(parts[5] ?? 0),
      amount: Number(parts[8] ?? 0),
      change_pct: null,
      turnover_rate: null,
      adjust,
      source: 'tencent',
    }
  }).filter((row) => {
    if (!row.date || row.close <= 0) return false
    if (opts.start && row.date < formatDate(opts.start)) return false
    if (opts.end && row.date > formatDate(opts.end)) return false
    return true
  })
  if (rows.length === 0) throw new Error('Tencent daily K-line returned no valid rows')
  return rows
}

export async function tencentTransactions(code: string, limit: number): Promise<Array<Record<string, unknown>>> {
  const symbol = tencentSymbol(code)
  const rows: Array<Record<string, unknown>> = []
  let page = 0
  while (rows.length < limit && page < 10) {
    const params = new URLSearchParams({
      appn: 'detail',
      action: 'data',
      c: symbol,
      p: String(page),
    })
    const text = await fetchTencentText(`http://stock.gtimg.cn/data/index.php?${params}`)
    const pageRows = parseTencentTransactionPage(text)
    if (pageRows.length === 0) break
    rows.push(...pageRows)
    page += 1
  }
  if (rows.length === 0) throw new Error('Tencent transactions returned no rows')
  return rows.slice(0, limit)
}

function parseTencentQuoteText(text: string): Quote[] {
  const quotes: Quote[] = []
  for (const line of text.split(';')) {
    if (!line.includes('~')) continue
    const match = /v_([a-z]{2}[A-Za-z0-9]+)="([^"]*)"/i.exec(line)
    if (!match) continue
    const requestedSymbol = match[1]
    const parts = match[2].split('~')
    if (parts.length < 45) continue
    const price = num(parts[3])
    const prevClose = num(parts[4])
    quotes.push({
      code: normalizeTencentQuoteCode(requestedSymbol, parts[2]),
      name: parts[1] ?? '',
      price,
      change: num(parts[31]),
      changePct: num(parts[32]),
      open: num(parts[5]),
      high: num(parts[33]),
      low: num(parts[34]),
      prevClose,
      volume: num(parts[6]) * 100,
      amount: num(parts[37]) * 10000,
      pe: nullableNum(parts[39]),
      pb: null,
      marketCap: null,
      turnoverRate: nullableNum(parts[38]),
    })
  }
  return quotes
}

function parseTencentTransactionPage(text: string): Array<Record<string, unknown>> {
  const quoted = /\[\d+,"([^"]*)"/.exec(text)?.[1]
  if (!quoted) return []
  return quoted.split('|').map((item) => {
    const parts = item.split('/')
    return {
      index: parts[0],
      time: parts[1],
      price: Number(parts[2] ?? 0),
      change: Number(parts[3] ?? 0),
      volume: Number(parts[4] ?? 0),
      amount: Number(parts[5] ?? 0),
      direction: tencentDirection(parts[6] ?? ''),
      raw: item,
    }
  }).filter((row) => row.time && Number(row.price) > 0)
}

async function fetchTencentText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { Referer: TENCENT_REFERER, 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Tencent HTTP ${res.status}`)
  const bytes = await res.arrayBuffer()
  return new TextDecoder('gb18030').decode(bytes)
}

function parseTencentJsonp(text: string): Record<string, unknown> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Tencent JSONP payload missing object')
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
}

function firstArray(data: Record<string, unknown> | undefined, keys: string[]): unknown[] {
  if (!data) return []
  for (const key of keys) {
    const value = data[key]
    if (Array.isArray(value)) return value
  }
  return []
}

function tencentSymbol(code: string, index = false): string {
  const trimmed = code.trim()
  if (/^hk\d{5}$/i.test(trimmed)) return trimmed.toLowerCase()
  if (/^us[A-Za-z0-9.]+$/i.test(trimmed)) return `us${trimmed.slice(2).toUpperCase()}`
  const clean = cleanCode(code)
  if (/^(sh|sz|bj)/i.test(code)) return code.toLowerCase()
  if (index) return clean.startsWith('399') ? `sz${clean}` : `sh${clean}`
  if (clean.startsWith('11')) return `sh${clean}`
  if (clean.startsWith('12')) return `sz${clean}`
  return clean.startsWith('6') || clean.startsWith('5') ? `sh${clean}` : `sz${clean}`
}

function cleanCode(value: string): string {
  return value.replace(/^(sh|sz|bj)/i, '').replace(/\.(SH|SZ|BJ)$/i, '').trim()
}

function normalizeTencentQuoteCode(requestedSymbol: string, providerCode: string | undefined): string {
  const requested = requestedSymbol.trim()
  if (/^hk\d{5}$/i.test(requested)) return requested.toLowerCase()
  if (/^us[A-Za-z0-9.]+$/i.test(requested)) return `us${requested.slice(2).toUpperCase()}`
  const provider = String(providerCode ?? '').trim()
  if (provider && provider !== '0') return cleanCode(provider)
  return cleanCode(requested)
}

function marketForCode(code: string): string {
  if (code.startsWith('6')) return 'SH'
  if (code.startsWith('8') || code.startsWith('4')) return 'BJ'
  return 'SZ'
}

function formatDate(value: string): string {
  const text = value.trim()
  if (text.length >= 10 && text.includes('-')) return text.slice(0, 10)
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
  return text
}

function num(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nullableNum(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function tencentDirection(value: string): string {
  if (value === 'B') return 'buy'
  if (value === 'S') return 'sell'
  if (value === 'M') return 'neutral'
  return value
}
