import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { migrateLegacyProjectBasePath, projectDirForCwd, resolveProjectBasePath } from '../../src/main/project-path'

describe('project path mapping', () => {
  it('preserves Unicode cwd segments instead of replacing them with dashes', () => {
    const cwd = '/Users/mark/文档/量化项目/finagent_workstation'

    expect(projectDirForCwd(cwd)).toBe(join('by-cwd', 'Users', 'mark', '文档', '量化项目', 'finagent_workstation'))
  })

  it('uses path segments and no hash suffix', () => {
    const cwd = '/Users/mark/workspace/项目'

    expect(projectDirForCwd(cwd)).toBe(join('by-cwd', 'Users', 'mark', 'workspace', '项目'))
    expect(projectDirForCwd(cwd)).not.toMatch(/[a-f0-9]{8,}$/)
  })

  it('does not migrate or create symlinks during runtime path resolution', () => {
    const globalBase = mkdtempSync(join(tmpdir(), 'fin-project-path-'))
    const cwd = '/Users/mark/文档/项目'
    const legacy = join(globalBase, 'projects', '-Users-mark-----')
    mkdirSync(legacy, { recursive: true })

    const resolved = resolveProjectBasePath(globalBase, cwd)

    expect(resolved).toBe(join(globalBase, 'projects', 'by-cwd', 'Users', 'mark', '文档', '项目'))
    expect(existsSync(resolved)).toBe(false)
    expect(existsSync(legacy)).toBe(true)
  })

  it('can copy legacy project data into the by-cwd runtime path when requested', () => {
    const globalBase = mkdtempSync(join(tmpdir(), 'fin-project-path-'))
    const cwd = '/Users/mark/workspace/standalone/finagent-workstation'
    const legacy = join(globalBase, 'projects', '-Users-mark-workspace-standalone-finagent-workstation')
    mkdirSync(join(legacy, 'sessions'), { recursive: true })
    writeFileSync(join(legacy, 'sessions', 'current.jsonl'), '{"type":"message","role":"user","content":"resume me"}\n', 'utf-8')

    const result = migrateLegacyProjectBasePath(globalBase, cwd)
    const target = resolveProjectBasePath(globalBase, cwd)

    expect(result.migrated).toBe(true)
    expect(result.from).toBe(legacy)
    expect(result.to).toBe(target)
    expect(existsSync(join(target, 'sessions', 'current.jsonl'))).toBe(true)
    expect(existsSync(join(legacy, 'sessions', 'current.jsonl'))).toBe(true)
  })
})
