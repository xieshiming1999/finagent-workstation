import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ToolContext } from '../../src/agent/tool'
import { TaskRegistry } from '../../src/agent/background-task'
import { TeamRegistry } from '../../src/agent/team-context'
import { SkillTool } from '../../src/agent/tools/skill'

function makeCtx(basePath: string, workDir: string): ToolContext {
  const memoryDir = join(basePath, 'memory')
  const bundleDir = join(basePath, 'bundle')
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

describe('Skill runtime template substitution', () => {
  it('renders concrete runtime paths when loading bundled skills', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-skill-base-'))
    const workDir = mkdtempSync(join(tmpdir(), 'fin-skill-work-'))
    const assetsPath = mkdtempSync(join(tmpdir(), 'fin-skill-assets-'))
    const skillDir = join(assetsPath, 'skills', 'path-check')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'skill.md'), [
      '---',
      'name: path-check',
      'description: path template check',
      '---',
      'Data={{DATA_DIR}}',
      'Memory={{MEMORY_DIR}}',
      'Bundle={{BUNDLE_DIR}}',
      'Skills={{SKILLS_DIR}}',
      'Skill={{SKILL_DIR}}',
      'Work={{WORK_DIR}}',
      'ProjectLocal={{PROJECT_LOCAL_DIR}}',
    ].join('\n'), 'utf-8')

    const result = await new SkillTool(assetsPath).call('skill-1', {
      skill: 'path-check',
    }, makeCtx(basePath, workDir))

    expect(result).toContain(`Data=${basePath}`)
    expect(result).toContain(`Memory=${join(basePath, 'memory')}`)
    expect(result).toContain(`Bundle=${join(basePath, 'bundle')}`)
    expect(result).toContain(`Skills=${join(assetsPath, 'skills')}`)
    expect(result).toContain(`Skill=${skillDir}`)
    expect(result).toContain(`Work=${workDir}`)
    expect(result).toContain(`ProjectLocal=${join(workDir, '.finagent-workstation')}`)
    expect(result).not.toContain('{{DATA_DIR}}')
  })
})
