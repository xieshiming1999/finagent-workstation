import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { globalApiStats, type ApiCallRecord } from '../data/resilience'
import type { Tool, ToolContext } from '../tool'

export class BudgetGovernorTool implements Tool {
  name = 'BudgetGovernor'
  description = 'Inspect recent provider/API usage, quota-like failures, Wind usage state, and safe retry guidance before broad external calls.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['help', 'status'],
      },
      source: { type: 'string' },
      minutes: { type: 'integer', minimum: 1, maximum: 1440 },
    },
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'status').trim()
    if (action === 'help') return JSON.stringify(help())
    if (action !== 'status') {
      throw new Error(`Invalid BudgetGovernor action "${action}". Use action="help" for supported actions.`)
    }
    return JSON.stringify(status(ctx, clampMinutes(input.minutes), optionalString(input.source)))
  }
}

function help(): Record<string, unknown> {
  return {
    contract: 'budget-governor-help-v1',
    actions: ['status'],
    guidance: [
      'Use before broad or quota-consuming calls.',
      'A stop decision means use cache/readback or ask the user before more live provider calls.',
      'This tool reads local usage evidence; it does not execute provider calls or mutate quotas.',
    ],
  }
}

function status(ctx: ToolContext, minutes: number, source: string | null): Record<string, unknown> {
  const recent = globalApiStats.getRecent(minutes)
    .filter((record) => !source || record.source === source)
  const quotaFailures = recent.filter(isQuotaFailure)
  const windUsage = readWindUsage(ctx)
  const decision = decide({ quotaFailures, failures: recent.filter((record) => !record.success), windUsage })
  return {
    contract: 'budget-governor-status-v1',
    runtime: 'finagent-workstation',
    windowMinutes: minutes,
    source,
    decision,
    summary: globalApiStats.getSummary(),
    quotaLikeFailures: quotaFailures,
    windUsage,
    nextAction: nextAction(decision),
  }
}

function decide(input: {
  quotaFailures: ApiCallRecord[]
  failures: ApiCallRecord[]
  windUsage: Record<string, unknown>
}): string {
  if (input.windUsage.exhausted === true) return 'stop_wind_calls'
  if (input.quotaFailures.length > 0) return 'stop_broad_live_calls'
  if (input.failures.length >= 3) return 'narrow_or_probe_before_retry'
  return 'ok_with_cache_first'
}

function nextAction(decision: string): string {
  if (decision === 'stop_wind_calls') return 'Do not call Wind again for the current quota day. Use cache/readback or fallback providers.'
  if (decision === 'stop_broad_live_calls') return 'Stop broad live collection. Use cache/readback, fallback providers, or a bounded credential/quota probe.'
  if (decision === 'narrow_or_probe_before_retry') return 'Retry only a narrow provider/interface after checking ProviderRouter or RecoveryPlanner.'
  return 'Use cache/readback first; live calls may continue if scoped and necessary.'
}

function isQuotaFailure(record: ApiCallRecord): boolean {
  const text = `${record.error ?? ''} ${record.status}`.toLowerCase()
  return record.status === 429 ||
    text.includes('quota') ||
    text.includes('rate limit') ||
    text.includes('rate_limit') ||
    text.includes('balance_insufficient') ||
    text.includes('frequency')
}

function readWindUsage(ctx: ToolContext): Record<string, unknown> {
  const file = join(ctx.basePath, 'memory', 'wind_usage.json')
  if (!existsSync(file)) return { exists: false, exhausted: false }
  try {
    const decoded = JSON.parse(readFileSync(file, 'utf-8'))
    if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
      return { exists: true, ...decoded }
    }
  } catch {
    return { exists: true, unreadable: true, exhausted: false }
  }
  return { exists: true, unreadable: true, exhausted: false }
}

function clampMinutes(value: unknown): number {
  return Math.max(1, Math.min(1440, Number(value ?? 60) || 60))
}

function optionalString(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text || null
}
