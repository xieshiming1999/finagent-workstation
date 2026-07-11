import { describe, expect, it } from 'vitest'

import { assistantMessage, toolMessage, userMessage } from '../../src/agent/message'
import {
  buildCustomStrategyPreflightToolCalls,
  buildCustomStrategySavedRunRepairToolCalls,
} from '../../src/domain/finance/workflows/finance-custom-strategy-preflight'

function strategyWorkflowContent(strategySpec?: Record<string, unknown>): string {
  return 'structured strategy request\n' +
    `data: ${JSON.stringify({
      workflowState: {
        contract: 'finance-workflow-state-v1',
        workflowKind: 'strategy_design',
        assetClass: 'stock',
        intentMode: 'validate',
        executionMode: 'preview_only',
        safetyBoundary: 'read-only validation',
        evidenceRefs: ['StrategySpec'],
        confirmationState: 'none',
        subject: '600519',
        source: 'agent-structured-intent',
      },
      ...(strategySpec ? { strategySpec } : {}),
    })}`
}

describe('finance custom strategy preflight', () => {
  it('discovers the contract from structured state but does not draft a StrategySpec', () => {
    const first = buildCustomStrategyPreflightToolCalls([
      userMessage(strategyWorkflowContent()),
    ])

    expect(first).toHaveLength(1)
    expect(first?.[0].input.action).toBe('custom_strategy_help')

    const afterHelp = buildCustomStrategyPreflightToolCalls([
      userMessage(strategyWorkflowContent()),
      assistantMessage('', [
        { id: 'help', name: 'MarketData', input: { action: 'custom_strategy_help' } },
      ]),
      toolMessage('help', JSON.stringify({ action: 'custom_strategy_help' })),
    ])

    expect(afterHelp).toBeNull()
  })

  it('validates an explicit structured StrategySpec after contract discovery', () => {
    const spec = {
      id: 'state_strategy_v1',
      assetClass: 'stock',
      symbol: '600519',
      symbols: ['600519'],
      timeframe: '1d',
    }
    const calls = buildCustomStrategyPreflightToolCalls([
      userMessage(strategyWorkflowContent(spec)),
      assistantMessage('', [
        { id: 'help', name: 'MarketData', input: { action: 'custom_strategy_help' } },
      ]),
      toolMessage('help', JSON.stringify({ action: 'custom_strategy_help' })),
    ])

    expect(calls).toHaveLength(1)
    expect(calls?.[0].input.action).toBe('custom_strategy_validate')
    expect(calls?.[0].input.strategySpec).toEqual(spec)
  })

  it('repairs saved strategy rerun from custom_strategy_backtest to custom_strategy_run', () => {
    const calls = buildCustomStrategySavedRunRepairToolCalls([
      userMessage('create and save'),
      assistantMessage('', [
        { id: 'save', name: 'MarketData', input: { action: 'custom_strategy_save' } },
      ]),
      toolMessage('save', JSON.stringify({
        action: 'custom_strategy_save',
        strategyId: 'custom_sma_v1',
        status: 'backtested',
        spec: { id: 'custom_sma_v1', universe: { symbols: ['600519'] } },
        evidence: { status: 'backtested' },
      })),
      userMessage('rerun saved strategy'),
    ], [
      {
        id: 'bt',
        name: 'MarketData',
        input: {
          action: 'custom_strategy_backtest',
          code: '000858',
          strategySpec: { id: 'custom_sma_v1' },
        },
      },
    ])

    expect(calls).toHaveLength(1)
    expect(calls?.[0].input).toEqual({
      action: 'custom_strategy_run',
      strategyId: 'custom_sma_v1',
      code: '000858',
    })
  })
})
