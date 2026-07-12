import { Role, type Message, type ToolResult, type ToolUse } from '../../../agent/message'

export type FinanceWorkflowKind =
  | 'market_analysis'
  | 'stock_research'
  | 'stock_selection'
  | 'fund_research'
  | 'strategy_design'
  | 'strategy_review'
  | 'strategy_rerun'
  | 'trade_prep'
  | 'trade_preparation'
  | 'trade_review'
  | 'watchlist_handoff'
  | 'monitor_review'
  | 'macro_factor_lookup'
  | 'evidence_review'
  | 'unknown'

export type FinanceAssetClass = 'stock' | 'fund' | 'portfolio' | 'mixed' | 'unknown'
export type FinanceIntentMode = 'analysis' | 'validate' | 'backtest' | 'save' | 'rerun' | 'observe' | 'watchlist_add' | 'size' | 'confirm' | 'review' | 'unknown'
export type FinanceExecutionMode = 'none' | 'preview_only' | 'watchlist' | 'backtest' | 'requires_confirmation' | 'paper_allowed_after_confirmation' | 'blocked' | 'unknown'
export type FinanceConfirmationState = 'none' | 'pending' | 'answered' | 'denied' | 'accepted' | 'unknown'

export interface FinanceWorkflowState {
  contract: 'finance-workflow-state-v1'
  workflowKind: FinanceWorkflowKind
  assetClass: FinanceAssetClass
  intentMode: FinanceIntentMode
  executionMode: FinanceExecutionMode
  safetyBoundary: string
  evidenceRefs: string[]
  confirmationState: FinanceConfirmationState
  subject?: string
  subjects?: string[]
  updatedAt?: string
  source: string
  hasUnsupportedExecutableParts?: boolean
  blockedTools?: string[]
  requiredArtifacts?: Array<Record<string, unknown>>
  requiredVerifier?: Record<string, unknown>
}

export function latestFinanceWorkflowState(messages: Message[], turnStartIndex = 0): FinanceWorkflowState | null {
  return latestFinanceWorkflowStateWhere(messages, turnStartIndex)
}

export function latestTradePrepWorkflowState(messages: Message[], turnStartIndex = 0): FinanceWorkflowState | null {
  return latestFinanceWorkflowStateWhere(
    messages,
    turnStartIndex,
    (state) => state.workflowKind === 'trade_prep',
  )
}

function latestFinanceWorkflowStateWhere(
  messages: Message[],
  turnStartIndex = 0,
  predicate?: (state: FinanceWorkflowState) => boolean,
): FinanceWorkflowState | null {
  const states: FinanceWorkflowState[] = []
  for (const message of messages.slice(Math.max(0, turnStartIndex))) {
    if (message.role === Role.User) {
      const state = financeWorkflowStateFromUserContent(message.content)
      if (state && (!predicate || predicate(state))) states.push(state)
    }
    if (message.role === Role.Assistant) {
      for (const call of message.toolUses ?? []) {
        const state = financeWorkflowStateFromToolCall(call)
        if (state && (!predicate || predicate(state))) states.push(state)
      }
    }
    if (message.role === Role.Tool && message.toolResult && !message.toolResult.isError) {
      const state = financeWorkflowStateFromToolResult(message.toolResult)
      if (state && (!predicate || predicate(state))) states.push(state)
    }
  }
  return states.at(-1) ?? null
}

export function financeWorkflowStateFromUserContent(content: string): FinanceWorkflowState | null {
  const direct = jsonObject(content)
  const explicit = stateFromUnknown(direct?.workflowState)
  if (explicit) return explicit
  const marker = content.lastIndexOf('data:')
  if (marker < 0) return null
  const payload = jsonObject(content.slice(marker + 'data:'.length))
  if (!payload) return null
  const embedded = stateFromUnknown(payload.workflowState)
  if (embedded) return embedded
  if (payload.template === 'strategy_signal') {
    return {
      contract: 'finance-workflow-state-v1',
      workflowKind: 'trade_prep',
      assetClass: 'stock',
      intentMode: 'size',
      executionMode: payload.confirmationRequired === true ? 'requires_confirmation' : 'preview_only',
      safetyBoundary: payload.confirmationRequired === true ? 'confirmation required before execution' : 'strategy signal sizing evidence',
      evidenceRefs: ['strategy_signal'],
      confirmationState: payload.confirmationRequired === true ? 'pending' : 'none',
      subject: subjectFromPayload(payload),
      subjects: subjectsFromPayload(payload),
      updatedAt: new Date().toISOString(),
      source: 'user-data:strategy_signal',
    }
  }
  return null
}

export function isTradeSizingWorkflowState(state: FinanceWorkflowState | null): boolean {
  return state?.workflowKind === 'trade_prep' &&
    (state.intentMode === 'size' || state.intentMode === 'confirm')
}

export function isTradeConfirmationWorkflowState(state: FinanceWorkflowState | null): boolean {
  return state?.workflowKind === 'trade_prep' &&
    (state.executionMode === 'requires_confirmation' ||
      state.confirmationState === 'pending' ||
      state.confirmationState === 'answered')
}

export function financeWorkflowStateFromToolCall(call: ToolUse): FinanceWorkflowState | null {
  const explicit = stateFromUnknown(call.input.workflowState)
  if (explicit) return explicit
  if (call.name !== 'MarketData' && call.name !== 'Portfolio') return null
  const action = String(call.input.action ?? '')
  if (!action.startsWith('custom_strategy_')) return null
  if (action === 'custom_strategy_help' || action === 'custom_strategy_list') return null
  const intentMode: FinanceIntentMode =
    action === 'custom_strategy_validate' ? 'validate' :
    action === 'custom_strategy_backtest' || action === 'custom_strategy_fund_backtest' || action === 'custom_strategy_rank' ? 'backtest' :
    action === 'custom_strategy_save' ? 'save' :
    action === 'custom_strategy_compare' ? 'review' :
    action === 'custom_strategy_run' ? 'rerun' :
    action === 'custom_strategy_observe' ? 'observe' :
    'unknown'
  return {
    contract: 'finance-workflow-state-v1',
    workflowKind: 'strategy_design',
    assetClass: assetClassFromSpec(call.input.strategySpec),
    intentMode,
    executionMode: 'preview_only',
    safetyBoundary: strategySafetyBoundary(intentMode),
    evidenceRefs: [action],
    confirmationState: 'none',
    subject: subjectFromPayload(call.input),
    subjects: subjectsFromPayload(call.input),
    updatedAt: new Date().toISOString(),
    source: `tool-call:${call.name}.${action}`,
  }
}

export function financeWorkflowStateFromToolResult(result: ToolResult): FinanceWorkflowState | null {
  const payload = jsonObject(result.content)
  if (!payload) return null
  const explicit = stateFromUnknown(payload.workflowState)
  if (explicit) return explicit
  if (payload.contract === 'trade-prep-v1') {
    return {
      contract: 'finance-workflow-state-v1',
      workflowKind: 'trade_prep',
      assetClass: 'stock',
      intentMode: 'size',
      executionMode: 'requires_confirmation',
      safetyBoundary: 'trade preparation only',
      evidenceRefs: ['trade-prep-v1'],
      confirmationState: 'pending',
      subject: subjectFromPayload(payload),
      subjects: subjectsFromPayload(payload),
      updatedAt: new Date().toISOString(),
      source: 'tool-result:trade-prep-v1',
    }
  }
  const action = String(payload.action ?? '')
  if (!action.startsWith('custom_strategy_')) return null
  if (action === 'custom_strategy_help' || action === 'custom_strategy_list') return null
  const intentMode: FinanceIntentMode =
    action === 'custom_strategy_validate' ? 'validate' :
    action === 'custom_strategy_backtest' || action === 'custom_strategy_fund_backtest' || action === 'custom_strategy_rank' ? 'backtest' :
    action === 'custom_strategy_save' ? 'save' :
    action === 'custom_strategy_compare' ? 'review' :
    action === 'custom_strategy_run' ? 'rerun' :
    action === 'custom_strategy_observe' ? 'observe' :
    'unknown'
  const rejected = String(payload.status ?? '') === 'rejected'
  return {
    contract: 'finance-workflow-state-v1',
    workflowKind: 'strategy_review',
    assetClass: assetClassFromSpec(payload.spec ?? payload.normalizedSpec),
    intentMode,
    executionMode: rejected ? 'blocked' : 'preview_only',
    safetyBoundary: rejected ? 'unsupported strategy parts' : 'strategy evidence only',
    evidenceRefs: [action],
    confirmationState: 'none',
    subject: subjectFromPayload(payload),
    subjects: subjectsFromPayload(payload),
    updatedAt: new Date().toISOString(),
    source: `tool-result:${action}`,
    hasUnsupportedExecutableParts: hasUnsupportedParts(payload),
  }
}

export function isStrategyState(state: FinanceWorkflowState | null): boolean {
  return state?.workflowKind === 'strategy_design' || state?.workflowKind === 'strategy_review'
}

export function isEvidenceReviewWorkflowState(state: FinanceWorkflowState | null): boolean {
  return state?.workflowKind === 'evidence_review' && state.intentMode === 'review'
}

function stateFromUnknown(value: unknown): FinanceWorkflowState | null {
  if (!value) return null
  if (typeof value === 'object' && !Array.isArray(value)) {
    const candidate = value as Partial<FinanceWorkflowState>
    return candidate.contract === 'finance-workflow-state-v1'
      ? candidate as FinanceWorkflowState
      : null
  }
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    const decoded = jsonObject(value)
    return decoded?.contract === 'finance-workflow-state-v1'
      ? decoded as unknown as FinanceWorkflowState
      : null
  }
  return null
}

function jsonObject(content: string): Record<string, unknown> | null {
  try {
    const decoded = JSON.parse(content)
    return decoded && typeof decoded === 'object' && !Array.isArray(decoded)
      ? decoded as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function strategySafetyBoundary(intentMode: FinanceIntentMode): string {
  if (intentMode === 'validate') return 'read-only validation'
  if (intentMode === 'backtest') return 'read-only backtest evidence'
  if (intentMode === 'save') return 'save strategy artifact only'
  if (intentMode === 'rerun') return 'reuse saved strategy artifact'
  if (intentMode === 'observe') return 'observation evidence only'
  return 'strategy evidence only'
}

function assetClassFromSpec(spec: unknown): FinanceAssetClass {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return 'unknown'
  const value = String((spec as Record<string, unknown>).assetClass ?? (spec as Record<string, unknown>).market ?? '').toLowerCase()
  if (value === 'fund') return 'fund'
  if (value === 'stock' || value === 'a_share') return 'stock'
  return 'unknown'
}

function subjectFromPayload(payload: Record<string, unknown>): string | undefined {
  for (const key of ['symbol', 'code', 'fundCode', 'strategyId']) {
    const value = String(payload[key] ?? '').trim()
    if (value) return value
  }
  const symbols = payload.symbols
  return Array.isArray(symbols) && symbols.length > 0 ? String(symbols[0]) : undefined
}

function subjectsFromPayload(payload: Record<string, unknown>): string[] | undefined {
  const symbols = payload.symbols
  if (!Array.isArray(symbols)) return undefined
  const values = symbols
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
  return values.length > 0 ? [...new Set(values)] : undefined
}

function hasUnsupportedParts(payload: Record<string, unknown>): boolean {
  for (const key of ['errors', 'unsupported', 'unsupportedDetails']) {
    const value = payload[key]
    if (Array.isArray(value) && value.length > 0) return true
    if (typeof value === 'string' && value.trim()) return true
  }
  return false
}
