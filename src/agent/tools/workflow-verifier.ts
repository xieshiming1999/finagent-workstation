import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ArtifactRegistry, type ArtifactKind } from '../artifact-registry'
import { readPendingInteractionState } from '../interaction-evidence'
import type { Tool, ToolContext } from '../tool'

type WorkflowSpec = {
  requiredAnyTools: string[]
  artifactKinds: ArtifactKind[]
  artifactRequired?: boolean
  approvalBoundary: 'no_trade' | 'explicit_approval_required'
  macroEvidenceRecord?: boolean
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
  stock_selection: {
    requiredAnyTools: ['MarketData', 'DataStore', 'DataProcess', 'Research'],
    artifactKinds: ['analysis', 'data_snapshot'],
    artifactRequired: false,
    approvalBoundary: 'no_trade',
  },
  watchlist_handoff: {
    requiredAnyTools: ['Watchlist'],
    artifactKinds: ['data_snapshot', 'analysis'],
    artifactRequired: false,
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
  strategy_rerun: {
    requiredAnyTools: ['DataProcess', 'MarketData', 'ArtifactRegistry'],
    artifactKinds: ['strategy', 'backtest', 'report'],
    approvalBoundary: 'no_trade',
  },
  trade_preparation: {
    requiredAnyTools: ['Portfolio', 'XueqiuTrade', 'AskUserQuestion'],
    artifactKinds: ['trade_preparation', 'analysis'],
    approvalBoundary: 'explicit_approval_required',
  },
  trade_review: {
    requiredAnyTools: ['Portfolio', 'XueqiuTrade'],
    artifactKinds: ['analysis', 'data_snapshot'],
    artifactRequired: false,
    approvalBoundary: 'no_trade',
  },
  macro_factor_lookup: {
    requiredAnyTools: ['SourceReader', 'DataStore', 'Research'],
    artifactKinds: ['macro_evidence', 'research', 'data_snapshot', 'report', 'dashboard'],
    approvalBoundary: 'no_trade',
    macroEvidenceRecord: true,
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
      workflowStateId: {
        type: 'string',
        description: 'Optional saved FinanceWorkflowState id to require for this check.',
      },
      requireWorkflowState: {
        type: 'boolean',
        description: 'Require a saved typed workflow-state record that matches this workflow family.',
      },
      providerHealth: {
        type: 'array',
        items: { type: 'object' },
        description: 'Optional provider-health rows from ProviderRouter/API health/probes. Blocking statuses fail this verifier check.',
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
      workflowStateId: optionalString(input.workflowStateId),
      requireWorkflowState: input.requireWorkflowState === true,
      providerHealth: input.providerHealth,
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
      'workflow_state',
      'provider_health',
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
  input: {
    workflow: string
    spec: WorkflowSpec
    artifactId?: string
    workflowStateId?: string
    requireWorkflowState: boolean
    providerHealth: unknown
    limit: number
  },
): Record<string, unknown> {
  const session = readSession(ctx, input.limit)
  const pending = readPendingInteractionState(ctx)
  const artifactEvidence = artifactEvidenceFor(ctx, input.spec, input.artifactId)
  const workflowStateEvidence = workflowStateEvidenceFor(ctx, {
    workflow: input.workflow,
    workflowStateId: input.workflowStateId,
    required: input.requireWorkflowState || !!input.workflowStateId,
  })
  const providerHealthEvidence = providerHealthEvidenceFor(input.providerHealth)
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
    check('artifact_evidence', artifactEvidence.passed, artifactEvidence.reason, artifactEvidence.reason),
    check(
      'approval_boundary',
      input.spec.approvalBoundary !== 'explicit_approval_required' || pending.length > 0,
      input.spec.approvalBoundary === 'explicit_approval_required'
        ? 'Trade-preparation boundary is explicit: approval or user question is pending.'
        : 'Workflow has no trade approval boundary.',
      'Trade-preparation workflow requires explicit approval evidence before any side-effect.',
    ),
    check(
      'workflow_state',
      workflowStateEvidence.passed,
      workflowStateEvidence.passedMessage ?? 'Typed workflow state is valid.',
      workflowStateEvidence.reason ?? 'Typed workflow state is missing or invalid.',
    ),
    check(
      'provider_health',
      providerHealthEvidence.passed,
      providerHealthEvidence.passedMessage ?? 'Provider health is valid.',
      providerHealthEvidence.reason ?? 'Provider health contains blocking evidence.',
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
      workflowState: workflowStateEvidence.record ?? null,
      providerHealth: providerHealthEvidence.observed,
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
  if (spec.artifactRequired === false) {
    return {
      passed: true,
      reason: 'Artifact evidence is optional for this workflow.',
    }
  }
  const artifact = artifacts.find((item) => spec.artifactKinds.includes(item.kind))
  if (!artifact && spec.macroEvidenceRecord) {
    const evidence = macroEvidenceRecordEvidence(ctx)
    if (evidence.passed) return evidence
  }
  return artifact
    ? { passed: true, reason: 'Required artifact kind is registered.', artifact }
    : { passed: false, reason: `No registered artifact of required kind: ${spec.artifactKinds.join(', ')}.` }
}

function macroEvidenceRecordEvidence(ctx: ToolContext): {
  passed: boolean
  reason: string
  artifact?: Record<string, unknown>
} {
  const dir = join(ctx.memoryDir, 'macro_evidence')
  if (!existsSync(dir)) {
    return {
      passed: false,
      reason: 'No macro evidence record directory exists. Use SourceReader(action:"macroEvidence") before finalizing.',
    }
  }
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  for (const file of files) {
    try {
      const record = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      const missing = missingMacroEvidenceFields(record)
      if (missing.length > 0) {
        return {
          passed: false,
          reason: `Latest macro evidence record is missing structured fields: ${missing.join(', ')}.`,
          artifact: record,
        }
      }
      return {
        passed: true,
        reason: 'Durable macro-evidence-record-v1 is available.',
        artifact: {
          kind: 'macro_evidence',
          path: file,
          record,
        },
      }
    } catch {
      // Keep scanning older records.
    }
  }
  return {
    passed: false,
    reason: 'No readable macro-evidence-record-v1 JSON file exists. Use SourceReader(action:"macroEvidence").',
  }
}

function missingMacroEvidenceFields(record: Record<string, unknown>): string[] {
  const missing: string[] = []
  for (const field of ['contract', 'source', 'title', 'topic', 'region', 'assetClass', 'confidenceEffect', 'tradeBoundary']) {
    const value = record[field]
    if (typeof value !== 'string' || !value.trim()) missing.push(field)
  }
  if (record.contract !== 'macro-evidence-record-v1') missing.push('contract:macro-evidence-record-v1')
  if (!Array.isArray(record.keyClaims) || record.keyClaims.length === 0) missing.push('keyClaims')
  if (!Array.isArray(record.affectedAssets) || record.affectedAssets.length === 0) missing.push('affectedAssets')
  return missing
}

function workflowStateEvidenceFor(ctx: ToolContext, input: {
  workflow: string
  workflowStateId?: string
  required: boolean
}): {
  passed: boolean
  reason?: string
  passedMessage?: string
  record?: Record<string, unknown>
} {
  const expectedKind = workflowKindForVerifierWorkflow(input.workflow)
  const records = readWorkflowStateRecords(ctx)
  const record = input.workflowStateId
    ? records.find((item) => item.id === input.workflowStateId)
    : records.find((item) => {
        const state = objectValue(item.workflowState)
        return item.status === 'active' && state?.workflowKind === expectedKind
      })
  if (!record) {
    if (!input.required) {
      return {
        passed: true,
        passedMessage: 'Typed workflow state was not required for this check.',
      }
    }
    return {
      passed: false,
      reason: input.workflowStateId
        ? `Required workflow state "${input.workflowStateId}" is not saved.`
        : `No active saved FinanceWorkflowState for expected kind "${expectedKind}".`,
    }
  }
  const state = objectValue(record.workflowState)
  const kind = state?.workflowKind
  if (kind !== expectedKind) {
    return {
      passed: false,
      record,
      reason: `Saved workflow state kind "${String(kind)}" does not match expected "${expectedKind}".`,
    }
  }
  if (record.status === 'blocked') {
    return {
      passed: false,
      record,
      reason: `Saved workflow state is blocked: ${String(record.blocker ?? 'blocker not specified')}.`,
    }
  }
  return {
    passed: true,
    passedMessage: 'Typed workflow state is saved and matches this workflow.',
    record,
  }
}

function providerHealthEvidenceFor(value: unknown): {
  passed: boolean
  reason?: string
  passedMessage?: string
  observed: Record<string, unknown>[]
} {
  const rows = Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    : []
  if (rows.length === 0) {
    return {
      passed: true,
      passedMessage: 'Provider health evidence was not supplied for this check.',
      observed: rows,
    }
  }
  const blockingStatuses = new Set([
    'unhealthy',
    'blocked',
    'runtime_unavailable',
    'transport_unstable',
    'quota_exhausted',
    'credential_missing',
    'credential-or-quota-required',
  ])
  const blocking = rows.filter((row) => {
    const status = String(row.status ?? row.classification ?? '').trim().toLowerCase()
    return blockingStatuses.has(status)
  })
  if (blocking.length > 0) {
    const labels = blocking.map((row) => {
      const provider = String(row.provider ?? row.source ?? 'provider')
      const status = String(row.status ?? row.classification ?? 'blocked')
      return `${provider}:${status}`
    }).join(', ')
    return {
      passed: false,
      reason: `Provider health has blocking rows: ${labels}.`,
      observed: rows,
    }
  }
  return {
    passed: true,
    passedMessage: 'Provider health evidence has no blocking rows.',
    observed: rows,
  }
}

function readWorkflowStateRecords(ctx: ToolContext): Record<string, unknown>[] {
  const file = join(ctx.memoryDir, 'workflows', 'state.json')
  if (!existsSync(file)) return []
  try {
    const decoded = JSON.parse(readFileSync(file, 'utf8')) as { records?: unknown }
    return Array.isArray(decoded.records)
      ? decoded.records.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
      : []
  } catch {
    return []
  }
}

function workflowKindForVerifierWorkflow(workflow: string): string {
  switch (workflow) {
    case 'market_overview':
      return 'market_analysis'
    case 'stock_research':
      return 'stock_research'
    case 'stock_selection':
      return 'stock_selection'
    case 'watchlist_handoff':
      return 'watchlist_handoff'
    case 'fund_selection':
      return 'fund_research'
    case 'strategy_backtest':
      return 'strategy_review'
    case 'strategy_rerun':
      return 'strategy_rerun'
    case 'trade_preparation':
      return 'trade_preparation'
    case 'trade_review':
      return 'trade_review'
    case 'trade_prep':
      return 'trade_prep'
    case 'macro_factor_lookup':
      return 'macro_attribution'
    default:
      return 'unknown'
  }
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

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
