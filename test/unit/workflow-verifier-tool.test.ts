import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArtifactRegistry } from '../../src/agent/artifact-registry'
import type { ToolContext } from '../../src/agent/tool'
import { WorkflowVerifierTool } from '../../src/agent/tools/workflow-verifier'

describe('WorkflowVerifierTool', () => {
  it('passes with tool and artifact evidence', async () => {
    const ctx = tempToolContext()
    seedSession(ctx, 'MarketData')
    new ArtifactRegistry(ctx.basePath).register({
      kind: 'analysis',
      path: 'memory/reports/stock-analysis.md',
      title: 'Stock analysis',
      source: 'agent-workflow',
      verificationStatus: 'verified',
    })

    const result = JSON.parse(await new WorkflowVerifierTool().call('verify-1', {
      action: 'check',
      workflow: 'stock_research',
    }, ctx))

    expect(result.contract).toBe('workflow-verifier-check-v1')
    expect(result.passed).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.observed.toolNames).toContain('MarketData')
  })

  it('reports missing artifact evidence', async () => {
    const ctx = tempToolContext()
    seedSession(ctx, 'MarketData')

    const result = JSON.parse(await new WorkflowVerifierTool().call('verify-2', {
      action: 'check',
      workflow: 'stock_research',
    }, ctx))

    expect(result.passed).toBe(false)
    expect(result.missing).toContain('artifact_evidence')
    expect(result.nextAction).toContain('Do not finalize yet')
  })

  it('rejects unknown workflow through the tool error channel', async () => {
    const ctx = tempToolContext()
    await expect(new WorkflowVerifierTool().call('verify-3', {
      action: 'check',
      workflow: 'unknown',
    }, ctx)).rejects.toThrow('Unknown WorkflowVerifier workflow')
  })
})

function tempToolContext(): ToolContext {
  const basePath = mkdtempSync(join(tmpdir(), 'fin-workflow-verifier-tool-'))
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

function seedSession(ctx: ToolContext, toolName: string): void {
  const dir = join(ctx.basePath, 'sessions')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'current.jsonl'), [
    JSON.stringify({
      type: 'message',
      role: 'assistant',
      toolUses: [
        { id: 'tool-1', name: toolName, input: {} },
      ],
    }),
    JSON.stringify({
      type: 'message',
      role: 'tool',
      toolResult: {
        toolUseId: 'tool-1',
        content: '{}',
        isError: false,
      },
    }),
  ].join('\n'), 'utf-8')
}
