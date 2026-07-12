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

  it('accepts watchlist handoff with watchlist tool and matching typed state', async () => {
    const ctx = tempToolContext()
    seedSession(ctx, 'Watchlist')
    seedWorkflowState(ctx, 'watchlist_handoff')

    const result = JSON.parse(await new WorkflowVerifierTool().call('verify-watchlist', {
      action: 'check',
      workflow: 'watchlist_handoff',
      requireWorkflowState: true,
    }, ctx))

    expect(result.passed).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.observed.toolNames).toContain('Watchlist')
  })

  it('accepts strategy rerun with strategy tool evidence and matching state', async () => {
    const ctx = tempToolContext()
    seedSession(ctx, 'MarketData')
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
    }, ctx))

    expect(result.passed).toBe(true)
    expect(result.missing).toEqual([])
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
    seedWorkflowState(ctx, 'macro_attribution')
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
  const dir = join(ctx.basePath, 'sessions')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'current.jsonl'), [
    JSON.stringify({
      type: 'message',
      role: 'assistant',
      toolUses: [
        { id: 'tool-1', name: toolName, input: {} },
      ],
    }),
    JSON.stringify({
      type: 'message',
      role: 'tool',
      toolResult: {
        toolUseId: 'tool-1',
        content: '{}',
        isError: false,
      },
    }),
  ].join('\n'), 'utf-8')
}
