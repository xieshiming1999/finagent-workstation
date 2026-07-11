import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ToolCapabilitySummary, ToolContext } from '../../src/agent/tool'
import { AgentSelfDebugTool } from '../../src/agent/tools/agent-self-debug'

describe('AgentSelfDebugTool', () => {
  it('reports repeated failed tool calls and discovery tools', async () => {
    const ctx = tempToolContext()
    seedRepeatedFailures(ctx)
    const tool = new AgentSelfDebugTool(() => [
      capability('Example', []),
      capability('Runbook', ['help', 'list', 'get']),
    ])

    const status = JSON.parse(await tool.call('debug-1', { action: 'status' }, ctx))

    expect(status.contract).toBe('agent-self-debug-status-v1')
    expect(status.state).toBe('needs_attention')
    expect(status.repeatedFailedToolCalls.length).toBe(1)
    expect(status.nextAction).toContain('Stop repeating')
    expect(status.discoveryTools.map((row: { name: string }) => row.name)).toContain('Runbook')
  })

  it('rejects unknown action through the tool error channel', async () => {
    const ctx = tempToolContext()
    await expect(new AgentSelfDebugTool(() => []).call('debug-2', {
      action: 'unknown',
    }, ctx)).rejects.toThrow('Invalid AgentSelfDebug action')
  })
})

function tempToolContext(): ToolContext {
  const basePath = mkdtempSync(join(tmpdir(), 'fin-agent-self-debug-tool-'))
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

function capability(name: string, actionValues: string[]): ToolCapabilitySummary {
  return {
    name,
    description: name,
    readOnly: true,
    canParallel: true,
    requiresUserInteraction: false,
    permission: 'read-only',
    schema: { propertyNames: [], required: [], actionValues },
  }
}
