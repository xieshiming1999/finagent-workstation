import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readPendingInteractionState } from '../interaction-evidence'
import type { Tool, ToolContext } from '../tool'

const FAILURE_CLASSES = [
  'auto',
  'pending_interaction',
  'repeated_tool_failure',
  'provider_unhealthy',
  'credential_required',
  'missing_artifact',
  'missing_evidence',
  'approval_boundary',
  'unsupported_request',
] as const

type FailureClass = typeof FAILURE_CLASSES[number]

export class RecoveryPlannerTool implements Tool {
  name = 'RecoveryPlanner'
  description = 'Plan structured recovery steps from failed tool calls, provider blocks, missing evidence, pending user input, or approval boundaries.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['help', 'plan'],
      },
      failureClass: {
        type: 'string',
        enum: FAILURE_CLASSES,
      },
      workflow: { type: 'string' },
      toolName: { type: 'string' },
      provider: { type: 'string' },
      interfaceId: { type: 'string' },
      details: { type: 'object' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'plan').trim()
    if (action === 'help') return JSON.stringify(help())
    if (action !== 'plan') {
      throw new Error(`Invalid RecoveryPlanner action "${action}". Use action="help" for supported actions.`)
    }
    return JSON.stringify(plan(ctx, input, clampLimit(input.limit)))
  }
}

function help(): Record<string, unknown> {
  return {
    contract: 'recovery-planner-help-v1',
    actions: ['plan'],
    failureClasses: FAILURE_CLASSES,
    guidance: [
      'Use structured failureClass/details when available.',
      'Use failureClass:auto to infer from pending interactions and recent failed tool calls.',
      'RecoveryPlanner suggests safe next steps; it does not execute side effects.',
    ],
  }
}

function plan(ctx: ToolContext, input: Record<string, unknown>, limit: number): Record<string, unknown> {
  const requestedClass = parseFailureClass(input.failureClass)
  const observed = observedState(ctx, limit)
  const failureClass = requestedClass === 'auto' ? inferFailureClass(observed) : requestedClass
  const options = optionsFor(failureClass)
  return {
    contract: 'recovery-planner-plan-v1',
    runtime: 'finagent-workstation',
    workflow: optionalString(input.workflow),
    failureClass,
    observed,
    options,
    recommended: options[0] ?? null,
  }
}

function observedState(ctx: ToolContext, limit: number): Record<string, unknown> {
  const pending = readPendingInteractionState(ctx)
  const session = readSession(ctx, limit)
  return {
    pendingInteractions: pending,
    recentFailedTools: session.recentFailedTools,
    repeatedFailedToolCalls: session.repeatedFailedToolCalls,
  }
}

function inferFailureClass(observed: Record<string, unknown>): Exclude<FailureClass, 'auto'> {
  if (Array.isArray(observed.pendingInteractions) && observed.pendingInteractions.length > 0) return 'pending_interaction'
  if (Array.isArray(observed.repeatedFailedToolCalls) && observed.repeatedFailedToolCalls.length > 0) return 'repeated_tool_failure'
  if (Array.isArray(observed.recentFailedTools) && observed.recentFailedTools.length > 0) return 'missing_evidence'
  return 'missing_evidence'
}

function optionsFor(failureClass: Exclude<FailureClass, 'auto'>): Array<Record<string, unknown>> {
  if (failureClass === 'pending_interaction') {
    return [option('resolve_user_input', 'Resolve the pending AskUserQuestion or approval explicitly, then continue.', true)]
  }
  if (failureClass === 'repeated_tool_failure') {
    return [
      option('stop_repeating_call', 'Stop repeating the same tool/input. Inspect tool help, ProviderRouter, or AgentSelfDebug before retrying.', true),
      option('change_route_or_scope', 'Switch provider through ProviderRouter, reduce scope, or use cache/readback if available.'),
    ]
  }
  if (failureClass === 'provider_unhealthy') {
    return [
      option('use_cache_or_alternate_provider', 'Use reusable cache/readback or ask ProviderRouter for a healthy allowed provider.'),
      option('bounded_probe', 'Run only a bounded serial probe for the affected provider/interface before retrying live data.'),
    ]
  }
  if (failureClass === 'credential_required') {
    return [option('request_or_configure_credential', 'Stop live provider calls until the required credential/quota is configured and verified.', true)]
  }
  if (failureClass === 'missing_artifact') {
    return [option('create_or_register_artifact', 'Create the expected artifact, then register it through ArtifactRegistry before finalizing.')]
  }
  if (failureClass === 'approval_boundary') {
    return [option('stop_for_approval', 'Stop before side effects and ask for explicit approval through the supported user-interaction path.', true)]
  }
  if (failureClass === 'unsupported_request') {
    return [option('return_unsupported_with_contract', 'Return a clear unsupported result with the missing contract/capability and a supported alternative.', true)]
  }
  return [
    option('collect_required_evidence', 'Use Runbook and WorkflowVerifier to identify missing evidence, then collect it through typed tools.'),
    option('disclose_missing_evidence', 'If evidence is unavailable, disclose what is missing and reduce confidence instead of inventing data.'),
  ]
}

function option(id: string, description: string, stopBeforeFinalAnswer = false): Record<string, unknown> {
  return { id, description, stopBeforeFinalAnswer }
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

function parseFailureClass(value: unknown): FailureClass {
  const text = String(value ?? 'auto').trim()
  if (FAILURE_CLASSES.includes(text as FailureClass)) return text as FailureClass
  throw new Error(`Unsupported RecoveryPlanner failureClass "${text}". Use action="help" for supported classes.`)
}

function optionalString(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text || null
}

function truncate(value: string, max = 240): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`
}

function clampLimit(value: unknown): number {
  return Math.max(1, Math.min(100, Number(value ?? 30) || 30))
}
