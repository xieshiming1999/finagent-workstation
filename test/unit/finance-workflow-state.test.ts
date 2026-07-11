import { describe, expect, it } from 'vitest'
import {
  financeWorkflowStateFromUserContent,
  latestFinanceWorkflowState,
} from '../../src/domain/finance/workflows/finance-workflow-state'
import { Role, type Message } from '../../src/agent/message'

describe('financeWorkflowStateFromUserContent', () => {
  it('does not infer workflow state from natural-language prompt text', () => {
    expect(financeWorkflowStateFromUserContent('帮我设计一个策略并保存')).toBeNull()
    expect(financeWorkflowStateFromUserContent('如果可以买入贵州茅台，请帮我计算仓位并准备下单')).toBeNull()
    expect(financeWorkflowStateFromUserContent('请确认是否继续下一步回测并加入观察池')).toBeNull()
  })

  it('ignores JSON payloads without an explicit workflowState contract', () => {
    const state = financeWorkflowStateFromUserContent(JSON.stringify({
      intent: 'trade_prep',
      symbol: '600519',
      confirmationRequired: true,
    }))

    expect(state).toBeNull()
  })

  it('accepts explicit whole-message workflowState JSON', () => {
    const state = financeWorkflowStateFromUserContent(JSON.stringify({
      workflowState: {
        contract: 'finance-workflow-state-v1',
        workflowKind: 'trade_prep',
        assetClass: 'stock',
        intentMode: 'size',
        executionMode: 'requires_confirmation',
        safetyBoundary: 'trade preparation only',
        evidenceRefs: ['trade-prep-v1'],
        confirmationState: 'pending',
        subject: '600519',
        source: 'agent-structured-intent',
      },
    }))

    expect(state).toMatchObject({
      workflowKind: 'trade_prep',
      intentMode: 'size',
      confirmationState: 'pending',
      subject: '600519',
      source: 'agent-structured-intent',
    })
  })

  it('accepts explicit data workflowState JSON after human-readable text', () => {
    const state = financeWorkflowStateFromUserContent(
      'runtime event\n'
      + 'data:{"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"strategy_review","assetClass":"stock","intentMode":"rerun","executionMode":"preview_only","safetyBoundary":"reuse saved strategy artifact","evidenceRefs":["custom_strategy_run"],"confirmationState":"none","subjects":["300059","600519"],"source":"scenario:structured"}}',
    )

    expect(state).toMatchObject({
      workflowKind: 'strategy_review',
      intentMode: 'rerun',
      subjects: ['300059', '600519'],
      source: 'scenario:structured',
    })
  })

  it('accepts only the explicit strategy_signal compatibility envelope', () => {
    const plainText = financeWorkflowStateFromUserContent('有入场信号，请确认买入 300059')
    expect(plainText).toBeNull()

    const state = financeWorkflowStateFromUserContent(
      'runtime event\n'
      + 'data:{"template":"strategy_signal","strategyId":"s1","code":"300059.SZ","signal":"entry","price":20.1,"confirmationRequired":true}',
    )

    expect(state).toMatchObject({
      workflowKind: 'trade_prep',
      assetClass: 'stock',
      intentMode: 'size',
      executionMode: 'requires_confirmation',
      confirmationState: 'pending',
      subject: '300059.SZ',
      source: 'user-data:strategy_signal',
    })
  })

  it('latest state scan does not classify ordinary user turns', () => {
    const messages: Message[] = [
      { role: Role.User, content: '今天市场怎么样？请给我一个策略建议。' },
      { role: Role.Assistant, content: '我会先检查工具。' },
    ]

    expect(latestFinanceWorkflowState(messages)).toBeNull()
  })
})
