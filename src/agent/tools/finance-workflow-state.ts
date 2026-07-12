import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Tool, ToolContext } from '../tool'
import type {
  FinanceAssetClass,
  FinanceConfirmationState,
  FinanceExecutionMode,
  FinanceIntentMode,
  FinanceWorkflowKind,
  FinanceWorkflowState,
} from '../../domain/finance/workflows/finance-workflow-state'

const WORKFLOW_KINDS: FinanceWorkflowKind[] = [
  'market_analysis',
  'stock_research',
  'stock_selection',
  'fund_research',
  'strategy_design',
  'strategy_review',
  'strategy_rerun',
  'trade_prep',
  'trade_preparation',
  'trade_review',
  'watchlist_handoff',
  'monitor_review',
  'macro_factor_lookup',
  'evidence_review',
  'unknown',
]
const ASSET_CLASSES: FinanceAssetClass[] = ['stock', 'fund', 'portfolio', 'mixed', 'unknown']
const INTENT_MODES: FinanceIntentMode[] = ['analysis', 'validate', 'backtest', 'save', 'rerun', 'observe', 'watchlist_add', 'size', 'confirm', 'review', 'unknown']
const EXECUTION_MODES: FinanceExecutionMode[] = ['none', 'preview_only', 'watchlist', 'backtest', 'requires_confirmation', 'paper_allowed_after_confirmation', 'blocked', 'unknown']
const CONFIRMATION_STATES: FinanceConfirmationState[] = ['none', 'pending', 'answered', 'denied', 'accepted', 'unknown']

export class FinanceWorkflowStateTool implements Tool {
  name = 'FinanceWorkflowState'
  description = 'Create or validate typed finance workflow state. Use this instead of relying on prompt-text parsing.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['help', 'create', 'validate', 'save', 'list', 'get', 'current'],
        description: 'help, create/validate a finance-workflow-state-v1 object, or save/list/get/current durable workflow state',
      },
      id: { type: 'string' },
      status: { type: 'string', enum: ['active', 'blocked', 'complete', 'cancelled'] },
      blocker: { type: 'string' },
      pendingUserQuestion: { type: 'object' },
      pendingApproval: { type: 'object' },
      generatedArtifacts: { type: 'array', items: { type: 'string' } },
      completedSteps: { type: 'array', items: { type: 'string' } },
      requiredEvidence: { type: 'array', items: { type: 'string' } },
      workflowKind: { type: 'string', enum: WORKFLOW_KINDS },
      assetClass: { type: 'string', enum: ASSET_CLASSES },
      intentMode: { type: 'string', enum: INTENT_MODES },
      executionMode: { type: 'string', enum: EXECUTION_MODES },
      confirmationState: { type: 'string', enum: CONFIRMATION_STATES },
      safetyBoundary: { type: 'string' },
      evidenceRefs: { type: 'array', items: { type: 'string' } },
      subject: { type: 'string' },
      subjects: { type: 'array', items: { type: 'string' } },
      source: { type: 'string' },
      hasUnsupportedExecutableParts: { type: 'boolean' },
      blockedTools: { type: 'array', items: { type: 'string' } },
      requiredArtifacts: {
        type: 'array',
        items: { type: 'object' },
        description: 'Structured output artifact requirements, for example kindAnyOf/report/dashboard and fields that must be included.',
      },
      requiredVerifier: {
        type: 'object',
        description: 'Structured verifier requirement, for example {"tool":"WorkflowVerifier","action":"check","workflow":"macro_factor_lookup"}.',
      },
      workflowState: { type: 'object', description: 'Existing finance-workflow-state-v1 object for validation' },
    },
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'help')
    if (action === 'help') return JSON.stringify(help())
    if (action === 'list') return JSON.stringify(listStates(ctx, input))
    if (action === 'get') return JSON.stringify(getState(ctx, input, false))
    if (action === 'current') return JSON.stringify(getState(ctx, input, true))
    if (action !== 'create' && action !== 'validate' && action !== 'save') {
      throw new Error(`Invalid FinanceWorkflowState action "${action}". Use action="help" for supported actions.`)
    }
    const state = input.workflowState && typeof input.workflowState === 'object'
      ? normalizeState(input.workflowState, action)
      : normalizeState(input, action)
    const errors = validateState(state)
    if (errors.length > 0) {
      throw new Error(`Invalid finance workflow state: ${errors.join('; ')}. Use FinanceWorkflowState(action:"help") for allowed enum values.`)
    }
    const workflowState = {
      ...state,
      updatedAt: state.updatedAt ?? new Date().toISOString(),
    } as FinanceWorkflowState
    if (action === 'save') return JSON.stringify(saveState(ctx, input, workflowState))
    return JSON.stringify({
      contract: 'finance-workflow-state-result-v1',
      action,
      workflowState,
      usage: 'Pass this workflowState as a structured tool parameter or embed it as data.workflowState only when a workflow entry point requires user-message state.',
    })
  }
}

function help(): Record<string, unknown> {
  return {
    contract: 'finance-workflow-state-help-v1',
    actions: ['create', 'validate', 'save', 'list', 'get', 'current'],
    enums: {
      workflowKind: WORKFLOW_KINDS,
      assetClass: ASSET_CLASSES,
      intentMode: INTENT_MODES,
      executionMode: EXECUTION_MODES,
      confirmationState: CONFIRMATION_STATES,
    },
    requiredForCreate: ['workflowKind', 'assetClass', 'intentMode', 'executionMode', 'confirmationState', 'safetyBoundary', 'evidenceRefs'],
    guidance: 'The agent must choose these typed fields explicitly. Save active workflow state when later turns, recovery, verification, or UI evidence need it. Do not infer workflow behavior by matching user prompt text in runtime code.',
    templates: {
      macroReportArtifact: {
        action: 'save',
        workflowKind: 'macro_factor_lookup',
        assetClass: 'mixed',
        intentMode: 'analysis',
        executionMode: 'none',
        confirmationState: 'none',
        safetyBoundary: 'macro evidence is context and invalidation input, not a direct buy/sell rule',
        evidenceRefs: ['query_macro_factors', 'query_macro_attribution', 'query_macro_research_evidence'],
        requiredArtifacts: [
          {
            kindAnyOf: ['report', 'dashboard'],
            requiredFields: ['topic', 'sourceDataTime', 'fetchedAt', 'missingEvidence', 'confidenceEffect', 'affectedAssets'],
          },
        ],
        requiredVerifier: { tool: 'WorkflowVerifier', action: 'check', workflow: 'macro_factor_lookup' },
      },
      readOnlyTradePreparation: {
        action: 'save',
        workflowKind: 'trade_preparation',
        assetClass: 'stock',
        intentMode: 'size',
        executionMode: 'preview_only',
        confirmationState: 'none',
        safetyBoundary: 'read-only sizing; no order, transfer, or portfolio mutation without explicit later confirmation',
        evidenceRefs: ['xueqiu_balance_or_portfolio_state', 'quote', 'risk_sizing', 'trade_boundary'],
        requiredVerifier: { tool: 'WorkflowVerifier', action: 'check', workflow: 'trade_preparation' },
      },
    },
  }
}

function normalizeState(value: unknown, action = 'validate'): Partial<FinanceWorkflowState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  const workflowKind = inferWorkflowKind(input)
  const creating = action === 'create'
  const saving = action === 'save'
  const requiredArtifacts = objectList(input.requiredArtifacts) ??
    (creating ? defaultRequiredArtifacts(workflowKind) : undefined)
  const requiredVerifier = objectValue(input.requiredVerifier) ??
    (creating ? defaultRequiredVerifier(workflowKind) : undefined)
  return {
    contract: 'finance-workflow-state-v1',
    workflowKind,
    assetClass: normalizeEnum(input.assetClass || (creating ? 'unknown' : '')) as FinanceAssetClass,
    intentMode: normalizeEnum(input.intentMode || ((creating || saving) ? defaultIntentMode(workflowKind, input) : '')) as FinanceIntentMode,
    executionMode: normalizeEnum(input.executionMode || (creating ? defaultExecutionMode(workflowKind) : '')) as FinanceExecutionMode,
    safetyBoundary: String(input.safetyBoundary ?? (creating ? defaultSafetyBoundary(workflowKind) : '')).trim(),
    evidenceRefs: normalizedEvidenceRefs(input, creating || saving),
    confirmationState: normalizeEnum(input.confirmationState || (creating ? 'none' : '')) as FinanceConfirmationState,
    subject: optionalString(input.subject),
    subjects: stringList(input.subjects),
    source: optionalString(input.source) ?? 'agent-structured-intent',
    updatedAt: optionalString(input.updatedAt),
    hasUnsupportedExecutableParts: input.hasUnsupportedExecutableParts === true,
    blockedTools: stringList(input.blockedTools),
    requiredArtifacts,
    requiredVerifier,
  }
}

function normalizedEvidenceRefs(input: Record<string, unknown>, creating: boolean): string[] {
  const explicit = stringList(input.evidenceRefs)
  if (explicit.length > 0) return explicit
  if (!creating) return []
  const required = stringList(input.requiredEvidence)
  if (required.length > 0) return required
  const confirmationState = normalizeEnum(input.confirmationState)
  if (confirmationState && confirmationState !== 'none') return [`approval_state:${confirmationState}`]
  return ['workflow_request']
}

function defaultIntentMode(kind: FinanceWorkflowKind, input: Record<string, unknown>): FinanceIntentMode | '' {
  const confirmationState = normalizeEnum(input.confirmationState)
  if ((kind === 'trade_prep' || kind === 'trade_preparation') && confirmationState === 'denied') return 'size'
  if (kind === 'macro_factor_lookup') return 'review'
  return 'unknown'
}

function defaultExecutionMode(kind: FinanceWorkflowKind): FinanceExecutionMode {
  if (kind === 'watchlist_handoff') return 'watchlist'
  if (kind === 'strategy_design' || kind === 'strategy_review' || kind === 'strategy_rerun') return 'preview_only'
  if (kind === 'trade_prep' || kind === 'trade_preparation') return 'preview_only'
  return 'none'
}

function defaultSafetyBoundary(kind: FinanceWorkflowKind): string {
  if (kind === 'macro_factor_lookup') return 'macro evidence is context and invalidation input, not a direct buy/sell rule'
  if (kind === 'trade_prep' || kind === 'trade_preparation') return 'read-only sizing; no order or transfer without explicit later confirmation'
  if (kind === 'watchlist_handoff') return 'observation-state mutation only; no order or broker side effect'
  if (kind === 'strategy_design' || kind === 'strategy_review' || kind === 'strategy_rerun') return 'strategy evidence only until validated and explicitly confirmed'
  return 'analysis only; no external side effect'
}

function defaultRequiredArtifacts(kind: FinanceWorkflowKind): Array<Record<string, unknown>> | undefined {
  if (kind !== 'macro_factor_lookup') return undefined
  return [
    {
      kindAnyOf: ['report', 'dashboard'],
      requiredFields: ['topic', 'sourceDataTime', 'fetchedAt', 'missingEvidence', 'confidenceEffect', 'affectedAssets'],
    },
  ]
}

function defaultRequiredVerifier(kind: FinanceWorkflowKind): Record<string, unknown> | undefined {
  if (kind === 'macro_factor_lookup') {
    return { tool: 'WorkflowVerifier', action: 'check', workflow: 'macro_factor_lookup' }
  }
  if (kind === 'trade_preparation' || kind === 'trade_prep') {
    return { tool: 'WorkflowVerifier', action: 'check', workflow: 'trade_preparation' }
  }
  return undefined
}

function validateState(state: Partial<FinanceWorkflowState>): string[] {
  const errors: string[] = []
  if (state.contract !== 'finance-workflow-state-v1') errors.push('contract must be finance-workflow-state-v1')
  if (!WORKFLOW_KINDS.includes(state.workflowKind as FinanceWorkflowKind)) errors.push(`workflowKind must be one of ${WORKFLOW_KINDS.join(', ')}`)
  if (!ASSET_CLASSES.includes(state.assetClass as FinanceAssetClass)) errors.push(`assetClass must be one of ${ASSET_CLASSES.join(', ')}`)
  if (!INTENT_MODES.includes(state.intentMode as FinanceIntentMode)) errors.push(`intentMode must be one of ${INTENT_MODES.join(', ')}`)
  if (!EXECUTION_MODES.includes(state.executionMode as FinanceExecutionMode)) errors.push(`executionMode must be one of ${EXECUTION_MODES.join(', ')}`)
  if (!CONFIRMATION_STATES.includes(state.confirmationState as FinanceConfirmationState)) errors.push(`confirmationState must be one of ${CONFIRMATION_STATES.join(', ')}`)
  if (!state.safetyBoundary) errors.push('safetyBoundary is required')
  if (!Array.isArray(state.evidenceRefs) || state.evidenceRefs.length === 0) errors.push('evidenceRefs must contain at least one evidence key')
  return errors
}

function inferWorkflowKind(input: Record<string, unknown>): FinanceWorkflowKind {
  const explicit = normalizeEnum(input.workflowKind)
  if (WORKFLOW_KINDS.includes(explicit as FinanceWorkflowKind)) return explicit as FinanceWorkflowKind
  const requiredVerifier = objectValue(input.requiredVerifier)
  const verifierWorkflow = normalizeEnum(requiredVerifier?.workflow)
  if (verifierWorkflow === 'trade_preparation') return 'trade_preparation'
  if (verifierWorkflow === 'macro_factor_lookup') return 'macro_factor_lookup'
  if (WORKFLOW_KINDS.includes(verifierWorkflow as FinanceWorkflowKind)) return verifierWorkflow as FinanceWorkflowKind
  return explicit as FinanceWorkflowKind
}

function normalizeEnum(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    .replace(/^_/, '')
}

function optionalString(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  return text ? text : undefined
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))]
}

function objectList(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined
  const rows = value.filter((item): item is Record<string, unknown> =>
    !!item && typeof item === 'object' && !Array.isArray(item),
  )
  return rows.length > 0 ? rows : undefined
}

type WorkflowStateStatus = 'active' | 'blocked' | 'complete' | 'cancelled'

interface WorkflowStateRecord {
  id: string
  contract: 'workflow-state-record-v1'
  status: WorkflowStateStatus
  workflowState: FinanceWorkflowState
  requiredEvidence: string[]
  completedSteps: string[]
  generatedArtifacts: string[]
  pendingUserQuestion?: Record<string, unknown>
  pendingApproval?: Record<string, unknown>
  blocker?: string
  updatedAt: string
}

function saveState(ctx: ToolContext, input: Record<string, unknown>, workflowState: FinanceWorkflowState): Record<string, unknown> {
  const store = readStore(ctx)
  const now = new Date().toISOString()
  const id = optionalString(input.id) ?? stateId(workflowState, now)
  const record: WorkflowStateRecord = {
    id,
    contract: 'workflow-state-record-v1',
    status: parseStatus(input.status),
    workflowState,
    requiredEvidence: stringList(input.requiredEvidence),
    completedSteps: stringList(input.completedSteps),
    generatedArtifacts: stringList(input.generatedArtifacts),
    pendingUserQuestion: objectValue(input.pendingUserQuestion),
    pendingApproval: objectValue(input.pendingApproval),
    blocker: optionalString(input.blocker),
    updatedAt: now,
  }
  const records = [record, ...store.records.filter((item) => item.id !== id)]
  writeStore(ctx, records)
  return {
    contract: 'workflow-state-record-v1',
    record,
    usage: 'Use FinanceWorkflowState(action:"current") or action:"get" to resume typed workflow state in later turns.',
  }
}

function listStates(ctx: ToolContext, input: Record<string, unknown>): Record<string, unknown> {
  const limit = Math.max(1, Math.min(100, Number(input.limit ?? 20) || 20))
  const workflowKind = optionalString(input.workflowKind)
  const records = readStore(ctx).records
    .filter((record) => !workflowKind || record.workflowState.workflowKind === workflowKind)
    .slice(0, limit)
  return {
    contract: 'workflow-state-list-v1',
    count: records.length,
    workflowKind,
    records,
  }
}

function getState(ctx: ToolContext, input: Record<string, unknown>, current: boolean): Record<string, unknown> {
  const records = readStore(ctx).records
  const id = optionalString(input.id)
  const record = current
    ? records.find((item) => item.status === 'active') ?? records[0]
    : records.find((item) => item.id === id)
  if (!record) {
    throw new Error(current
      ? 'No saved workflow state. Use FinanceWorkflowState(action:"save") after creating typed state.'
      : 'FinanceWorkflowState(action:"get") requires an existing id. Use action="list" first.')
  }
  return {
    contract: 'workflow-state-record-v1',
    record,
  }
}

function readStore(ctx: ToolContext): { records: WorkflowStateRecord[] } {
  const file = storePath(ctx)
  if (!existsSync(file)) return { records: [] }
  try {
    const decoded = JSON.parse(readFileSync(file, 'utf8')) as { records?: unknown }
    return {
      records: Array.isArray(decoded.records)
        ? decoded.records.filter(isWorkflowStateRecord)
        : [],
    }
  } catch {
    return { records: [] }
  }
}

function writeStore(ctx: ToolContext, records: WorkflowStateRecord[]): void {
  const file = storePath(ctx)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ contract: 'workflow-state-store-v1', records }, null, 2)}\n`)
}

function storePath(ctx: ToolContext): string {
  return join(ctx.memoryDir, 'workflows', 'state.json')
}

function isWorkflowStateRecord(value: unknown): value is WorkflowStateRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<WorkflowStateRecord>
  return record.contract === 'workflow-state-record-v1' &&
    typeof record.id === 'string' &&
    typeof record.updatedAt === 'string' &&
    !!stateFromUnknown(record.workflowState)
}

function stateFromUnknown(value: unknown): FinanceWorkflowState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const state = value as Partial<FinanceWorkflowState>
  return state.contract === 'finance-workflow-state-v1' ? state as FinanceWorkflowState : null
}

function stateId(state: FinanceWorkflowState, now: string): string {
  const subject = optionalString(state.subject) ?? state.subjects?.join('-')
  const suffix = now.replace(/[^0-9]/g, '')
  return ['workflow', state.workflowKind, state.intentMode, subject, suffix]
    .filter(Boolean)
    .join('-')
}

function parseStatus(value: unknown): WorkflowStateStatus {
  const text = String(value ?? 'active').trim()
  return ['active', 'blocked', 'complete', 'cancelled'].includes(text)
    ? text as WorkflowStateStatus
    : 'active'
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
