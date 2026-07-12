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
    expect(list.workflows).toContain('stock_selection')

    const detail = JSON.parse(await tool.call('runbook-2', {
      action: 'get',
      workflow: 'strategy_backtest',
    }, ctx))
    expect(detail.contract).toBe('runbook-detail-v1')
    expect(detail.workflow).toBe('strategy_backtest')
    expect(detail.requiredEvidence).toContain('StrategySpec')
    expect(detail.approvalBoundary).toContain('Backtest and monitor only')

    const selection = JSON.parse(await tool.call('runbook-selection', {
      action: 'get',
      workflow: 'stock_selection',
    }, ctx))
    expect(selection.requiredEvidence).toContain('screening_or_candidate_source')
    expect(selection.verifier).toContain('workflow:"stock_selection"')
    expect(selection.approvalBoundary).toContain('No watchlist mutation')

    const watchlist = JSON.parse(await tool.call('runbook-watchlist', {
      action: 'get',
      workflow: 'watchlist_handoff',
    }, ctx))
    expect(watchlist.requiredEvidence).toContain('watchlist_readback')
    expect(watchlist.verifier).toContain('workflow:"watchlist_handoff"')

    const rerun = JSON.parse(await tool.call('runbook-rerun', {
      action: 'get',
      workflow: 'strategy_rerun',
    }, ctx))
    expect(rerun.requiredEvidence).toContain('saved_strategy_identity')
    expect(rerun.verifier).toContain('workflow:"strategy_rerun"')

    const tradeReview = JSON.parse(await tool.call('runbook-trade-review', {
      action: 'get',
      workflow: 'trade_review',
    }, ctx))
    expect(tradeReview.requiredEvidence).toContain('transactions_or_missing_reason')
    expect(tradeReview.approvalBoundary).toContain('Read-only simulated-account review')

    const macro = JSON.parse(await tool.call('runbook-macro', {
      action: 'get',
      workflow: 'macro_factor_lookup',
    }, ctx))
    expect(macro.requiredEvidence).toContain('macro-evidence-record-v1')
    expect(macro.allowedTools).toContain('SourceReader')
    expect(macro.artifactTypes).toContain('report')
    expect(macro.outputRequirements).toContain(
      'When the user asks for a reviewable report, dashboard, artifact, or panel output, create or register a durable report/dashboard artifact through ArtifactRegistry before finalizing.',
    )
    expect(macro.approvalBoundary).toContain('not a direct buy/sell rule')
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
