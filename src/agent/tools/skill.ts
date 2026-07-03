import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'

const MAX_SKILL_SIZE = 50_000
const invokedSkills = new Set<string>()

export function getInvokedSkills(): Set<string> { return invokedSkills }

export class SkillTool implements Tool {
  name = 'Skill'
  description = 'Load, create, update, or delete a skill. Skills are markdown instruction files. Pass a skill name to load, or use actions: create, update, delete.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      skill: { type: 'string', description: 'Skill name to load, or action: "create", "update", "delete"' },
      args: { type: 'string', description: 'For create/update: skill name; for load: arguments substituted into $ARGUMENTS' },
      content: { type: 'string', description: 'Skill content (for create/update). Must include frontmatter with name and description.' },
    },
    required: ['skill'],
  }

  private assetsPath: string
  constructor(assetsPath: string) { this.assetsPath = assetsPath }

  needsPermissions(input: Record<string, unknown>): boolean {
    const skill = String(input.skill ?? '').trim()
    return skill === 'create' || skill === 'update' || skill === 'delete'
  }

  validateInput(input: Record<string, unknown>, ctx: ToolContext): string | null {
    const skill = String(input.skill ?? '').trim()
    if (!skill) return 'skill is required.'

    switch (skill) {
      case 'create': {
        const content = input.content as string | undefined
        if (!content) return 'create requires "content" with full skill.md including frontmatter.'
        const parsed = parseFrontmatter(content)
        const name = parsed.name
        if (!name) return 'skill.md frontmatter must include "name" field.'
        const nameErr = validateSkillName(name)
        if (nameErr) return nameErr
        if (content.length > MAX_SKILL_SIZE) return `Skill content must be ≤${MAX_SKILL_SIZE / 1000}KB.`
        break
      }
      case 'update': {
        const args = input.args as string | undefined
        const content = input.content as string | undefined
        if (!args) return 'update requires "args" with the skill name.'
        if (!content) return 'update requires "content" with the updated skill.md.'
        if (content.length > MAX_SKILL_SIZE) return `Skill content must be ≤${MAX_SKILL_SIZE / 1000}KB.`
        break
      }
      case 'delete': {
        if (!input.args) return 'delete requires "args" with the skill name.'
        break
      }
    }
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const skill = String(input.skill).trim()
    const args = input.args ? String(input.args) : undefined
    const content = input.content ? String(input.content) : undefined

    switch (skill) {
      case 'create': return this.createSkill(ctx, args ?? '', content!)
      case 'update': return this.updateSkill(ctx, args!, content!)
      case 'delete': return this.deleteSkill(ctx, args!)
      default: return this.loadSkill(ctx, skill, args)
    }
  }

  private loadSkill(ctx: ToolContext, skillName: string, args?: string): string {
    const name = skillName.startsWith('/') ? skillName.slice(1) : skillName
    const projectLocalPath = join(ctx.projectLocalDir, 'skills', name, 'skill.md')
    const memoryPath = join(ctx.basePath, 'memory/skills', name, 'skill.md')
    const bundlePath = join(this.assetsPath, 'skills', name, 'skill.md')

    let filePath: string | null = null
    let source: string = 'bundle'
    // Priority: project-local > memory > plugin > bundle
    if (existsSync(projectLocalPath)) { filePath = projectLocalPath; source = 'project' }
    else if (existsSync(memoryPath)) { filePath = memoryPath; source = 'memory' }
    else {
      for (const pluginDir of ctx.pluginSkillPaths) {
        const pluginPath = join(pluginDir, name, 'skill.md')
        if (existsSync(pluginPath)) { filePath = pluginPath; source = 'plugin'; break }
      }
      if (!filePath && existsSync(bundlePath)) { filePath = bundlePath; source = 'bundle' }
    }

    if (!filePath) return toolError(`Skill "${name}" not found.`)

    let content = readFileSync(filePath, 'utf-8')
    const parsed = parseFrontmatter(content)
    content = parsed.body

    if (args) content = substituteArguments(content, args)

    // Replace runtime placeholders with concrete paths.
    content = content.replaceAll('$DATA_DIR', ctx.basePath)
    content = content.replaceAll('$SKILL_DIR', join(filePath, '..'))
    content = content.replaceAll('{{DATA_DIR}}', ctx.basePath)
    content = content.replaceAll('{{MEMORY_DIR}}', ctx.memoryDir)
    content = content.replaceAll('{{BUNDLE_DIR}}', ctx.bundleDir)
    content = content.replaceAll('{{SKILLS_DIR}}', join(this.assetsPath, 'skills'))
    content = content.replaceAll('{{SKILL_DIR}}', join(filePath, '..'))
    content = content.replaceAll('{{WORK_DIR}}', ctx.workDir)
    content = content.replaceAll('{{PROJECT_LOCAL_DIR}}', ctx.projectLocalDir)

    invokedSkills.add(name)

    return `Skill "${name}" loaded (${source}).\n\n--- Skill Instructions ---\n${content}\n--- End Skill ---`
  }

  private createSkill(ctx: ToolContext, nameOrEmpty: string, content: string): string {
    const parsed = parseFrontmatter(content)
    const name = parsed.name || nameOrEmpty
    if (!name) return toolError('skill name required (in frontmatter or as args).')
    const nameErr = validateSkillName(name)
    if (nameErr) return toolError(nameErr)

    const dirPath = join(ctx.basePath, 'memory/skills', name)
    const filePath = join(dirPath, 'skill.md')
    if (existsSync(filePath)) return toolError(`Skill "${name}" already exists. Use "update" to modify it.`)

    mkdirSync(dirPath, { recursive: true })
    writeFileSync(filePath, content, 'utf-8')
    const desc = parsed.description || '(no description)'
    return `Skill "${name}" created at memory/skills/${name}/skill.md\nDescription: ${desc}\nIt will appear in the skills index on next conversation.`
  }

  private updateSkill(ctx: ToolContext, name: string, content: string): string {
    name = name.trim()
    const memorySkillPath = join(ctx.basePath, 'memory/skills', name, 'skill.md')

    if (existsSync(memorySkillPath)) {
      writeFileSync(memorySkillPath, content, 'utf-8')
      const sizeKb = (content.length / 1024).toFixed(1)
      return `Skill "${name}" updated (${sizeKb}KB, ${content.split('\n').length} lines). Path: memory/skills/${name}/skill.md`
    }

    const bundleSkillPath = join(this.assetsPath, 'skills', name, 'skill.md')
    if (existsSync(bundleSkillPath)) {
      const dir = join(ctx.basePath, 'memory/skills', name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'skill.md'), content, 'utf-8')
      return `Created memory override for bundle skill "${name}".`
    }

    return toolError(`Skill "${name}" not found.`)
  }

  private deleteSkill(ctx: ToolContext, name: string): string {
    name = name.trim()
    const skillDir = join(ctx.basePath, 'memory/skills', name)
    if (!existsSync(skillDir)) return toolError(`Skill "${name}" not found in memory/skills/.`)
    rmSync(skillDir, { recursive: true })
    return `Skill "${name}" deleted from memory/skills/.`
  }
}

function validateSkillName(name: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    return `Invalid skill name "${name}". Use lowercase letters, numbers, and hyphens only.`
  }
  if (name.length > 64) return 'Skill name must be ≤64 characters.'
  return null
}

function parseFrontmatter(content: string): { name: string; description: string; body: string; [key: string]: string } {
  const result: any = { name: '', description: '', body: content }
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return result

  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim()
    let val = line.slice(idx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    result[key] = val
  }
  result.body = content.slice(match[0].length).trim()
  return result
}

function substituteArguments(content: string, args: string): string {
  if (content.includes('$ARGUMENTS')) {
    content = content.replace(/\$ARGUMENTS/g, args)
    const parts = args.split(/\s+/)
    for (let i = 0; i < parts.length; i++) {
      content = content.replace(new RegExp(`\\$${i + 1}`, 'g'), parts[i])
    }
    return content
  }
  return content + `\n\nARGUMENTS: ${args}`
}

function discoverSkills(basePath: string, assetsPath: string, projectLocalDir?: string, pluginSkillPaths?: string[]): Array<{ name: string; source: string }> {
  const skills = new Map<string, { name: string; source: string }>()

  // 1. Bundle skills (lowest priority)
  const bundleDir = join(assetsPath, 'skills')
  if (existsSync(bundleDir)) {
    try {
      for (const name of readdirSync(bundleDir)) {
        if (existsSync(join(bundleDir, name, 'skill.md'))) {
          skills.set(name, { name, source: 'bundle' })
        }
      }
    } catch { /* */ }
  }

  // 2. Plugin skills (override bundle)
  if (pluginSkillPaths) {
    for (const dir of pluginSkillPaths) {
      if (!existsSync(dir)) continue
      try {
        for (const name of readdirSync(dir)) {
          if (existsSync(join(dir, name, 'skill.md'))) {
            skills.set(name, { name, source: 'plugin' })
          }
        }
      } catch { /* */ }
    }
  }

  // 3. Memory skills (override plugin + bundle)
  const memoryDir = join(basePath, 'memory/skills')
  if (existsSync(memoryDir)) {
    try {
      for (const name of readdirSync(memoryDir)) {
        if (existsSync(join(memoryDir, name, 'skill.md'))) {
          skills.set(name, { name, source: 'memory' })
        }
      }
    } catch { /* */ }
  }

  // 4. Project-local skills (highest priority — {cwd}/.finagent-workstation/skills/)
  if (projectLocalDir) {
    const localDir = join(projectLocalDir, 'skills')
    if (existsSync(localDir)) {
      try {
        for (const name of readdirSync(localDir)) {
          if (existsSync(join(localDir, name, 'skill.md'))) {
            skills.set(name, { name, source: 'project' })
          }
        }
      } catch { /* */ }
    }
  }

  return Array.from(skills.values())
}
