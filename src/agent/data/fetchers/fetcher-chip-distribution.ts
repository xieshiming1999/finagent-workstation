import type { FetchResult } from './base-fetcher'
import type { DataApiProviderCapability } from '../data-api-interface-contract'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data-api-interface-router'
import { readChipDistributionRows } from '../data-api-interface-cache'
import {
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  type DataApiFetchOptions,
  withInterfaceProvenance,
} from './fetcher-interface-utils'
import { DefaultEastmoneyMarketProvider } from '../../../domain/market/providers/eastmoney-market-provider'

type ChipDistributionRow = Record<string, unknown>
const SIDECAR = 'http://127.0.0.1:19800'

export async function fetchChipDistribution(
  code: string,
  opts: DataApiFetchOptions & { date?: string; limit?: number } = {},
): Promise<FetchResult<ChipDistributionRow>> {
  const routed = await runDataApiInterfaceRoute(
    'stock.chip_distribution',
    (capability) => chipDistributionSource(capability, code),
    {
      label: 'stock chip distribution',
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => {
        const rows = readChipDistributionRows(code, { date: opts.date, minRows: 1, limit: opts.limit ?? 20 })
        return rows.length > 0 ? { data: rows, source: 'local', fetchedAt: new Date().toISOString() } : null
      },
      ...providerConstraintFromFetchOptions(opts),
    },
  )
  return withInterfaceProvenance(routed.data, {
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    canonicalSchema: 'chip_distribution',
    canonicalTable: 'chip_distribution',
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: routed.cacheDecision,
  })
}

function chipDistributionSource(
  capability: DataApiProviderCapability,
  code: string,
): DataApiInterfaceRoute<FetchResult<ChipDistributionRow>> | null {
  if (capability.provider === 'akshare') {
    return {
      capability,
      source: 'akshare',
      run: () => fetchAkshareChipDistribution(code),
    }
  }
  if (capability.provider !== 'eastmoney') return null
  return {
    capability,
    source: 'eastmoney',
    run: () => fetchEastmoneyChipDistribution(code),
  }
}

async function fetchEastmoneyChipDistribution(code: string): Promise<FetchResult<ChipDistributionRow>> {
  const rows: Array<Record<string, unknown>> = await new DefaultEastmoneyMarketProvider().readChip(code)
  const now = new Date().toISOString()
  const data = normalizeChipRows(code, rows, 'eastmoney', now)
  return { data, source: 'eastmoney', fetchedAt: now }
}

async function fetchAkshareChipDistribution(code: string): Promise<FetchResult<ChipDistributionRow>> {
  const res = await fetch(`${SIDECAR}/chip?code=${encodeURIComponent(code)}&_priority=background`, {
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`akshare chip failed: ${res.status}`)
  const json = await res.json() as any
  if (json.error) throw new Error(String(json.error))
  const rows = Array.isArray(json.data)
    ? json.data
    : Array.isArray(json.rows)
      ? json.rows
      : Array.isArray(json)
        ? json
        : json.data != null
          ? [json.data]
          : [json]
  const now = new Date().toISOString()
  const data = normalizeChipRows(code, rows as Array<Record<string, unknown>>, 'akshare', now)
  if (data.length === 0) throw new Error('akshare chip returned no canonical rows')
  return { data, source: 'akshare', fetchedAt: now }
}

function normalizeChipRows(
  code: string,
  rows: Array<Record<string, unknown>>,
  source: 'eastmoney' | 'akshare',
  fetchedAt: string,
): ChipDistributionRow[] {
  return rows.map((row: Record<string, unknown>) => ({
    code,
    trade_date: String(row.TRADE_DATE ?? row.date ?? '').slice(0, 10),
    avg_cost: safeNum(row.AVG_COST ?? row.COST_AVG ?? row.avgCost),
    profit_ratio: safeNum(row.PROFIT_RATIO ?? row.WINNER_RATE ?? row.profitRatio),
    concentration70: safeNum(row.CONCENTRATION_70 ?? row.COST_70 ?? row.concentration70),
    concentration90: safeNum(row.CONCENTRATION_90 ?? row.COST_90 ?? row.concentration90),
    current_price: safeNum(row.CLOSE_PRICE ?? row.currentPrice),
    method: row.METHOD ?? row.method ?? null,
    source,
    fetched_at: fetchedAt,
    raw_json: JSON.stringify(row),
  })).filter((row: ChipDistributionRow) => Boolean(row.trade_date))
}

function safeNum(v: unknown): number | null {
  if (v == null || v === '' || v === '--' || v === 'NaN') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
