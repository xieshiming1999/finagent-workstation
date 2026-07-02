import type { FetchResult } from './base-fetcher'
import { fetchSectors } from '../eastmoney-fetcher'
import type { DataApiProviderCapability } from '../data-api-interface-contract'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data-api-interface-router'
import { readSectorRankingRows } from '../data-api-interface-cache'
import {
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  type DataApiFetchOptions,
  withInterfaceProvenance,
} from './fetcher-interface-utils'

const SIDECAR = 'http://127.0.0.1:19800'
const GOTDX = 'http://127.0.0.1:19801'

export interface SectorRow {
  date: string; sector_type: string; code: string; name: string
  change_pct: number; turnover_rate: number | null
  up_count: number; down_count: number
  leading_stock: string | null; leading_pct: number | null
  rank: number; source: string
}

export async function fetchSectorRanking(
  type: 'industry' | 'concept' = 'industry',
  opts: DataApiFetchOptions = {},
): Promise<FetchResult<SectorRow>> {
  const interfaceId = opts.interfaceId === 'market.board_ranking'
    ? 'market.board_ranking'
    : 'market.sector_ranking'
  const routed = await runDataApiInterfaceRoute(
    interfaceId,
    (capability) => sectorRankingSource(capability, type),
    {
      label: 'sector ranking',
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => {
        const rows = readSectorRankingRows(type, { minRows: 1 }).filter(isLikelySectorRankingRow)
        return rows.length > 0 ? { data: rows, source: 'local', fetchedAt: new Date().toISOString() } : null
      },
      ...providerConstraintFromFetchOptions(opts),
    },
  )
  return withInterfaceProvenance(routed.data, {
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    canonicalSchema: 'sector_rank',
    canonicalTable: 'sector_ranking',
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: routed.cacheDecision,
  })
}

function sectorRankingSource(
  capability: DataApiProviderCapability,
  type: 'industry' | 'concept',
): DataApiInterfaceRoute<FetchResult<SectorRow>> | null {
  if (capability.provider === 'eastmoney')
    return {
      capability,
      source: 'eastmoney',
      run: () => fetchSectorRankingEastmoney(type),
    }
  if (capability.provider === 'akshare')
    return {
      capability,
      source: 'akshare',
      run: () => fetchSectorRankingAkshare(type),
    }
  if (capability.provider === 'tdx')
    return {
      capability,
      source: 'tdx:mac',
      run: () => fetchSectorRankingTdx(type),
    }
  if (capability.provider === 'sina')
    return {
      capability,
      source: 'sina',
      run: () => fetchSectorRankingSina(type),
    }
  return null
}

async function fetchSectorRankingEastmoney(type: 'industry' | 'concept' = 'industry'): Promise<FetchResult<SectorRow>> {
  const items = await fetchSectors(type)
  if (!items?.length) return { data: [], source: 'eastmoney', fetchedAt: new Date().toISOString() }

  const today = new Date().toISOString().split('T')[0]
  const data: SectorRow[] = items.map((d, i) => ({
    date: today, sector_type: type,
    code: d.code,
    name: d.name,
    change_pct: d.changePct,
    turnover_rate: d.turnoverRate,
    up_count: d.upCount,
    down_count: d.downCount,
    leading_stock: d.leadingStock,
    leading_pct: d.leadingChangePct,
    rank: i + 1, source: 'eastmoney',
  })).filter(isLikelySectorRankingRow)
  if (items.length > 0 && data.length === 0) {
    throw new Error('EastMoney sector ranking returned only non-sector instruments')
  }

  return { data, source: 'eastmoney', fetchedAt: new Date().toISOString() }
}

async function fetchSectorRankingAkshare(type: 'industry' | 'concept' = 'industry'): Promise<FetchResult<SectorRow>> {
  const func = type === 'concept' ? 'stock_board_concept_name_em' : 'stock_board_industry_name_em'
  const res = await fetch(`${SIDECAR}/akshare/${func}?_priority=background`, {
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`AkShare sector ranking failed: ${res.status}`)
  const json = await res.json() as any
  const rows = (json.data ?? json) as Array<Record<string, unknown>>
  const today = new Date().toISOString().split('T')[0]
  const data: SectorRow[] = rows.map((r, i) => ({
    date: today,
    sector_type: type,
    code: String(r['板块代码'] ?? r['代码'] ?? r.code ?? ''),
    name: String(r['板块名称'] ?? r['名称'] ?? r.name ?? ''),
    change_pct: safeNum(r['涨跌幅'] ?? r.change_pct),
    turnover_rate: safeNullableNum(r['换手率'] ?? r.turnover_rate),
    up_count: safeNum(r['上涨家数'] ?? r.up_count),
    down_count: safeNum(r['下跌家数'] ?? r.down_count),
    leading_stock: nullableString(r['领涨股票'] ?? r.leading_stock),
    leading_pct: safeNullableNum(r['领涨股票-涨跌幅'] ?? r.leading_pct),
    rank: i + 1,
    source: 'akshare',
  })).filter(isLikelySectorRankingRow)
  if (rows.length > 0 && data.length === 0) {
    throw new Error('AkShare sector ranking returned only non-sector instruments')
  }

  return { data, source: 'akshare', fetchedAt: new Date().toISOString() }
}

async function fetchSectorRankingTdx(type: 'industry' | 'concept' = 'industry'): Promise<FetchResult<SectorRow>> {
  const boardType = type === 'concept' ? '1' : '0'
  const res = await fetch(`${GOTDX}/mac/board_list?board_type=${boardType}&start=0&page_size=100`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`TDX MAC sector ranking failed: ${res.status}`)
  const json = await res.json() as any
  const rows = (json.List ?? json.data ?? json) as Array<Record<string, unknown>>
  const today = new Date().toISOString().split('T')[0]
  const data: SectorRow[] = rows.map((r, i) => {
    const code = String(r.Code ?? r.code ?? '')
    const name = String(r.Name ?? r.name ?? '')
    const price = safeNullableNum(r.Price ?? r.price)
    const prevClose = safeNullableNum(r.PreClose ?? r.preClose)
    const speed = safeNullableNum(r.RiseSpeed ?? r.riseSpeed)
    const changePct = price != null && prevClose != null && prevClose > 0
      ? (price - prevClose) / prevClose * 100
      : (speed ?? 0)
    return {
      date: today,
      sector_type: type,
      code,
      name,
      change_pct: changePct,
      turnover_rate: null,
      up_count: 0,
      down_count: 0,
      leading_stock: nullableString(r.SymbolName ?? r.symbolName),
      leading_pct: safeNullableNum(r.SymbolRiseSpeed ?? r.symbolRiseSpeed),
      rank: i + 1,
      source: 'tdx:mac',
    }
  }).filter(isLikelySectorRankingRow)
  if (rows.length > 0 && data.length === 0) {
    throw new Error('TDX MAC sector ranking returned only non-sector instruments')
  }

  return { data, source: 'tdx:mac', fetchedAt: new Date().toISOString() }
}

async function fetchSectorRankingSina(type: 'industry' | 'concept' = 'industry'): Promise<FetchResult<SectorRow>> {
  const url = type === 'concept'
    ? 'http://money.finance.sina.com.cn/q/view/newFLJK.php?param=class'
    : 'http://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php'
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      Referer: 'https://finance.sina.com.cn/',
      'User-Agent': 'Mozilla/5.0',
    },
  })
  if (!res.ok) throw new Error(`Sina sector ranking failed: ${res.status}`)
  const body = await decodeResponseText(res)
  const raw = parseSinaJsObject(body)
  const today = new Date().toISOString().split('T')[0]
  const data: SectorRow[] = Object.entries(raw).map(([key, value], index) => {
    const parts = String(value ?? '').split(',')
    return {
      date: today,
      sector_type: type,
      code: parts[0] || key,
      name: parts[1] || key,
      change_pct: safeNum(parts[5]),
      turnover_rate: null,
      up_count: 0,
      down_count: 0,
      leading_stock: nullableString(parts[12] || parts[8]),
      leading_pct: safeNullableNum(parts[9]),
      rank: index + 1,
      source: 'sina',
    }
  }).filter(isLikelySectorRankingRow)
  if (Object.keys(raw).length > 0 && data.length === 0) {
    throw new Error('Sina sector ranking returned only non-sector instruments')
  }

  return { data, source: 'sina', fetchedAt: new Date().toISOString() }
}

function isLikelySectorRankingRow(row: Pick<SectorRow, 'code' | 'name'>): boolean {
  const code = String(row.code ?? '').trim()
  const name = String(row.name ?? '').trim()
  if (!code && !name) return false
  if (/^BK\d{4,}$/i.test(code)) return true
  if (/^(gn|hy|dy|area|sw|thshy|thsgn|em)[_-]/i.test(code)) return true
  if (/(行业|板块|概念|指数|主题|地域|地区|产业链|赛道)$/.test(name)) return true
  if (/认购|认沽|期权|购\d|沽\d|上证50[购沽]|沪深300[购沽]|中证500[购沽]/.test(name)) return false
  if (/^(N|C|U)[\u4e00-\u9fa5A-Za-z]/.test(name)) return false
  if (/^\d{6}$/.test(code)) return false
  if (/^(sh|sz|bj)\d{6}$/i.test(code)) return false
  return true
}

function safeNum(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function safeNullableNum(value: unknown): number | null {
  if (value == null || value === '' || value === '--') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function nullableString(value: unknown): string | null {
  if (value == null || value === '') return null
  return String(value)
}

async function decodeResponseText(res: Response): Promise<string> {
  const contentType = res.headers.get('content-type')?.toLowerCase() ?? ''
  const buffer = await res.arrayBuffer()
  if (contentType.includes('utf-8') || contentType.includes('json')) {
    return new TextDecoder('utf-8').decode(buffer)
  }
  for (const encoding of ['gb18030', 'gbk', 'utf-8']) {
    try {
      return new TextDecoder(encoding).decode(buffer)
    } catch {}
  }
  return new TextDecoder().decode(buffer)
}

function parseSinaJsObject(body: string): Record<string, unknown> {
  const text = body.trim().replace(/^\/\*[\s\S]*?\*\//, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Sina sector ranking returned non-object payload')
  const parsed = JSON.parse(text.slice(start, end + 1))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Sina sector ranking returned unexpected schema')
  }
  return parsed as Record<string, unknown>
}
