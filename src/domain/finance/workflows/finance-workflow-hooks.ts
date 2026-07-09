import type { Message, ToolUse } from '../../../agent/message'
import type { DomainRecovery, DomainToolInterception, DomainWorkflowHooks } from '../../../agent/domain-workflow-hooks'
import {
  CUSTOM_STRATEGY_SKIP_REASONS,
  maybeBuildCustomStrategyAutoSaveToolCalls,
  maybeBuildCustomStrategyBacktestAnswer,
  maybeBuildCustomStrategyComparisonAnswer,
  maybeBuildCustomStrategyRejectedValidationAnswer,
  maybeBuildCustomStrategyRunComparisonAnswer,
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
import { maybeBuildMacroEvidenceAnswer } from './finance-macro-evidence-summary'
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
  const macroConditionReadbackCalls = buildMacroConditionWatchlistReadbackCalls(messages, proposedToolCalls)
  if (macroConditionReadbackCalls) {
    return {
      skippedReason:
        'Skipped: macro-condition watchlist writes require immediate readback before more evidence collection or final synthesis.',
      answer: null,
      autoToolCalls: macroConditionReadbackCalls,
    }
  }

  const macroEvidenceCalls = maybeCompleteMacroEvidenceCalls(messages, proposedToolCalls)
  if (macroEvidenceCalls) {
    return {
      skippedReason:
        'Skipped: macro evidence was proposed without the complete governed macro/news readback set; adding attribution, source evidence, and finance-news readbacks before synthesis.',
      answer: null,
      autoToolCalls: macroEvidenceCalls,
    }
  }

  const macroStockEvidenceCalls = buildMacroStockQuoteRecovery(messages)
  if (macroStockEvidenceCalls) {
    return {
      skippedReason:
        'Skipped: named-stock macro/news workflow is missing governed stock identity or quote evidence; executing local stock evidence before synthesis or generic fallback.',
      answer: null,
      autoToolCalls: macroStockEvidenceCalls,
    }
  }

  const macroExternalFallbackAnswer = maybeBuildMacroExternalFallbackAnswer(messages, proposedToolCalls)
  if (macroExternalFallbackAnswer) {
    return {
      skippedReason:
        'Skipped: governed macro evidence exists; first-pass macro workflow must answer before generic search or web fetch fallback.',
      answer: macroExternalFallbackAnswer,
    }
  }

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
  const macroEvidenceAnswer = maybeBuildMacroEvidenceAnswer(messages.slice(lastUserIndex), {
    failureSummary: '本轮已使用结构化宏观 readback 和来源证据；如需刷新来源，应进入显式 macro source update / extraction workflow。',
  })
  if (
    macroEvidenceAnswer &&
    !requiresMacroStockQuoteRecovery(messages.slice(lastUserIndex)) &&
    !hasPendingWatchlistStateWorkflow(messages.slice(lastUserIndex))
  ) {
    return macroEvidenceAnswer
  }
  const customStrategySaveRunBoundaryAnswer = maybeBuildCustomStrategySaveRunBoundaryAnswer(messages.slice(lastUserIndex))
  if (customStrategySaveRunBoundaryAnswer) return customStrategySaveRunBoundaryAnswer
  const customStrategyRunComparisonAnswer = maybeBuildCustomStrategyRunComparisonAnswer(messages.slice(lastUserIndex))
  if (customStrategyRunComparisonAnswer) return customStrategyRunComparisonAnswer
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

  const macroStockRecovery = buildMacroStockQuoteRecovery(messages)
  if (macroStockRecovery) {
    return {
      toolCalls: macroStockRecovery,
      answerAfterTools: maybeBuildFinanceBoundedAnswer,
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

function buildMacroConditionWatchlistReadbackCalls(
  messages: Message[],
  proposedToolCalls: ToolUse[],
): ToolUse[] | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const turnMessages = messages.slice(lastUserIndex + 1)
  const proposedMacroWrites = proposedToolCalls.filter((call) =>
    call.name === 'Watchlist' &&
    call.input.action === 'add' &&
    call.input.type === 'macro-condition'
  )
  const proposedMacroReadback = proposedToolCalls.some((call) =>
    call.name === 'Watchlist' &&
    call.input.action === 'list' &&
    (call.input.type === 'macro-condition' || call.input.groupType === 'macro-condition')
  )
  if (proposedMacroWrites.length > 0 && !proposedMacroReadback) {
    return [...proposedMacroWrites, macroConditionWatchlistReadbackCall()]
  }
  const successfulToolIds = successfulToolResultIds(turnMessages)
  const hasMacroConditionWrite = turnMessages.some((message) =>
    message.role === Role.Assistant &&
    (message.toolUses ?? []).some((call) =>
      call.name === 'Watchlist' &&
      call.input.action === 'add' &&
      call.input.type === 'macro-condition' &&
      successfulToolIds.has(call.id)
    )
  )
  if (!hasMacroConditionWrite) return null
  const hasMacroConditionReadback = [...turnMessages.flatMap((message) => message.toolUses ?? []), ...proposedToolCalls]
    .some((call) =>
      call.name === 'Watchlist' &&
      call.input.action === 'list' &&
      (call.input.type === 'macro-condition' || call.input.groupType === 'macro-condition')
    )
  if (hasMacroConditionReadback) return null
  return [macroConditionWatchlistReadbackCall()]
}

function macroConditionWatchlistReadbackCall(): ToolUse {
  return {
    id: `auto-macro-condition-watchlist-readback-${Date.now()}`,
    name: 'Watchlist',
    input: {
      action: 'list',
      type: 'macro-condition',
      status: 'watching',
    },
  }
}

function hasPendingWatchlistStateWorkflow(turnMessages: Message[]): boolean {
  const loadedWatchlistSkill = turnMessages.some((message) =>
    message.role === Role.Assistant &&
    (message.toolUses ?? []).some((call) =>
      call.name === 'Skill' && String(call.input.skill ?? '') === 'watchlist'
    )
  )
  const inspectedWatchlistHelp = turnMessages.some((message) =>
    message.role === Role.Assistant &&
    (message.toolUses ?? []).some((call) =>
      call.name === 'Watchlist' && call.input.action === 'help'
    )
  )
  if (!loadedWatchlistSkill && !inspectedWatchlistHelp) return false
  const successfulToolIds = successfulToolResultIds(turnMessages)
  const hasMacroConditionWrite = turnMessages.some((message) =>
    message.role === Role.Assistant &&
    (message.toolUses ?? []).some((call) =>
      call.name === 'Watchlist' &&
      call.input.action === 'add' &&
      call.input.type === 'macro-condition' &&
      successfulToolIds.has(call.id)
    )
  )
  const hasMacroConditionReadback = turnMessages.some((message) =>
    message.role === Role.Assistant &&
    (message.toolUses ?? []).some((call) =>
      call.name === 'Watchlist' &&
      call.input.action === 'list' &&
      (call.input.type === 'macro-condition' || call.input.groupType === 'macro-condition') &&
      successfulToolIds.has(call.id)
    )
  )
  if (hasMacroConditionWrite && !hasMacroConditionReadback) return true
  const hasWatchlistStateCall = turnMessages.some((message) =>
    message.role === Role.Assistant &&
    (message.toolUses ?? []).some((call) =>
      call.name === 'Watchlist' &&
      (call.input.action === 'add' || call.input.action === 'update' || call.input.action === 'list') &&
      successfulToolIds.has(call.id)
    )
  )
  return !hasWatchlistStateCall
}

function maybeBuildMacroExternalFallbackAnswer(
  messages: Message[],
  proposedToolCalls: ToolUse[],
): string | null {
  if (!proposedToolCalls.some((call) => call.name === 'Research' || call.name === 'WebFetch')) return null
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  return maybeBuildMacroEvidenceAnswer(messages.slice(lastUserIndex), {
    failureSummary:
      '模型尝试追加通用 Research/WebFetch，但本轮已经有受治理宏观 evidence/readback；first-pass attribution 必须先基于这些证据完成。',
    suffix:
      '如果用户明确要求更新来源或验证网页可达性，再进入 macro_research_sources / macro_research_extract / source validation workflow。',
  })
}

function buildMacroStockQuoteRecovery(messages: Message[]): ToolUse[] | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const turnMessages = messages.slice(lastUserIndex)
  const workflowState = latestFinanceWorkflowState(turnMessages)
  if (workflowState?.workflowKind !== 'macro_factor_lookup') return null
  const searchTerm = latestMacroStockSubject(turnMessages)
  if (!searchTerm || hasMacroStockQuoteEvidence(turnMessages, searchTerm)) return null
  const identity = latestStockIdentityFromToolResults(turnMessages, searchTerm)
  if (identity?.code) {
    return [{
      id: `auto-macro-stock-quote-${Date.now()}`,
      name: 'DataStore',
      input: { action: 'query_quote', code: identity.code, limit: 1 },
    }]
  }
  if (hasStockIdentitySearch(turnMessages, searchTerm)) return null
  return [{
    id: `auto-macro-stock-search-${Date.now()}`,
    name: 'DataStore',
    input: { action: 'query_stock_list', keyword: searchTerm, limit: 5 },
  }]
}

function requiresMacroStockQuoteRecovery(turnMessages: Message[]): boolean {
  const searchTerm = latestMacroStockSubject(turnMessages)
  return Boolean(searchTerm &&
    !hasMacroStockQuoteEvidence(turnMessages, searchTerm) &&
    !hasStockIdentitySearch(turnMessages, searchTerm))
}

function latestMacroStockSubject(messages: Message[]): string | null {
  const state = latestFinanceWorkflowState(messages)
  if (state?.assetClass === 'stock') {
    const subject = normalizeStockSubject(state.subject)
    if (subject) return subject
    for (const candidate of state.subjects ?? []) {
      const normalized = normalizeStockSubject(candidate)
      if (normalized) return normalized
    }
  }
  for (let index = messages.length - 1; index >= 0; index--) {
    const uses = messages[index].toolUses ?? []
    for (let useIndex = uses.length - 1; useIndex >= 0; useIndex--) {
      const call = uses[useIndex]
      const action = String(call.input.action ?? '')
      if ((call.name === 'DataStore' || call.name === 'MarketData') && action.includes('macro')) {
        for (const key of ['code', 'symbol', 'stockCode', 'stockName', 'subject']) {
          const subject = normalizeStockSubject(call.input[key])
          if (subject) return subject
        }
      }
    }
  }
  return null
}

function normalizeStockSubject(value: unknown): string | null {
  const subject = String(value ?? '').trim()
  if (!subject) return null
  const qualifiedCode = subject.match(/^(\d{6})\.(?:SH|SZ)$/i)
  return qualifiedCode?.[1] ?? subject
}

function hasMacroStockQuoteEvidence(messages: Message[], searchTerm: string): boolean {
  const identity = latestStockIdentityFromToolResults(messages, searchTerm)
  const successfulIds = new Set(messages
    .map((message) => message.toolResult)
    .filter((result): result is NonNullable<Message['toolResult']> => Boolean(result && !result.isError))
    .map((result) => result.toolUseId))
  for (const message of messages) {
    for (const call of message.toolUses ?? []) {
      if (!successfulIds.has(call.id)) continue
      if ((call.name !== 'DataStore' && call.name !== 'MarketData') ||
          (call.input.action !== 'query_quote' && call.input.action !== 'quote')) continue
      const code = String(call.input.code ?? call.input.symbol ?? '').trim()
      if (code && code === (identity?.code ?? searchTerm)) return true
    }
  }
  return false
}

function hasStockIdentitySearch(messages: Message[], searchTerm: string): boolean {
  return messages.some((message) => {
    if (message.role !== Role.Assistant) return false
    return (message.toolUses ?? []).some((call) =>
      (call.name === 'DataStore' || call.name === 'MarketData') &&
      call.input.action === 'query_stock_list' &&
      String(call.input.keyword ?? call.input.query ?? '') === searchTerm
    )
  })
}

function latestStockIdentityFromToolResults(
  messages: Message[],
  searchTerm: string,
): { code: string; name: string } | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const result = messages[index].toolResult
    if (!result || result.isError) continue
    const payload = parseToolResultObject(result.content)
    if (payload?.action !== 'query_stock_list') continue
    if (String(payload.keyword ?? '') !== searchTerm) continue
    const rows = Array.isArray(payload.data) ? payload.data : []
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const record = row as Record<string, unknown>
      const code = String(record.code ?? record.symbol ?? '').trim()
      const name = String(record.name ?? '').trim()
      if (code && name) return { code, name }
    }
  }
  return null
}

function parseToolResultObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const decoded = JSON.parse(trimmed)
    return decoded && typeof decoded === 'object' && !Array.isArray(decoded)
      ? decoded as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function toolResultAction(content: string): string | null {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const decoded = JSON.parse(trimmed)
    return typeof decoded?.action === 'string' ? decoded.action : null
  } catch {
    return null
  }
}

function maybeCompleteMacroEvidenceCalls(
  messages: Message[],
  proposedToolCalls: ToolUse[],
): ToolUse[] | null {
  const macroCalls = proposedToolCalls.filter((call) =>
    (call.name === 'DataStore' || call.name === 'MarketData') &&
    String(call.input.action ?? '').includes('macro')
  )
  const priorCalls = collectExecutedToolCalls(messages)
  const priorMacroCalls = priorCalls.filter((call) =>
    (call.name === 'DataStore' || call.name === 'MarketData') &&
    String(call.input.action ?? '').includes('macro')
  )
  if (macroCalls.length === 0 && priorMacroCalls.length === 0) return null
  const combinedCalls = [...priorCalls, ...proposedToolCalls]
  const hasAction = (action: string) => combinedCalls.some((call) =>
    (call.name === 'DataStore' || call.name === 'MarketData') &&
    call.input.action === action
  )
  const hasMacroSourceCatalog = combinedCalls.some((call) =>
    (call.name === 'DataStore' || call.name === 'MarketData') &&
    call.input.action === 'macro_research_sources'
  )
  const hasFinanceNewsReadback = combinedCalls.some((call) =>
    (call.name === 'DataStore' || call.name === 'MarketData') &&
    call.input.action === 'query_finance_news'
  )
  const proposedFinanceNewsRefresh = proposedToolCalls.some((call) =>
    (call.name === 'DataStore' || call.name === 'MarketData') &&
    call.input.action === 'finance_news'
  )
  const additions: ToolUse[] = []
  const attributionBaseCalls = macroCalls.length > 0 ? macroCalls : priorMacroCalls
  const target = attributionBaseCalls
    .map((call) => String(call.input.target ?? '').trim())
    .find(Boolean) ?? 'A-shares'
  const toolName = attributionBaseCalls[0].name
  if (!hasAction('query_macro_factors') || proposedFinanceNewsRefresh) {
    additions.push({
      id: `auto-macro-factors-${Date.now()}`,
      name: toolName,
      input: {
        action: 'query_macro_factors',
        target,
        limit: 10,
      },
    })
  }
  if (!hasAction('query_macro_attribution')) {
    additions.push({
      id: `auto-macro-attribution-${Date.now()}`,
      name: toolName,
      input: {
        action: 'query_macro_attribution',
        target,
        limit: 10,
      },
    })
  }
  if (hasMacroSourceCatalog && !hasAction('query_macro_research_evidence')) {
    additions.push({
      id: `auto-macro-research-evidence-${Date.now()}`,
      name: toolName,
      input: {
        action: 'query_macro_research_evidence',
        target,
        limit: 10,
      },
    })
  }
  if (hasMacroSourceCatalog && hasFinanceNewsReadback && !hasAction('finance_news')) {
    additions.push({
      id: `auto-macro-finance-news-refresh-${Date.now()}`,
      name: toolName,
      input: {
        action: 'finance_news',
        query: target,
        limit: 20,
      },
    })
  }
  if (!hasAction('query_finance_news') || proposedFinanceNewsRefresh) {
    additions.push({
      id: `auto-macro-finance-news-${Date.now()}`,
      name: toolName,
      input: {
        action: 'query_finance_news',
        query: target,
        limit: 10,
      },
    })
  }
  if (additions.length === 0) return null
  const shouldSuppressGenericExternal = proposedToolCalls.some((call) => call.name === 'Research' || call.name === 'WebFetch')
  const retainedCalls = shouldSuppressGenericExternal
    ? []
    : additions.some((call) => call.input.action === 'finance_news')
      ? proposedToolCalls.filter((call) => call.input.action !== 'query_finance_news')
      : proposedToolCalls
  const deferredReadbacks = shouldSuppressGenericExternal
    ? []
    : additions.some((call) => call.input.action === 'finance_news')
      ? proposedToolCalls.filter((call) => call.input.action === 'query_finance_news')
      : []
  return [
    ...cloneInterceptedToolCalls(retainedCalls),
    ...additions,
    ...cloneInterceptedToolCalls(deferredReadbacks),
  ]
}

function cloneInterceptedToolCalls(calls: ToolUse[]): ToolUse[] {
  return calls.map((call, index) => ({
    ...call,
    id: `auto-retained-${Date.now()}-${index}-${call.id}`,
  }))
}

function maybeBuildBudgetedFinanceToolCalls(
  messages: Message[],
  proposedToolCalls: ToolUse[],
): ToolUse[] | null {
  const proposedEvidenceCalls = proposedToolCalls.filter((call) => isFinanceEvidenceTool(call.name))
  if (proposedEvidenceCalls.length === 0) return null
  const currentEvidenceCalls = collectExecutedToolCalls(messages).filter((call) => isFinanceEvidenceTool(call.name)).length
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

  const selectedCalls = prioritizeBudgetedFinanceCalls(proposedEvidenceCalls, remaining)
  return selectedCalls.map((call, index) => ({
    ...repairBudgetedFinanceCall(call),
    id: `auto-budget-${index}-${call.id}`,
  }))
}

function repairBudgetedFinanceCall(call: ToolUse): ToolUse {
  if (
    call.name === 'DataStore' &&
    call.input.action === 'query_index_quote' &&
    !call.input.code &&
    !call.input.codes
  ) {
    return {
      ...call,
      input: {
        ...call.input,
        codes: '000001,399001,399006,000300',
      },
    }
  }
  return call
}

function prioritizeBudgetedFinanceCalls(proposedEvidenceCalls: ToolUse[], remaining: number): ToolUse[] {
  const selected = proposedEvidenceCalls.slice(0, remaining)
  const requiredAttribution = proposedEvidenceCalls.find((call) =>
    (call.name === 'DataStore' || call.name === 'MarketData') &&
    call.input.action === 'query_macro_attribution'
  )
  if (!requiredAttribution || selected.some((call) => call === requiredAttribution)) return selected
  const replaceIndex = findLastIndex(selected, (call) =>
    (call.name === 'DataStore' || call.name === 'MarketData') &&
    String(call.input.action ?? '').includes('macro')
  )
  if (replaceIndex >= 0) {
    selected[replaceIndex] = requiredAttribution
    return selected
  }
  selected[selected.length - 1] = requiredAttribution
  return selected
}

function collectToolCalls(messages: Message[]): ToolUse[] {
  return messages.flatMap((message) => message.role === Role.Assistant ? message.toolUses ?? [] : [])
}

function collectExecutedToolCalls(messages: Message[]): ToolUse[] {
  const executedIds = executedToolUseIds(messages)
  return collectToolCalls(messages).filter((call) => executedIds.has(call.id))
}

function executedToolUseIds(messages: Message[]): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.role !== Role.Tool || !message.toolResult || message.toolResult.isError) continue
    const content = message.toolResult.content.trim()
    if (content.startsWith('Skipped:')) continue
    ids.add(message.toolResult.toolUseId)
  }
  return ids
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
  const priorMessages = messagesWithoutCurrentProposedAssistant(messages, proposedToolCalls)
  const existingKeys = new Set(
    collectToolCalls(priorMessages)
      .filter((call) => executedToolUseIds(priorMessages).has(call.id))
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

function messagesWithoutCurrentProposedAssistant(
  messages: Message[],
  proposedToolCalls: ToolUse[],
): Message[] {
  const last = messages[messages.length - 1]
  if (
    last?.role !== Role.Assistant ||
    !last.toolUses?.length ||
    last.toolUses.length !== proposedToolCalls.length
  ) {
    return messages
  }
  const proposedIds = new Set(proposedToolCalls.map((call) => call.id))
  const sameToolSet = last.toolUses.every((call) => proposedIds.has(call.id))
  return sameToolSet ? messages.slice(0, -1) : messages
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
