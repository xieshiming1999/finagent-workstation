import { mkdirSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { ToolContext } from '../../src/agent/tool'
import { AskUserQuestionTool } from '../../src/agent/tools/ask-user'

describe('interaction evidence', () => {
  it('records AskUserQuestion pending and resolved lifecycle rows', async () => {
    const ctx = tempToolContext()
    const tool = new AskUserQuestionTool()

    const pending = tool.call('ask-1', {
      question: 'Choose action',
      options: ['Approve', 'Cancel'],
    }, ctx)
    expect(tool.getPendingQuestion()).toMatchObject({
      question: 'Choose action',
      options: ['Approve', 'Cancel'],
      requestId: 'ask-1',
    })

    tool.respondToQuestion('Approve')
    await expect(pending).resolves.toBe('Approve')

    expect(readEvidence(ctx)).toMatchObject([
      {
        type: 'user_question_pending',
        requestId: 'ask-1',
        toolName: 'AskUserQuestion',
        question: 'Choose action',
        options: ['Approve', 'Cancel'],
      },
      {
        type: 'user_question_resolved',
        requestId: 'ask-1',
        toolName: 'AskUserQuestion',
        question: 'Choose action',
        options: ['Approve', 'Cancel'],
        answer: 'Approve',
      },
    ])
  })
})

function tempToolContext(): ToolContext {
  const basePath = mkdtempSync(join(tmpdir(), 'fin-interaction-evidence-'))
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

function readEvidence(ctx: ToolContext): Array<Record<string, unknown>> {
  return readFileSync(join(ctx.memoryDir, 'interaction_evidence.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
}
