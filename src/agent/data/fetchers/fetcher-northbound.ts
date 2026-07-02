import type { FetchResult } from './base-fetcher'
import type { DataApiProviderCapability } from '../data-api-interface-contract'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data-api-interface-router'
import { readNorthboundFlowRows } from '../data-api-interface-cache'
import {
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  type DataApiFetchOptions,
  withInterfaceProvenance,
} from './fetcher-interface-utils'
import { EASTMONEY_RUNTIME_TIMEOUT_MS } from '../provider-timeouts'

const SIDECAR = 'http://127.0.0.1:19800'
const BACKGROUND_TIMEOUT_MS = EASTMONEY_RUNTIME_TIMEOUT_MS

export interface NorthboundRow {
  trade_date: string
  mutual_type: string
  buy_amount: number | null
  sell_amount: number | null
  net_buy: number | null
  hold_market_cap: number | null
  source: string
}

export async function fetchNorthbound(
  days = 30,
  opts: DataApiFetchOptions = {},
): Promise<FetchResult<NorthboundRow>> {
  const routed = await runDataApiInterfaceRoute(
    'market.northbound_flow',
    (capability) => northboundSource(capability, days),
    {
      label: 'northbound flow',
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => {
        const rows = readNorthboundFlowRows({ minRows: 1, limit: days })
        return rows.length > 0 ? { data: rows, source: 'local', fetchedAt: new Date().toISOString() } : null
      },
      ...providerConstraintFromFetchOptions(opts),
    },
  )
  return withInterfaceProvenance(routed.data, {
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    canonicalSchema: 'northbound_flow',
    canonicalTable: 'northbound_flow',
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: routed.cacheDecision,
  })
}

function northboundSource(
  capability: DataApiProviderCapability,
  days: number,
): DataApiInterfaceRoute<FetchResult<NorthboundRow>> | null {
  if (capability.provider !== 'eastmoney' && capability.provider !== 'akshare') return null
  const source = capability.provider
  return {
    capability,
    source,
    run: () => fetchNorthboundSidecar(days, source),
  }
}

async function fetchNorthboundSidecar(
  days: number,
  source: 'eastmoney' | 'akshare',
): Promise<FetchResult<NorthboundRow>> {
  const providerParam = source === 'eastmoney' ? '&_provider=eastmoney' : ''
  const url = `${SIDECAR}/akshare/stock_hsgt_hist_em?symbol=沪股通&_priority=background${providerParam}`
  const res = await fetch(url, { signal: AbortSignal.timeout(BACKGROUND_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`AkShare northbound failed: ${res.status}`)
  const json = await res.json() as any
  const rows = json.data as any[]
  if (!rows?.length) return { data: [], source: 'akshare', fetchedAt: new Date().toISOString() }

  // Also fetch 深股通
  let szRows: any[] = []
  try {
    const szRes = await fetch(`${SIDECAR}/akshare/stock_hsgt_hist_em?symbol=深股通&_priority=background${providerParam}`, { signal: AbortSignal.timeout(BACKGROUND_TIMEOUT_MS) })
    if (szRes.ok) {
      const szJson = await szRes.json() as any
      szRows = szJson.data ?? []
    }
  } catch {}

  const shData: NorthboundRow[] = rows.slice(-days).map((r) => {
    const date = String(r['日期'] ?? '').substring(0, 10)
    const shNet = Number(r['当日资金流入'] ?? 0)
    return {
      trade_date: date,
      mutual_type: '沪股通',
      buy_amount: shNet > 0 ? shNet : null,
      sell_amount: shNet < 0 ? -shNet : null,
      net_buy: shNet,
      hold_market_cap: null,
      source,
    }
  })

  const szData: NorthboundRow[] = szRows.slice(-days).map((r) => {
    const date = String(r['日期'] ?? '').substring(0, 10)
    const szNet = Number(r['当日资金流入'] ?? 0)
    return {
      trade_date: date,
      mutual_type: '深股通',
      buy_amount: szNet > 0 ? szNet : null,
      sell_amount: szNet < 0 ? -szNet : null,
      net_buy: szNet,
      hold_market_cap: null,
      source,
    }
  })

  return { data: [...shData, ...szData], source, fetchedAt: new Date().toISOString() }
}
