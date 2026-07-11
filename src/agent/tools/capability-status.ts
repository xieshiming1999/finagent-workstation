import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import type { Tool, ToolCapabilitySummary, ToolContext } from '../tool'
import { readPendingInteractionState } from '../interaction-evidence'

type JsonObject = Record<string, unknown>

const EVIDENCE = [
  'agent_discovery',
  'tool_calls',
  'no_tool_errors',
  'ui_artifacts',
  'no_pending_interactions',
] as const

type Evidence = typeof EVIDENCE[number]

export class CapabilityStatusTool implements Tool {
  name = 'CapabilityStatus'
  description = 'Inspect runtime capability health and evaluate whether workflow evidence is sufficient before final claims.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['help', 'summary', 'evaluate'],
        description: 'help, summary, or evaluate',
      },
      workflow: {
        type: 'string',
        description: 'Short workflow name for evaluate results, for example market_overview or stock_research',
      },
      requiredEvidence: {
        type: 'array',
        items: { type: 'string', enum: EVIDENCE },
        description: 'Evidence classes that must be present for evaluate. Omit for the default evaluator set.',
      },
      limit: {
        type: 'number',
        description: 'Maximum recent rows to inspect, default 20',
      },
    },
  }

  constructor(private readonly capabilitiesProvider: () => ToolCapabilitySummary[]) {}

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'summary')
    if (action === 'help') return JSON.stringify(help())
    if (action !== 'summary' && action !== 'evaluate') {
      throw new Error(`Invalid CapabilityStatus action "${action}". Use action="help" for supported actions.`)
    }

    const limit = clampLimit(input.limit)
    const summary = buildSummary(ctx, this.capabilitiesProvider(), limit)
    if (action === 'summary') return JSON.stringify(summary)

    const requiredEvidence = parseRequiredEvidence(input.requiredEvidence)
    return JSON.stringify(evaluateWorkflow(summary, {
      workflow: String(input.workflow ?? 'general_workflow'),
      requiredEvidence,
    }))
  }
}

function help(): JsonObject {
  return {
    contract: 'capability-status-help-v1',
    actions: ['summary', 'evaluate'],
    requiredEvidence: EVIDENCE,
    guidance: [
      'Call summary before broad, risky, or unfamiliar tool use.',
      'Call evaluate before final workflow claims to check tool calls, errors, pending user input, and UI artifacts.',
      'CapabilityStatus is evidence-focused and does not decide domain-specific finance logic.',
    ],
  }
}

function buildSummary(
  ctx: ToolContext,
  capabilities: ToolCapabilitySummary[],
  limit: number,
): JsonObject {
  const session = readCurrentSession(ctx, limit)
  const artifacts = listArtifacts(ctx, limit)
  const pendingInteractions = readPendingInteractionState(ctx)
  const broadDiscoveryTools = capabilities
    .filter((capability) => capability.schema.actionValues.includes('help') ||
      capability.name === 'ToolCatalog' ||
      capability.name === 'WorkflowEvidence')
    .map((capability) => ({
      name: capability.name,
      actions: capability.schema.actionValues,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    contract: 'capability-status-summary-v1',
    runtime: 'finagent-workstation',
    capabilitySummary: {
      count: capabilities.length,
      readOnly: capabilities.filter((capability) => capability.readOnly).length,
      writeOrSideEffect: capabilities.filter((capability) => capability.permission === 'write-or-side-effect').length,
      inputDependentPermission: capabilities.filter((capability) => capability.permission === 'input-dependent').length,
      trustedRuntime: capabilities.filter((capability) => capability.permission === 'trusted-runtime').length,
      userInteraction: capabilities.filter((capability) => capability.requiresUserInteraction).length,
      broadDiscoveryTools,
    },
    health: {
      pendingInteractionCount: pendingInteractions.length,
      toolErrorCount: Number(session.toolErrorCount ?? 0),
      toolCallCount: Number(session.toolCallCount ?? 0),
      uiArtifactCount: Number((artifacts.pages as JsonObject).count ?? 0) +
        Number((artifacts.dashboards as JsonObject).count ?? 0),
      repeatedFailureCount: Number(session.repeatedFailureCount ?? 0),
    },
    pendingInteractions,
    session,
    artifacts,
    guidance: 'Use evaluate to check whether selected evidence classes are present before final workflow claims.',
  }
}

function evaluateWorkflow(
  summary: JsonObject,
  input: { workflow: string; requiredEvidence: Evidence[] },
): JsonObject {
  const health = summary.health as JsonObject
  const checks = input.requiredEvidence.map((evidence) => {
    const passed = evidencePassed(evidence, summary)
    return {
      evidence,
      passed,
      message: evidenceMessage(evidence, passed, health),
    }
  })
  const missing = checks.filter((check) => !check.passed).map((check) => check.evidence)
  return {
    contract: 'capability-status-evaluation-v1',
    workflow: input.workflow,
    passed: missing.length === 0,
    checks,
    missing,
    nextAction: missing.length === 0
      ? 'Proceed with the final answer and cite the evidence already collected.'
      : `Collect or repair missing evidence before finalizing: ${missing.join(', ')}.`,
  }
}

function evidencePassed(evidence: Evidence, summary: JsonObject): boolean {
  const health = summary.health as JsonObject
  const capabilitySummary = summary.capabilitySummary as JsonObject
  if (evidence === 'agent_discovery') return Number(capabilitySummary.count ?? 0) > 0
  if (evidence === 'tool_calls') return Number(health.toolCallCount ?? 0) > 0
  if (evidence === 'no_tool_errors') return Number(health.toolErrorCount ?? 0) === 0
  if (evidence === 'ui_artifacts') return Number(health.uiArtifactCount ?? 0) > 0
  if (evidence === 'no_pending_interactions') return Number(health.pendingInteractionCount ?? 0) === 0
  return false
}

function evidenceMessage(evidence: Evidence, passed: boolean, health: JsonObject): string {
  if (evidence === 'tool_calls') return passed ? 'At least one tool call is present.' : 'No tool calls are visible in the current session evidence.'
  if (evidence === 'no_tool_errors') return passed ? 'No failed tool result is visible.' : `${health.toolErrorCount} failed tool result(s) are visible.`
  if (evidence === 'ui_artifacts') return passed ? 'At least one page or dashboard artifact exists.' : 'No page/dashboard artifact is visible.'
  if (evidence === 'no_pending_interactions') return passed ? 'No pending user question or approval is visible.' : `${health.pendingInteractionCount} pending interaction(s) require resolution.`
  return passed ? 'Capability discovery is available.' : 'Capability discovery did not return registered capabilities.'
}

function parseRequiredEvidence(value: unknown): Evidence[] {
  if (value === undefined) return ['agent_discovery', 'tool_calls', 'no_tool_errors', 'no_pending_interactions']
  if (!Array.isArray(value)) {
    throw new Error('CapabilityStatus evaluate requires requiredEvidence to be an array of supported evidence names. Use action="help" for allowed values.')
  }
  const out: Evidence[] = []
  for (const item of value) {
    if (!EVIDENCE.includes(item as Evidence)) {
      throw new Error(`Unsupported requiredEvidence "${String(item)}". Use one of: ${EVIDENCE.join(', ')}.`)
    }
    out.push(item as Evidence)
  }
  return out.length ? out : ['agent_discovery', 'tool_calls', 'no_tool_errors', 'no_pending_interactions']
}

function readCurrentSession(ctx: ToolContext, limit: number): JsonObject {
  const file = join(ctx.basePath, 'sessions', 'current.jsonl')
  if (!existsSync(file)) return { exists: false, toolCallCount: 0, toolErrorCount: 0, recentFailedTools: [] }

  const recentFailedTools: JsonObject[] = []
  const toolUsesById = new Map<string, JsonObject>()
  const repeatedFailuresBySignature = new Map<string, JsonObject>()
  let toolCallCount = 0
  let toolErrorCount = 0
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const text = line.trim()
    if (!text) continue
    try {
      const decoded = JSON.parse(text) as JsonObject
      if (decoded.type !== 'message') continue
      if (Array.isArray(decoded.toolUses)) {
        toolCallCount += decoded.toolUses.length
        for (const item of decoded.toolUses) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const row = item as JsonObject
            const id = String(row.id ?? '')
            if (id) toolUsesById.set(id, { name: row.name, input: row.input })
          }
        }
      }
      const result = decoded.toolResult ?? decoded.tool_result
      if (result && typeof result === 'object' && !Array.isArray(result) && (result as JsonObject).isError === true) {
        toolErrorCount++
        const toolUseId = String((result as JsonObject).toolUseId ?? '')
        const toolUse = toolUsesById.get(toolUseId)
        const signature = toolFailureSignature(toolUse)
        if (signature) {
          const existing = repeatedFailuresBySignature.get(signature) ?? {
            toolName: toolUse?.name,
            input: toolUse?.input,
            count: 0,
            latestToolUseId: toolUseId,
          }
          existing.count = Number(existing.count ?? 0) + 1
          existing.latestToolUseId = toolUseId
          repeatedFailuresBySignature.set(signature, existing)
        }
        recentFailedTools.push({
          toolUseId: (result as JsonObject).toolUseId,
          ...(toolUse?.name ? { toolName: toolUse.name } : {}),
          content: truncate(String((result as JsonObject).content ?? ''), 240),
        })
        if (recentFailedTools.length > limit) recentFailedTools.shift()
      }
    } catch {
      // Ignore malformed rows; session repair is owned elsewhere.
    }
  }
  const repeatedFailedToolCalls = [...repeatedFailuresBySignature.values()]
    .filter((row) => Number(row.count ?? 0) >= 3)
    .map((row) => ({
      ...row,
      warning: `Same tool/input failed ${String(row.count)} times. Stop repeating this call; inspect help/status or change arguments before retrying.`,
    }))
  return {
    exists: true,
    toolCallCount,
    toolErrorCount,
    recentFailedTools,
    repeatedFailureCount: repeatedFailedToolCalls.length,
    repeatedFailedToolCalls,
  }
}

function toolFailureSignature(toolUse: JsonObject | undefined): string | null {
  const name = String(toolUse?.name ?? '')
  if (!name) return null
  let input = ''
  try {
    input = JSON.stringify(toolUse?.input ?? {})
  } catch {
    input = String(toolUse?.input ?? '')
  }
  return `${name}::${input}`
}

function listArtifacts(ctx: ToolContext, limit: number): JsonObject {
  return {
    pages: listHtmlFiles(join(ctx.basePath, 'memory', 'pages'), limit),
    dashboards: listHtmlFiles(join(ctx.basePath, 'memory', 'dashboards'), limit),
  }
}

function listHtmlFiles(dir: string, limit: number): JsonObject {
  if (!existsSync(dir)) return { exists: false, count: 0, recent: [] }
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.html'))
    .map((name) => {
      const path = join(dir, name)
      const stat = statSync(path)
      return { path, updatedAt: stat.mtime.toISOString(), sizeBytes: stat.size }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return { exists: true, count: files.length, recent: files.slice(0, limit) }
}

function clampLimit(value: unknown): number {
  return Math.max(1, Math.min(100, Number(value ?? 20) || 20))
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`
}
