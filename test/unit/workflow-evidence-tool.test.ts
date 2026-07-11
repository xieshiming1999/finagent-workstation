import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { ToolContext } from '../../src/agent/tool'
import { WorkflowEvidenceTool } from '../../src/agent/tools/workflow-evidence'

describe('WorkflowEvidenceTool', () => {
  it('summarizes session, pending input, and artifacts', async () => {
    const ctx = tempToolContext()
    mkdirSync(join(ctx.basePath, 'sessions'), { recursive: true })
    mkdirSync(join(ctx.memoryDir, 'pages'), { recursive: true })
    mkdirSync(join(ctx.memoryDir, 'dashboards'), { recursive: true })
    mkdirSync(join(ctx.memoryDir, 'workflows'), { recursive: true })
    writeFileSync(join(ctx.basePath, 'sessions', 'current.jsonl'), [
      JSON.stringify({ type: 'session_meta', id: 'session-1', createdAt: '2026-07-11T00:00:00.000Z' }),
      JSON.stringify({ type: 'message', role: 'user', content: '今天市场怎么样', timestamp: '2026-07-11T00:00:01.000Z' }),
      JSON.stringify({
        type: 'message',
        role: 'assistant',
        toolUses: [
          { id: 'call-1', name: 'MarketData', input: { action: 'query_quote', code: '000001' } },
        ],
        timestamp: '2026-07-11T00:00:02.000Z',
      }),
      JSON.stringify({
        type: 'message',
        role: 'tool',
        toolResult: {
          toolUseId: 'call-1',
          content: 'Provider failed with timeout',
          isError: true,
        },
        timestamp: '2026-07-11T00:00:03.000Z',
      }),
    ].join('\n'))
    writeFileSync(join(ctx.memoryDir, 'interaction_pending.json'), JSON.stringify({
      contract: 'interaction-pending-state-v1',
      updatedAt: '2026-07-11T00:00:04.000Z',
      pending: [
        { type: 'user_question_pending', requestId: 'ask-1', toolName: 'AskUserQuestion' },
      ],
    }))
    writeFileSync(join(ctx.memoryDir, 'dashboards', 'market.html'), '<html>market</html>')
    writeFileSync(join(ctx.memoryDir, 'pages', 'note.html'), '<html>note</html>')
    writeFileSync(join(ctx.memoryDir, 'workflows', 'state.json'), JSON.stringify({
      contract: 'workflow-state-store-v1',
      records: [
        {
          id: 'market-analysis-1',
          contract: 'workflow-state-record-v1',
          status: 'active',
          updatedAt: '2026-07-11T00:00:00.500Z',
          workflowState: {
            contract: 'finance-workflow-state-v1',
            workflowKind: 'market_analysis',
            assetClass: 'mixed',
            intentMode: 'analysis',
            executionMode: 'preview_only',
            confirmationState: 'none',
            safetyBoundary: 'read-only market overview',
            evidenceRefs: ['market_overview'],
            subject: 'cn-market',
          },
        },
      ],
    }))

    const tool = new WorkflowEvidenceTool()
    const summary = JSON.parse(await tool.call('tool-1', { action: 'summary' }, ctx))

    expect(summary).toMatchObject({
      contract: 'workflow-evidence-summary-v1',
      pendingInteractions: [
        { type: 'user_question_pending', requestId: 'ask-1', toolName: 'AskUserQuestion' },
      ],
      session: {
        messageCount: 3,
        toolCallCount: 1,
        toolResultCount: 1,
        toolErrorCount: 1,
      },
      runtimeState: {
        contract: 'agent-runtime-state-v1',
        state: 'waiting_for_user',
        observed: {
          toolErrors: 1,
        },
      },
    })
    expect(summary.artifacts.dashboards.count).toBe(1)
    expect(summary.artifacts.pages.count).toBe(1)
    expect(summary.workflowStates.length).toBe(1)

    const trace = JSON.parse(await tool.call('tool-2', { action: 'trace', limit: 20 }, ctx))
    expect(trace).toMatchObject({
      contract: 'workflow-trace-v1',
      runtimeState: {
        contract: 'agent-runtime-state-v1',
      },
    })
    expect(trace.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'workflow_state' }),
      expect.objectContaining({ type: 'pending_interaction' }),
      expect.objectContaining({ type: 'ui_artifact' }),
    ]))
  })
})

function tempToolContext(): ToolContext {
  const basePath = mkdtempSync(join(tmpdir(), 'fin-workflow-evidence-tool-'))
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
