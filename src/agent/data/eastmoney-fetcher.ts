import { trackedFetchJSON } from './tracked-fetch'

const EASTMONEY_CLIST_URL = 'https://push2delay.eastmoney.com/api/qt/clist/get'
const SIDECAR_URL = 'http://127.0.0.1:19800'

export interface Quote {
  code: string
  name: string
  price: number
  change: number
  changePct: number
  open: number
  high: number
  low: number
  prevClose: number
  volume: number
  amount: number
  pe: number | null
  pb: number | null
  marketCap: number | null
  turnoverRate: number | null
}

export interface KlineBar {
  date: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  amount: number
  changePct: number | null
  turnoverRate: number | null
}

export interface MoneyFlow {
  date: string
  mainNetInflow: number
  smallNetInflow: number
  mediumNetInflow: number
  largeNetInflow: number
  superLargeNetInflow: number
  closePrice: number | null
  changePct: number | null
}

export interface SectorItem {
  code: string
  name: string
  changePct: number
  turnoverRate: number | null
  upCount: number
  downCount: number
  leadingStock: string | null
  leadingChangePct: number | null
}

export type SectorStock = Quote

function cleanCode(code: string): string {
  return code.replace(/\.(SH|SZ|BJ)$/i, '').replace(/^(SH|SZ|BJ)/i, '')
}

function secId(code: string): string {
  const c = cleanCode(code)
  const market = c.startsWith('6') ? '1' : '0'
  return `${market}.${c}`
}

function d(v: unknown): number {
  if (typeof v === 'number') return v
  return parseFloat(String(v)) || 0
}

function dn(v: unknown): number | null {
  if (typeof v === 'number') return v
  const n = parseFloat(String(v))
  return isNaN(n) ? null : n
}

async function fetchJSON(url: string, timeoutMs?: number): Promise<unknown> {
  return trackedFetchJSON(url, undefined, timeoutMs)
}

export async function fetchQuote(code: string): Promise<Quote | null> {
  const url = `https://push2delay.eastmoney.com/api/qt/stock/get?ut=fa5fd1943c7b386f172d6893dbbd1d0c&fltt=2&invt=2&fields=f43,f44,f45,f46,f47,f48,f51,f55,f58,f60,f116,f168,f170&secid=${secId(code)}`
  const json = await fetchJSON(url) as any
  const data = json?.data
  if (!data) return null

  const price = d(data.f43)
  const prevClose = d(data.f60)
  return {
    code: cleanCode(code),
    name: data.f58 ?? '',
    price,
    change: price - prevClose,
    changePct: d(data.f170),
    open: d(data.f46),
    high: d(data.f44),
    low: d(data.f45),
    prevClose,
    volume: d(data.f47),
    amount: d(data.f48),
    pe: dn(data.f55),
    pb: dn(data.f51),
    marketCap: dn(data.f116),
    turnoverRate: dn(data.f168),
  }
}

export async function fetchQuoteBatch(codes: string[]): Promise<Quote[]> {
  const results: Quote[] = []
  for (const code of codes) {
    const quote = await fetchQuote(code)
    if (quote) results.push(quote)
  }
  return results
}

export async function fetchKline(
  code: string,
  period = 'daily',
  adjust = 'qfq',
  startDate?: string,
  limit = 120,
): Promise<KlineBar[]> {
  if (period !== 'daily') return []
  const qs = new URLSearchParams({
    symbol: cleanCode(code),
    period: 'daily',
    adjust,
    _priority: 'background',
  })
  if (startDate) qs.set('start_date', startDate.replace(/-/g, ''))
  const json = await fetchJSON(`${SIDECAR_URL}/akshare/stock_zh_a_hist?${qs}`) as any
  const rows = (json?.data ?? []) as Array<Record<string, unknown>>

  const bars: KlineBar[] = []
  for (const row of rows.slice(-limit)) {
    bars.push({
      date: String(row['日期'] ?? row.date ?? '').substring(0, 10),
      open: d(row['开盘'] ?? row.open),
      close: d(row['收盘'] ?? row.close),
      high: d(row['最高'] ?? row.high),
      low: d(row['最低'] ?? row.low),
      volume: d(row['成交量'] ?? row.volume),
      amount: d(row['成交额'] ?? row.amount),
      changePct: dn(row['涨跌幅'] ?? row.changePct ?? row.change_pct),
      turnoverRate: dn(row['换手率'] ?? row.turnoverRate ?? row.turnover_rate),
    })
  }
  return bars
}

export async function fetchMoneyFlow(code: string, days = 30): Promise<MoneyFlow[]> {
  const market = cleanCode(code).startsWith('6') ? 'sh' : cleanCode(code).startsWith('8') || cleanCode(code).startsWith('4') ? 'bj' : 'sz'
  const json = await fetchJSON(`${SIDECAR_URL}/akshare/stock_individual_fund_flow?stock=${cleanCode(code)}&market=${market}&_priority=background&_provider=eastmoney`) as any
  const rows = (json?.data ?? []) as Array<Record<string, unknown>>

  const flows: MoneyFlow[] = []
  for (const row of rows.slice(-days)) {
    flows.push({
      date: String(row['日期'] ?? row.date ?? '').substring(0, 10),
      mainNetInflow: d(row['主力净流入-净额'] ?? row.mainNetInflow ?? row.main_net),
      smallNetInflow: d(row['小单净流入-净额'] ?? row.smallNetInflow ?? row.small_net),
      mediumNetInflow: d(row['中单净流入-净额'] ?? row.mediumNetInflow ?? row.medium_net),
      largeNetInflow: d(row['大单净流入-净额'] ?? row.largeNetInflow ?? row.large_net),
      superLargeNetInflow: d(row['超大单净流入-净额'] ?? row.superLargeNetInflow ?? row.super_large_net),
      closePrice: dn(row['收盘价'] ?? row.closePrice ?? row.close_price),
      changePct: dn(row['涨跌幅'] ?? row.changePct ?? row.change_pct),
    })
  }
  return flows
}

export async function fetchSectors(type: 'industry' | 'concept' | 'area' = 'industry'): Promise<SectorItem[]> {
  const fsMap: Record<string, string> = {
    industry: 'm:90 t:2 f:!50',
    concept: 'm:90 t:3 f:!50',
    area: 'm:90 t:1 f:!50',
  }
  const fs = encodeURIComponent(fsMap[type] ?? fsMap.industry)
  const url = `${EASTMONEY_CLIST_URL}?pn=1&pz=100&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=${fs}&fields=f3,f8,f12,f14,f104,f105,f140,f141`
  const json = await fetchJSON(url) as any
  return normalizeSectorRows(json)
}

export async function fetchSectorStocks(
  sector: string | Pick<SectorItem, 'code' | 'name'>,
  type: 'industry' | 'concept' | 'area' = 'industry',
  limit = 200,
  timeoutMs?: number,
): Promise<SectorStock[]> {
  const sectorCode = await resolveSectorCode(sector, type)
  if (!sectorCode) return []

  const url = eastmoneyUrl(EASTMONEY_CLIST_URL, {
    pn: '1',
    pz: String(limit),
    po: '1',
    np: '1',
    ut: 'bd1d9ddb04089700cf9c27f6f7426281',
    fltt: '2',
    invt: '2',
    fid: 'f3',
    fs: `b:${sectorCode} f:!50`,
    fields: 'f2,f3,f4,f5,f6,f7,f8,f9,f12,f14,f15,f16,f17,f18,f20',
  })
  const json = await fetchJSON(url, timeoutMs) as any
  return normalizeSectorStockRows(json)
}

export function normalizeSectorRows(json: any): SectorItem[] {
  const diff = json?.data?.diff as any[] | undefined
  if (!Array.isArray(diff)) return []

  return diff.map((item) => ({
    code: String(item.f12 ?? ''),
    name: String(item.f14 ?? ''),
    changePct: d(item.f3),
    turnoverRate: dn(item.f8),
    upCount: d(item.f104),
    downCount: d(item.f105),
    leadingStock: item.f140 ? String(item.f140) : null,
    leadingChangePct: dn(item.f141),
  })).filter((item) => item.code && item.name)
}

export function normalizeSectorStockRows(json: any): SectorStock[] {
  const diff = json?.data?.diff as any[] | undefined
  if (!Array.isArray(diff)) return []

  return diff.map((item): SectorStock | null => {
    const code = String(item.f12 ?? '')
    if (!code) return null
    const price = d(item.f2)
    const prevClose = d(item.f18)
    return {
      code,
      name: String(item.f14 ?? ''),
      price,
      change: d(item.f4),
      changePct: d(item.f3),
      open: d(item.f17),
      high: d(item.f15),
      low: d(item.f16),
      prevClose,
      volume: d(item.f5),
      amount: d(item.f6),
      pe: dn(item.f9),
      pb: dn(item.f23),
      marketCap: dn(item.f20),
      turnoverRate: dn(item.f8),
    }
  }).filter((item): item is SectorStock => item !== null)
}

async function resolveSectorCode(
  sector: string | Pick<SectorItem, 'code' | 'name'>,
  type: 'industry' | 'concept' | 'area',
): Promise<string | null> {
  const rawCode = typeof sector === 'string' ? sector : sector.code
  if (/^BK\d{4,}$/i.test(rawCode.trim())) return rawCode.trim().toUpperCase()

  const name = typeof sector === 'string' ? sector.trim() : sector.name.trim()
  if (!name) return null

  const sectors = await fetchSectors(type)
  const found = sectors.find((s) => s.name === name || s.code === name.toUpperCase())
    ?? sectors.find((s) => s.name.includes(name) || name.includes(s.name))
  return found?.code ?? null
}

function eastmoneyUrl(base: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params)
  return `${base}?${qs.toString()}`
}
