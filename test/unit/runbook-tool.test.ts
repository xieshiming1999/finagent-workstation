import { mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { ToolContext } from '../../src/agent/tool'
import { RunbookTool } from '../../src/agent/tools/runbook'

describe('RunbookTool', () => {
  it('lists and returns structured workflow guidance', async () => {
    const ctx = tempToolContext()
    const tool = new RunbookTool()

    const list = JSON.parse(await tool.call('runbook-1', { action: 'list' }, ctx))
    expect(list.contract).toBe('runbook-list-v1')
    expect(list.workflows).toContain('stock_research')

    const detail = JSON.parse(await tool.call('runbook-2', {
      action: 'get',
      workflow: 'strategy_backtest',
    }, ctx))
    expect(detail.contract).toBe('runbook-detail-v1')
    expect(detail.workflow).toBe('strategy_backtest')
    expect(detail.requiredEvidence).toContain('StrategySpec')
    expect(detail.approvalBoundary).toContain('Backtest and monitor only')
  })

  it('rejects unknown workflows through the tool error channel', async () => {
    const ctx = tempToolContext()
    await expect(new RunbookTool().call('runbook-3', {
      action: 'get',
      workflow: 'unknown',
    }, ctx)).rejects.toThrow('Unknown Runbook workflow "unknown"')
  })
})

function tempToolContext(): ToolContext {
  const basePath = mkdtempSync(join(tmpdir(), 'fin-runbook-tool-'))
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
