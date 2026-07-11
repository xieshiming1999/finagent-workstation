import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ArtifactRegistry } from '../artifact-registry'
import { readPendingInteractionState } from '../interaction-evidence'
import type { Tool, ToolCapabilitySummary, ToolContext } from '../tool'

export class AgentSelfDebugTool implements Tool {
  name = 'AgentSelfDebug'
  description = 'Inspect recent agent runtime blockers, repeated tool failures, pending user interactions, artifacts, and discovery surfaces.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['help', 'status'],
      },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
  }

  constructor(private readonly capabilitiesProvider: () => ToolCapabilitySummary[]) {}

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'status').trim()
    if (action === 'help') return JSON.stringify(help())
    if (action !== 'status') {
      throw new Error(`Invalid AgentSelfDebug action "${action}". Use action="help" for supported actions.`)
    }
    return JSON.stringify(status(ctx, this.capabilitiesProvider(), clampLimit(input.limit)))
  }
}

function help(): Record<string, unknown> {
  return {
    contract: 'agent-self-debug-help-v1',
    actions: ['status'],
    guidance: [
      'Use this before repeating failed calls or assuming the agent is idle.',
      'Resolve pending AskUserQuestion/approval outside hidden automation.',
      'Use discovery tools or runbooks when repeated failures show the wrong tool/action.',
    ],
  }
}

function status(
  ctx: ToolContext,
  capabilities: ToolCapabilitySummary[],
  limit: number,
): Record<string, unknown> {
  const session = readSession(ctx, limit)
  const pending = readPendingInteractionState(ctx)
  const artifacts = new ArtifactRegistry(ctx.basePath).list().slice(0, limit)
  const discoveryTools = capabilities
    .filter((tool) => tool.schema.actionValues.includes('help') ||
      tool.name === 'ToolCatalog' ||
      tool.name === 'Runbook' ||
      tool.name === 'WorkflowVerifier')
    .map((tool) => ({ name: tool.name, actions: tool.schema.actionValues }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const blockerCount = pending.length + session.recentFailedTools.length + session.repeatedFailedToolCalls.length
  return {
    contract: 'agent-self-debug-status-v1',
    runtime: 'finagent-workstation',
    state: blockerCount > 0 ? 'needs_attention' : 'clear',
    blockerCount,
    pendingInteractions: pending,
    recentFailedTools: session.recentFailedTools,
    repeatedFailedToolCalls: session.repeatedFailedToolCalls,
    artifacts: {
      count: artifacts.length,
      latest: artifacts.slice(0, 5),
    },
    discoveryTools,
    nextAction: nextAction(pending, session),
  }
}

function nextAction(
  pending: Array<Record<string, unknown>>,
  session: { recentFailedTools: Array<Record<string, unknown>>; repeatedFailedToolCalls: Array<Record<string, unknown>> },
): string {
  if (pending.length > 0) return 'Resolve pending AskUserQuestion or approval explicitly before continuing.'
  if (session.repeatedFailedToolCalls.length > 0) {
    return 'Stop repeating the same failing tool/input; inspect help, runbook, provider health, or choose a different tool.'
  }
  if (session.recentFailedTools.length > 0) {
    return 'Inspect the latest tool error, repair arguments or provider state, then retry narrowly.'
  }
  return 'No immediate runtime blocker is visible.'
}

function readSession(ctx: ToolContext, limit: number): {
  recentFailedTools: Array<Record<string, unknown>>
  repeatedFailedToolCalls: Array<Record<string, unknown>>
} {
  const file = join(ctx.basePath, 'sessions', 'current.jsonl')
  if (!existsSync(file)) return { recentFailedTools: [], repeatedFailedToolCalls: [] }
  const toolUses = new Map<string, Record<string, unknown>>()
  const failures: Array<Record<string, unknown>> = []
  const repeated = new Map<string, Record<string, unknown>>()
  for (const line of readFileSync(file, 'utf8').split('\n').slice(0, limit)) {
    const text = line.trim()
    if (!text) continue
    try {
      const decoded = JSON.parse(text) as Record<string, unknown>
      if (Array.isArray(decoded.toolUses)) {
        for (const item of decoded.toolUses) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const row = item as Record<string, unknown>
            const id = String(row.id ?? '')
            if (id) toolUses.set(id, { name: row.name, input: row.input })
          }
        }
      }
      const result = decoded.toolResult ?? decoded.tool_result
      if (result && typeof result === 'object' && !Array.isArray(result) && (result as Record<string, unknown>).isError === true) {
        const id = String((result as Record<string, unknown>).toolUseId ?? '')
        const toolUse = toolUses.get(id)
        const failure = {
          toolUseId: id,
          toolName: toolUse?.name,
          input: toolUse?.input,
          content: truncate(String((result as Record<string, unknown>).content ?? '')),
        }
        failures.push(failure)
        const signature = `${String(failure.toolName ?? '')}|${JSON.stringify(failure.input ?? null)}`
        const current = repeated.get(signature) ?? { ...failure, count: 0 }
        current.count = Number(current.count ?? 0) + 1
        repeated.set(signature, current)
      }
    } catch {
      // Session repair is owned elsewhere.
    }
  }
  return {
    recentFailedTools: failures.slice(-5).reverse(),
    repeatedFailedToolCalls: [...repeated.values()].filter((item) => Number(item.count ?? 0) >= 3),
  }
}

function truncate(value: string, max = 240): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`
}

function clampLimit(value: unknown): number {
  return Math.max(1, Math.min(100, Number(value ?? 30) || 30))
}
