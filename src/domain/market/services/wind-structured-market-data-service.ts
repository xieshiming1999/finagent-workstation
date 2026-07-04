import type { ToolContext } from '../../../agent/tool'
import { WindMcpTool } from '../../../agent/tools/wind-mcp'
import {
  readCompanyInfoRows,
  readFundamentalRows,
} from '../../../agent/data/data-api-interface-cache'

type WindStructuredAction =
  | 'stock_risk_metrics'
  | 'fund_company_info'
  | 'fund_investor_holders'
  | 'fund_financials'
  | 'index_fundamentals'
  | 'index_profile'
  | 'bond_profile'
  | 'bond_market_data'
  | 'bond_issuer_financials'

type WindStructuredSpec = {
  action: WindStructuredAction
  interfaceId:
    | 'stock.risk_metrics'
    | 'fund.company_info'
    | 'fund.investor_holders'
    | 'fund.financials'
    | 'index.fundamentals'
    | 'index.profile'
    | 'bond.profile'
    | 'bond.market_data'
    | 'bond.issuer_financials'
  capabilityId:
    | 'wind.stock.risk_metrics'
    | 'wind.fund.company_info'
    | 'wind.fund.investor_holders'
    | 'wind.fund.financials'
    | 'wind.index.fundamentals'
    | 'wind.index.profile'
    | 'wind.bond.profile'
    | 'wind.bond.market_data'
    | 'wind.bond.issuer_financials'
  canonicalSchema: 'stock_company_info' | 'fundamental'
  canonicalTable: 'stock_company_info' | 'fundamental'
  server: 'stock_data' | 'fund_data' | 'index_data' | 'bond_data'
  tool:
    | 'get_risk_metrics'
    | 'get_fund_company_info'
    | 'get_fund_holders'
    | 'get_fund_financials'
    | 'get_index_fundamentals'
    | 'get_index_basicinfo'
    | 'get_bond_basicinfo'
    | 'get_bond_market_data'
    | 'get_bond_financial_data'
  family: 'stock' | 'fund' | 'index' | 'bond'
  defaultInfoType?: string
}

type WindStructuredResult = {
  action: WindStructuredAction
  symbol: string
  windcode: string
  interfaceId: WindStructuredSpec['interfaceId']
  provider: 'local' | 'wind'
  providerId: 'local' | 'wind'
  capabilityId: string
  cacheStatus: 'cache-hit' | 'provider-hit'
  cacheMode: 'cache-first' | 'live-only' | 'cache-only'
  cachePolicyMode: 'cacheFirst' | 'liveOnly' | 'cacheOnly'
  cacheDecision: string
  canonicalSchema: WindStructuredSpec['canonicalSchema']
  canonicalTable: WindStructuredSpec['canonicalTable']
  source: string
  count: number
  sourceDataTime?: string
  fetchedAt?: string
  data: Array<Record<string, unknown>>
}

type WindInvoker = (
  spec: WindStructuredSpec,
  ctx: ToolContext,
  windcode: string,
  input: Record<string, unknown>,
) => Promise<void>

const WIND_STRUCTURED_SPECS: Record<WindStructuredAction, WindStructuredSpec> = {
  stock_risk_metrics: {
    action: 'stock_risk_metrics',
    interfaceId: 'stock.risk_metrics',
    capabilityId: 'wind.stock.risk_metrics',
    canonicalSchema: 'stock_company_info',
    canonicalTable: 'stock_company_info',
    server: 'stock_data',
    tool: 'get_risk_metrics',
    family: 'stock',
    defaultInfoType: 'get_risk_metrics',
  },
  fund_company_info: {
    action: 'fund_company_info',
    interfaceId: 'fund.company_info',
    capabilityId: 'wind.fund.company_info',
    canonicalSchema: 'stock_company_info',
    canonicalTable: 'stock_company_info',
    server: 'fund_data',
    tool: 'get_fund_company_info',
    family: 'fund',
    defaultInfoType: 'get_fund_company_info',
  },
  fund_investor_holders: {
    action: 'fund_investor_holders',
    interfaceId: 'fund.investor_holders',
    capabilityId: 'wind.fund.investor_holders',
    canonicalSchema: 'stock_company_info',
    canonicalTable: 'stock_company_info',
    server: 'fund_data',
    tool: 'get_fund_holders',
    family: 'fund',
    defaultInfoType: 'get_fund_holders',
  },
  fund_financials: {
    action: 'fund_financials',
    interfaceId: 'fund.financials',
    capabilityId: 'wind.fund.financials',
    canonicalSchema: 'fundamental',
    canonicalTable: 'fundamental',
    server: 'fund_data',
    tool: 'get_fund_financials',
    family: 'fund',
  },
  index_fundamentals: {
    action: 'index_fundamentals',
    interfaceId: 'index.fundamentals',
    capabilityId: 'wind.index.fundamentals',
    canonicalSchema: 'fundamental',
    canonicalTable: 'fundamental',
    server: 'index_data',
    tool: 'get_index_fundamentals',
    family: 'index',
  },
  index_profile: {
    action: 'index_profile',
    interfaceId: 'index.profile',
    capabilityId: 'wind.index.profile',
    canonicalSchema: 'stock_company_info',
    canonicalTable: 'stock_company_info',
    server: 'index_data',
    tool: 'get_index_basicinfo',
    family: 'index',
    defaultInfoType: 'get_index_basicinfo',
  },
  bond_profile: {
    action: 'bond_profile',
    interfaceId: 'bond.profile',
    capabilityId: 'wind.bond.profile',
    canonicalSchema: 'stock_company_info',
    canonicalTable: 'stock_company_info',
    server: 'bond_data',
    tool: 'get_bond_basicinfo',
    family: 'bond',
    defaultInfoType: 'get_bond_basicinfo',
  },
  bond_market_data: {
    action: 'bond_market_data',
    interfaceId: 'bond.market_data',
    capabilityId: 'wind.bond.market_data',
    canonicalSchema: 'stock_company_info',
    canonicalTable: 'stock_company_info',
    server: 'bond_data',
    tool: 'get_bond_market_data',
    family: 'bond',
    defaultInfoType: 'get_bond_market_data',
  },
  bond_issuer_financials: {
    action: 'bond_issuer_financials',
    interfaceId: 'bond.issuer_financials',
    capabilityId: 'wind.bond.issuer_financials',
    canonicalSchema: 'fundamental',
    canonicalTable: 'fundamental',
    server: 'bond_data',
    tool: 'get_bond_financial_data',
    family: 'bond',
  },
}

export class WindStructuredMarketDataService {
  constructor(private readonly invokeWind: WindInvoker = callWindStructuredTool) {}

  async readAction(
    action: WindStructuredAction,
    input: Record<string, unknown>,
    ctx: ToolContext,
    code: string,
    limit: number,
  ): Promise<string> {
    const spec = WIND_STRUCTURED_SPECS[action]
    if (!spec) throw new Error(`Unsupported Wind structured action: ${action}`)
    enforceWindProviderOnly(action, input.provider)
    const windcode = normalizeWindcode(spec.family, String(input.windcode ?? code ?? ''))
    const cacheMode = normalizeCacheMode(input.cacheMode)
    const cachedRows = readStructuredRows(spec, code, input, limit)
    if (cacheMode !== 'live-only' && cachedRows.length > 0) {
      return JSON.stringify(
        buildResult(spec, action, code, windcode, cachedRows, {
          provider: 'local',
          providerId: 'local',
          capabilityId: 'local.cache',
          cacheStatus: 'cache-hit',
          cacheMode,
          cacheDecision:
            spec.canonicalTable === 'fundamental'
              ? 'cacheFirst read reusable local Wind fundamental rows before provider routing; cache reader returned governed canonical rows'
              : 'cacheFirst read reusable local Wind company-info rows before provider routing; cache reader returned governed canonical rows',
          source: `local ${spec.canonicalTable}`,
        }),
        null,
        2,
      )
    }
    if (cacheMode === 'cache-only') {
      throw new Error(
        `${spec.interfaceId} cache-only lookup missed; no reusable canonical rows matched ${code}.`,
      )
    }
    await this.invokeWind(spec, ctx, windcode, input)
    const rows = readStructuredRows(spec, code, input, limit)
    if (rows.length === 0) {
      throw new Error(
        `Wind ${spec.interfaceId} call finished but no canonical ${spec.canonicalTable} rows were readable for ${code}. Check persistence/normalizer contract.`,
      )
    }
    return JSON.stringify(
      buildResult(spec, action, code, windcode, rows, {
        provider: 'wind',
        providerId: 'wind',
        capabilityId: spec.capabilityId,
        cacheStatus: 'provider-hit',
        cacheMode,
        cacheDecision:
          cacheMode === 'live-only'
            ? 'liveOnly bypassed reusable local data and refreshed through the governed Wind provider path'
            : 'cacheFirst checked reusable local data first; no matching canonical rows were found so the governed Wind provider path refreshed and persisted the requirement',
        source: `WindMcp ${spec.server}.${spec.tool}`,
      }),
      null,
      2,
    )
  }
}

function readStructuredRows(
  spec: WindStructuredSpec,
  code: string,
  input: Record<string, unknown>,
  limit: number,
): Array<Record<string, unknown>> {
  if (spec.canonicalTable === 'fundamental') {
    return readFundamentalRows(code, { limit }).filter((row) => String(row.source ?? '') === 'Wind')
  }
  const infoType = String(input.infoType ?? input.type ?? input.info_type ?? spec.defaultInfoType ?? '').trim()
  return readCompanyInfoRows(code, {
    infoType: infoType || undefined,
    limit,
  }).filter((row) => String(row.source ?? '') === 'Wind')
}

function buildResult(
  spec: WindStructuredSpec,
  action: WindStructuredAction,
  code: string,
  windcode: string,
  rows: Array<Record<string, unknown>>,
  opts: {
    provider: 'local' | 'wind'
    providerId: 'local' | 'wind'
    capabilityId: string
    cacheStatus: 'cache-hit' | 'provider-hit'
    cacheMode: 'cache-first' | 'live-only' | 'cache-only'
    cacheDecision: string
    source: string
  },
): WindStructuredResult {
  const sourceDataTime =
    spec.canonicalTable === 'fundamental'
      ? latestValue(rows, ['report_date', 'fetched_at'])
      : latestValue(rows, ['updated_at'])
  const fetchedAt =
    spec.canonicalTable === 'fundamental'
      ? latestValue(rows, ['fetched_at', 'report_date'])
      : latestValue(rows, ['updated_at'])
  return {
    action,
    symbol: code,
    windcode,
    interfaceId: spec.interfaceId,
    provider: opts.provider,
    providerId: opts.providerId,
    capabilityId: opts.capabilityId,
    cacheStatus: opts.cacheStatus,
    cacheMode: opts.cacheMode,
    cachePolicyMode: normalizeCachePolicyMode(opts.cacheMode),
    cacheDecision: opts.cacheDecision,
    canonicalSchema: spec.canonicalSchema,
    canonicalTable: spec.canonicalTable,
    source: opts.source,
    count: rows.length,
    ...(sourceDataTime ? { sourceDataTime } : {}),
    ...(fetchedAt ? { fetchedAt } : {}),
    data: rows,
  }
}

async function callWindStructuredTool(
  spec: WindStructuredSpec,
  ctx: ToolContext,
  windcode: string,
  input: Record<string, unknown>,
): Promise<void> {
  const tool = new WindMcpTool((key) => ctx.getConfigValue?.(key)?.toString())
  const args: Record<string, unknown> = { windcode }
  if (typeof input.query === 'string' && input.query.trim()) args.query = input.query.trim()
  if (typeof input.question === 'string' && input.question.trim()) args.question = input.question.trim()
  await tool.call(
    `wind-structured:${spec.action}`,
    {
      action: 'call',
      server: spec.server,
      tool: spec.tool,
      arguments: args,
    },
    ctx,
  )
}

function enforceWindProviderOnly(action: string, provider: unknown): void {
  if (provider == null) return
  const value = String(provider).trim().toLowerCase()
  if (!value || value === 'wind') return
  throw new Error(
    `${action} only supports provider:"wind" in the current governed workflow. Remove the provider override or set provider:"wind".`,
  )
}

function normalizeWindcode(
  family: WindStructuredSpec['family'],
  raw: string,
): string {
  const value = raw.trim().toUpperCase()
  if (!value) throw new Error('symbol/code required for Wind structured workflow')
  if (value.includes('.')) return value
  switch (family) {
    case 'fund':
      return `${value}.OF`
    case 'index':
      return value.startsWith('399') ? `${value}.SZ` : `${value}.SH`
    case 'stock':
      return value.startsWith('6') || value.startsWith('9')
        ? `${value}.SH`
        : `${value}.SZ`
    case 'bond':
      return value.startsWith('0') || value.startsWith('1') || value.startsWith('2')
        ? `${value}.SH`
        : `${value}.SZ`
  }
}

function normalizeCacheMode(
  value: unknown,
): 'cache-first' | 'live-only' | 'cache-only' {
  const text = String(value ?? '').trim()
  if (text === 'live-only' || text === 'cache-only') return text
  return 'cache-first'
}

function normalizeCachePolicyMode(
  value: 'cache-first' | 'live-only' | 'cache-only',
): 'cacheFirst' | 'liveOnly' | 'cacheOnly' {
  switch (value) {
    case 'live-only':
      return 'liveOnly'
    case 'cache-only':
      return 'cacheOnly'
    default:
      return 'cacheFirst'
  }
}

function latestValue(
  rows: Array<Record<string, unknown>>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    let latest: string | undefined
    for (const row of rows) {
      const raw = row[key]
      if (raw == null) continue
      const text = String(raw).trim()
      if (!text) continue
      if (!latest || text.localeCompare(latest) > 0) latest = text
    }
    if (latest) return latest
  }
  return undefined
}
