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

  it('rejects incomplete state with correction guidance', async () => {
    const tool = new FinanceWorkflowStateTool()
    await expect(tool.call('tool-2', {
      action: 'create',
      workflowKind: 'trade_prep',
    }, tempToolContext())).rejects.toThrow(/Invalid finance workflow state: .*assetClass must be one of.*FinanceWorkflowState\(action:"help"\)/)
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
