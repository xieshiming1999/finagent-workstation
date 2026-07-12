import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ToolContext } from '../../src/agent/tool'
import { ArtifactRegistryTool } from '../../src/agent/tools/artifact-registry'

describe('ArtifactRegistryTool', () => {
  it('registers, lists, and gets durable artifacts', async () => {
    const ctx = tempToolContext()
    const tool = new ArtifactRegistryTool()

    const created = JSON.parse(await tool.call('artifact-1', {
      action: 'register',
      kind: 'analysis',
      path: 'memory/reports/stock-analysis.md',
      title: 'Stock analysis',
      source: 'agent-workflow',
      verificationStatus: 'verified',
      freshness: { status: 'fresh' },
      provenance: { workflow: 'stock_research' },
      links: ['workflow:stock_research'],
      metadata: { templateId: 'stock_research' },
    }, ctx))
    expect(created.contract).toBe('artifact-registry-record-v1')
    expect(created.artifact.kind).toBe('analysis')
    expect(created.artifact.stableRef).toMatch(/^artifact:analysis:/)
    expect(created.artifact.verificationStatus).toBe('verified')

    const list = JSON.parse(await tool.call('artifact-2', {
      action: 'list',
      kind: 'analysis',
    }, ctx))
    expect(list.contract).toBe('artifact-registry-list-v1')
    expect(list.count).toBe(1)

    const get = JSON.parse(await tool.call('artifact-3', {
      action: 'get',
      id: created.artifact.stableRef,
    }, ctx))
    expect(get.artifact.title).toBe('Stock analysis')

    const graph = JSON.parse(await tool.call('artifact-graph', {
      action: 'graph',
      kind: 'analysis',
    }, ctx))
    expect(graph.contract).toBe('artifact-evidence-graph-v1')
    expect(graph.artifactCount).toBe(1)
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.artifact.stableRef }),
    ]))
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: created.artifact.stableRef,
        relation: 'from_source',
      }),
    ]))
  })

  it('rejects incomplete register input through the tool error channel', async () => {
    const ctx = tempToolContext()
    await expect(new ArtifactRegistryTool().call('artifact-4', {
      action: 'register',
      kind: 'analysis',
      title: 'Stock analysis',
    }, ctx)).rejects.toThrow('requires non-empty title and source')
  })

  it('discloses managed register requirements in help and schema', async () => {
    const ctx = tempToolContext()
    const tool = new ArtifactRegistryTool()
    const help = JSON.parse(await tool.call('artifact-help', {
      action: 'help',
    }, ctx))

    expect(help.guidance.join('\n')).toContain('kind, title, and source')
    expect(tool.inputSchema.properties.source.description).toContain('Required for register')
  })

  it('creates a managed artifact file when register omits path', async () => {
    const ctx = tempToolContext()
    const created = JSON.parse(await new ArtifactRegistryTool().call('artifact-managed', {
      action: 'register',
      kind: 'macro_evidence',
      title: 'Energy macro evidence',
      source: 'EIA',
      metadata: { topic: 'energy', affectedAssets: ['energy equities'] },
    }, ctx))

    expect(created.contract).toBe('artifact-registry-record-v1')
    expect(created.managedArtifact).toBe(true)
    expect(created.artifact.path).toMatch(/^memory\/artifacts\/macro_evidence\/.+\.json$/)
    expect(existsSync(join(ctx.basePath, created.artifact.path))).toBe(true)
  })

  it('normalizes macro evidence fields into report artifacts', async () => {
    const ctx = tempToolContext()
    const created = JSON.parse(await new ArtifactRegistryTool().call('artifact-macro-report', {
      action: 'register',
      kind: 'report',
      title: 'Macro factor report',
      source: 'macro workflow',
      metadata: {
        topic: 'energy',
        affectedAssets: ['oil', 'energy equities'],
        missingEvidence: ['second official source'],
        confidenceEffect: 'raises confidence for energy-sensitive watch conditions',
        sourceDataTime: '2026-07-03',
        fetchedAt: '2026-07-12T04:00:00Z',
        freshnessStatus: 'stale',
        failureClass: 'credential-or-quota-required',
      },
    }, ctx))

    const summary = created.artifact.metadata.macroEvidenceSummary
    expect(summary).toMatchObject({
      contract: 'macro-artifact-evidence-summary-v1',
      topic: 'energy',
      sourceTime: '2026-07-03',
      fetchedAt: '2026-07-12T04:00:00Z',
      freshnessStatus: 'stale',
      confidenceEffect: 'raises confidence for energy-sensitive watch conditions',
      affectedAssets: ['oil', 'energy equities'],
      missingEvidence: ['second official source'],
      failureClass: 'credential-or-quota-required',
    })
    expect(created.artifact.provenance.macroEvidenceSummary).toMatchObject(summary)
    expect(created.artifact.provenance.failureClass).toBe('credential-or-quota-required')
    expect(created.artifact.freshness).toMatchObject({
      status: 'stale',
      sourceTime: '2026-07-03',
      fetchedAt: '2026-07-12T04:00:00Z',
    })
    const stored = JSON.parse(readFileSync(join(ctx.basePath, created.artifact.path), 'utf8'))
    expect(stored.macroEvidenceSummary).toMatchObject(summary)
  })
})

function tempToolContext(): ToolContext {
  const basePath = mkdtempSync(join(tmpdir(), 'fin-artifact-registry-tool-'))
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
