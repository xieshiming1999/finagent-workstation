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
        enum: ['help', 'create', 'validate'],
        description: 'help, create a finance-workflow-state-v1 object, or validate an existing state',
      },
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

  async call(_id: string, input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'help')
    if (action === 'help') return JSON.stringify(help())
    if (action !== 'create' && action !== 'validate') {
      throw new Error(`Invalid FinanceWorkflowState action "${action}". Use action="help" for supported actions.`)
    }
    const state = action === 'validate'
      ? normalizeState(input.workflowState)
      : normalizeState(input)
    const errors = validateState(state)
    if (errors.length > 0) {
      throw new Error(`Invalid finance workflow state: ${errors.join('; ')}. Use FinanceWorkflowState(action:"help") for allowed enum values.`)
    }
    return JSON.stringify({
      contract: 'finance-workflow-state-result-v1',
      action,
      workflowState: {
        ...state,
        updatedAt: state.updatedAt ?? new Date().toISOString(),
      },
      usage: 'Pass this workflowState as a structured tool parameter or embed it as data.workflowState only when a workflow entry point requires user-message state.',
    })
  }
}

function help(): Record<string, unknown> {
  return {
    contract: 'finance-workflow-state-help-v1',
    actions: ['create', 'validate'],
    enums: {
      workflowKind: WORKFLOW_KINDS,
      assetClass: ASSET_CLASSES,
      intentMode: INTENT_MODES,
      executionMode: EXECUTION_MODES,
      confirmationState: CONFIRMATION_STATES,
    },
    requiredForCreate: ['workflowKind', 'assetClass', 'intentMode', 'executionMode', 'confirmationState', 'safetyBoundary', 'evidenceRefs'],
    guidance: 'The agent must choose these typed fields explicitly. Do not infer workflow behavior by matching user prompt text in runtime code.',
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
