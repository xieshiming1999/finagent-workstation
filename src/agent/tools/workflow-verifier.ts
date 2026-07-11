import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ArtifactRegistry, type ArtifactKind } from '../artifact-registry'
import { readPendingInteractionState } from '../interaction-evidence'
import type { Tool, ToolContext } from '../tool'

type WorkflowSpec = {
  requiredAnyTools: string[]
  artifactKinds: ArtifactKind[]
  approvalBoundary: 'no_trade' | 'explicit_approval_required'
}

const WORKFLOWS: Record<string, WorkflowSpec> = {
  market_overview: {
    requiredAnyTools: ['MarketData', 'DataStore', 'Research'],
    artifactKinds: ['analysis', 'dashboard', 'data_snapshot'],
    approvalBoundary: 'no_trade',
  },
  stock_research: {
    requiredAnyTools: ['MarketData', 'DataStore', 'DataProcess', 'Research'],
    artifactKinds: ['analysis', 'dashboard', 'data_snapshot'],
    approvalBoundary: 'no_trade',
  },
  fund_selection: {
    requiredAnyTools: ['MarketData', 'DataStore', 'DataProcess', 'Research'],
    artifactKinds: ['analysis', 'data_snapshot'],
    approvalBoundary: 'no_trade',
  },
  strategy_backtest: {
    requiredAnyTools: ['DataProcess', 'MarketData'],
    artifactKinds: ['strategy', 'backtest', 'report'],
    approvalBoundary: 'no_trade',
  },
  trade_preparation: {
    requiredAnyTools: ['Portfolio', 'XueqiuTrade', 'AskUserQuestion'],
    artifactKinds: ['trade_preparation', 'analysis'],
    approvalBoundary: 'explicit_approval_required',
  },
}

export class WorkflowVerifierTool implements Tool {
  name = 'WorkflowVerifier'
  description = 'Verify whether a workflow has enough structured evidence before the agent finalizes a claim or proceeds to a boundary.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['help', 'list', 'check'],
      },
      workflow: {
        type: 'string',
        enum: Object.keys(WORKFLOWS),
      },
      artifactId: {
        type: 'string',
        description: 'Optional artifact id/stable ref to require for this check.',
      },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'list').trim()
    if (action === 'help') return JSON.stringify(help())
    if (action === 'list') {
      return JSON.stringify({
        contract: 'workflow-verifier-list-v1',
        workflows: Object.keys(WORKFLOWS),
        guidance: 'Call WorkflowVerifier(action:"check", workflow:<id>) before final workflow claims.',
      })
    }
    if (action !== 'check') {
      throw new Error(`Invalid WorkflowVerifier action "${action}". Use action="help" for supported actions.`)
    }
    const workflow = String(input.workflow ?? '').trim()
    const spec = WORKFLOWS[workflow]
    if (!spec) {
      throw new Error(`Unknown WorkflowVerifier workflow "${workflow}". Use action="list" to inspect available workflows.`)
    }
    return JSON.stringify(checkWorkflow(ctx, {
      workflow,
      spec,
      artifactId: optionalString(input.artifactId),
      limit: clampLimit(input.limit),
    }))
  }
}

function help(): Record<string, unknown> {
  return {
    contract: 'workflow-verifier-help-v1',
    actions: ['list', 'check'],
    workflows: Object.keys(WORKFLOWS),
    checks: [
      'tool_calls_present',
      'required_tool_family',
      'no_tool_errors',
      'no_pending_interactions',
      'artifact_evidence',
      'approval_boundary',
    ],
    guidance: [
      'This tool checks structured session, interaction, and artifact evidence.',
      'It does not parse the user prompt to infer intent.',
      'If a check fails, collect evidence, register an artifact, resolve pending input, or stop at the approval boundary.',
    ],
  }
}

function checkWorkflow(
  ctx: ToolContext,
  input: { workflow: string; spec: WorkflowSpec; artifactId?: string; limit: number },
): Record<string, unknown> {
  const session = readSession(ctx, input.limit)
  const pending = readPendingInteractionState(ctx)
  const artifactEvidence = artifactEvidenceFor(ctx, input.spec, input.artifactId)
  const toolNames = new Set(session.toolNames)
  const usedRequiredTool = input.spec.requiredAnyTools.some((name) => toolNames.has(name))
  const checks = [
    check('tool_calls_present', session.toolCallCount > 0, 'At least one tool call is visible.', 'No tool call is visible for this workflow.'),
    check(
      'required_tool_family',
      usedRequiredTool,
      'A required tool family was used.',
      `No required tool family was used. Expected one of: ${input.spec.requiredAnyTools.join(', ')}.`,
    ),
    check('no_tool_errors', session.toolErrorCount === 0, 'No tool errors are visible.', `${session.toolErrorCount} tool error(s) are visible.`),
    check('no_pending_interactions', pending.length === 0, 'No pending AskUserQuestion or approval is visible.', `${pending.length} pending interaction(s) must be resolved before finalizing.`),
    check('artifact_evidence', artifactEvidence.passed, 'Required artifact evidence is registered.', artifactEvidence.reason),
    check(
      'approval_boundary',
      input.spec.approvalBoundary !== 'explicit_approval_required' || pending.length > 0,
      input.spec.approvalBoundary === 'explicit_approval_required'
        ? 'Trade-preparation boundary is explicit: approval or user question is pending.'
        : 'Workflow has no trade approval boundary.',
      'Trade-preparation workflow requires explicit approval evidence before any side-effect.',
    ),
  ]
  const missing = checks.filter((item) => !item.passed).map((item) => item.id)
  return {
    contract: 'workflow-verifier-check-v1',
    workflow: input.workflow,
    passed: missing.length === 0,
    missing,
    checks,
    observed: {
      toolNames: [...toolNames].sort(),
      pendingInteractions: pending.length,
      artifact: artifactEvidence.artifact ?? null,
    },
    nextAction: missing.length === 0
      ? 'Final answer may cite the verified workflow evidence.'
      : `Do not finalize yet. Resolve missing checks: ${missing.join(', ')}.`,
  }
}

function readSession(ctx: ToolContext, limit: number): { toolCallCount: number; toolErrorCount: number; toolNames: string[] } {
  const file = join(ctx.basePath, 'sessions', 'current.jsonl')
  if (!existsSync(file)) return { toolCallCount: 0, toolErrorCount: 0, toolNames: [] }
  const toolNames = new Set<string>()
  let toolCallCount = 0
  let toolErrorCount = 0
  for (const line of readFileSync(file, 'utf8').split('\n').slice(0, limit)) {
    const text = line.trim()
    if (!text) continue
    try {
      const decoded = JSON.parse(text) as Record<string, unknown>
      if (Array.isArray(decoded.toolUses)) {
        toolCallCount += decoded.toolUses.length
        for (const item of decoded.toolUses) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const name = (item as Record<string, unknown>).name
            if (typeof name === 'string') toolNames.add(name)
          }
        }
      }
      const result = decoded.toolResult ?? decoded.tool_result
      if (result && typeof result === 'object' && !Array.isArray(result) && (result as Record<string, unknown>).isError === true) {
        toolErrorCount++
      }
    } catch {
      // Session repair is owned elsewhere.
    }
  }
  return { toolCallCount, toolErrorCount, toolNames: [...toolNames] }
}

function artifactEvidenceFor(ctx: ToolContext, spec: WorkflowSpec, artifactId?: string): {
  passed: boolean
  reason: string
  artifact?: Record<string, unknown>
} {
  const artifacts = new ArtifactRegistry(ctx.basePath).list()
  if (artifactId) {
    const normalizedId = artifactId.startsWith('artifact:') ? artifactId.slice('artifact:'.length) : artifactId
    const artifact = artifacts.find((item) => item.id === normalizedId || item.stableRef === artifactId)
    return artifact
      ? { passed: true, reason: 'Required artifact id is registered.', artifact }
      : { passed: false, reason: `Required artifact "${artifactId}" is not registered.` }
  }
  const artifact = artifacts.find((item) => spec.artifactKinds.includes(item.kind))
  return artifact
    ? { passed: true, reason: 'Required artifact kind is registered.', artifact }
    : { passed: false, reason: `No registered artifact of required kind: ${spec.artifactKinds.join(', ')}.` }
}

function check(id: string, passed: boolean, passedMessage: string, failedMessage: string): {
  id: string
  passed: boolean
  message: string
} {
  return { id, passed, message: passed ? passedMessage : failedMessage }
}

function clampLimit(value: unknown): number {
  return Math.max(1, Math.min(100, Number(value ?? 50) || 50))
}

function optionalString(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  return text || undefined
}
