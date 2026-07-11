import {
  normalizeFinanceProviders,
  providerOrder,
  requiresSerialCalls,
  type FinanceDataTask,
  type FinanceProvider,
  type ProviderGates,
} from '../data/provider-policy'
import dataApiInterfaces from '../data/data-api-interfaces.json'
import { globalApiStats, type ApiCallRecord } from '../data/resilience'
import type { Tool, ToolContext } from '../tool'

export type ProviderHealthProvider = () => Array<Record<string, unknown>>

const TASKS: FinanceDataTask[] = [
  'quote',
  'indexQuote',
  'kline',
  'indexKline',
  'intradayTick',
  'sector',
  'limitPool',
  'dragonTiger',
  'fundamental',
  'macro',
  'fund',
  'moneyFlow',
]

const RAW_ORDERS: Record<FinanceDataTask, FinanceProvider[]> = {
  quote: ['tdx', 'eastmoneyDirect', 'akshare'],
  indexQuote: ['tdx', 'sina', 'akshare'],
  kline: ['tdx', 'eastmoneyDirect', 'akshare'],
  indexKline: ['tdx', 'eastmoneyDirect', 'akshare'],
  intradayTick: ['tdx'],
  sector: ['eastmoneyDirect', 'akshare', 'tdx'],
  limitPool: ['eastmoneyDirect', 'akshare'],
  dragonTiger: ['eastmoneyDirect'],
  fundamental: ['wind', 'tushare', 'eastmoneyDirect', 'tdx'],
  macro: ['wind', 'tushare', 'akshare'],
  fund: ['eastmoneyDirect', 'akshare', 'wind'],
  moneyFlow: ['eastmoneyDirect', 'akshare', 'wind'],
}

export class ProviderRouterTool implements Tool {
  constructor(private readonly runtimeHealthProvider: ProviderHealthProvider = runtimeProviderHealthRows) {}

  name = 'ProviderRouter'
  description = 'Explain code-owned finance provider routing order, provider gates, skipped providers, and serial-call requirements.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['help', 'tasks', 'route'],
      },
      task: {
        type: 'string',
        enum: TASKS,
      },
      preferredProviders: {
        type: 'array',
        items: { type: 'string' },
      },
      temporarilyBlockedProviders: {
        type: 'array',
        items: { type: 'string' },
      },
      providerHealth: {
        type: 'array',
        items: { type: 'object' },
        description: 'Optional health rows: provider, status, reason. unhealthy/blocked/quota_exhausted/credential_missing statuses are skipped.',
      },
      includeRuntimeHealth: {
        type: 'boolean',
        description: 'Default true. Merge recent runtime API health from the app statistics store so provider health can affect routing without manual rows.',
      },
      gates: {
        type: 'object',
        description: 'Optional provider gates: windConfigured, windQuotaAvailable, tushareConfigured, tusharePermissionLikely, allowAkshareCompatibility, allowBroadAkshare.',
      },
    },
  }

  async call(_id: string, input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'tasks').trim()
    if (action === 'help') return JSON.stringify(help())
    if (action === 'tasks') {
      return JSON.stringify({ contract: 'provider-router-tasks-v1', tasks: TASKS })
    }
    if (action !== 'route') {
      throw new Error(`Invalid ProviderRouter action "${action}". Use action="help" for supported actions.`)
    }
    const task = parseTask(input.task)
    if (!task) {
      throw new Error('ProviderRouter(action:"route") requires a supported task. Use action="tasks" to inspect tasks.')
    }
    return JSON.stringify(route(task, input, this.runtimeHealthProvider))
  }
}

function help(): Record<string, unknown> {
  return {
    contract: 'provider-router-help-v1',
    actions: ['tasks', 'route'],
    guidance: [
      'Provider routing is code-owned and can account for credentials, quota, compatibility gates, and temporary provider blocks.',
      'Use preferredProviders only to request a provider already allowed by policy; unsupported preferences are ignored with explanation.',
      'Use the returned order and skipped list in final provenance instead of inventing provider order.',
    ],
  }
}

function route(
  task: FinanceDataTask,
  input: Record<string, unknown>,
  runtimeHealthProvider: ProviderHealthProvider,
): Record<string, unknown> {
  const gates = gatesFromInput(input)
  const healthRows = combinedHealthRows(task, input, runtimeHealthProvider)
  const healthBlocks = healthBlocksFromRows(healthRows)
  const effectiveGates = {
    ...gates,
    temporarilyBlockedProviders: [
      ...(gates.temporarilyBlockedProviders ?? []),
      ...Object.keys(healthBlocks) as FinanceProvider[],
    ],
  }
  const preferred = normalizeFinanceProviders(input.preferredProviders)
  const order = providerOrder(task, effectiveGates, preferred)
  const base = RAW_ORDERS[task]
  const skipped = base
    .filter((provider) => !order.includes(provider))
    .map((provider) => ({
      provider,
      reason: healthBlocks[provider] ?? skipReason(provider, effectiveGates, preferred),
    }))
  return {
    contract: 'provider-router-route-v1',
    runtime: 'finagent-workstation',
    task,
    order,
    preferredProviders: preferred,
    skipped,
    serialProviders: order.filter(requiresSerialCalls),
    gates: effectiveGates,
    providerHealth: Object.entries(healthBlocks).map(([provider, reason]) => ({
      provider,
      routeEffect: 'skipped',
      reason,
    })),
    providerHealthSource: providerHealthSource(input, healthRows),
    nextAction: order.length === 0
      ? 'No provider is currently allowed. Use cache/readback, configure credentials, or clear temporary provider blocks before retrying.'
      : 'Use providers in returned order; do not override order from prompt knowledge.',
  }
}

function combinedHealthRows(
  task: FinanceDataTask,
  input: Record<string, unknown>,
  runtimeHealthProvider: ProviderHealthProvider,
): Array<Record<string, unknown>> {
  const rows = Array.isArray(input.providerHealth)
    ? input.providerHealth.filter((row): row is Record<string, unknown> =>
      !!row && typeof row === 'object' && !Array.isArray(row))
    : []
  if (input.includeRuntimeHealth === false) return [...rows]
  return [...rows, ...contractProviderHealthRows(task), ...runtimeHealthProvider()]
}

function healthBlocksFromRows(rows: Array<Record<string, unknown>>): Partial<Record<FinanceProvider, string>> {
  const blocked = new Set([
    'unhealthy',
    'blocked',
    'runtime_unavailable',
    'transport_unstable',
    'quota_exhausted',
    'credential_missing',
  ])
  const out: Partial<Record<FinanceProvider, string>> = {}
  for (const row of rows) {
    const [provider] = normalizeFinanceProviders([row.provider])
    if (!provider) continue
    const status = String(row.status ?? '').trim()
    if (!blocked.has(status)) continue
    out[provider] = `health_${status}:${String(row.reason ?? 'provider health blocked routing')}`
  }
  return out
}

export function runtimeProviderHealthRows(records: ApiCallRecord[] = globalApiStats.getRecent(30)): Array<Record<string, unknown>> {
  const byProvider: Record<string, ApiCallRecord[]> = {}
  for (const record of records) {
    const [provider] = normalizeFinanceProviders([record.source])
    if (!provider) continue
    ;(byProvider[provider] ??= []).push(record)
  }
  return Object.entries(byProvider).map(([provider, providerRecords]) => {
    const failures = providerRecords.filter((record) => !record.success)
    const status = runtimeHealthStatus(providerRecords, failures)
    return {
      provider,
      status,
      reason: status === 'ready'
        ? `runtime health ready: ${providerRecords.length - failures.length}/${providerRecords.length} recent calls succeeded`
        : `runtime health ${status}: ${failures.length}/${providerRecords.length} recent calls failed${failures[0]?.error ? ` (${failures[0].error})` : ''}`,
      source: 'globalApiStats',
      total: providerRecords.length,
      success: providerRecords.length - failures.length,
      failures: failures.length,
      lastRequest: providerRecords[0]?.timestamp,
    }
  })
}

export function contractProviderHealthRows(task: FinanceDataTask): Array<Record<string, unknown>> {
  const interfaceIds = taskInterfaceIds(task)
  if (interfaceIds.length === 0) return []
  const contract = dataApiInterfaces as DataApiInterfaceContract
  const byId = new Map((contract.interfaces ?? []).map((item) => [item.id, item]))
  const rows: Array<Record<string, unknown>> = []
  for (const interfaceId of interfaceIds) {
    const definition = byId.get(interfaceId)
    if (!definition) continue
    for (const capability of definition.capabilities ?? []) {
      const status = contractBlockingStatus(capability.status)
      if (!status) continue
      rows.push({
        provider: capability.provider,
        status,
        reason: `contract ${status}: ${capability.id} for ${definition.id}${capability.probeId ? ` probe=${capability.probeId}` : ''}${capability.reason ? ` (${capability.reason})` : ''}`,
        source: 'dataApiInterfaceContract',
        interfaceId: definition.id,
        capabilityId: capability.id,
        probeId: capability.probeId,
      })
    }
  }
  return rows
}

function contractBlockingStatus(status: string | undefined): string | null {
  if (status === 'disabled') return 'blocked'
  if (status === 'transport-unstable') return 'transport_unstable'
  return null
}

function taskInterfaceIds(task: FinanceDataTask): string[] {
  switch (task) {
    case 'quote':
      return ['stock.quote']
    case 'indexQuote':
      return ['index.quote']
    case 'kline':
      return ['stock.daily_kline']
    case 'indexKline':
      return ['index.daily_kline']
    case 'intradayTick':
      return ['stock.tick_chart_intraday', 'stock.transactions']
    case 'sector':
      return ['market.sector_ranking']
    case 'limitPool':
      return ['market.limit_pool']
    case 'dragonTiger':
      return ['market.dragon_tiger']
    case 'fundamental':
      return ['stock.daily_valuation', 'stock.company_info']
    case 'macro':
      return ['wind.economic_series']
    case 'fund':
      return ['fund.identity_list', 'fund.nav_history']
    case 'moneyFlow':
      return ['stock.money_flow', 'market.flow_rank']
  }
}

interface DataApiInterfaceContract {
  interfaces?: DataApiInterfaceDefinition[]
}

interface DataApiInterfaceDefinition {
  id: string
  capabilities?: DataApiCapability[]
}

interface DataApiCapability {
  id?: string
  provider?: string
  status?: string
  probeId?: string
  reason?: string
}

function runtimeHealthStatus(records: ApiCallRecord[], failures: ApiCallRecord[]): string {
  if (failures.length <= 0) return 'ready'
  const successes = records.length - failures.length
  if (successes <= 0) return 'runtime_unavailable'
  if (failures.length / records.length >= 0.5) return 'transport_unstable'
  return 'degraded'
}

function providerHealthSource(input: Record<string, unknown>, rows: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    manualRows: Array.isArray(input.providerHealth) ? input.providerHealth.length : 0,
    runtimeRows: input.includeRuntimeHealth === false
      ? 0
      : rows.length - (Array.isArray(input.providerHealth) ? input.providerHealth.length : 0),
    contractRows: rows.filter((row) => row.source === 'dataApiInterfaceContract').length,
    runtimeEnabled: input.includeRuntimeHealth !== false,
  }
}

function gatesFromInput(input: Record<string, unknown>): ProviderGates {
  const source = input.gates && typeof input.gates === 'object' && !Array.isArray(input.gates)
    ? input.gates as Record<string, unknown>
    : {}
  return {
    windConfigured: source.windConfigured === true,
    windQuotaAvailable: source.windQuotaAvailable !== false,
    tushareConfigured: source.tushareConfigured === true,
    tusharePermissionLikely: source.tusharePermissionLikely !== false,
    allowAkshareCompatibility: source.allowAkshareCompatibility === true,
    allowBroadAkshare: source.allowBroadAkshare === true,
    temporarilyBlockedProviders: normalizeFinanceProviders(input.temporarilyBlockedProviders),
  }
}

function skipReason(provider: FinanceProvider, gates: ProviderGates, preferred: FinanceProvider[]): string {
  if (gates.temporarilyBlockedProviders?.includes(provider)) return 'temporarily_blocked'
  if (provider === 'wind' && !(gates.windConfigured && gates.windQuotaAvailable !== false)) {
    return gates.windConfigured ? 'wind_quota_unavailable' : 'wind_not_configured'
  }
  if (provider === 'tushare' && !(gates.tushareConfigured && gates.tusharePermissionLikely !== false)) {
    return gates.tushareConfigured ? 'tushare_permission_unlikely' : 'tushare_not_configured'
  }
  if (provider === 'akshare' && gates.allowAkshareCompatibility !== true) return 'akshare_compatibility_disabled'
  if (preferred.length > 0 && !preferred.includes(provider)) return 'not_preferred'
  return 'not_allowed_by_policy'
}

function parseTask(value: unknown): FinanceDataTask | null {
  const text = String(value ?? '').trim()
  return TASKS.includes(text as FinanceDataTask) ? text as FinanceDataTask : null
}
