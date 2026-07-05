import { describe, expect, it } from 'vitest'

import { Role, type Message } from '../../src/agent/message'
import {
  maybeBuildFundCandidateDiscoveryAnswer,
} from '../../src/domain/finance/workflows/finance-fund-candidate-summary'
import {
  maybeBuildStockCandidateDiscoveryAnswer,
} from '../../src/domain/finance/workflows/finance-stock-candidate-summary'
import { maybeBuildFinanceBoundedAnswer } from '../../src/domain/finance/workflows/finance-workflow-hooks'

function user(content: string): Message {
  return {
    role: Role.User,
    content,
  }
}

function assistantTool(id: string, name: string, input: Record<string, unknown>): Message {
  return {
    role: Role.Assistant,
    content: '',
    toolUses: [{ id, name, input }],
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

function evidenceFromAnswer(answer: string): Record<string, unknown> {
  const line = answer.split(/\r?\n/).find((item) => item.startsWith('analysisEvidence:'))
  if (!line) throw new Error(`missing analysisEvidence line in:\n${answer}`)
  return JSON.parse(line.slice('analysisEvidence:'.length)) as Record<string, unknown>
}

describe('finance candidate workflow summaries', () => {
  it('adds candidate analysis evidence to stock discovery summaries', () => {
    const answer = maybeBuildStockCandidateDiscoveryAnswer([
      assistantTool('breakout', 'DataProcess', { action: 'breakout_summary' }),
      tool('breakout', {
        action: 'breakout_summary',
        sourcePolicy: 'local-first',
        results: [
          { code: '300059', name: '东方财富', status: 'ok', score: 91, decision: 'watch', quotePrice: 20.5, changePct: 3.2, latestDate: '2026-07-02' },
          { code: '600519', name: '贵州茅台', status: 'ok', score: 86, decision: 'watch', quotePrice: 1500, changePct: 1.2, latestDate: '2026-07-02' },
          { code: '000858', name: '五粮液', status: 'ok', score: 81, decision: 'watch', quotePrice: 120, changePct: 0.8, latestDate: '2026-07-02' },
        ],
      }),
    ])

    expect(answer).toBeTruthy()
    const evidence = evidenceFromAnswer(answer!)
    expect(evidence.contract).toBe('analysis-evidence-v1')
    expect(evidence.kind).toBe('candidate_research')
    expect(evidence.strategyReadiness).toBe('candidate')
    expect((evidence.subject as any).type).toBe('candidate_set')
  })

  it('adds candidate analysis evidence to fund discovery summaries', () => {
    const screenResult = fundScreenResult()
    const answer = maybeBuildFundCandidateDiscoveryAnswer([
      assistantTool('screen', 'DataStore', { action: 'screen_fund' }),
      tool('screen', screenResult),
    ])

    expect(answer).toBeTruthy()
    const evidence = evidenceFromAnswer(answer!)
    expect(evidence.contract).toBe('analysis-evidence-v1')
    expect(evidence.kind).toBe('candidate_research')
    expect(evidence.strategyReadiness).toBe('candidate')
    expect((evidence.sourceCoverage as any).canonicalTable).toBe('fund_performance_metrics')
  })

  it('builds stock candidate bounded answer only with structured workflow state', () => {
    const evidenceMessages = [
      assistantTool('breakout', 'DataProcess', { action: 'breakout_summary' }),
      tool('breakout', {
        action: 'breakout_summary',
        sourcePolicy: 'local-first',
        results: [
          { code: '300059', name: '东方财富', status: 'ok', score: 91, decision: 'watch', quotePrice: 20.5, changePct: 3.2, latestDate: '2026-07-02' },
          { code: '600519', name: '贵州茅台', status: 'ok', score: 86, decision: 'watch', quotePrice: 1500, changePct: 1.2, latestDate: '2026-07-02' },
          { code: '000858', name: '五粮液', status: 'ok', score: 81, decision: 'watch', quotePrice: 120, changePct: 0.8, latestDate: '2026-07-02' },
        ],
      }),
    ]

    const promptOnly = maybeBuildFinanceBoundedAnswer([
      user('帮我筛选值得观察的股票候选'),
      ...evidenceMessages,
    ])
    expect(promptOnly).toBeNull()

    const structured = maybeBuildFinanceBoundedAnswer([
      user(
        'stock candidates\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"stock_research","assetClass":"stock","intentMode":"analysis","executionMode":"preview_only","safetyBoundary":"candidate observation only","evidenceRefs":["breakout_summary"],"confirmationState":"none","source":"agent-structured-intent"}}'
      ),
      ...evidenceMessages,
    ])
    expect(structured).toContain('观察候选')
    expect(structured).toContain('analysisEvidence:')
  })

  it('builds fund candidate bounded answer only with structured workflow state', () => {
    const evidenceMessages = [
      assistantTool('screen', 'DataStore', { action: 'screen_fund' }),
      tool('screen', fundScreenResult()),
    ]

    const promptOnly = maybeBuildFinanceBoundedAnswer([
      user('帮我选几个适合长期观察的基金，并说明数据依据。'),
      ...evidenceMessages,
    ])
    expect(promptOnly).toBeNull()

    const structured = maybeBuildFinanceBoundedAnswer([
      user(
        'fund candidates\n' +
        'data: {"workflowState":{"contract":"finance-workflow-state-v1","workflowKind":"fund_research","assetClass":"fund","intentMode":"analysis","executionMode":"preview_only","safetyBoundary":"candidate observation only","evidenceRefs":["screen_fund"],"confirmationState":"none","source":"agent-structured-intent"}}'
      ),
      ...evidenceMessages,
    ])
    expect(structured).toContain('基金关注候选')
    expect(structured).toContain('analysisEvidence:')
  })

  it('rejects legacy fund screener prose even when it resembles candidates', () => {
    const answer = maybeBuildFundCandidateDiscoveryAnswer([
      assistantTool('screen', 'DataStore', { action: 'screen_fund' }),
      tool('screen', 'Source: local\nCoverage: rows:3\n110011 易方达中小盘 NAV:5.21 1Y:12.1 3Y:35.2'),
    ])

    expect(answer).toBeNull()
  })
})

function fundScreenResult(): Record<string, unknown> {
  return {
    action: 'screen_fund',
    interfaceId: 'fund.candidate_research',
    provider: 'local',
    capabilityId: 'local.cache',
    canonicalSchema: 'fund_performance_metrics',
    canonicalTable: 'fund_performance_metrics',
    coverage: { rows: 3, return_1y: 3, return_3y: 3, nav: 3 },
    candidates: [
      { code: '110011', name: '易方达中小盘', fund_type: '混合型', nav: 5.21, return_1y: 12.1, return_3y: 35.2 },
      { code: '161725', name: '招商中证白酒', fund_type: '指数型', nav: 1.25, return_1y: 10.1, return_3y: 30.2 },
      { code: '163402', name: '兴全趋势', fund_type: '混合型', nav: 0.98, return_1y: 8.1, return_3y: 28.2 },
    ],
  }
}
