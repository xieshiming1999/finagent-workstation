import {
  normalizeFinanceProviders,
  providerOrder,
  requiresSerialCalls,
  type FinanceDataTask,
  type FinanceProvider,
  type ProviderGates,
} from '../data/provider-policy'
import type { Tool, ToolContext } from '../tool'

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
    return JSON.stringify(route(task, input))
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

function route(task: FinanceDataTask, input: Record<string, unknown>): Record<string, unknown> {
  const gates = gatesFromInput(input)
  const preferred = normalizeFinanceProviders(input.preferredProviders)
  const order = providerOrder(task, gates, preferred)
  const base = RAW_ORDERS[task]
  const skipped = base
    .filter((provider) => !order.includes(provider))
    .map((provider) => ({
      provider,
      reason: skipReason(provider, gates, preferred),
    }))
  return {
    contract: 'provider-router-route-v1',
    runtime: 'finagent-workstation',
    task,
    order,
    preferredProviders: preferred,
    skipped,
    serialProviders: order.filter(requiresSerialCalls),
    gates,
    nextAction: order.length === 0
      ? 'No provider is currently allowed. Use cache/readback, configure credentials, or clear temporary provider blocks before retrying.'
      : 'Use providers in returned order; do not override order from prompt knowledge.',
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
