import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { Tool, ToolContext } from '../../src/agent/tool'
import { ToolRegistry } from '../../src/agent/tool'
import { CapabilityStatusTool } from '../../src/agent/tools/capability-status'

describe('CapabilityStatusTool', () => {
  it('summarizes capabilities, pending interactions, failures, and artifacts', async () => {
    const ctx = tempToolContext()
    seedEvidence(ctx)

    const registry = new ToolRegistry()
    registry.register(exampleTool())
    registry.register(interactionTool())
    registry.register(new CapabilityStatusTool(() => registry.capabilities()))

    const tool = registry.get('CapabilityStatus')!
    const summary = JSON.parse(await tool.call('cap-1', { action: 'summary' }, ctx))

    expect(summary).toMatchObject({
      contract: 'capability-status-summary-v1',
      runtime: 'finagent-workstation',
      capabilitySummary: {
        count: 3,
        writeOrSideEffect: 2,
        userInteraction: 1,
      },
      health: {
        pendingInteractionCount: 1,
        toolCallCount: 1,
        toolErrorCount: 1,
        uiArtifactCount: 1,
      },
    })
  })

  it('evaluates required evidence and reports missing classes', async () => {
    const ctx = tempToolContext()
    seedEvidence(ctx)
    const registry = new ToolRegistry()
    registry.register(exampleTool())
    registry.register(new CapabilityStatusTool(() => registry.capabilities()))

    const tool = registry.get('CapabilityStatus')!
    const evaluation = JSON.parse(await tool.call('cap-2', {
      action: 'evaluate',
      workflow: 'market_overview',
      requiredEvidence: ['agent_discovery', 'tool_calls', 'no_tool_errors', 'no_pending_interactions', 'ui_artifacts'],
    }, ctx))

    expect(evaluation).toMatchObject({
      contract: 'capability-status-evaluation-v1',
      workflow: 'market_overview',
      passed: false,
      missing: ['no_tool_errors', 'no_pending_interactions'],
    })
  })

  it('fails invalid evidence names through the tool error channel', async () => {
    const ctx = tempToolContext()
    const registry = new ToolRegistry()
    registry.register(new CapabilityStatusTool(() => registry.capabilities()))
    const tool = registry.get('CapabilityStatus')!

    await expect(tool.call('cap-3', {
      action: 'evaluate',
      requiredEvidence: ['made_up'],
    }, ctx)).rejects.toThrow('Unsupported requiredEvidence "made_up"')
  })
})

function seedEvidence(ctx: ToolContext): void {
  mkdirSync(join(ctx.basePath, 'sessions'), { recursive: true })
  mkdirSync(join(ctx.memoryDir, 'dashboards'), { recursive: true })
  writeFileSync(join(ctx.basePath, 'sessions', 'current.jsonl'), [
    JSON.stringify({
      type: 'message',
      role: 'assistant',
      toolUses: [{ id: 'call-1', name: 'MarketData', input: { action: 'quote' } }],
    }),
    JSON.stringify({
      type: 'message',
      role: 'tool',
      toolResult: { toolUseId: 'call-1', content: 'failed', isError: true },
    }),
  ].join('\n'))
  writeFileSync(join(ctx.memoryDir, 'interaction_pending.json'), JSON.stringify({
    contract: 'interaction-pending-state-v1',
    pending: [{ type: 'user_question_pending', requestId: 'ask-1' }],
  }))
  writeFileSync(join(ctx.memoryDir, 'dashboards', 'market.html'), '<html>market</html>')
}

function tempToolContext(): ToolContext {
  const basePath = mkdtempSync(join(tmpdir(), 'fin-capability-status-'))
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

function exampleTool(): Tool {
  return {
    name: 'Example',
    description: 'Example write tool',
    isReadOnly: false,
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['help', 'run'] } },
    },
    async call() {
      return 'ok'
    },
  }
}

function interactionTool(): Tool {
  return {
    name: 'AskUserQuestion',
    description: 'Ask the user',
    isReadOnly: false,
    requiresUserInteraction: true,
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string' } },
    },
    async call() {
      return 'ok'
    },
  }
}
