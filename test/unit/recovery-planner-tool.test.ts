import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ToolContext } from '../../src/agent/tool'
import { RecoveryPlannerTool } from '../../src/agent/tools/recovery-planner'

describe('RecoveryPlannerTool', () => {
  it('infers repeated tool failure from session evidence', async () => {
    const ctx = tempToolContext()
    seedRepeatedFailures(ctx)

    const plan = JSON.parse(await new RecoveryPlannerTool().call('recover-1', {
      action: 'plan',
      failureClass: 'auto',
    }, ctx))

    expect(plan.contract).toBe('recovery-planner-plan-v1')
    expect(plan.failureClass).toBe('repeated_tool_failure')
    expect(plan.recommended.id).toBe('stop_repeating_call')
    expect(plan.recommended.stopBeforeFinalAnswer).toBe(true)
  })

  it('returns typed credential recovery', async () => {
    const plan = JSON.parse(await new RecoveryPlannerTool().call('recover-2', {
      action: 'plan',
      failureClass: 'credential_required',
      provider: 'wind',
    }, tempToolContext()))

    expect(plan.failureClass).toBe('credential_required')
    expect(plan.recommended.id).toBe('request_or_configure_credential')
  })
})

function tempToolContext(): ToolContext {
  const basePath = mkdtempSync(join(tmpdir(), 'fin-recovery-planner-tool-'))
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

function seedRepeatedFailures(ctx: ToolContext): void {
  const dir = join(ctx.basePath, 'sessions')
  mkdirSync(dir, { recursive: true })
  const rows: string[] = []
  for (let i = 0; i < 3; i++) {
    rows.push(JSON.stringify({
      type: 'message',
      role: 'assistant',
      toolUses: [
        { id: `tool-${i}`, name: 'MarketData', input: { action: 'query_quote', symbol: '300059' } },
      ],
    }))
    rows.push(JSON.stringify({
      type: 'message',
      role: 'tool',
      toolResult: {
        toolUseId: `tool-${i}`,
        content: 'unknown action',
        isError: true,
      },
    }))
  }
  writeFileSync(join(dir, 'current.jsonl'), rows.join('\n'), 'utf-8')
}
