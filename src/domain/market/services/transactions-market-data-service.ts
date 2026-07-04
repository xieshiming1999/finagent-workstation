import type { ToolContext } from '../../../agent/tool'
import { runDataApiInterfaceRoute, type DataApiInterfaceRoute, type DataApiInterfaceRouteResult } from '../../../agent/data/data-api-interface-router'
import type { DataApiProviderCapability, DataApiProviderMode } from '../../../agent/data/data-api-interface-contract'
import { readTransactionRows } from '../../../agent/data/data-api-interface-cache'
import { getLocalStore } from '../../../agent/tools/market-data-utils'
import { TdxMarketDataService } from './tdx-market-data-service'
import type { FetchProvenance } from '../../../agent/data/fetchers/base-fetcher'
import { tencentTransactions } from '../../../agent/data/tencent-fetcher'

export interface TransactionsDataApiOptions {
  provider?: string
  providerMode?: DataApiProviderMode
  cacheMode?: 'cache-first' | 'live-only' | 'cache-only'
  allowFallback?: boolean
  allowDegraded?: boolean
}

export type TransactionsResult = {
  kind: 'transactions'
  code: string
  tradeDate?: string
  rows: Array<Record<string, unknown>>
  provenance?: FetchProvenance
}

export class TransactionsMarketDataService {
  constructor(private readonly tdxService: TdxMarketDataService = new TdxMarketDataService()) {}

  async readTransactions(
    ctx: ToolContext,
    code: string,
    limit: number,
    input: Record<string, unknown>,
    opts: TransactionsDataApiOptions = {},
  ): Promise<TransactionsResult> {
    const cleanCode = code.trim()
    if (!cleanCode) throw new Error('code required. Example: MarketData(action:"transactions", code:"600519")')
    const tradeDate = normalizeDate(input.date ?? input.tradeDate)
    const interfaceId = transactionsInterfaceId(cleanCode, input)
    const routeOpts = effectiveTransactionsOptions(input, opts)
    const routed = await runDataApiInterfaceRoute<TransactionsResult>(
      interfaceId,
      (capability) => this.transactionRoute(ctx, capability, cleanCode, limit, input, tradeDate),
      {
        label: interfaceId === 'fund.etf_transactions' ? 'ETF transactions' : 'stock transactions',
        cacheMode: routeOpts.cacheMode,
        provider: routeOpts.provider,
        providerMode: routeOpts.providerMode,
        allowFallback: routeOpts.allowFallback,
        allowDegraded: routeOpts.allowDegraded,
        readCache: () => {
          const requestedCacheSource = (routeOpts.providerMode ?? (routeOpts.provider ? 'strict' : 'auto')) === 'strict' && routeOpts.provider
            ? routeOpts.provider.trim().toLowerCase()
            : undefined
          const rows = readTransactionRows(cleanCode, { tradeDate, limit, minRows: 1, source: requestedCacheSource })
          const source = transactionCacheSource(rows)
          return rows.length > 0
            ? {
                cacheHit: true,
                data: { kind: 'transactions' as const, code: cleanCode, tradeDate, rows },
                capabilityId: 'local.cache',
                provider: source ?? 'local',
                source: source ?? 'local',
                cacheDecision: source
                  ? `cache-first read reusable transactions rows from ${source}`
                  : 'cache-first read reusable transactions rows',
              }
            : null
        },
      },
    )
    return withTransactionProvenance(routed)
  }

  private transactionRoute(
    ctx: ToolContext,
    capability: DataApiProviderCapability,
    code: string,
    limit: number,
    input: Record<string, unknown>,
    tradeDate?: string,
  ): DataApiInterfaceRoute<TransactionsResult> | null {
    if (capability.provider === 'tdx') {
      return {
        capability,
        source: 'tdx',
        run: async () => {
          await this.tdxService.readDirectAction(ctx, 'tdx_transactions', { ...input, limit }, code, limit)
          const rows = readTransactionRows(code, { tradeDate, limit, minRows: 1 })
          return { kind: 'transactions', code, tradeDate, rows }
        },
      }
    }
    if (capability.provider === 'sina') {
      return {
        capability,
        source: 'sina',
        run: async () => fetchSinaTransactions(ctx, code, limit, tradeDate),
      }
    }
    if (capability.provider === 'tencent') {
      return {
        capability,
        source: 'tencent',
        run: async () => fetchTencentTransactions(ctx, code, limit, tradeDate),
      }
    }
    return null
  }
}

function effectiveTransactionsOptions(
  input: Record<string, unknown>,
  opts: TransactionsDataApiOptions,
): Required<Pick<TransactionsDataApiOptions, 'cacheMode'>> & TransactionsDataApiOptions {
  return {
    provider: opts.provider ?? stringValue(input.provider),
    providerMode: opts.providerMode ?? providerModeValue(input.providerMode),
    cacheMode: opts.cacheMode ?? cacheModeValue(input.cacheMode) ?? 'cache-first',
    allowFallback: opts.allowFallback ?? booleanValue(input.allowFallback),
    allowDegraded: opts.allowDegraded ?? booleanValue(input.allowDegraded),
  }
}

async function fetchSinaTransactions(
  ctx: ToolContext,
  code: string,
  limit: number,
  tradeDate?: string,
): Promise<TransactionsResult> {
  const symbol = sinaSymbol(code)
  const date = tradeDate ?? todayLocalDate()
  const pageSize = Math.max(1, Math.min(limit, 60))
  const params = new URLSearchParams({
    symbol,
    num: String(pageSize),
    page: '1',
    sort: 'ticktime',
    asc: '0',
    volume: '0',
    amount: '0',
    type: '0',
    day: date,
  })
  const url = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_Bill.GetBillList?${params}`
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      Referer: `https://vip.stock.finance.sina.com.cn/quotes_service/view/cn_bill.php?symbol=${symbol}`,
      'User-Agent': 'Mozilla/5.0',
    },
  })
  if (!res.ok) throw new Error(`Sina stock transactions failed: ${res.status}`)
  const rows = await res.json() as Array<Record<string, unknown>>
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Sina stock transactions returned no rows')
  const store = getLocalStore(ctx)
  store.saveTransactions(rows.map((row) => normalizeSinaTransactionRow(row, code, date)))
  return { kind: 'transactions', code, tradeDate: date, rows: readTransactionRows(code, { tradeDate: date, limit, minRows: 1 }) }
}

function normalizeSinaTransactionRow(row: Record<string, unknown>, code: string, tradeDate: string): Record<string, unknown> {
  const price = num(row.price)
  const volume = num(row.volume)
  return {
    code,
    trade_date: tradeDate,
    time: String(row.ticktime ?? ''),
    price,
    volume,
    amount: price != null && volume != null ? price * volume : null,
    direction: sinaDirection(String(row.kind ?? '')),
    source: 'sina',
    raw_json: JSON.stringify(row),
  }
}

async function fetchTencentTransactions(
  ctx: ToolContext,
  code: string,
  limit: number,
  tradeDate?: string,
): Promise<TransactionsResult> {
  const date = tradeDate ?? todayLocalDate()
  const rawRows = await tencentTransactions(code, limit)
  const store = getLocalStore(ctx)
  store.saveTransactions(rawRows.map((row) => normalizeTencentTransactionRow(row, code, date)))
  return { kind: 'transactions', code, tradeDate: date, rows: readTransactionRows(code, { tradeDate: date, limit, minRows: 1 }) }
}

function normalizeTencentTransactionRow(row: Record<string, unknown>, code: string, tradeDate: string): Record<string, unknown> {
  return {
    code,
    trade_date: tradeDate,
    time: String(row.time ?? ''),
    price: num(row.price),
    volume: num(row.volume),
    amount: num(row.amount),
    direction: String(row.direction ?? ''),
    source: 'tencent',
    raw_json: JSON.stringify(row),
  }
}

function withTransactionProvenance(routed: DataApiInterfaceRouteResult<TransactionsResult>): TransactionsResult {
  return {
    ...routed.data,
    provenance: {
      interfaceId: routed.interfaceId,
      capabilityId: routed.capabilityId,
      provider: routed.provider,
      source: routed.source,
      cachedProvider: routed.cachedProvider,
      cachedSource: routed.cachedSource,
      cachedCapabilityId: routed.cachedCapabilityId,
      canonicalSchema: 'transactions',
      canonicalTable: 'transactions',
      cacheStatus: routed.cacheStatus,
      cacheMode: routed.cacheMode,
      cacheDecision: routed.cacheDecision,
      providerMode: routed.providerMode,
      requestedProvider: routed.requestedProvider,
      allowFallback: routed.allowFallback,
    },
  }
}

function transactionCacheSource(rows: Array<Record<string, unknown>>): string | null {
  const source = rows.find((row) => typeof row.source === 'string' && row.source.trim())
    ?.source
  return typeof source === 'string' ? source.trim() : null
}

function normalizeDate(value: unknown): string | undefined {
  if (value == null || value === '') return undefined
  const clean = String(value).replace(/\D/g, '')
  if (clean.length !== 8) return String(value)
  return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function providerModeValue(value: unknown): DataApiProviderMode | undefined {
  if (value === 'auto' || value === 'strict' || value === 'preferred') return value
  return undefined
}

function cacheModeValue(value: unknown): TransactionsDataApiOptions['cacheMode'] | undefined {
  if (value === 'cache-first' || value === 'live-only' || value === 'cache-only') return value
  return undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function todayLocalDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function transactionsInterfaceId(code: string, input: Record<string, unknown>): 'stock.transactions' | 'fund.etf_transactions' {
  const instrumentType = stringValue(input.instrumentType ?? input.assetType)?.toLowerCase()
  if (instrumentType === 'etf') return 'fund.etf_transactions'
  return isChinaEtfCode(code) ? 'fund.etf_transactions' : 'stock.transactions'
}

function isChinaEtfCode(code: string): boolean {
  const clean = code.replace(/^(sh|sz)/i, '').replace(/\D/g, '')
  return /^(15|16|50|51|52|56|58)\d{4}$/.test(clean)
}

function sinaSymbol(code: string): string {
  const clean = code.replace(/^(sh|sz|bj)/i, '').replace(/\.(SH|SZ|BJ)$/i, '')
  return `${clean.startsWith('6') ? 'sh' : 'sz'}${clean}`
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function sinaDirection(kind: string): string {
  if (kind === 'U') return 'buy'
  if (kind === 'D') return 'sell'
  if (kind === 'E') return 'neutral'
  return kind
}
