import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArtifactRegistry } from '../../src/agent/artifact-registry'
import type { ToolContext } from '../../src/agent/tool'
import { WorkflowVerifierTool } from '../../src/agent/tools/workflow-verifier'

describe('WorkflowVerifierTool', () => {
  it('passes with tool and artifact evidence', async () => {
    const ctx = tempToolContext()
    seedSession(ctx, 'MarketData')
    new ArtifactRegistry(ctx.basePath).register({
      kind: 'analysis',
      path: 'memory/reports/stock-analysis.md',
      title: 'Stock analysis',
      source: 'agent-workflow',
      verificationStatus: 'verified',
    })

    const result = JSON.parse(await new WorkflowVerifierTool().call('verify-1', {
      action: 'check',
      workflow: 'stock_research',
    }, ctx))

    expect(result.contract).toBe('workflow-verifier-check-v1')
    expect(result.passed).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.observed.toolNames).toContain('MarketData')
  })

  it('reports missing artifact evidence', async () => {
    const ctx = tempToolContext()
    seedSession(ctx, 'MarketData')

    const result = JSON.parse(await new WorkflowVerifierTool().call('verify-2', {
      action: 'check',
      workflow: 'stock_research',
    }, ctx))

    expect(result.passed).toBe(false)
    expect(result.missing).toContain('artifact_evidence')
    expect(result.nextAction).toContain('Do not finalize yet')
  })

  it('accepts stock selection evidence without requiring stale artifact reuse', async () => {
    const ctx = tempToolContext()
    seedSession(ctx, 'DataProcess')
    seedWorkflowState(ctx, 'stock_selection')

    const result = JSON.parse(await new WorkflowVerifierTool().call('verify-selection', {
      action: 'check',
      workflow: 'stock_selection',
      requireWorkflowState: true,
    }, ctx))

    expect(result.passed).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.observed.workflowState.workflowState.workflowKind).toBe('stock_selection')
    expect(result.checks.find((item: { id: string }) => item.id === 'artifact_evidence').message).toContain('Artifact evidence is optional')
  })

  it('requires fund-specific readback evidence for fund selection', async () => {
    const ctx = tempToolContext()
    seedSessionCalls(ctx, [
      { id: 'tool-1', name: 'DataStore', input: { action: 'query_macro_factors', target: 'bond funds' }, result: '{"status":"ok"}' },
    ])

    const missingResult = JSON.parse(await new WorkflowVerifierTool().call('verify-fund-missing', {
      action: 'check',
      workflow: 'fund_selection',
    }, ctx))

    expect(missingResult.passed).toBe(false)
    expect(missingResult.missing).toContain('fund_identity_evidence')
    expect(missingResult.missing).toContain('fund_nav_or_yield_evidence')

    seedSessionCalls(ctx, [
      { id: 'tool-1', name: 'DataStore', input: { action: 'query_fund_list', limit: 20 }, result: 'fund_list | interface:fund.identity_list' },
      { id: 'tool-2', name: 'DataStore', input: { action: 'query_fund_nav', code: '000083', limit: 60 }, result: '000083 fund NAV | interface:fund.nav_history' },
      { id: 'tool-3', name: 'DataStore', input: { action: 'query_macro_factors', target: 'bond funds' }, result: '{"status":"ok"}' },
    ])

    const passedResult = JSON.parse(await new WorkflowVerifierTool().call('verify-fund-pass', {
      action: 'check',
      workflow: 'fund_selection',
    }, ctx))

    expect(passedResult.passed).toBe(true)
    expect(passedResult.missing).toEqual([])
    expect(passedResult.observed.workflowSpecific.navOrYield.action).toBe('query_fund_nav')
  })

  it('rejects stock selection when saved workflow state belongs to stock research', async () => {
    const ctx = tempToolContext()
    seedSession(ctx, 'DataProcess')
    seedWorkflowState(ctx, 'stock_research')

    const result = JSON.parse(await new WorkflowVerifierTool().call('verify-selection-state', {
      action: 'check',
      workflow: 'stock_selection',
      requireWorkflowState: true,
    }, ctx))

    expect(result.passed).toBe(false)
    expect(result.missing).toContain('workflow_state')
    expect(result.checks.find((item: { id: string }) => item.id === 'workflow_state').message).toContain('stock_selection')
  })

  it('requires watchlist handoff add, readback, condition, and source evidence', async () => {
    const ctx = tempToolContext()
    seedSession(ctx, 'Watchlist')
    seedWorkflowState(ctx, 'watchlist_handoff')

    const missingResult = JSON.parse(await new WorkflowVerifierTool().call('verify-watchlist-missing', {
      action: 'check',
      workflow: 'watchlist_handoff',
      requireWorkflowState: true,
    }, ctx))

    expect(missingResult.passed).toBe(false)
    expect(missingResult.missing).toContain('watchlist_add_evidence')
    expect(missingResult.missing).toContain('watchlist_readback_evidence')

    seedSessionCalls(ctx, [
      {
        id: 'tool-1',
        name: 'Watchlist',
        input: {
          action: 'add',
          symbol: '002215',
          name: '诺普信',
          entryCondition: 'ROE remains above 15 and valuation gap is resolved',
          stopLoss: 8,
          source: 'stock-picking: query_stock_daily_valuation + query_fundamental',
        },
        result: '{"status":"added","symbol":"002215"}',
      },
      {
        id: 'tool-2',
        name: 'Watchlist',
        input: { action: 'list', symbol: '002215' },
        result: '{"count":1,"items":[{"symbol":"002215","entryCondition":"ROE remains above 15"}]}',
      },
    ])

    const result = JSON.parse(await new WorkflowVerifierTool().call('verify-watchlist', {
      action: 'check',
      workflow: 'watchlist_handoff',
      requireWorkflowState: true,
    }, ctx))

    expect(result.passed).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.observed.toolNames).toContain('Watchlist')
    expect(result.observed.workflowSpecific.added).toHaveLength(1)
    expect(result.observed.workflowSpecific.readback).toHaveLength(1)
  })

  it('treats earlier data fetch failures as recovered after valid watchlist handoff evidence', async () => {
    const ctx = tempToolContext()
    seedWorkflowState(ctx, 'watchlist_handoff')
    seedSessionCalls(ctx, [
      {
        id: 'tool-1',
        name: 'DataStore',
        input: { action: 'fetch', code: '600519', type: 'fundamental' },
        result: 'DataStore fetch failed: provider unavailable',
        isError: true,
      },
      {
        id: 'tool-2',
        name: 'Watchlist',
        input: {
          action: 'add',
          symbol: '600519',
          name: '贵州茅台',
          entryCondition: 'Wait for valuation and price confirmation',
          stopLoss: 1100,
          source: 'query_stock_daily_valuation(local cache)',
        },
        result: '{"status":"added","symbol":"600519"}',
      },
      {
        id: 'tool-3',
        name: 'Watchlist',
        input: { action: 'list', symbol: '600519' },
        result: '{"count":1,"items":[{"symbol":"600519","entryCondition":"Wait for valuation and price confirmation"}]}',
      },
    ])

    const result = JSON.parse(await new WorkflowVerifierTool().call('verify-watchlist-recovered-error', {
      action: 'check',
      workflow: 'watchlist_handoff',
      requireWorkflowState: true,
    }, ctx))

    expect(result.passed).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.checks.find((item: { id: string }) => item.id === 'no_tool_errors').message).toContain('recovered tool error')
  })

  it('accepts strategy rerun with strategy tool evidence and matching state', async () => {
    const ctx = tempToolContext()
    seedSessionCalls(ctx, [
      {
        id: 'tool-1',
        name: 'MarketData',
        input: { action: 'custom_strategy_run', strategyId: 'custom_moutai_ema_trend_v1_v1', symbols: ['300059'] },
        result: JSON.stringify({
          action: 'custom_strategy_run',
          strategyId: 'custom_moutai_ema_trend_v1_v1',
          code: '300059',
          dataCoverage: { symbol: '300059', sufficient: true },
        }),
      },
    ])
    seedWorkflowState(ctx, 'strategy_rerun')
    new ArtifactRegistry(ctx.basePath).register({
      kind: 'backtest',
      path: 'memory/reports/backtest.md',
      title: 'Backtest',
      source: 'agent-workflow',
      verificationStatus: 'verified',
    })

    const result = JSON.parse(await new WorkflowVerifierTool().call('verify-rerun', {
      action: 'check',
      workflow: 'strategy_rerun',
      requireWorkflowState: true,
      strategyId: 'custom_moutai_ema_trend_v1_v1',
      targetSymbols: ['300059'],
    }, ctx))

    expect(result.passed).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('rejects strategy rerun when custom_strategy_run did not cover the selected target', async () => {
    const ctx = tempToolContext()
    seedSessionCalls(ctx, [
      {
        id: 'tool-1',
        name: 'MarketData',
        input: { action: 'custom_strategy_run', strategyId: 'custom_moutai_ema_trend_v1_v1', symbols: ['600519'] },
        result: JSON.stringify({
          action: 'custom_strategy_run',
          strategyId: 'custom_moutai_ema_trend_v1_v1',
          code: '600519',
          dataCoverage: { symbol: '600519', sufficient: true },
        }),
      },
    ])
    seedWorkflowState(ctx, 'strategy_rerun')
    new ArtifactRegistry(ctx.basePath).register({
      kind: 'backtest',
      path: 'memory/reports/backtest.md',
      title: 'Backtest',
      source: 'agent-workflow',
      verificationStatus: 'verified',
    })

    const result = JSON.parse(await new WorkflowVerifierTool().call('verify-rerun-target', {
      action: 'check',
      workflow: 'strategy_rerun',
      requireWorkflowState: true,
      strategyId: 'custom_moutai_ema_trend_v1_v1',
      targetSymbols: ['300059'],
    }, ctx))

    expect(result.passed).toBe(false)
    expect(result.missing).toContain('strategy_rerun_target_symbols')
    expect(result.nextAction).toContain('Do not finalize yet')
  })

  it('accepts trade review with simulated trading evidence and matching state', async () => {
    const ctx = tempToolContext()
    seedSession(ctx, 'XueqiuTrade')
    seedWorkflowState(ctx, 'trade_review')

    const result = JSON.parse(await new WorkflowVerifierTool().call('verify-trade-review', {
      action: 'check',
      workflow: 'trade_review',
      requireWorkflowState: true,
    }, ctx))

    expect(result.passed).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('accepts trade preparation when sizing evidence exists and no order side effect is visible', async () => {
    const ctx = tempToolContext()
    seedSessionCalls(ctx, [
      { id: 'tool-1', name: 'XueqiuTrade', input: { action: 'balance' }, result: '{"cash":100000}' },
      { id: 'tool-2', name: 'MarketData', input: { action: 'quote', code: '600519' }, result: '{"price":1204.98}' },
      { id: 'tool-3', name: 'DataProcess', input: { action: 'indicators', code: '600519' }, result: '{"rsi":40.9}' },
    ])

    const result = JSON.parse(await new WorkflowVerifierTool().call('verify-trade-prep', {
      action: 'check',
      workflow: 'trade_preparation',
    }, ctx))

    expect(result.passed).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.observed.approvalBoundary.accountEvidence).toBe(true)
    expect(result.observed.approvalBoundary.sizingEvidence).toBe(true)
    expect(result.observed.approvalBoundary.sideEffectCalls).toEqual([])
  })

  it('rejects trade preparation when an order side effect is visible', async () => {
    const ctx = tempToolContext()
    seedSessionCalls(ctx, [
      { id: 'tool-1', name: 'XueqiuTrade', input: { action: 'balance' }, result: '{"cash":100000}' },
      { id: 'tool-2', name: 'MarketData', input: { action: 'quote', code: '600519' }, result: '{"price":1204.98}' },
      { id: 'tool-3', name: 'XueqiuTrade', input: { action: 'buy', symbol: 'SH600519', shares: 8 }, result: '{"success":true}' },
    ])

    const result = JSON.parse(await new WorkflowVerifierTool().call('verify-trade-prep-write', {
      action: 'check',
      workflow: 'trade_preparation',
    }, ctx))

    expect(result.passed).toBe(false)
    expect(result.missing).toContain('approval_boundary')
    expect(result.missing).toContain('trade_no_side_effect')
    expect(result.observed.approvalBoundary.sideEffectCalls).toEqual(['XueqiuTrade.buy'])
  })

  it('accepts matching typed workflow state', async () => {
    const ctx = tempToolContext()
    seedSession(ctx, 'MarketData')
    seedWorkflowState(ctx, 'stock_research')
    new ArtifactRegistry(ctx.basePath).register({
      kind: 'analysis',
      path: 'memory/reports/stock-analysis.md',
      title: 'Stock analysis',
      source: 'agent-workflow',
      verificationStatus: 'verified',
    })

    const result = JSON.parse(await new WorkflowVerifierTool().call('verify-state', {
      action: 'check',
      workflow: 'stock_research',
      requireWorkflowState: true,
      providerHealth: [
        { provider: 'tdx', status: 'healthy' },
      ],
    }, ctx))

    expect(result.passed).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.observed.workflowState.id).toBe('state-1')
  })

  it('fails on blocking provider health', async () => {
    const ctx = tempToolContext()
    seedSession(ctx, 'MarketData')
    new ArtifactRegistry(ctx.basePath).register({
      kind: 'analysis',
      path: 'memory/reports/stock-analysis.md',
      title: 'Stock analysis',
      source: 'agent-workflow',
      verificationStatus: 'verified',
    })

    const result = JSON.parse(await new WorkflowVerifierTool().call('verify-health', {
      action: 'check',
      workflow: 'stock_research',
      providerHealth: [
        { provider: 'eastmoney', status: 'transport_unstable' },
      ],
    }, ctx))

    expect(result.passed).toBe(false)
    expect(result.missing).toContain('provider_health')
    expect(result.checks.find((item: { id: string }) => item.id === 'provider_health').message).toContain('eastmoney:transport_unstable')
  })

  it('accepts durable macro evidence records', async () => {
    const ctx = tempToolContext()
    seedSession(ctx, 'SourceReader')
    seedWorkflowState(ctx, 'macro_factor_lookup')
    seedMacroEvidence(ctx)

    const result = JSON.parse(await new WorkflowVerifierTool().call('verify-macro', {
      action: 'check',
      workflow: 'macro_factor_lookup',
      requireWorkflowState: true,
    }, ctx))

    expect(result.passed).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.observed.artifact.kind).toBe('macro_evidence')
    expect(result.observed.artifact.record.contract).toBe('macro-evidence-record-v1')
  })

  it('rejects unknown workflow through the tool error channel', async () => {
    const ctx = tempToolContext()
    await expect(new WorkflowVerifierTool().call('verify-3', {
      action: 'check',
      workflow: 'unknown',
    }, ctx)).rejects.toThrow('Unknown WorkflowVerifier workflow')
  })
})

function tempToolContext(): ToolContext {
  const basePath = mkdtempSync(join(tmpdir(), 'fin-workflow-verifier-tool-'))
  const memoryDir = join(basePath, 'memory')
  mkdirSync(memoryDir, { recursive: true })
  return {
    basePath,
    workDir: basePath,
    memoryDir,
    bundleDir: join(basePath, 'bundle'),
    projectLocalDir: join(basePath, '.finagent-workstation'),
    pluginSkillPaths: [],
    skipPermissions: false,
    approvedTools: new Set(),
    planMode: false,
    readFileTimestamps: new Map(),
    taskRegistry: {} as ToolContext['taskRegistry'],
    teamRegistry: {} as ToolContext['teamRegistry'],
  }
}

function seedWorkflowState(ctx: ToolContext, workflowKind: string): void {
  const dir = join(ctx.memoryDir, 'workflows')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'state.json'), JSON.stringify({
    contract: 'workflow-state-store-v1',
    records: [
      {
        id: 'state-1',
        contract: 'workflow-state-record-v1',
        status: 'active',
        workflowState: {
          contract: 'finance-workflow-state-v1',
          workflowKind,
          assetClass: 'stock',
          intentMode: 'analysis',
          executionMode: 'preview_only',
          safetyBoundary: 'no_trade',
          evidenceRefs: ['quote'],
          confirmationState: 'none',
          source: 'test',
        },
        requiredEvidence: ['quote'],
        completedSteps: ['quote'],
        generatedArtifacts: [],
        updatedAt: '2026-07-11T00:00:00.000Z',
      },
    ],
  }), 'utf-8')
}

function seedMacroEvidence(ctx: ToolContext): void {
  const dir = join(ctx.memoryDir, 'macro_evidence')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'macro_test.json'), JSON.stringify({
    contract: 'macro-evidence-record-v1',
    id: 'macro:test',
    source: 'bea',
    title: 'Official macro evidence',
    topic: 'rates and demand',
    region: 'US',
    assetClass: 'equity',
    keyClaims: ['Demand conditions affect cyclical earnings.'],
    affectedAssets: ['A-shares', 'cyclical stocks'],
    confidenceEffect: 'raises confidence in macro attribution, not a trade signal',
    freshness: 'fresh',
    tradeBoundary: 'Macro evidence is context, hypothesis, and invalidation input. It is not a direct buy/sell rule.',
  }), 'utf-8')
}

function seedSession(ctx: ToolContext, toolName: string): void {
  seedSessionCalls(ctx, [
    { id: 'tool-1', name: toolName, input: {}, result: '{}' },
  ])
}

function seedSessionCalls(ctx: ToolContext, calls: Array<{
  id: string
  name: string
  input: Record<string, unknown>
  result: string
  isError?: boolean
}>): void {
  const dir = join(ctx.basePath, 'sessions')
  mkdirSync(dir, { recursive: true })
  const lines = [
    JSON.stringify({
      type: 'message',
      role: 'assistant',
      toolUses: calls.map((call) => ({ id: call.id, name: call.name, input: call.input })),
    }),
    ...calls.map((call) => JSON.stringify({
      type: 'message',
      role: 'tool',
      toolResult: {
        toolUseId: call.id,
        content: call.result,
        isError: call.isError === true,
      },
    })),
  ]
  writeFileSync(join(dir, 'current.jsonl'), lines.join('\n'), 'utf-8')
}
