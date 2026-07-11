import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { ToolContext } from '../../src/agent/tool'
import { SourceReaderTool } from '../../src/agent/tools/source-reader'

describe('SourceReaderTool', () => {
  it('reads local source and persists source evidence', async () => {
    const ctx = tempToolContext()
    const sourcePath = join(ctx.basePath, 'macro.html')
    writeFileSync(sourcePath, '<html><title>Macro Note</title><body>2026-07-11 rates matter</body></html>')

    const result = JSON.parse(await new SourceReaderTool().call('source-1', {
      action: 'read',
      path: sourcePath,
      source: 'local-test',
      topic: 'rates',
    }, ctx))

    expect(result.contract).toBe('source-reader-result-v1')
    expect(result.record.title).toBe('Macro Note')
    expect(result.record.publishedAt).toBe('2026-07-11')
    expect(result.record.hash).toBeTruthy()
    expect(existsSync(result.artifactHint.path)).toBe(true)
  })

  it('rejects missing source locator', async () => {
    await expect(new SourceReaderTool().call(
      'source-2',
      { action: 'read' },
      tempToolContext(),
    )).rejects.toThrow('requires exactly one of url or path')
  })
})

function tempToolContext(): ToolContext {
  const basePath = mkdtempSync(join(tmpdir(), 'fin-source-reader-tool-'))
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
