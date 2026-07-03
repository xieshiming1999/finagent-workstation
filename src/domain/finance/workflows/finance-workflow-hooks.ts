import type { Message, ToolUse } from '../../../agent/message'
import type { DomainRecovery, DomainToolInterception, DomainWorkflowHooks } from '../../../agent/domain-workflow-hooks'
import {
  CUSTOM_STRATEGY_SKIP_REASONS,
  maybeBuildCustomStrategyAutoSaveToolCalls,
  maybeBuildCustomStrategyBacktestAnswer,
  maybeBuildCustomStrategyComparisonAnswer,
  maybeBuildCustomStrategyRejectedValidationAnswer,
  maybeBuildCustomStrategySaveRunBoundaryAnswer,
  maybeBuildCustomStrategySaveAnswer,
  maybeBuildCustomStrategyUnsupportedProxyAnswer,
  maybeBuildCustomStrategyValidateOnlyAnswer,
} from './finance-custom-strategy-summary'
import { buildCustomStrategyPreflightToolCalls } from './finance-custom-strategy-preflight'
import { buildTradeSizingPreflightToolCalls } from './finance-trade-sizing-preflight'
import {
  buildInvestmentEvidenceReviewSearchToolCalls,
  maybeBuildInvestmentEvidenceReviewAnswer,
} from './finance-evidence-review-summary'
import { maybeBuildFundCandidateDiscoveryAnswer } from './finance-fund-candidate-summary'
import { maybeBuildFundMonitorReviewSummary } from './finance-fund-monitor-summary'
import { maybeBuildFundStrategyWatchAnswer } from './finance-fund-watch-summary'
import { maybeBuildPortfolioMonitorReviewSummary } from './finance-portfolio-monitor-summary'
import { maybeBuildPositionSizingAnswer } from './finance-position-sizing-summary'
import { maybeBuildPriorAnalysisValidationAnswer } from './finance-prior-analysis-validation-summary'
import {
  buildQuantOptimizationRecovery,
  maybeBuildQuantOptimizationAnswer,
} from './finance-quant-optimization-summary'
import { maybeBuildStockCandidateDiscoveryAnswer } from './finance-stock-candidate-summary'
import { maybeBuildStockSignalCheckAnswer } from './finance-stock-signal-summary'
import { maybeBuildStockStrategyWatchAnswer } from './finance-stock-watch-summary'
import { maybeBuildTradeBudgetSummary } from './finance-trade-budget-summary'
import {
  buildLocalStrategyComparisonRecovery,
  isLocalStrategyComparisonState,
  isWatchlistPortfolioBacktestState,
  maybeBuildLocalStrategyComparisonAnswer,
  maybeBuildWatchlistPortfolioBacktestAnswer,
} from './finance-strategy-comparison-summary'
import {
  buildStrategyMonitorRecovery,
  buildStrategyMonitorRecoveryAnswer,
} from './finance-strategy-monitor-recovery'
import {
  isWatchlistRsiRankingState,
  maybeBuildWatchlistRsiRankingAnswer,
} from './finance-watchlist-rsi-ranking-summary'
import { Role } from '../../../agent/message'
import { isFinanceEvidenceTool } from './finance-workflow-policy'
import {
  financeWorkflowStateFromUserContent,
  isStrategyState,
  type FinanceWorkflowState,
} from './finance-workflow-state'

const MAX_FINANCE_EVIDENCE_TOOL_CALLS = 12

export function buildFinancePreflightToolCalls(messages: Message[]): ToolUse[] | null {
  return buildFundMonitorReviewPreflightToolCalls(messages) ??
    buildPortfolioMonitorReviewPreflightToolCalls(messages) ??
    buildInvestmentEvidenceReviewSearchToolCalls(messages) ??
    buildTradeSizingPreflightToolCalls(messages) ??
    buildFundStrategyPreflightToolCalls(messages) ??
    buildCustomStrategyPreflightToolCalls(messages)
}

function buildPortfolioMonitorReviewPreflightToolCalls(messages: Message[]): ToolUse[] | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const payload = structuredMonitorPayload(messages[lastUserIndex].content)
  if (!payload || payload.template !== 'portfolio_rebalance_monitor') return null
  const turnMessages = messages.slice(lastUserIndex + 1)
  if (hasAnsweredAskUserQuestion(turnMessages)) return null
  if (turnMessages.some((message) =>
    message.role === Role.Assistant &&
    (message.toolUses ?? []).some((call) => call.name === 'AskUserQuestion')
  )) return null
  const strategyId = String(payload.strategyId ?? '').trim() || '-'
  return [{
    id: `portfolio-monitor-review-confirmation-${Date.now()}`,
    name: 'AskUserQuestion',
    input: {
      questions: [{
        question: `组合再平衡监控 ${strategyId} 已触发，是否进入只复核、不调仓的观察处理？`,
        header: '组合复核',
        options: [
          {
            label: '只复核不调仓',
            description: '检查组合排序证据、目标权重和风险边界，不写 Portfolio 或雪球模拟盘交易。',
          },
          {
            label: '继续观察',
            description: '记录触发结果，本轮不做进一步操作。',
          },
        ],
      }],
    },
  }]
}

function buildFundMonitorReviewPreflightToolCalls(messages: Message[]): ToolUse[] | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const payload = structuredMonitorPayload(messages[lastUserIndex].content)
  if (!payload || payload.template !== 'fund_rule_monitor') return null
  const turnMessages = messages.slice(lastUserIndex + 1)
  if (hasAnsweredAskUserQuestion(turnMessages)) return null
  if (turnMessages.some((message) =>
    message.role === Role.Assistant &&
    (message.toolUses ?? []).some((call) => call.name === 'AskUserQuestion')
  )) return null
  const fundCode = String(payload.code ?? payload.fundCode ?? payload.symbol ?? '').trim() || '-'
  return [{
    id: `fund-monitor-review-confirmation-${Date.now()}`,
    name: 'AskUserQuestion',
    input: {
      questions: [{
        question: `基金观察监控 ${fundCode} 已触发，是否进入只复核、不交易的观察处理？`,
        header: '基金观察',
        options: [
          {
            label: '只复核不交易',
            description: '检查净值、回撤、波动和定投边界，不执行申购赎回或模拟交易。',
          },
          {
            label: '继续观察',
            description: '记录触发结果，本轮不做进一步操作。',
          },
        ],
      }],
    },
  }]
}

function structuredMonitorPayload(content: string): Record<string, unknown> | null {
  const marker = 'data:'
  const index = content.lastIndexOf(marker)
  if (index < 0) return null
  try {
    const decoded = JSON.parse(content.slice(index + marker.length).trim())
    return decoded && typeof decoded === 'object' && !Array.isArray(decoded)
      ? decoded as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function hasAnsweredAskUserQuestion(messages: Message[]): boolean {
  const askIds = new Set<string>()
  for (const message of messages) {
    if (message.role !== Role.Assistant) continue
    for (const call of message.toolUses ?? []) {
      if (call.name === 'AskUserQuestion') askIds.add(call.id)
    }
  }
  return messages.some((message) =>
    message.role === Role.Tool &&
    !!message.toolResult &&
    !message.toolResult.isError &&
    askIds.has(message.toolResult.toolUseId)
  )
}

function buildFundStrategyPreflightToolCalls(messages: Message[]): ToolUse[] | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const workflowState = financeWorkflowStateFromUserContent(messages[lastUserIndex].content)
  if (!isFundStrategyWorkflow(workflowState)) return null
  const turnMessages = messages.slice(lastUserIndex + 1)
  if (hasSuccessfulAction(turnMessages, 'custom_strategy_observe') || hasSuccessfulAction(turnMessages, 'custom_strategy_fund_backtest')) return null
  const fundCode = latestSuccessfulFundReadbackCode(turnMessages)
  if (!fundCode) return null
  return [{
    id: `fund-strategy-observe-${Date.now()}`,
    name: 'MarketData',
    input: {
      action: 'custom_strategy_observe',
      symbols: [fundCode],
      strategySpec: draftFundObservationStrategySpec(fundCode),
    },
  }]
}

function isFundStrategyWorkflow(state: FinanceWorkflowState | null): boolean {
  return !!state &&
    isStrategyState(state) &&
    state.assetClass === 'fund' &&
    (state.intentMode === 'observe' || state.intentMode === 'backtest' || state.intentMode === 'validate')
}

function latestSuccessfulFundReadbackCode(messages: Message[]): string | null {
  const successfulToolIds = successfulToolResultIds(messages)
  for (const message of [...messages].reverse()) {
    if (message.role !== Role.Assistant) continue
    for (const call of [...(message.toolUses ?? [])].reverse()) {
      if (!successfulToolIds.has(call.id)) continue
      if (call.name !== 'DataStore' && call.name !== 'MarketData') continue
      const action = String(call.input.action ?? '')
      if (action !== 'query_fund_nav' && action !== 'query_fund_money_yield') continue
      const code = stringValue(call.input.code) ??
        stringValue(call.input.fundCode) ??
        stringValue(call.input.symbol) ??
        firstString(call.input.symbols) ??
        firstString(call.input.codes)
      if (code && /^\d{6}(?:\.OF)?$/i.test(code)) return code.replace(/\.OF$/i, '')
    }
  }
  return null
}

function hasSuccessfulAction(messages: Message[], action: string): boolean {
  const successfulToolIds = successfulToolResultIds(messages)
  return messages.some((message) =>
    message.role === Role.Assistant &&
    (message.toolUses ?? []).some((call) => call.input.action === action && successfulToolIds.has(call.id)),
  )
}

function successfulToolResultIds(messages: Message[]): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.role === Role.Tool && message.toolResult && !message.toolResult.isError) ids.add(message.toolResult.toolUseId)
  }
  return ids
}

function draftFundObservationStrategySpec(fundCode: string): Record<string, unknown> {
  return {
    id: `fund_dca_observation_${fundCode}_v1`,
    name: `fund_dca_observation_${fundCode}`,
    version: 1,
    assetClass: 'fund',
    market: 'fund',
    fundCode,
    code: fundCode,
    dataRequirements: {
      dataClass: 'ordinary_fund_nav',
      minBars: 60,
      requiredFields: ['date', 'nav'],
    },
    indicators: [
      { id: 'fundDrawdown20', type: 'fund_drawdown', source: 'nav', params: { period: 20 } },
      { id: 'fundVolatility20', type: 'fund_volatility', source: 'nav', params: { period: 20 } },
      { id: 'navTrend20', type: 'nav_trend', source: 'nav', params: { period: 20 } },
    ],
    entry: {
      all: [
        { left: 'fundDrawdown20', op: '>=', right: 5 },
        { left: 'fundDrawdown20', op: '<', right: 15 },
        { left: 'navTrend20', op: '<', right: 0 },
      ],
    },
    exit: {
      any: [
        { left: 'fundDrawdown20', op: '>=', right: 15 },
      ],
    },
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function firstString(value: unknown): string | null {
  return Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()
    ? value[0].trim()
    : null
}

export function maybeBuildFinancePreflightAnswer(messages: Message[]): string | null {
  return maybeBuildInvestmentEvidenceReviewAnswer(messages)
}

export function maybeInterceptFinanceToolCalls(
  messages: Message[],
  proposedToolCalls: ToolUse[],
): DomainToolInterception | null {
  const budgetAnswerProbe = maybeBuildFinanceBudgetProbeAnswer(messages, proposedToolCalls)
  if (budgetAnswerProbe) {
    return {
      skippedReason: 'Skipped: finance evidence budget reached; answer now from collected and budgeted evidence.',
      answer: budgetAnswerProbe,
    }
  }

  const deduplicatedCalls = maybeBuildDeduplicatedFinanceToolCalls(messages, proposedToolCalls)
  if (deduplicatedCalls) {
    return {
      skippedReason:
        'Skipped: duplicate finance evidence call in this turn; executing only novel evidence calls.',
      answer: null,
      autoToolCalls: deduplicatedCalls,
    }
  }

  const repairedRankCalls = maybeRepairCustomStrategyRankSymbols(messages, proposedToolCalls)
  if (repairedRankCalls) {
    return {
      skippedReason:
        'Skipped: custom_strategy_rank was missing symbols; repairing from structured workflow-state subjects before executing.',
      answer: null,
      autoToolCalls: repairedRankCalls,
    }
  }

  const validateOnlyAnswer = maybeBuildCustomStrategyValidateOnlyAnswer(messages, proposedToolCalls)
  if (validateOnlyAnswer) {
    return {
      skippedReason: CUSTOM_STRATEGY_SKIP_REASONS.validateOnly,
      answer: validateOnlyAnswer,
    }
  }

  const rejectedAnswer = maybeBuildCustomStrategyRejectedValidationAnswer(messages, proposedToolCalls)
  if (rejectedAnswer) {
    return {
      skippedReason: CUSTOM_STRATEGY_SKIP_REASONS.rejectedValidation,
      answer: rejectedAnswer,
    }
  }

  const unsupportedProxyAnswer = maybeBuildCustomStrategyUnsupportedProxyAnswer(messages, proposedToolCalls)
  if (unsupportedProxyAnswer) {
    return {
      skippedReason: CUSTOM_STRATEGY_SKIP_REASONS.unsupportedProxy,
      answer: unsupportedProxyAnswer,
    }
  }

  const saveRerunCalls = buildCustomStrategyPreflightToolCalls(messages)
  if (
    saveRerunCalls?.some((call) => call.name === 'MarketData' && call.input.action === 'custom_strategy_run') &&
    !proposedToolCalls.some((call) => call.name === 'MarketData' && call.input.action === 'custom_strategy_run')
  ) {
    return {
      skippedReason:
        'Skipped: saved backtested strategy evidence is runnable; executing custom_strategy_run before any save-only summary.',
      answer: null,
      autoToolCalls: saveRerunCalls,
    }
  }

  const saveAnswer = maybeBuildCustomStrategySaveAnswer(messages, proposedToolCalls)
  if (saveAnswer) {
    return {
      skippedReason: CUSTOM_STRATEGY_SKIP_REASONS.saveComplete,
      answer: saveAnswer,
    }
  }

  const autoToolCalls = maybeBuildCustomStrategyAutoSaveToolCalls(messages, proposedToolCalls)
  if (autoToolCalls) {
    return {
      skippedReason: CUSTOM_STRATEGY_SKIP_REASONS.redirectToSave,
      answer: null,
      autoToolCalls,
      autoAnswerProbe: [{
        id: 'auto-custom-strategy-save-answer',
        name: 'MarketData',
        input: { action: 'query_kline' },
      }],
    }
  }

  const comparisonAnswer = maybeBuildCustomStrategyComparisonAnswer(messages)
  if (comparisonAnswer) {
    return {
      skippedReason: CUSTOM_STRATEGY_SKIP_REASONS.comparisonComplete,
      answer: comparisonAnswer,
    }
  }

  const backtestAnswer = maybeBuildCustomStrategyBacktestAnswer(messages, proposedToolCalls)
  if (backtestAnswer) {
    return {
      skippedReason: CUSTOM_STRATEGY_SKIP_REASONS.backtestComplete,
      answer: backtestAnswer,
    }
  }

  const budgetedCalls = maybeBuildBudgetedFinanceToolCalls(messages, proposedToolCalls)
  if (budgetedCalls) {
    return {
      skippedReason:
        'Skipped: proposed finance evidence batch would exceed the bounded workflow budget; executing only the necessary synthesis call.',
      answer: null,
      autoToolCalls: budgetedCalls,
      autoAnswerProbe: [{
        id: 'auto-finance-budget-answer-probe',
        name: 'DataProcess',
        input: { action: 'budget_answer_probe' },
      }],
    }
  }

  return null
}

function maybeRepairCustomStrategyRankSymbols(
  messages: Message[],
  proposedToolCalls: ToolUse[],
): ToolUse[] | null {
  const rankCall = proposedToolCalls.find((call) =>
    call.name === 'MarketData' &&
    call.input.action === 'custom_strategy_rank' &&
    !hasStringArray(call.input.symbols) &&
    !hasStringArray(call.input.codes)
  )
  if (!rankCall) return null
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  const promptState = lastUserIndex >= 0
    ? financeWorkflowStateFromUserContent(messages[lastUserIndex].content)
    : null
  const callState = workflowStateFromInput(rankCall.input.workflowState)
  const symbols = symbolsFromWorkflowState(callState) ?? symbolsFromWorkflowState(promptState) ?? []
  if (symbols.length < 2) return null
  return proposedToolCalls.map((call) => {
    if (call !== rankCall) return call
    return {
      ...call,
      id: `auto-rank-symbols-${call.id}`,
      input: {
        ...call.input,
        symbols,
      },
    }
  })
}

function workflowStateFromInput(value: unknown): FinanceWorkflowState | null {
  if (!value) return null
  if (typeof value === 'object' && !Array.isArray(value)) {
    const candidate = value as Partial<FinanceWorkflowState>
    return candidate.contract === 'finance-workflow-state-v1'
      ? candidate as FinanceWorkflowState
      : null
  }
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const decoded = JSON.parse(value) as unknown
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
        const candidate = decoded as Partial<FinanceWorkflowState>
        return candidate.contract === 'finance-workflow-state-v1'
          ? candidate as FinanceWorkflowState
          : null
      }
    } catch {
      return null
    }
  }
  return null
}

function symbolsFromWorkflowState(state: FinanceWorkflowState | null): string[] | null {
  if (!state || !isStrategyState(state)) return null
  const symbols = [
    ...(Array.isArray(state.subjects) ? state.subjects : []),
    state.subject,
  ]
    .map((item) => String(item ?? '').trim())
    .filter((item): item is string => Boolean(item))
  const unique = [...new Set(symbols)]
  return unique.length >= 2 ? unique : null
}

function hasStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => typeof item === 'string' && item.trim())
}

export function maybeBuildFinanceBoundedAnswer(messages: Message[]): string | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const prompt = messages[lastUserIndex].content
  const workflowState = financeWorkflowStateFromUserContent(prompt)
  if (isWatchlistRsiRankingState(workflowState)) {
    return maybeBuildWatchlistRsiRankingAnswer(messages.slice(lastUserIndex))
  }
  const positionSizingAnswer = maybeBuildPositionSizingAnswer(messages.slice(lastUserIndex))
  if (positionSizingAnswer) return positionSizingAnswer
  const tradeBudgetAnswer = maybeBuildTradeBudgetSummary(messages.slice(lastUserIndex))
  if (tradeBudgetAnswer) return tradeBudgetAnswer
  const fundMonitorReviewAnswer = maybeBuildFundMonitorReviewSummary(messages.slice(lastUserIndex))
  if (fundMonitorReviewAnswer) return fundMonitorReviewAnswer
  const portfolioMonitorReviewAnswer = maybeBuildPortfolioMonitorReviewSummary(messages.slice(lastUserIndex))
  if (portfolioMonitorReviewAnswer) return portfolioMonitorReviewAnswer
  const priorAnalysisValidationAnswer = maybeBuildPriorAnalysisValidationAnswer(messages.slice(lastUserIndex))
  if (priorAnalysisValidationAnswer) return priorAnalysisValidationAnswer
  const investmentEvidenceReviewAnswer = maybeBuildInvestmentEvidenceReviewAnswer(messages)
  if (investmentEvidenceReviewAnswer) return investmentEvidenceReviewAnswer
  const customStrategySaveRunBoundaryAnswer = maybeBuildCustomStrategySaveRunBoundaryAnswer(messages.slice(lastUserIndex))
  if (customStrategySaveRunBoundaryAnswer) return customStrategySaveRunBoundaryAnswer
  const customStrategyComparisonAnswer = maybeBuildCustomStrategyComparisonAnswer(messages.slice(lastUserIndex))
  if (customStrategyComparisonAnswer) return customStrategyComparisonAnswer
  if (isLocalStrategyComparisonState(workflowState)) {
    return maybeBuildLocalStrategyComparisonAnswer(messages.slice(lastUserIndex))
  }
  if (isWatchlistPortfolioBacktestState(workflowState)) {
    return maybeBuildWatchlistPortfolioBacktestAnswer(messages.slice(lastUserIndex))
  }
  const stockSignalCheckAnswer = maybeBuildStockSignalCheckAnswer(messages.slice(lastUserIndex))
  if (stockSignalCheckAnswer) return stockSignalCheckAnswer
  const fundStrategyWatchAnswer = maybeBuildFundStrategyWatchAnswer(messages.slice(lastUserIndex))
  if (fundStrategyWatchAnswer) return fundStrategyWatchAnswer
  const stockStrategyWatchAnswer = maybeBuildStockStrategyWatchAnswer(messages.slice(lastUserIndex))
  if (stockStrategyWatchAnswer) return stockStrategyWatchAnswer
  if (isFundCandidateWorkflow(workflowState)) {
    return maybeBuildFundCandidateDiscoveryAnswer(messages.slice(lastUserIndex + 1))
  }
  if (isStockCandidateWorkflow(workflowState)) {
    return maybeBuildStockCandidateDiscoveryAnswer(messages.slice(lastUserIndex + 1))
  }
  return maybeBuildQuantOptimizationAnswer(messages.slice(lastUserIndex))
}

export function buildFinanceRecovery(messages: Message[]): DomainRecovery | null {
  const quantOptimizationRecovery = buildQuantOptimizationRecovery(messages)
  if (quantOptimizationRecovery) {
    return {
      toolCalls: quantOptimizationRecovery.toolCalls,
      answerAfterTools: maybeBuildFinanceBoundedAnswer,
    }
  }

  const localStrategyComparisonRecovery = buildLocalStrategyComparisonRecovery(messages)
  if (localStrategyComparisonRecovery) {
    return {
      toolCalls: localStrategyComparisonRecovery.toolCalls,
      answerAfterTools: maybeBuildFinanceBoundedAnswer,
    }
  }

  const strategyMonitorRecovery = buildStrategyMonitorRecovery(messages)
  if (strategyMonitorRecovery) {
    return {
      toolCalls: strategyMonitorRecovery.toolCalls,
      answerAfterTools: (updatedMessages) =>
        buildStrategyMonitorRecoveryAnswer(updatedMessages, strategyMonitorRecovery),
    }
  }

  return null
}

export const financeWorkflowHooks: DomainWorkflowHooks = {
  buildPreflightToolCalls: buildFinancePreflightToolCalls,
  maybeBuildPreflightAnswer: maybeBuildFinancePreflightAnswer,
  maybeInterceptToolCalls: maybeInterceptFinanceToolCalls,
  maybeBuildBoundedAnswer: maybeBuildFinanceBoundedAnswer,
  buildRecovery: buildFinanceRecovery,
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) return index
  }
  return -1
}

function maybeBuildFinanceBudgetProbeAnswer(messages: Message[], proposedToolCalls: ToolUse[]): string | null {
  if (!proposedToolCalls.some((call) => call.id === 'auto-finance-budget-answer-probe')) return null
  return maybeBuildFinanceBoundedAnswer(messages)
}

function maybeBuildBudgetedFinanceToolCalls(
  messages: Message[],
  proposedToolCalls: ToolUse[],
): ToolUse[] | null {
  const proposedEvidenceCalls = proposedToolCalls.filter((call) => isFinanceEvidenceTool(call.name))
  if (proposedEvidenceCalls.length === 0) return null
  const currentEvidenceCalls = collectToolCalls(messages).filter((call) => isFinanceEvidenceTool(call.name)).length
  const remaining = MAX_FINANCE_EVIDENCE_TOOL_CALLS - currentEvidenceCalls
  if (remaining >= proposedEvidenceCalls.length) return null

  const existingAnswer = maybeBuildFinanceBoundedAnswer(messages)
  if (existingAnswer) return null
  if (remaining <= 0) return null

  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  const workflowState = lastUserIndex >= 0
    ? financeWorkflowStateFromUserContent(messages[lastUserIndex].content)
    : null
  if (isStockCandidateWorkflow(workflowState)) {
    const synthesisCall = proposedEvidenceCalls.find((call) =>
      call.name === 'DataProcess' && call.input.action === 'breakout_summary'
    )
    if (synthesisCall) {
      return [{
        ...synthesisCall,
        id: `auto-budget-${synthesisCall.id}`,
      }]
    }
  }

  return proposedEvidenceCalls.slice(0, remaining).map((call, index) => ({
    ...call,
    id: `auto-budget-${index}-${call.id}`,
  }))
}

function collectToolCalls(messages: Message[]): ToolUse[] {
  return messages.flatMap((message) => message.role === Role.Assistant ? message.toolUses ?? [] : [])
}

function isStockCandidateWorkflow(state: FinanceWorkflowState | null): boolean {
  return state?.workflowKind === 'stock_research' &&
    (state.intentMode === 'analysis' ||
      state.intentMode === 'observe' ||
      state.intentMode === 'review')
}

function isFundCandidateWorkflow(state: FinanceWorkflowState | null): boolean {
  return state?.workflowKind === 'fund_research' &&
    (state.intentMode === 'analysis' ||
      state.intentMode === 'observe' ||
      state.intentMode === 'review')
}

function maybeBuildDeduplicatedFinanceToolCalls(
  messages: Message[],
  proposedToolCalls: ToolUse[],
): ToolUse[] | null {
  const existingKeys = new Set(
    collectToolCalls(messages)
      .filter((call) => isFinanceEvidenceTool(call.name))
      .map(financeToolKey),
  )
  let removed = 0
  const filtered = proposedToolCalls.filter((call) => {
    if (!isFinanceEvidenceTool(call.name)) return true
    const key = financeToolKey(call)
    if (existingKeys.has(key)) {
      removed += 1
      return false
    }
    existingKeys.add(key)
    return true
  })
  if (removed === 0 || filtered.length === proposedToolCalls.length || filtered.length === 0) return null
  return filtered.map((call, index) => ({
    ...call,
    id: `auto-dedup-${index}-${call.id}`,
  }))
}

function financeToolKey(call: ToolUse): string {
  return `${call.name}:${stableJson(call.input)}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
