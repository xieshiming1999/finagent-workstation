import { mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { ToolContext } from '../../src/agent/tool'
import { FinanceWorkflowStateTool } from '../../src/agent/tools/finance-workflow-state'

describe('FinanceWorkflowStateTool', () => {
  it('creates explicit typed workflow state', async () => {
    const tool = new FinanceWorkflowStateTool()
    const result = JSON.parse(await tool.call('tool-1', {
      action: 'create',
      workflowKind: 'trade_prep',
      assetClass: 'stock',
      intentMode: 'size',
      executionMode: 'requires_confirmation',
      confirmationState: 'pending',
      safetyBoundary: 'trade preparation only',
      evidenceRefs: ['trade-prep-v1'],
      subject: '600519',
    }, tempToolContext()))

    expect(result).toMatchObject({
      contract: 'finance-workflow-state-result-v1',
      workflowState: {
        contract: 'finance-workflow-state-v1',
        workflowKind: 'trade_prep',
        subject: '600519',
      },
    })
  })

  it('accepts nested workflowState for create and preserves artifact requirements', async () => {
    const tool = new FinanceWorkflowStateTool()
    const result = JSON.parse(await tool.call('tool-nested', {
      action: 'create',
      workflowState: {
        contract: 'finance-workflow-state-v1',
        workflowKind: 'evidence_review',
        assetClass: 'mixed',
        intentMode: 'review',
        executionMode: 'none',
        confirmationState: 'none',
        safetyBoundary: 'macro evidence is analysis context only',
        evidenceRefs: ['macro_evidence', 'artifact_registry'],
        requiredArtifacts: [{
          kindAnyOf: ['report', 'dashboard'],
          mustInclude: ['sourceTime', 'fetchedAt'],
        }],
        requiredVerifier: {
          tool: 'WorkflowVerifier',
          action: 'check',
          workflow: 'macro_factor_lookup',
        },
      },
    }, tempToolContext()))

    expect(result.workflowState).toMatchObject({
      workflowKind: 'evidence_review',
      requiredArtifacts: [expect.objectContaining({ kindAnyOf: ['report', 'dashboard'] })],
      requiredVerifier: { tool: 'WorkflowVerifier', workflow: 'macro_factor_lookup' },
    })
  })

  it('create defaults safe workflow fields for natural prompts', async () => {
    const tool = new FinanceWorkflowStateTool()
    const result = JSON.parse(await tool.call('tool-2', {
      action: 'create',
      workflowKind: 'trade_prep',
    }, tempToolContext()))

    expect(result.workflowState).toMatchObject({
      workflowKind: 'trade_prep',
      assetClass: 'unknown',
      executionMode: 'preview_only',
      confirmationState: 'none',
      evidenceRefs: ['workflow_request'],
      requiredVerifier: {
        tool: 'WorkflowVerifier',
        action: 'check',
        workflow: 'trade_preparation',
      },
    })
    expect(result.workflowState.safetyBoundary).toContain('no order')
  })

  it('validate rejects incomplete state with correction guidance', async () => {
    const tool = new FinanceWorkflowStateTool()
    await expect(tool.call('tool-2b', {
      action: 'validate',
      workflowState: {
        contract: 'finance-workflow-state-v1',
        workflowKind: 'trade_prep',
      },
    }, tempToolContext())).rejects.toThrow(/Invalid finance workflow state: .*assetClass must be one of.*FinanceWorkflowState\(action:"help"\)/)
  })

  it('accepts P0 workflow maturity scenario workflow kinds', async () => {
    const tool = new FinanceWorkflowStateTool()
    for (const workflowKind of ['watchlist_handoff', 'strategy_rerun', 'trade_preparation', 'trade_review']) {
      const result = JSON.parse(await tool.call(`state-${workflowKind}`, {
        action: 'validate',
        workflowState: {
          contract: 'finance-workflow-state-v1',
          workflowKind,
          assetClass: 'stock',
          intentMode: workflowKind === 'watchlist_handoff' ? 'watchlist_add' : 'analysis',
          executionMode: workflowKind === 'watchlist_handoff' ? 'watchlist' : workflowKind === 'strategy_rerun' ? 'backtest' : 'none',
          confirmationState: 'none',
          safetyBoundary: 'read-only or observation-only workflow',
          evidenceRefs: ['data_provenance'],
          source: 'test',
        },
      }, tempToolContext()))
      expect(result.workflowState.workflowKind).toBe(workflowKind)
    }
  })

  it('saves and resumes durable workflow state', async () => {
    const tool = new FinanceWorkflowStateTool()
    const context = tempToolContext()

    const saved = JSON.parse(await tool.call('tool-3', {
      action: 'save',
      id: 'trade-prep-600519',
      status: 'active',
      workflowState: {
        contract: 'finance-workflow-state-v1',
        workflowKind: 'trade_prep',
        assetClass: 'stock',
        intentMode: 'size',
        executionMode: 'requires_confirmation',
        confirmationState: 'pending',
        safetyBoundary: 'trade preparation only',
        evidenceRefs: ['quote', 'risk_budget'],
        subject: '600519',
      },
      requiredEvidence: ['quote', 'risk_budget'],
      completedSteps: ['quote_checked'],
      generatedArtifacts: ['artifact:trade-prep-600519'],
      pendingApproval: { kind: 'paper_trade' },
    }, context))
    expect(saved.record.id).toBe('trade-prep-600519')

    const current = JSON.parse(await tool.call('tool-4', {
      action: 'current',
    }, context))
    expect(current.record).toMatchObject({
      id: 'trade-prep-600519',
      status: 'active',
      workflowState: { workflowKind: 'trade_prep' },
      pendingApproval: { kind: 'paper_trade' },
    })

    const listed = JSON.parse(await tool.call('tool-5', {
      action: 'list',
      workflowKind: 'trade_prep',
    }, context))
    expect(listed.count).toBe(1)
  })
})

function tempToolContext(): ToolContext {
  const basePath = mkdtempSync(join(tmpdir(), 'fin-finance-workflow-state-tool-'))
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
