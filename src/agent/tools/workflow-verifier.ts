import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ArtifactRegistry, type ArtifactKind } from '../artifact-registry'
import type { Tool, ToolContext } from '../tool'

type WorkflowSpec = {
  requiredAnyTools: string[]
  artifactKinds: ArtifactKind[]
  artifactRequired?: boolean
  approvalBoundary: 'no_trade' | 'explicit_approval_required'
  macroEvidenceRecord?: boolean
}

type SessionEvidence = {
  toolCallCount: number
  toolErrorCount: number
  toolNames: string[]
  calls: ToolCallEvidence[]
}

type ToolCallEvidence = {
  name: string
  input: Record<string, unknown>
  result?: string
  isError?: boolean
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
    artifactRequired: false,
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
    artifactRequired: false,
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
      strategyId: {
        type: 'string',
        description: 'Optional saved StrategySpec id expected in strategy_rerun evidence.',
      },
      targetSymbols: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional target symbols expected in custom_strategy_run evidence.',
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
      strategyId: optionalString(input.strategyId),
      targetSymbols: stringList(input.targetSymbols),
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
      strategyId?: string
      targetSymbols: string[]
      limit: number
  },
): Record<string, unknown> {
  const session = readSession(ctx, input.limit)
  const pending = pendingInteractionsForSession(session)
  const artifactEvidence = artifactEvidenceFor(ctx, input.spec, input.artifactId)
  const workflowStateEvidence = workflowStateEvidenceFor(ctx, {
    workflow: input.workflow,
    workflowStateId: input.workflowStateId,
    required: input.requireWorkflowState || !!input.workflowStateId,
  })
  const providerHealthEvidence = providerHealthEvidenceFor(input.providerHealth)
  const workflowSpecificEvidence = workflowSpecificEvidenceFor(input.workflow, session, {
    strategyId: input.strategyId,
    targetSymbols: input.targetSymbols,
  })
  const workflowSpecificPassed = workflowSpecificEvidence.checks.every((item) => item.passed)
  const approvalBoundaryEvidence = approvalBoundaryEvidenceFor(
    input.spec.approvalBoundary,
    input.workflow,
    session,
    pending.length,
  )
  const toolNames = new Set(session.toolNames)
  const usedRequiredTool = input.spec.requiredAnyTools.some((name) => toolNames.has(name))
  const unrecoveredErrors = unrecoveredToolErrors(session, {
    workflow: input.workflow,
    workflowSpecificPassed,
  })
  const checks = [
    check('tool_calls_present', session.toolCallCount > 0, 'At least one tool call is visible.', 'No tool call is visible for this workflow.'),
    check(
      'required_tool_family',
      usedRequiredTool,
      'A required tool family was used.',
      `No required tool family was used. Expected one of: ${input.spec.requiredAnyTools.join(', ')}.`,
    ),
    check(
      'no_tool_errors',
      unrecoveredErrors.length === 0,
      session.toolErrorCount === 0
        ? 'No tool errors are visible.'
        : `${session.toolErrorCount - unrecoveredErrors.length} recovered tool error(s); no unrecovered tool errors remain.`,
      `${unrecoveredErrors.length} unrecovered tool error(s) are visible: ${unrecoveredErrors.join('; ')}`,
    ),
    check('no_pending_interactions', pending.length === 0, 'No pending AskUserQuestion or approval is visible.', `${pending.length} pending interaction(s) must be resolved before finalizing.`),
    check('artifact_evidence', artifactEvidence.passed, artifactEvidence.reason, artifactEvidence.reason),
    check(
      'approval_boundary',
      approvalBoundaryEvidence.passed,
      approvalBoundaryEvidence.passedMessage,
      approvalBoundaryEvidence.reason,
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
    ...workflowSpecificEvidence.checks,
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
      approvalBoundary: approvalBoundaryEvidence.observed,
      workflowSpecific: workflowSpecificEvidence.observed,
    },
    nextAction: missing.length === 0
      ? 'Final answer may cite the verified workflow evidence.'
      : `Do not finalize yet. Resolve missing checks: ${missing.join(', ')}.`,
  }
}

function pendingInteractionsForSession(session: SessionEvidence): ToolCallEvidence[] {
  return session.calls.filter((call) => {
    if (call.result !== undefined) return false
    if (call.name === 'AskUserQuestion') return true
    if (call.name === 'Approval' || call.name === 'Permission') return true
    return false
  })
}

function readSession(ctx: ToolContext, limit: number): SessionEvidence {
  const file = join(ctx.basePath, 'sessions', 'current.jsonl')
  if (!existsSync(file)) return { toolCallCount: 0, toolErrorCount: 0, toolNames: [], calls: [] }
  const toolNames = new Set<string>()
  const pendingCalls = new Map<string, ToolCallEvidence>()
  const calls: ToolCallEvidence[] = []
  let toolCallCount = 0
  let toolErrorCount = 0
  for (const line of readFileSync(file, 'utf8').split('\n').slice(-limit)) {
    const text = line.trim()
    if (!text) continue
    try {
      const decoded = JSON.parse(text) as Record<string, unknown>
      if (Array.isArray(decoded.toolUses)) {
        toolCallCount += decoded.toolUses.length
        for (const item of decoded.toolUses) {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const record = item as Record<string, unknown>
            const name = record.name
            if (typeof name === 'string') toolNames.add(name)
            if (typeof name === 'string') {
              const evidence: ToolCallEvidence = {
                name,
                input: objectValue(record.input) ?? {},
              }
              const id = typeof record.id === 'string' ? record.id : ''
              if (id) pendingCalls.set(id, evidence)
              calls.push(evidence)
            }
          }
        }
      }
      const result = decoded.toolResult ?? decoded.tool_result
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        const resultRecord = result as Record<string, unknown>
        const isError = resultRecord.isError === true
        if (isError) toolErrorCount++
        const toolUseId = typeof resultRecord.toolUseId === 'string' ? resultRecord.toolUseId : ''
        const evidence = toolUseId ? pendingCalls.get(toolUseId) : undefined
        if (evidence) {
          evidence.result = typeof resultRecord.content === 'string'
            ? resultRecord.content
            : JSON.stringify(resultRecord.content ?? '')
          evidence.isError = isError
        }
      }
    } catch {
      // Session repair is owned elsewhere.
    }
  }
  return { toolCallCount, toolErrorCount, toolNames: [...toolNames], calls }
}

function workflowSpecificEvidenceFor(workflow: string, session: SessionEvidence, expected: {
  strategyId?: string
  targetSymbols: string[]
}): {
  checks: ReturnType<typeof check>[]
  observed: Record<string, unknown>
} {
  if (workflow === 'fund_selection') return fundSelectionEvidenceFor(session)
  if (workflow === 'watchlist_handoff') return watchlistHandoffEvidenceFor(session)
  if (workflow === 'strategy_rerun') return strategyRerunEvidenceFor(session, expected)
  if (workflow === 'trade_preparation') return tradePreparationEvidenceFor(session)
  return { checks: [], observed: {} }
}

function approvalBoundaryEvidenceFor(
  boundary: WorkflowSpec['approvalBoundary'],
  workflow: string,
  session: SessionEvidence,
  pendingCount: number,
): {
  passed: boolean
  passedMessage: string
  reason: string
  observed: Record<string, unknown>
} {
  if (boundary !== 'explicit_approval_required') {
    return {
      passed: true,
      passedMessage: 'Workflow has no trade approval boundary.',
      reason: 'Workflow has no trade approval boundary.',
      observed: { boundary },
    }
  }
  if (workflow !== 'trade_preparation') {
    return {
      passed: pendingCount > 0,
      passedMessage: 'Explicit approval or user question is pending.',
      reason: 'Workflow requires explicit approval evidence before any side-effect.',
      observed: { boundary, pendingInteractions: pendingCount },
    }
  }
  const tradeEvidence = tradePreparationEvidenceFor(session)
  const sideEffect = tradeEvidence.observed.sideEffectCalls as unknown[]
  const sizing = tradeEvidence.observed.sizingEvidence === true
  const account = tradeEvidence.observed.accountEvidence === true
  const passed = sideEffect.length === 0 && sizing && account
  return {
    passed,
    passedMessage: 'Trade-preparation boundary is satisfied: account/sizing evidence exists and no order side-effect is visible.',
    reason: sideEffect.length > 0
      ? `Trade-preparation has order side-effect calls: ${sideEffect.join(', ')}.`
      : 'Trade-preparation needs account evidence and sizing/quote evidence while avoiding order side-effect calls.',
    observed: tradeEvidence.observed,
  }
}

function tradePreparationEvidenceFor(session: SessionEvidence): {
  checks: ReturnType<typeof check>[]
  observed: Record<string, unknown>
} {
  const accountCalls = session.calls.filter((call) => {
    if (call.isError) return false
    if (call.name === 'XueqiuTrade') return ['balance', 'portfolios', 'positions', 'history'].includes(String(call.input.action ?? ''))
    if (call.name === 'Portfolio') return ['snapshot', 'positions'].includes(String(call.input.action ?? ''))
    return false
  })
  const sizingCalls = session.calls.filter((call) => {
    if (call.isError) return false
    const action = String(call.input.action ?? '')
    if (call.name === 'MarketData' && ['quote', 'query_quote'].includes(action)) return true
    if (call.name === 'DataStore' && action === 'query_quote') return true
    if (call.name === 'DataProcess' && ['position_sizing', 'risk_sizing', 'indicators', 'support'].includes(action)) return true
    if (call.name === 'Portfolio' && ['preview_trade', 'position_sizing'].includes(action)) return true
    return false
  })
  const sideEffectCalls = session.calls.filter(isTradeSideEffectCall).map((call) => {
    const action = String(call.input.action ?? '')
    return action ? `${call.name}.${action}` : call.name
  })
  return {
    checks: [
      check(
        'trade_account_evidence',
        accountCalls.length > 0,
        'Simulated account or portfolio state evidence is visible.',
        'Trade preparation needs simulated account/portfolio state before sizing.',
      ),
      check(
        'trade_sizing_evidence',
        sizingCalls.length > 0,
        'Sizing, quote, or risk evidence is visible.',
        'Trade preparation needs quote/sizing/risk evidence before finalizing.',
      ),
      check(
        'trade_no_side_effect',
        sideEffectCalls.length === 0,
        'No simulated order or cash-transfer side-effect call is visible.',
        `Trade preparation must not include order/cash-transfer side effects: ${sideEffectCalls.join(', ')}.`,
      ),
    ],
    observed: {
      accountEvidence: accountCalls.length > 0,
      sizingEvidence: sizingCalls.length > 0,
      sideEffectCalls,
      accountCalls: accountCalls.map(summarizeCall),
      sizingCalls: sizingCalls.map(summarizeCall),
    },
  }
}

function isTradeSideEffectCall(call: ToolCallEvidence): boolean {
  const action = String(call.input.action ?? '').trim().toLowerCase()
  if (call.name === 'XueqiuTrade') {
    return new Set(['buy', 'sell', 'transfer_in', 'transfer_out', 'bank_transfer', 'add_transaction', 'transaction_add']).has(action)
  }
  if (call.name === 'Portfolio') {
    return new Set(['trade', 'buy', 'sell', 'transfer']).has(action)
  }
  return false
}

function watchlistHandoffEvidenceFor(session: SessionEvidence): {
  checks: ReturnType<typeof check>[]
  observed: Record<string, unknown>
} {
  const addCalls = session.calls.filter((call) =>
    !call.isError &&
    call.name === 'Watchlist' &&
    String(call.input.action ?? '') === 'add'
  )
  const readbackCalls = session.calls.filter((call) => {
    if (call.isError || call.name !== 'Watchlist') return false
    return ['list', 'get', 'readback'].includes(String(call.input.action ?? ''))
  })
  const conditionCalls = addCalls.filter((call) => {
    const input = call.input
    return hasText(input.entryCondition) ||
      hasText(input.exitCondition) ||
      input.targetEntryPrice !== undefined ||
      input.stopLoss !== undefined ||
      input.targetPrice !== undefined ||
      Array.isArray(input.conditions)
  })
  const sourceCalls = addCalls.filter((call) => {
    const input = call.input
    return hasText(input.source) ||
      hasText(input.sourceTime) ||
      hasText(input.fetchedAt) ||
      hasText(input.strategyId) ||
      hasText(input.score) ||
      hasText(input.rating)
  })
  const sideEffectCalls = session.calls.filter(isTradeSideEffectCall).map((call) => {
    const action = String(call.input.action ?? '')
    return action ? `${call.name}.${action}` : call.name
  })
  return {
    checks: [
      check(
        'watchlist_add_evidence',
        addCalls.length > 0,
        'Watchlist add evidence is visible.',
        'Watchlist handoff needs Watchlist(action:"add") evidence before finalizing.',
      ),
      check(
        'watchlist_readback_evidence',
        readbackCalls.length > 0,
        'Watchlist readback evidence is visible.',
        'Watchlist handoff needs Watchlist(action:"list"|"get"|"readback") after mutation before finalizing.',
      ),
      check(
        'watchlist_condition_evidence',
        conditionCalls.length > 0,
        'Watchlist condition evidence is visible.',
        'Watchlist handoff needs structured observation conditions such as entryCondition, exitCondition, targetEntryPrice, stopLoss, targetPrice, or conditions[].',
      ),
      check(
        'watchlist_source_evidence',
        sourceCalls.length > 0,
        'Watchlist source/provenance evidence is visible.',
        'Watchlist handoff needs source, sourceTime/fetchedAt, strategyId, score, or rating evidence on the added item.',
      ),
      check(
        'watchlist_no_trade_side_effect',
        sideEffectCalls.length === 0,
        'No trade side-effect call is visible.',
        `Watchlist handoff must not include trade side effects: ${sideEffectCalls.join(', ')}.`,
      ),
    ],
    observed: {
      added: addCalls.map(summarizeCall),
      readback: readbackCalls.map(summarizeCall),
      conditionEvidence: conditionCalls.map(summarizeCall),
      sourceEvidence: sourceCalls.map(summarizeCall),
      sideEffectCalls,
    },
  }
}

function fundSelectionEvidenceFor(session: SessionEvidence): {
  checks: ReturnType<typeof check>[]
  observed: Record<string, unknown>
} {
  const fundList = successfulAction(session, 'query_fund_list')
  const performance = successfulAction(session, 'query_fund_performance')
  const navOrYield = successfulAction(session, 'query_fund_nav') || successfulAction(session, 'query_fund_money_yield')
  const holding = successfulAction(session, 'query_fund_holding')
  const macroOnlyCount = session.calls.filter((call) => {
    const action = String(call.input.action ?? '')
    return action.startsWith('query_macro') || action === 'query_finance_news'
  }).length
  return {
    checks: [
      check(
        'fund_identity_evidence',
        !!fundList,
        'Fund identity/category readback is visible.',
        'Fund selection needs query_fund_list evidence before finalizing.',
      ),
      check(
        'fund_return_evidence',
        !!performance || !!navOrYield,
        'Fund return evidence is visible.',
        'Fund selection needs query_fund_performance or NAV/money-yield readback before finalizing.',
      ),
      check(
        'fund_nav_or_yield_evidence',
        !!navOrYield,
        'Fund NAV or money-yield evidence is visible.',
        'Fund selection needs ordinary NAV or money-fund yield evidence before finalizing.',
      ),
      check(
        'fund_holding_or_missing_reason',
        !!holding || !!navOrYield,
        'Fund holding evidence is visible or NAV/yield evidence is enough for a bounded first pass.',
        'Fund selection needs holding evidence or an explicit missing-holding reason before finalizing.',
      ),
      check(
        'fund_primary_evidence_not_macro_only',
        !!fundList && !!navOrYield && macroOnlyCount < session.toolCallCount,
        'Fund evidence is primary; macro/news evidence may be secondary context.',
        'Fund selection cannot finalize as a macro/news-only answer. Use fund identity, NAV/yield, performance, risk, data time, fetched-at, provider/cache, and keep macro/news as secondary context.',
      ),
    ],
    observed: {
      fundList: summarizeCall(fundList),
      performance: summarizeCall(performance),
      navOrYield: summarizeCall(navOrYield),
      holding: summarizeCall(holding),
      macroOrNewsCalls: macroOnlyCount,
    },
  }
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function successfulAction(session: SessionEvidence, action: string): ToolCallEvidence | undefined {
  return session.calls.find((call) => {
    if (call.isError) return false
    if (String(call.input.action ?? '') !== action) return false
    const result = call.result ?? ''
    return !result.startsWith('Skipped:')
  })
}

function summarizeCall(call: ToolCallEvidence | undefined): Record<string, unknown> | null {
  if (!call) return null
  return {
    tool: call.name,
    action: call.input.action,
    code: call.input.code ?? call.input.fundCode ?? call.input.symbol,
    resultPreview: (call.result ?? '').slice(0, 220),
  }
}

function strategyRerunEvidenceFor(session: SessionEvidence, expected: {
  strategyId?: string
  targetSymbols: string[]
}): {
  checks: ReturnType<typeof check>[]
  observed: Record<string, unknown>
} {
  const rerunCalls = successfulActions(session, 'custom_strategy_run')
  const successfulRuns = rerunCalls
    .map((call) => ({ call, payload: parseStrategyRunPayload(call) }))
    .filter((item) => item.payload?.action === 'custom_strategy_run')
  const strategyMatched = !expected.strategyId || successfulRuns.some((item) => {
    const inputId = String(item.call.input.strategyId ?? item.call.input.strategy_id ?? '')
    const outputId = String(item.payload?.strategyId ?? item.payload?.strategy_id ?? '')
    return inputId === expected.strategyId || outputId === expected.strategyId
  })
  const missingTargets = expected.targetSymbols.filter((symbol) => !successfulRuns.some((item) => {
    const observed = observedSymbolsForStrategyRun(item.call, item.payload)
    return observed.has(normalizeSymbol(symbol))
  }))
  return {
    checks: [
      check(
        'strategy_rerun_call',
        successfulRuns.length > 0,
        'A successful custom_strategy_run result is visible.',
        'Strategy rerun needs MarketData(action:"custom_strategy_run") evidence before finalizing.',
      ),
      check(
        'strategy_rerun_strategy_identity',
        strategyMatched,
        expected.strategyId
          ? `custom_strategy_run evidence matches strategyId ${expected.strategyId}.`
          : 'No specific strategyId was required for this check.',
        `custom_strategy_run evidence does not match required strategyId ${expected.strategyId}.`,
      ),
      check(
        'strategy_rerun_target_symbols',
        missingTargets.length === 0,
        expected.targetSymbols.length > 0
          ? `custom_strategy_run evidence covers target symbol(s): ${expected.targetSymbols.join(', ')}.`
          : 'No specific target symbol was required for this check.',
        `custom_strategy_run evidence is missing target symbol(s): ${missingTargets.join(', ')}.`,
      ),
    ],
    observed: {
      expectedStrategyId: expected.strategyId ?? null,
      expectedTargetSymbols: expected.targetSymbols,
      runs: successfulRuns.map((item) => ({
        input: item.call.input,
        strategyId: item.payload?.strategyId ?? item.payload?.strategy_id ?? null,
        action: item.payload?.action ?? null,
        code: item.payload?.code ?? item.payload?.symbol ?? null,
        dataCoverage: objectValue(item.payload?.dataCoverage) ?? null,
      })),
    },
  }
}

function successfulActions(session: SessionEvidence, action: string): ToolCallEvidence[] {
  return session.calls.filter((call) => {
    if (call.isError) return false
    if (String(call.input.action ?? '') !== action) return false
    const result = call.result ?? ''
    return !result.startsWith('Skipped:')
  })
}

function parseJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined
  try {
    const decoded = JSON.parse(value)
    return objectValue(decoded)
  } catch {
    return undefined
  }
}

function observedSymbolsForStrategyRun(call: ToolCallEvidence, payload: Record<string, unknown> | undefined): Set<string> {
  const symbols = new Set<string>()
  for (const value of [
    call.input.code,
    call.input.symbol,
    payload?.code,
    payload?.symbol,
    objectValue(payload?.dataCoverage)?.symbol,
  ]) {
    const normalized = normalizeSymbol(value)
    if (normalized) symbols.add(normalized)
  }
  for (const value of [call.input.codes, call.input.symbols]) {
    for (const item of stringList(value)) {
      const normalized = normalizeSymbol(item)
      if (normalized) symbols.add(normalized)
    }
  }
  return symbols
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
      return 'macro_factor_lookup'
    default:
      return 'unknown'
  }
}

function unrecoveredToolErrors(session: SessionEvidence, options: {
  workflow: string
  workflowSpecificPassed: boolean
}): string[] {
  const failures: string[] = []
  for (let index = 0; index < session.calls.length; index++) {
    const call = session.calls[index]
    if (!call.isError) continue
    if (isRecoveredByWorkflowEvidence(call, options)) continue
    const action = String(call.input.action ?? '')
    const recovered = session.calls.slice(index + 1).some((later) =>
      !later.isError &&
      later.name === call.name &&
      String(later.input.action ?? '') === action
    )
    if (!recovered) failures.push(action ? `${call.name}.${action}` : call.name)
  }
  return failures
}

function isRecoveredByWorkflowEvidence(call: ToolCallEvidence, options: {
  workflow: string
  workflowSpecificPassed: boolean
}): boolean {
  if (!options.workflowSpecificPassed) return false
  if (options.workflow !== 'watchlist_handoff') return false
  if (call.name === 'DataStore' || call.name === 'MarketData' || call.name === 'DataProcess' || call.name === 'Research') {
    return true
  }
  return false
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

function parseStrategyRunPayload(call: ToolCallEvidence): Record<string, unknown> {
  const parsed = parseJsonObject(call.result)
  if (parsed?.action === 'custom_strategy_run') return parsed
  const result = call.result ?? ''
  return {
    action: 'custom_strategy_run',
    strategyId: call.input.strategyId ?? result.match(/"strategyId"\s*:\s*"([^"]+)"/)?.[1],
    strategy_id: call.input.strategy_id,
    code: call.input.code ?? call.input.symbol ?? firstInputSymbol(call.input) ??
      result.match(/"code"\s*:\s*"([^"]+)"/)?.[1] ??
      result.match(/"symbol"\s*:\s*"([^"]+)"/)?.[1],
  }
}

function firstInputSymbol(input: Record<string, unknown>): string | undefined {
  const symbols = input.symbols
  return Array.isArray(symbols) && symbols.length > 0
    ? String(symbols[0])
    : undefined
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter(Boolean)
}

function normalizeSymbol(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}
