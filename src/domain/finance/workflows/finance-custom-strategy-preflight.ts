import { Role, type Message, type ToolUse } from '../../../agent/message'
import {
  financeWorkflowStateFromUserContent,
  isStrategyState,
  latestFinanceWorkflowState,
  type FinanceWorkflowState,
} from './finance-workflow-state'

export function buildCustomStrategyPreflightToolCalls(messages: Message[]): ToolUse[] | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const userContent = messages[lastUserIndex].content
  const workflowState = latestFinanceWorkflowState(messages, lastUserIndex)
  const userWorkflowState = financeWorkflowStateFromUserContent(userContent)
  const commandState = isStrategyState(userWorkflowState) ? userWorkflowState : workflowState
  if (!isStrategyState(workflowState)) return null

  const turnMessages = messages.slice(lastUserIndex + 1)
  const toolCalls = collectToolCalls(turnMessages)
  const results = successfulToolResults(turnMessages)
  if (isCustomStrategySaveAndRunState(commandState)) {
    const saved = latestSavedStrategy(turnMessages)
    const hasRun = toolCalls.some((call) =>
      call.name === 'MarketData' &&
      call.input.action === 'custom_strategy_run' &&
      results.has(call.id)
    )
    if (saved && !hasRun) {
      return [{
        id: `custom-strategy-run-${Date.now()}`,
        name: 'MarketData',
        input: {
          action: 'custom_strategy_run',
          strategyId: saved.strategyId,
          symbols: [saved.symbol],
        },
      }]
    }
    if (!saved) {
      const latest = latestBacktestedStrategy(messages.slice(0, lastUserIndex))
      if (latest) {
        return [{
          id: `custom-strategy-save-${Date.now()}`,
          name: 'MarketData',
          input: {
            action: 'custom_strategy_save',
            strategySpec: latest.strategySpec,
            evidence: latest.evidence,
          },
        }]
      }
    }
  }
  const customStrategyCalls = toolCalls.filter(isCustomStrategyToolCall)
  const hasHelp = toolCalls.some((call) =>
    call.name === 'MarketData' &&
    call.input.action === 'custom_strategy_help' &&
    results.has(call.id)
  )
  if (customStrategyCalls.some((call) => call.input.action !== 'custom_strategy_help')) return null
  if (hasHelp) {
    return buildStructuredStrategyToolCalls(commandState, structuredStrategySpec(userContent))
  }

  return [{
    id: `custom-strategy-preflight-${Date.now()}`,
    name: 'MarketData',
    input: { action: 'custom_strategy_help' },
  }]
}

export function buildCustomStrategySavedRunRepairToolCalls(
  messages: Message[],
  proposedToolCalls: ToolUse[],
): ToolUse[] | null {
  const lastUserIndex = findLastIndex(messages, (message) => message.role === Role.User)
  if (lastUserIndex < 0) return null
  const saved = latestSavedStrategy(messages.slice(0, lastUserIndex))
  if (!saved) return null
  let changed = false
  const repaired = proposedToolCalls.map((call) => {
    if (call.name !== 'MarketData' || call.input.action !== 'custom_strategy_backtest') return call
    const target =
      stringOrNull(call.input.code) ??
      stringOrNull(call.input.symbol) ??
      firstString(call.input.symbols) ??
      firstString(call.input.codes)
    if (!target) return call
    changed = true
    return {
      ...call,
      input: {
        action: 'custom_strategy_run',
        strategyId: saved.strategyId,
        code: target,
      },
    }
  })
  return changed ? repaired : null
}

function buildStructuredStrategyToolCalls(
  state: FinanceWorkflowState | null,
  structuredSpec?: Record<string, unknown>,
): ToolUse[] | null {
  const symbol = firstString(structuredSpec?.symbols) ??
    stringOrNull(structuredSpec?.symbol)
  if (!structuredSpec || !symbol) return null
  if (isCustomStrategyValidateState(state)) {
    return [{
      id: `custom-strategy-validate-${symbol}-${Date.now()}`,
      name: 'MarketData',
      input: {
        action: 'custom_strategy_validate',
        strategySpec: structuredSpec,
      },
    }]
  }
  if (!isCustomStrategyBacktestState(state)) return null
  return [{
    id: `custom-strategy-backtest-${symbol}-${Date.now()}`,
    name: 'MarketData',
    input: {
      action: 'custom_strategy_backtest',
      code: symbol,
      range: '2y',
      strategySpec: structuredSpec,
    },
  }]
}

function isCustomStrategyValidateState(state: FinanceWorkflowState | null): boolean {
  return isStrategyState(state) &&
    (state?.intentMode === 'validate' || state?.intentMode === 'analysis' || state?.intentMode === 'unknown')
}

function isCustomStrategyBacktestState(state: FinanceWorkflowState | null): boolean {
  return isStrategyState(state) && state?.intentMode === 'backtest'
}

function isCustomStrategySaveAndRunState(state: FinanceWorkflowState | null): boolean {
  return isStrategyState(state) && (state?.intentMode === 'save' || state?.intentMode === 'rerun')
}

function structuredStrategySpec(content: string): Record<string, unknown> | undefined {
  const marker = content.lastIndexOf('data:')
  if (marker < 0) return undefined
  const payload = parseJsonObject(content.slice(marker + 'data:'.length))
  const spec = objectOrEmpty(payload?.strategySpec)
  return Object.keys(spec).length > 0 ? spec : undefined
}

function isCustomStrategyToolCall(call: ToolUse): boolean {
  return call.name === 'MarketData' && String(call.input.action ?? '').startsWith('custom_strategy_')
}

function collectToolCalls(messages: Message[]): ToolUse[] {
  return messages.flatMap((message) => message.role === Role.Assistant ? message.toolUses ?? [] : [])
}

function successfulToolResults(messages: Message[]): Map<string, string> {
  const resultByToolUseId = new Map<string, string>()
  for (const message of messages) {
    if (message.role === Role.Tool && message.toolResult && !message.toolResult.isError) {
      resultByToolUseId.set(message.toolResult.toolUseId, message.toolResult.content)
    }
  }
  return resultByToolUseId
}

function latestBacktestedStrategy(messages: Message[]): {
  strategyId: string
  symbol: string
  strategySpec: Record<string, unknown>
  evidence: Record<string, unknown>
} | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== Role.Tool || !message.toolResult || message.toolResult.isError) continue
    const payload = parseJsonObject(message.toolResult.content)
    if (!payload || payload.action !== 'custom_strategy_backtest' || payload.status !== 'backtested') continue
    const validation = objectOrEmpty(payload.validation)
    const spec = objectOrEmpty(validation.spec)
    if (Object.keys(spec).length === 0) continue
    const symbol = stringOrNull(payload.symbol) ?? symbolFromSpec(spec)
    const strategyId =
      stringOrNull(payload.strategyId) ??
      stringOrNull(validation.strategyId) ??
      stringOrNull(spec.id)
    if (!symbol || !strategyId) continue
    return {
      strategyId,
      symbol,
      strategySpec: spec,
      evidence: payload,
    }
  }
  return null
}

function latestSavedStrategy(messages: Message[]): { strategyId: string; symbol: string } | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== Role.Tool || !message.toolResult || message.toolResult.isError) continue
    const payload = parseJsonObject(message.toolResult.content)
    if (!payload || payload.action !== 'custom_strategy_save' || !hasBacktestedEvidence(payload)) continue
    const spec = objectOrEmpty(payload.spec)
    const strategyId = stringOrNull(payload.strategyId)
    const symbol = symbolFromSpec(spec)
    if (!strategyId || !symbol) continue
    return { strategyId, symbol }
  }
  return null
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function hasBacktestedEvidence(payload: Record<string, unknown>): boolean {
  if (payload.status === 'backtested') return true
  const evidence = objectOrEmpty(payload.evidence)
  return evidence.status === 'backtested'
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function firstString(value: unknown): string | null {
  return Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()
    ? value[0].trim()
    : null
}

function symbolFromSpec(spec: Record<string, unknown>): string | null {
  const direct = stringOrNull(spec.symbol) ?? firstString(spec.symbols)
  if (direct) return direct
  const universe = objectOrEmpty(spec.universe)
  return firstString(universe.symbols)
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) return index
  }
  return -1
}
