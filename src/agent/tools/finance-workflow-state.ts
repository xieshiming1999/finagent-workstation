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
  'fund_research',
  'strategy_design',
  'strategy_review',
  'trade_prep',
  'monitor_review',
  'evidence_review',
  'unknown',
]
const ASSET_CLASSES: FinanceAssetClass[] = ['stock', 'fund', 'portfolio', 'mixed', 'unknown']
const INTENT_MODES: FinanceIntentMode[] = ['analysis', 'validate', 'backtest', 'save', 'rerun', 'observe', 'size', 'confirm', 'review', 'unknown']
const EXECUTION_MODES: FinanceExecutionMode[] = ['none', 'preview_only', 'requires_confirmation', 'paper_allowed_after_confirmation', 'blocked', 'unknown']
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
    const state = action === 'validate' || action === 'save'
      ? normalizeState(input.workflowState)
      : normalizeState(input)
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
  }
}

function normalizeState(value: unknown): Partial<FinanceWorkflowState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  return {
    contract: 'finance-workflow-state-v1',
    workflowKind: normalizeEnum(input.workflowKind) as FinanceWorkflowKind,
    assetClass: normalizeEnum(input.assetClass) as FinanceAssetClass,
    intentMode: normalizeEnum(input.intentMode) as FinanceIntentMode,
    executionMode: normalizeEnum(input.executionMode) as FinanceExecutionMode,
    safetyBoundary: String(input.safetyBoundary ?? '').trim(),
    evidenceRefs: stringList(input.evidenceRefs),
    confirmationState: normalizeEnum(input.confirmationState) as FinanceConfirmationState,
    subject: optionalString(input.subject),
    subjects: stringList(input.subjects),
    source: optionalString(input.source) ?? 'agent-structured-intent',
    updatedAt: optionalString(input.updatedAt),
    hasUnsupportedExecutableParts: input.hasUnsupportedExecutableParts === true,
    blockedTools: stringList(input.blockedTools),
  }
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

function normalizeEnum(value: unknown): string {
  return String(value ?? '').trim().replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, '')
}

function optionalString(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  return text ? text : undefined
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))]
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
