import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { globalApiStats } from '../../src/agent/data/resilience'
import type { ToolContext } from '../../src/agent/tool'
import { BudgetGovernorTool } from '../../src/agent/tools/budget-governor'

describe('BudgetGovernorTool', () => {
  it('stops Wind calls when local Wind usage is exhausted', async () => {
    const ctx = tempToolContext()
    const memory = join(ctx.basePath, 'memory')
    mkdirSync(memory, { recursive: true })
    writeFileSync(join(memory, 'wind_usage.json'), JSON.stringify({
      date: '2026-07-11',
      count: 3,
      exhausted: true,
      exhaustedCode: 'RATE_LIMIT_DAILY',
    }), 'utf-8')

    const status = JSON.parse(await new BudgetGovernorTool().call('budget-1', {
      action: 'status',
    }, ctx))

    expect(status.contract).toBe('budget-governor-status-v1')
    expect(status.decision).toBe('stop_wind_calls')
    expect(status.nextAction).toContain('Do not call Wind')
  })

  it('detects quota-like API failures', async () => {
    globalApiStats.record({
      source: 'tushare',
      url: 'https://api.tushare.pro',
      status: 429,
      durationMs: 20,
      success: false,
      error: 'rate limit',
      timestamp: new Date().toISOString(),
    })

    const status = JSON.parse(await new BudgetGovernorTool().call('budget-2', {
      action: 'status',
      source: 'tushare',
    }, tempToolContext()))

    expect(status.decision).toBe('stop_broad_live_calls')
    expect(status.quotaLikeFailures.length).toBeGreaterThan(0)
  })
})

function tempToolContext(): ToolContext {
  const basePath = mkdtempSync(join(tmpdir(), 'fin-budget-governor-tool-'))
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
