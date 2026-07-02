import type { QuoteSnapshotRow, StockInfo } from '../store/data-store-types'
import type { FetchProvenance } from './base-fetcher'
import { timeoutForEastmoneyBackedUrl } from '../provider-timeouts'
import { tencentQuotes } from '../tencent-fetcher'

export interface EtfQuoteFetchResult {
  stocks: StockInfo[]
  quotes: QuoteSnapshotRow[]
  provenance?: FetchProvenance
}

export async function fetchEtfQuotes(
  limit = 80,
  source: 'eastmoney' | 'akshare' | 'sina' | 'tencent' = 'eastmoney',
): Promise<EtfQuoteFetchResult> {
  const pageSize = Math.max(1, Math.min(200, Math.floor(limit)))
  if (source === 'tencent') return fetchTencentEtfQuotes(pageSize)
  const url = source === 'eastmoney'
    ? `https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:MK0021,b:MK0022,b:MK0023,b:MK0024&fields=f12,f14,f2,f3,f5`
    : source === 'sina'
      ? `https://vip.stock.finance.sina.com.cn/quotes_service/api/jsonp.php/IO.XSRV2.CallbackList['da_yPT46_Ll7K6WD']/Market_Center.getHQNodeDataSimple?page=1&num=${pageSize}&sort=symbol&asc=0&node=etf_hq_fund`
      : `http://127.0.0.1:19800/akshare/fund_etf_spot_em?_priority=background`
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url)),
    headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://finance.sina.com.cn/' },
  })
  if (!res.ok) throw new Error(`${source} ETF API returned HTTP ${res.status}`)
  const text = await res.text()
  const body = parseJsonOrJsonp(text) as Record<string, any>
  const rows = Array.isArray(body?.data?.diff)
    ? body.data.diff as Array<Record<string, unknown>>
    : Array.isArray(body?.data)
      ? body.data as Array<Record<string, unknown>>
      : Array.isArray(body)
        ? body as Array<Record<string, unknown>>
        : []
  const now = new Date().toISOString()

  const stocks: StockInfo[] = []
  const quotes: QuoteSnapshotRow[] = []
  for (const row of rows.slice(0, pageSize)) {
    const code = normalizeEtfCode(row.f12 ?? row['代码'] ?? row.code ?? row.symbol)
    if (!code) continue
    const name = String(row.f14 ?? row['名称'] ?? row.name ?? code).trim()
    stocks.push({
      code,
      name,
      market: 'ETF',
      industry: null,
      list_date: null,
      delist_date: null,
      stock_type: 'etf',
      updated_at: now,
    })
    quotes.push({
      code,
      timestamp: now,
      fetched_at: now,
      source: `${source}:etf`,
      name,
      price: toNum(row.f2 ?? row['最新价'] ?? row.trade ?? row.price),
      change: toNum(row.f4 ?? row.pricechange),
      change_pct: toNum(row.f3 ?? row['涨跌幅'] ?? row.changepercent ?? row.change_pct),
      open: toNum(row.f17 ?? row.open),
      high: toNum(row.f15 ?? row.high),
      low: toNum(row.f16 ?? row.low),
      prev_close: toNum(row.f18 ?? row.settlement),
      volume: toNum(row.f5 ?? row['成交量'] ?? row.volume),
      amount: toNum(row.f6 ?? row.amount),
      raw_json: JSON.stringify(row),
    })
  }

  return { stocks, quotes }
}

export async function fetchTencentListedFundQuotes(limit = 80): Promise<EtfQuoteFetchResult> {
  return fetchTencentFundQuoteSymbols(TENCENT_LISTED_FUND_SYMBOLS, limit, {
    market: 'LISTED_FUND',
    stockType: 'listed_fund',
    source: 'tencent:listed_fund',
  })
}

async function fetchTencentEtfQuotes(limit: number): Promise<EtfQuoteFetchResult> {
  return fetchTencentFundQuoteSymbols(TENCENT_ETF_SYMBOLS, limit, {
    market: 'ETF',
    stockType: 'etf',
    source: 'tencent:etf',
  })
}

async function fetchTencentFundQuoteSymbols(
  symbols: string[],
  limit: number,
  opts: { market: string; stockType: string; source: string },
): Promise<EtfQuoteFetchResult> {
  const now = new Date().toISOString()
  const boundedLimit = Math.max(1, Math.min(symbols.length, Math.floor(limit)))
  const quotes = (await tencentQuotes(symbols.slice(0, boundedLimit))).map((quote) => ({
    code: quote.code,
    timestamp: now,
    fetched_at: now,
    source: opts.source,
    name: quote.name,
    price: quote.price,
    change: quote.change,
    change_pct: quote.changePct,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    prev_close: quote.prevClose,
    volume: quote.volume,
    amount: quote.amount,
    raw_json: JSON.stringify(quote),
  }))
  const stocks = quotes.map((quote) => ({
    code: quote.code,
    name: quote.name ?? quote.code,
    market: opts.market,
    industry: null,
    list_date: null,
    delist_date: null,
    stock_type: opts.stockType,
    updated_at: now,
  }))
  if (quotes.length === 0) throw new Error(`Tencent ${opts.stockType} quote returned no rows`)
  return { stocks, quotes }
}

function toNum(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeEtfCode(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^(sh|sz)/i, '')
}

function parseJsonOrJsonp(text: string): unknown {
  const trimmed = text.trim().replace(/^\/\*[\s\S]*?\*\//, '').trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('(')
    const end = trimmed.lastIndexOf(')')
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start + 1, end))
    }
    throw new Error('ETF API returned non-JSON payload')
  }
}

const TENCENT_ETF_SYMBOLS = [
  '510300',
  '510050',
  '510500',
  '588000',
  '159915',
  '159919',
  '159949',
  '159995',
]

const TENCENT_LISTED_FUND_SYMBOLS = [
  '511880',
  '511990',
  '160222',
  '161725',
]
