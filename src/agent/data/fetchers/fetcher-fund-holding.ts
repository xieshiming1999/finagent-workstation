import type { FetchResult } from './base-fetcher'
import type { DataApiProviderCapability } from '../data-api-interface-contract'
import {
  runDataApiInterfaceRoute,
  type DataApiInterfaceRoute,
} from '../data-api-interface-router'
import { readFundHoldingRows } from '../data-api-interface-cache'
import {
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  type DataApiFetchOptions,
  withInterfaceProvenance,
} from './fetcher-interface-utils'
import { timeoutForEastmoneyBackedUrl } from '../provider-timeouts'

const SIDECAR_AKSHARE = 'http://127.0.0.1:19800/akshare'

export interface FundHoldingRow {
  fund_code: string; report_date: string; stock_code: string; stock_name: string
  hold_shares: number | null; hold_value: number | null; hold_pct: number | null
  rank: number; source: string
}

export async function fetchFundHolding(
  fundCode: string,
  opts: DataApiFetchOptions = {},
): Promise<FetchResult<FundHoldingRow>> {
  const routed = await runDataApiInterfaceRoute(
    'fund.holding',
    (capability) => fundHoldingSource(capability, fundCode),
    {
      label: 'fund holding',
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => {
        const rows = readFundHoldingRows(fundCode, { minRows: 1 })
        return rows.length > 0 ? { data: rows, source: 'local', fetchedAt: new Date().toISOString() } : null
      },
      ...providerConstraintFromFetchOptions(opts),
    },
  )
  return withInterfaceProvenance(routed.data, {
    interfaceId: routed.interfaceId,
    capabilityId: routed.capabilityId,
    provider: routed.provider,
    canonicalSchema: 'fund_holding',
    canonicalTable: 'fund_holding',
    cacheStatus: routed.cacheStatus,
    cacheMode: routed.cacheMode,
    cacheDecision: routed.cacheDecision,
  })
}

function fundHoldingSource(
  capability: DataApiProviderCapability,
  fundCode: string,
): DataApiInterfaceRoute<FetchResult<FundHoldingRow>> | null {
  if (capability.provider === 'eastmoney')
    return {
      capability,
      source: 'eastmoney',
      run: () => fetchFundHoldingEastmoney(fundCode),
    }
  if (capability.provider !== 'akshare') return null
  const source = capability.provider
  return {
    capability,
    source,
    run: () => fetchFundHoldingSidecar(fundCode, source),
  }
}

async function fetchFundHoldingSidecar(
  fundCode: string,
  source: 'akshare',
): Promise<FetchResult<FundHoldingRow>> {
  const url = `${SIDECAR_AKSHARE}/fund_portfolio_hold_em?symbol=${fundCode}`
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url)) })
  if (!res.ok) throw new Error(`AkShare fund holding failed: ${res.status}`)
  const json = await res.json() as any; const rows = (json.data ?? json) as Array<Record<string, unknown>>

  const now = new Date().toISOString()
  const data: FundHoldingRow[] = rows.map((r, i) => ({
    fund_code: fundCode,
    report_date: parseReportDate(String(r['截止日期'] ?? r['季度'] ?? '')),
    stock_code: String(r['股票代码'] ?? ''),
    stock_name: String(r['股票名称'] ?? ''),
    hold_shares: safeNum(r['持股数']),
    hold_value: safeNum(r['持仓市值']),
    hold_pct: safeNum(r['占净值比例']),
    rank: i + 1,
    source,
  })).filter((r) => r.stock_code)

  return { data, source, fetchedAt: now }
}

async function fetchFundHoldingEastmoney(fundCode: string): Promise<FetchResult<FundHoldingRow>> {
  const year = new Date().getFullYear()
  const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${encodeURIComponent(fundCode)}&topline=10000&year=${year}&month=&rt=${Date.now()}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: `https://fundf10.eastmoney.com/ccmx_${encodeURIComponent(fundCode)}.html`,
    },
    signal: AbortSignal.timeout(timeoutForEastmoneyBackedUrl(url)),
  })
  if (!res.ok) throw new Error(`EastMoney fund holding failed: ${res.status}`)
  const rows = parseEastmoneyFundHoldingRows(await res.text(), fundCode)
  if (rows.length === 0) throw new Error('EastMoney fund holding returned no canonical rows')
  return { data: rows, source: 'eastmoney', fetchedAt: new Date().toISOString() }
}

function safeNum(v: unknown): number | null {
  if (v == null || v === '' || v === '--') return null
  const n = Number(String(v).replace(/[%,，]/g, '').trim())
  return isNaN(n) ? null : n
}

function parseReportDate(d: string): string {
  if (!d) return ''
  // Handle '2024Q1' format
  const qMatch = d.match(/^(\d{4})Q(\d)$/)
  if (qMatch) {
    const quarterEndMonth = { '1': '03-31', '2': '06-30', '3': '09-30', '4': '12-31' }
    return `${qMatch[1]}-${quarterEndMonth[qMatch[2] as keyof typeof quarterEndMonth] ?? '12-31'}`
  }
  if (d.includes('-') && d.length >= 10) return d.substring(0, 10)
  if (d.length === 8) return `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`
  return d
}

function parseEastmoneyFundHoldingRows(text: string, fundCode: string): FundHoldingRow[] {
  const sections = text.split(/<h4 class='t'>/).slice(1)
  const rows: FundHoldingRow[] = []
  for (const section of sections) {
    const reportDate = parseReportDate(
      section.match(/截止至：<font[^>]*>([^<]+)<\/font>/)?.[1] ??
      section.match(/(\d{4})年([1-4])季度/)?.slice(1).join('Q') ??
      '',
    )
    const rowPattern = /<tr><td>(\d+)<\/td><td><a[^>]*>(\d{6})<\/a><\/td><td class='tol'><a[^>]*>([^<]+)<\/a><\/td>[\s\S]*?<td class='tor'>([^<]*)<\/td><td class='tor'>([^<]*)<\/td><td class='tor'>([^<]*)<\/td><\/tr>/g
    let match: RegExpExecArray | null
    while ((match = rowPattern.exec(section))) {
      rows.push({
        fund_code: fundCode,
        report_date: reportDate,
        stock_code: match[2],
        stock_name: decodeHtml(match[3]),
        hold_pct: safeNum(match[4]),
        hold_shares: safeNum(match[5]),
        hold_value: safeNum(match[6]),
        rank: Number(match[1]),
        source: 'eastmoney',
      })
    }
  }
  return rows.filter((row) => row.stock_code && row.report_date)
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}
