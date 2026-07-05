import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ToolContext } from '../../src/agent/tool'
import { FileReadTool } from '../../src/agent/tools/file-read'
import { FileWriteTool } from '../../src/agent/tools/file-write'
import { FileEditTool } from '../../src/agent/tools/file-edit'
import { LSTool } from '../../src/agent/tools/ls'
import { GlobTool } from '../../src/agent/tools/glob'
import { GrepTool } from '../../src/agent/tools/grep'
import { TaskRegistry } from '../../src/agent/background-task'
import { TeamRegistry } from '../../src/agent/team-context'

function makeContext(): ToolContext {
  const basePath = mkdtempSync(join(tmpdir(), 'fin-runtime-'))
  const workDir = mkdtempSync(join(tmpdir(), 'fin-workdir-'))
  const memoryDir = join(basePath, 'memory')
  const bundleDir = join(basePath, 'bundle')
  mkdirSync(memoryDir, { recursive: true })
  mkdirSync(bundleDir, { recursive: true })
  const taskRegistry = new TaskRegistry()
  taskRegistry.configure(memoryDir)
  const teamRegistry = new TeamRegistry()
  teamRegistry.configure(memoryDir)
  return {
    basePath,
    workDir,
    memoryDir,
    bundleDir,
    projectLocalDir: join(workDir, '.finagent-workstation'),
    pluginSkillPaths: [],
    skipPermissions: true,
    approvedTools: new Set(),
    planMode: false,
    readFileTimestamps: new Map(),
    taskRegistry,
    teamRegistry,
  }
}

describe('file tool path conventions', () => {
  it('resolves memory/pages paths against runtime memory instead of cwd/workDir', async () => {
    const ctx = makeContext()
    const target = join(ctx.memoryDir, 'pages', 'stock-picks-2026-06-01.html')
    mkdirSync(join(ctx.memoryDir, 'pages'), { recursive: true })
    writeFileSync(target, '<html>old</html>', 'utf-8')

    const read = await new FileReadTool().call('read-1', {
      file_path: 'memory/pages/stock-picks-2026-06-01.html',
    }, ctx)
    expect(read).toContain(`Resolved path: ${target}`)
    expect(read).toContain(`Base path: ${ctx.basePath}`)
    expect(read).toContain(`Memory dir: ${ctx.memoryDir}`)
    expect(read).toContain('<html>old</html>')
    expect(ctx.readFileTimestamps.has(target)).toBe(true)

    const edit = new FileEditTool()
    expect(edit.validateInput?.({
      file_path: 'memory/pages/stock-picks-2026-06-01.html',
      old_string: 'old',
      new_string: 'new',
    }, ctx)).toBeNull()

    const editResult = await edit.call('edit-1', {
      file_path: 'memory/pages/stock-picks-2026-06-01.html',
      old_string: 'old',
      new_string: 'new',
    }, ctx)
    expect(editResult).toContain(`File updated: ${target}`)
    expect(editResult).toContain(`Base path: ${ctx.basePath}`)
    expect(readFileSync(target, 'utf-8')).toContain('<html>new</html>')
    expect(existsSync(join(ctx.workDir, 'memory', 'pages', 'stock-picks-2026-06-01.html'))).toBe(false)
  })

  it('writes memory paths to runtime memory and keeps ordinary relative paths in workDir', async () => {
    const ctx = makeContext()
    const write = new FileWriteTool()

    const writeMemoryResult = await write.call('write-memory', {
      file_path: 'memory/pages/generated.html',
      content: '<html>runtime</html>',
    }, ctx)
    expect(writeMemoryResult).toContain(`Resolved path: ${join(ctx.memoryDir, 'pages', 'generated.html')}`)
    expect(writeMemoryResult).toContain(`Base path: ${ctx.basePath}`)
    expect(readFileSync(join(ctx.memoryDir, 'pages', 'generated.html'), 'utf-8')).toContain('runtime')
    expect(existsSync(join(ctx.workDir, 'memory', 'pages', 'generated.html'))).toBe(false)

    await write.call('write-workdir', {
      file_path: 'notes.txt',
      content: 'repo local',
    }, ctx)
    expect(readFileSync(join(ctx.workDir, 'notes.txt'), 'utf-8')).toBe('repo local')
  })

  it('allows generated runtime page overwrites without weakening ordinary file guards', async () => {
    const ctx = makeContext()
    const write = new FileWriteTool()
    const pagePath = join(ctx.memoryDir, 'pages', 'generated.html')
    const ordinaryPath = join(ctx.memoryDir, 'notes.md')
    mkdirSync(join(ctx.memoryDir, 'pages'), { recursive: true })
    writeFileSync(pagePath, '<html>old</html>', 'utf-8')
    writeFileSync(ordinaryPath, 'old', 'utf-8')

    expect(write.validateInput?.({
      file_path: 'memory/pages/generated.html',
      content: '<html>new</html>',
    }, ctx)).toBeNull()
    await write.call('write-page-overwrite', {
      file_path: 'memory/pages/generated.html',
      content: '<html>new</html>',
    }, ctx)
    expect(readFileSync(pagePath, 'utf-8')).toBe('<html>new</html>')

    expect(write.validateInput?.({
      file_path: 'memory/notes.md',
      content: 'new',
    }, ctx)).toBe('File has not been read yet. Read it first before writing to it.')
  })

  it('throws file tool failures through the error channel instead of returning error text', async () => {
    const ctx = makeContext()
    const write = new FileWriteTool()
    const dirPath = join(ctx.workDir, 'existing-dir')
    mkdirSync(dirPath, { recursive: true })

    await expect(write.call('write-fail', {
      file_path: dirPath,
      content: 'not a directory write',
    }, ctx)).rejects.toThrow(/Write failed:/)

    await expect(new GrepTool().call('grep-fail', {
      path: 'memory/pages',
      pattern: '[',
    }, ctx)).rejects.toThrow(/Grep failed:/)
  })

  it('lists, globs, and greps memory paths through runtime memory', async () => {
    const ctx = makeContext()
    mkdirSync(join(ctx.memoryDir, 'pages'), { recursive: true })
    writeFileSync(join(ctx.memoryDir, 'pages', 'alpha.html'), 'needle', 'utf-8')

    const ls = await new LSTool().call('ls-1', { path: 'memory/pages' }, ctx)
    expect(ls).toContain(`Resolved path: ${join(ctx.memoryDir, 'pages')}`)
    expect(ls).toContain(`Base path: ${ctx.basePath}`)
    expect(ls).toContain('alpha.html')

    const glob = await new GlobTool().call('glob-1', { path: 'memory/pages', pattern: '*.html' }, ctx)
    expect(glob).toContain('alpha.html')

    const grep = await new GrepTool().call('grep-1', { path: 'memory/pages', pattern: 'needle', output_mode: 'files_with_matches' }, ctx)
    expect(grep).toContain('alpha.html')
  })
})
