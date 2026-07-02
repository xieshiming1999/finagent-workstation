import type { FetchResult } from './base-fetcher'
import type { DataApiProviderCapability } from '../data-api-interface-contract'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data-api-interface-router'
import { readFundManagerRows } from '../data-api-interface-cache'
import {
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  type DataApiFetchOptions,
  withInterfaceProvenance,
} from './fetcher-interface-utils'
import { timeoutForEastmoneyBackedUrl } from '../provider-timeouts'

const SIDECAR_AKSHARE = 'http://127.0.0.1:19800/akshare'

export interface FundManagerRow {
  manager_id: string; name: string; company: string | null; start_date: string | null
  total_size: number | null; fund_count: number | null; best_return: number | null
  experience_years: number | null; updated_at: string; source: string
}

export async function fetchFundManagers(
  opts: DataApiFetchOptions = {},
): Promise<FetchResult<FundManagerRow>> {
  const routed = await runDataApiInterfaceRoute(
    'fund.manager',
    fundManagerSource,
    {
      label: 'fund manager',
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => {
        const rows = readFundManagerRows({ minRows: 20 })
        return rows.length > 0 ? { data: rows, source: 'local', fetchedAt: new Date().toISOString() } : null
      },
      ...providerConstraintFromFetchOptions(opts),
    },
  )
  return withInterfaceProvenance(routed.data, {
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    canonicalSchema: 'fund_manager',
    canonicalTable: 'fund_manager',
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: routed.cacheDecision,
  })
}

function fundManagerSource(
  capability: DataApiProviderCapability,
): DataApiInterfaceRoute<FetchResult<FundManagerRow>> | null {
  if (capability.provider === 'eastmoney')
    return {
      capability,
      source: 'eastmoney',
      run: () => fetchFundManagersEastmoney(),
    }
  if (capability.provider !== 'akshare') return null
  const source = capability.provider
  return {
    capability,
    source,
    run: () => fetchFundManagersSidecar(source),
  }
}

async function fetchFundManagersSidecar(
  source: 'akshare',
): Promise<FetchResult<FundManagerRow>> {
  const url = `${SIDECAR_AKSHARE}/fund_manager_em`
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url, 60_000)) })
  if (!res.ok) throw new Error(`AkShare fund manager failed: ${res.status}`)
  const json = await res.json() as any; const rows = (json.data ?? json) as Array<Record<string, unknown>>

  const now = new Date().toISOString()
  const data: FundManagerRow[] = rows.map((r) => ({
    manager_id: String(r['经理ID'] ?? r['ID'] ?? `mgr_${String(r['姓名'] ?? '')}_${String(r['基金公司'] ?? '')}`),
    name: String(r['姓名'] ?? ''),
    company: String(r['基金公司'] ?? '') || null,
    start_date: String(r['起始日期'] ?? '') || null,
    total_size: safeNum(r['管理规模']),
    fund_count: safeNum(r['基金数量']) ? Math.round(Number(r['基金数量'])) : null,
    best_return: safeNum(r['最佳回报']),
    experience_years: safeNum(r['从业年限']),
    updated_at: now,
    source,
  })).filter((m) => m.name)

  return { data, source, fetchedAt: now }
}

async function fetchFundManagersEastmoney(): Promise<FetchResult<FundManagerRow>> {
  const url = 'https://fund.eastmoney.com/Data/FundDataPortfolio_Interface.aspx?dt=14&mc=returnjson&ft=all&pn=500&pi=1&sc=abbname&st=asc'
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://fund.eastmoney.com/manager/default.html',
    },
    signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url, 60_000)),
  })
  if (!res.ok) throw new Error(`EastMoney fund manager failed: ${res.status}`)
  const rows = parseEastmoneyFundManagerRows(await res.text())
  const now = new Date().toISOString()
  const data: FundManagerRow[] = rows.map((row) => eastmoneyManagerRowToCanonical(row, now))
    .filter((row): row is FundManagerRow => !!row)
  if (data.length === 0) throw new Error('EastMoney fund manager returned no canonical rows')
  return { data, source: 'eastmoney', fetchedAt: now }
}

function safeNum(v: unknown): number | null {
  if (v == null || v === '' || v === '--') return null
  const n = Number(String(v).replace(/[%，,]|亿元/g, '').trim())
  return isNaN(n) ? null : n
}

function parseEastmoneyFundManagerRows(text: string): unknown[][] {
  const match = text.match(/data\s*:\s*(\[[\s\S]*?\])\s*,\s*record/)
  if (!match) return []
  const parsed = JSON.parse(match[1]) as unknown
  return Array.isArray(parsed) ? parsed.filter(Array.isArray) as unknown[][] : []
}

function eastmoneyManagerRowToCanonical(row: unknown[], updatedAt: string): FundManagerRow | null {
  const managerId = String(row[0] ?? '').trim()
  const name = String(row[1] ?? '').trim()
  if (!name) return null
  const fundCodes = String(row[4] ?? '').split(',').filter(Boolean)
  const experienceDays = safeNum(row[6])
  return {
    manager_id: managerId || `mgr_${name}_${String(row[3] ?? '').trim()}`,
    name,
    company: String(row[3] ?? '').trim() || null,
    start_date: null,
    total_size: safeNum(row[10]),
    fund_count: fundCodes.length || null,
    best_return: safeNum(row[11] ?? row[7]),
    experience_years: experienceDays == null ? null : Number((experienceDays / 365.25).toFixed(2)),
    updated_at: updatedAt,
    source: 'eastmoney',
  }
}
