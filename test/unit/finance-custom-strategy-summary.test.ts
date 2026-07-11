import { describe, expect, it } from 'vitest'

import { Role, type Message } from '../../src/agent/message'
import {
  maybeBuildCustomStrategyBacktestAnswer,
  maybeBuildCustomStrategyComparisonAnswer,
  maybeBuildCustomStrategyRejectedValidationAnswer,
  maybeBuildCustomStrategyRepeatedSaveAnswer,
  maybeBuildCustomStrategySaveAnswer,
  maybeBuildCustomStrategySaveRunBoundaryAnswer,
  maybeBuildCustomStrategySavedAnswer,
  maybeBuildCustomStrategyUnsupportedProxyAnswer,
} from '../../src/domain/finance/workflows/finance-custom-strategy-summary'

function user(content: string): Message {
  return { role: Role.User, content }
}

function assistantTool(id: string, input: Record<string, unknown>): Message {
  return {
    role: Role.Assistant,
    content: '',
    toolUses: [{ id, name: 'MarketData', input }],
  }
}

function tool(id: string, content: Record<string, unknown> | string, isError = false): Message {
  return {
    role: Role.Tool,
    content: '',
    toolResult: {
      toolUseId: id,
      content: typeof content === 'string' ? content : JSON.stringify(content),
      isError,
    },
  }
}

function backtestResult(symbol: string, totalReturnPct: number, trades: number): Record<string, unknown> {
  return {
    action: 'custom_strategy_backtest',
    status: 'backtested',
    symbol,
    strategyId: `strategy_${symbol}`,
    actualStartDate: '2025-07-01',
    actualEndDate: '2026-06-30',
    bars: 240,
    dataCoverage: {
      mode: 'strategy_backtest_kline_coverage',
      symbol,
      rows: 240,
      requiredBars: 120,
      sufficient: true,
      actualStartDate: '2025-07-01',
      actualEndDate: '2026-06-30',
      source: 'local kline_daily',
      cacheStatus: 'local-hit',
    },
    metrics: {
      tradeCount: trades,
      totalReturnPct,
      maxDrawdownPct: 8,
      winRatePct: 50,
    },
    assumptions: {
      commissionPct: 0.1,
      slippagePct: 0.05,
    },
    validation: {
      spec: { id: `strategy_${symbol}`, symbol },
    },
  }
}

describe('finance custom strategy summaries', () => {
  it('builds comparison answer only after comparable custom backtests exist', () => {
    const messages: Message[] = [
      user(
        'compare structured strategies\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"strategy_review","assetClass":"stock","intentMode":"backtest","executionMode":"preview_only","safetyBoundary":"read-only backtest","evidenceRefs":["custom_strategy_backtest"],"confirmationState":"none","source":"agent-structured-intent"}}'
      ),
      assistantTool('bt-600519', { action: 'custom_strategy_backtest', code: '600519' }),
      tool('bt-600519', backtestResult('600519', 3, 1)),
      assistantTool('bt-000858', { action: 'custom_strategy_backtest', code: '000858' }),
      tool('bt-000858', backtestResult('000858', 6, 2)),
      assistantTool('bt-300059', { action: 'custom_strategy_backtest', code: '300059' }),
      tool('bt-300059', backtestResult('300059', 1, 1)),
    ]

    const answer = maybeBuildCustomStrategyComparisonAnswer(messages)

    expect(answer).toContain('多标的动量策略比较')
    expect(answer).toContain('600519')
    expect(answer).toContain('000858')
    expect(answer).toContain('300059')
    expect(answer).toContain('优先候选为 000858')
    expect(answer).toContain('覆盖满足')
    expect(answer).toContain('cache=local-hit')
  })

  it('does not build comparison answer from prompt text alone', () => {
    const messages: Message[] = [
      user('帮我比较茅台、五粮液、东方财富，找出更适合动量策略的一只，并说明数据来源和回测假设。'),
      assistantTool('bt-600519', { action: 'custom_strategy_backtest', code: '600519' }),
      tool('bt-600519', backtestResult('600519', 3, 1)),
      assistantTool('bt-000858', { action: 'custom_strategy_backtest', code: '000858' }),
      tool('bt-000858', backtestResult('000858', 6, 2)),
    ]

    const answer = maybeBuildCustomStrategyComparisonAnswer(messages)

    expect(answer).toBeNull()
  })

  it('blocks proxy validation only from structured unsupported workflow state', () => {
    const messages: Message[] = [
      user(
        'structured unsupported strategy request\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"strategy_design","assetClass":"stock","intentMode":"validate","executionMode":"blocked","safetyBoundary":"unsupported strategy parts","evidenceRefs":["StrategySpec"],"confirmationState":"none","source":"agent-structured-intent","hasUnsupportedExecutableParts":true}}'
      ),
      assistantTool('help', { action: 'custom_strategy_help' }),
      tool('help', { action: 'custom_strategy_help' }),
    ]

    const answer = maybeBuildCustomStrategyUnsupportedProxyAnswer(messages, [
      {
        id: 'proxy',
        name: 'MarketData',
        input: {
          action: 'custom_strategy_validate',
          strategySpec: {
            name: 'proxy strategy',
            entry: { conditions: [{ indicator: 'rsi', operator: '>', value: 40 }] },
          },
        },
      },
    ])

    expect(answer).toContain('结构化工作流状态')
    expect(answer).toContain('未创建代理规则')
  })

  it('does not block proxy validation from unsupported-looking prompt text alone', () => {
    const messages: Message[] = [
      user('创建一个用新闻情绪和主力资金实时盘口决定买卖的策略并回测。'),
      assistantTool('help', { action: 'custom_strategy_help' }),
      tool('help', { action: 'custom_strategy_help' }),
    ]

    const answer = maybeBuildCustomStrategyUnsupportedProxyAnswer(messages, [
      {
        id: 'proxy',
        name: 'MarketData',
        input: {
          action: 'custom_strategy_validate',
          strategySpec: {
            name: 'proxy strategy',
            entry: { conditions: [{ indicator: 'rsi', operator: '>', value: 40 }] },
          },
        },
      },
    ])

    expect(answer).toBeNull()
  })

  it('reports rejected validation without parsing error vocabulary', () => {
    const messages: Message[] = [
      user('structured validation'),
      assistantTool('validate', { action: 'custom_strategy_validate' }),
      tool('validate', {
        action: 'custom_strategy_validate',
        status: 'rejected',
        strategyId: 'bad_exit_v1',
        errors: ['exit operator missing', 'exit rule has no executable right-hand value'],
      }),
    ]

    const answer = maybeBuildCustomStrategyRejectedValidationAnswer(messages, [
      { id: 'extra', name: 'MarketData', input: { action: 'custom_strategy_backtest' } },
    ])

    expect(answer).toContain('验证状态：rejected')
    expect(answer).toContain('exit operator missing')
    expect(answer).toContain('exit rule has no executable right-hand value')
  })

  it('formats custom backtest symbol and position sizing without leaking objects', () => {
    const messages: Message[] = [
      user('帮我从自选股里找一只适合趋势策略的股票，设计策略并用本地数据回测，先不要下单。'),
      assistantTool('bt', { action: 'custom_strategy_backtest', code: '002129' }),
      tool('bt', {
        ...backtestResult('', 12, 2),
        symbol: undefined,
        code: '002129',
        assumptions: {
          commissionPct: 0.1,
          slippagePct: 0.05,
          positionSizing: { type: 'fixed_fraction', value: 0.5 },
        },
        validation: {
          spec: {
            id: 'custom_trend_v1',
            positionSizing: { type: 'fixed_fraction', value: 0.5 },
          },
        },
      }),
      assistantTool('extra', { action: 'query_quote' }),
    ]

    const answer = maybeBuildCustomStrategyBacktestAnswer(messages, [
      { id: 'extra', name: 'MarketData', input: { action: 'query_quote' } },
    ])

    expect(answer).toContain('标的：002129')
    expect(answer).toContain('仓位规则：fixed_fraction (value=0.5)')
    expect(answer).toContain('数据覆盖：2025-07-01 ~ 2026-06-30')
    expect(answer).toContain('覆盖满足')
    expect(answer).not.toContain('[object Object]')
  })

  it('does not turn structured save/rerun lifecycle calls into a backtest-only answer', () => {
    const messages: Message[] = [
      user('structured strategy lifecycle'),
      assistantTool('bt', { action: 'custom_strategy_backtest', code: '600519' }),
      tool('bt', {
        ...backtestResult('600519', 0, 0),
        lifecycleAdvice: {
          status: 'saveable_backtest_evidence',
          saveable: true,
          runnableAfterSave: true,
          nextActions: ['custom_strategy_save', 'custom_strategy_run'],
        },
      }),
    ]

    const answer = maybeBuildCustomStrategyBacktestAnswer(messages, [
      { id: 'save', name: 'MarketData', input: { action: 'custom_strategy_save' } },
      { id: 'run', name: 'MarketData', input: { action: 'custom_strategy_run', strategyId: 'strategy_600519' } },
    ])

    expect(answer).toBeNull()
  })

  it('reports validation-only save as non-runnable when rerun fails', () => {
    const messages: Message[] = [
      user(
        'rerun structured saved strategy\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"strategy_review","assetClass":"stock","intentMode":"rerun","executionMode":"preview_only","safetyBoundary":"reuse saved strategy artifact","evidenceRefs":["custom_strategy_save"],"confirmationState":"none","source":"agent-structured-intent"}}'
      ),
      assistantTool('save', { action: 'custom_strategy_save' }),
      tool('save', {
        action: 'custom_strategy_save',
        strategyId: 'custom_fund_watch_v1',
        version: 1,
        status: 'validated',
        spec: { id: 'custom_fund_watch_v1', name: '基金定投观察策略' },
        validation: { status: 'validated' },
        evidence: null,
      }),
      assistantTool('run', { action: 'custom_strategy_run', strategyId: 'custom_fund_watch_v1' }),
      tool(
        'run',
        'custom strategy custom_fund_watch_v1 is not runnable; status=validated. Run custom_strategy_backtest and save backtested evidence first.',
        true,
      ),
    ]

    const answer = maybeBuildCustomStrategySaveRunBoundaryAnswer(messages)

    expect(answer).toContain('策略保存与重跑边界')
    expect(answer).toContain('保存状态：validated')
    expect(answer).toContain('不能声明“按 strategyId 重跑一致”')
    expect(answer).toContain('backtested evidence')
  })

  it('builds save-rerun boundary from structured save and run evidence without prompt parsing', () => {
    const messages: Message[] = [
      user('把刚才验证通过的策略保存下来，然后重新按策略 ID 跑一次，确认结果一致。'),
      assistantTool('save', { action: 'custom_strategy_save' }),
      tool('save', {
        action: 'custom_strategy_save',
        strategyId: 'custom_ema_v1',
        version: 1,
        status: 'backtested',
        spec: { id: 'custom_ema_v1', name: '贵州茅台_EMA趋势' },
        validation: { status: 'validated' },
        evidence: { status: 'backtested', bars: 240 },
      }),
      assistantTool('run', { action: 'custom_strategy_run', strategyId: 'custom_ema_v1', code: '000858' }),
      tool('run', {
        ...backtestResult('000858', 4, 1),
        action: 'custom_strategy_run',
        code: '000858',
        strategyId: 'custom_ema_v1',
        status: 'backtested',
      }),
    ]

    const answer = maybeBuildCustomStrategySaveRunBoundaryAnswer(messages)

    expect(answer).toContain('策略保存与重跑完成')
    expect(answer).toContain('strategyId：custom_ema_v1')
    expect(answer).toContain('标的：000858')
    expect(answer).toContain('数据覆盖')
  })

  it('stops repeated custom_strategy_save from structured save evidence without prompt parsing', () => {
    const messages: Message[] = [
      user('保存策略。'),
      assistantTool('save', { action: 'custom_strategy_save' }),
      tool('save', {
        action: 'custom_strategy_save',
        strategyId: 'custom_ema_v1',
        version: 1,
        status: 'backtested',
        spec: { id: 'custom_ema_v1', name: 'EMA 趋势策略' },
        validation: { status: 'validated' },
        evidence: { status: 'backtested', actualStartDate: '2025-07-01', actualEndDate: '2026-06-30', bars: 240 },
      }),
    ]

    const answer = maybeBuildCustomStrategyRepeatedSaveAnswer(messages, [
      { id: 'repeat-save', name: 'MarketData', input: { action: 'custom_strategy_save' } },
    ])

    expect(answer).toContain('已经保存成功')
    expect(answer).toContain('custom_ema_v1')
    expect(answer).toContain('停止')
  })

  it('builds rerun answer from custom_strategy_run evidence without a same-turn save', () => {
    const messages: Message[] = [
      user('换成五粮液000858重跑已保存策略。'),
      assistantTool('run', { action: 'custom_strategy_run', strategyId: 'custom_ema_v1', code: '000858' }),
      tool('run', {
        ...backtestResult('000858', 4, 1),
        action: 'custom_strategy_run',
        code: '000858',
        strategyId: 'custom_ema_v1',
        status: 'backtested',
      }),
    ]

    const answer = maybeBuildCustomStrategySaveRunBoundaryAnswer(messages)

    expect(answer).toContain('策略保存与重跑完成')
    expect(answer).toContain('strategyId：custom_ema_v1')
    expect(answer).toContain('标的：000858')
  })

  it('does not close a natural-language save-rerun turn after save only', () => {
    const messages: Message[] = [
      user('保存刚才验证通过的策略，然后换一只股票重跑。'),
      assistantTool('save', { action: 'custom_strategy_save' }),
      tool('save', {
        action: 'custom_strategy_save',
        strategyId: 'custom_ema_v1',
        version: 1,
        status: 'backtested',
        spec: { id: 'custom_ema_v1', name: '贵州茅台_EMA趋势' },
        validation: { status: 'validated' },
        evidence: { status: 'backtested', bars: 240 },
      }),
    ]

    expect(maybeBuildCustomStrategySavedAnswer(messages)).toBeNull()
    expect(
      maybeBuildCustomStrategySaveAnswer(messages, [
        { id: 'next-kline', name: 'MarketData', input: { action: 'query_kline' } },
      ]),
    ).toBeNull()
  })
})
