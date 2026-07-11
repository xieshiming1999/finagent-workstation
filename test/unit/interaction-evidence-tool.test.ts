import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { ToolContext } from '../../src/agent/tool'
import { InteractionEvidenceTool } from '../../src/agent/tools/interaction-evidence'

describe('InteractionEvidenceTool', () => {
  it('summarizes pending and resolved interaction evidence', async () => {
    const ctx = tempToolContext()
    writeFileSync(join(ctx.memoryDir, 'interaction_evidence.jsonl'), [
      JSON.stringify({ type: 'user_question_pending', requestId: 'ask-1', toolName: 'AskUserQuestion' }),
      JSON.stringify({ type: 'permission_request', requestId: 'perm-1', toolName: 'Write' }),
      JSON.stringify({ type: 'permission_resolved', requestId: 'perm-1', toolName: 'Write', approved: true }),
    ].join('\n'))
    writeFileSync(join(ctx.memoryDir, 'interaction_pending.json'), JSON.stringify({
      contract: 'interaction-pending-state-v1',
      updatedAt: '2026-07-11T00:00:00.000Z',
      pending: [
        { type: 'user_question_pending', requestId: 'ask-snapshot', toolName: 'AskUserQuestion' },
      ],
    }))

    const tool = new InteractionEvidenceTool()
    const summary = JSON.parse(await tool.call('tool-1', { action: 'summary' }, ctx))
    expect(summary).toMatchObject({
      contract: 'interaction-evidence-result-v1',
      action: 'summary',
      count: 3,
      byType: {
        user_question_pending: 1,
        permission_request: 1,
        permission_resolved: 1,
      },
    })
    expect(summary.pending).toMatchObject([
      { type: 'user_question_pending', requestId: 'ask-snapshot' },
    ])

    const recent = JSON.parse(await tool.call('tool-2', {
      action: 'recent',
      type: 'permission_resolved',
    }, ctx))
    expect(recent.rows).toMatchObject([
      { type: 'permission_resolved', requestId: 'perm-1', approved: true },
    ])
  })
})

function tempToolContext(): ToolContext {
  const basePath = mkdtempSync(join(tmpdir(), 'fin-interaction-evidence-tool-'))
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
