import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { summarizeToolCapability, type Tool } from './tool'
import { promptBuilderCopy } from './runtime-copy'
import { memoryLifecyclePromptGuidance } from './memory-lifecycle'
import { financeOutputStandardPromptGuidance } from './finance-output-standard'

/**
 * Assembles the system prompt for the Agent.
 *
 * All prompt content comes from files — code only handles assembly logic.
 *
 * Files loaded (in order):
 *   1. bundle/AGENTS.md — project identity, rules, file system, behavior
 *   2. bundle/{role}/AGENTS.md — role-specific instructions (chat/event)
 *   3. Available Tools (auto-generated from registered tools)
 *   4. Skills Index (lazy — only names, loaded on demand via SkillTool)
 *   5. memory/MEMORY.md — current memory index
 *   6. memory/{role}/soul.md — agent's personal soul (editable)
 *   7. memory/ai_reflections.md — past analysis reflections
 *   8. strategies.json — active investment strategies summary
 *   9. Environment (auto-generated: platform, date, paths)
 *  10. bundle/prompts/{provider}.md — provider-specific prompt (optional)
 */
export class PromptBuilder {
  private basePath: string
  private assetsPath: string
  private agentRole: string
  providerHint: string | null = null
  pluginSkillPaths: string[] = []

  constructor(basePath: string, assetsPath: string, agentRole: string = 'chat') {
    this.basePath = basePath
    this.assetsPath = assetsPath
    this.agentRole = agentRole
  }

  build(tools: Tool[]): string {
    const sections: string[] = []

    // 1. bundle/AGENTS.md — shared project identity, rules, file system, behavior
    const agentsMd = this.loadFile(join(this.assetsPath, 'bundle/AGENTS.md'), true)
    if (agentsMd) {
      sections.push(`# Project Instructions (from bundle/AGENTS.md — read-only)\n\n${agentsMd}`)
    } else {
      sections.push(FALLBACK_BASE_PROMPT)
    }

    // 2. bundle/{role}/AGENTS.md — role-specific instructions
    if (this.agentRole) {
      const roleMd = this.loadFile(join(this.assetsPath, `bundle/${this.agentRole}/AGENTS.md`), true)
      if (roleMd) {
        sections.push(`# Role Instructions (from bundle/${this.agentRole}/AGENTS.md — read-only)\n\n${roleMd}`)
      }
    }

    // 2b. {cwd}/.finagent-workstation/AGENTS.md — project-local instructions (highest priority)
    const projectLocalAgents = this.loadFile(join(process.cwd(), '.finagent-workstation', 'AGENTS.md'), true)
    if (projectLocalAgents) {
      sections.push(`# Project-Local Instructions (from .finagent-workstation/AGENTS.md — editable)\n\n${projectLocalAgents}`)
    }

    // 3. Available Tools (auto-generated)
    sections.push(this.buildToolsSection(tools))

    // 4. Skills Index
    const skillsSection = this.buildSkillsSection()
    if (skillsSection) sections.push(skillsSection)

    // 5. memory/MEMORY.md — current memory index
    sections.push(memoryLifecyclePromptGuidance)
    sections.push(financeOutputStandardPromptGuidance)
    sections.push(this.loadMemoryIndex())

    // 5a. Active Wind daily quota state, if Wind already reported exhaustion.
    const windQuotaStatus = this.loadWindQuotaStatus(tools.some((tool) => tool.name === 'WindMcp'))
    if (windQuotaStatus) sections.push(windQuotaStatus)

    // 6. memory/{role}/soul.md — agent's personal soul
    const soul = this.loadAgentSoul()
    if (soul) sections.push(soul)

    // 7. memory/ai_reflections.md — past analysis reflections
    const reflections = this.loadFile(join(this.basePath, 'memory/ai_reflections.md'))
    if (reflections) {
      sections.push(`# Past Analysis Reflections (from memory/ai_reflections.md — editable)\n${reflections}`)
    }

    // 8. strategies.json — active investment strategies summary
    const strategies = this.loadStrategySummary()
    if (strategies) sections.push(strategies)

    // 9. Environment (auto-generated)
    sections.push(this.buildEnvironment())

    // 10. Provider-specific prompt (optional)
    const providerPrompt = this.loadProviderPrompt()
    if (providerPrompt) sections.push(providerPrompt)

    return sections.join('\n\n')
  }

  private loadFile(absolutePath: string, renderRuntimePaths = false): string | null {
    if (!existsSync(absolutePath)) return null
    const content = readFileSync(absolutePath, 'utf-8').trim()
    if (renderRuntimePaths) return this.renderRuntimeTemplate(content) || null
    return content || null
  }

  private renderRuntimeTemplate(content: string): string {
    return content
      .replaceAll('{{DATA_DIR}}', this.basePath)
      .replaceAll('{{MEMORY_DIR}}', join(this.basePath, 'memory'))
      .replaceAll('{{BUNDLE_DIR}}', join(this.basePath, 'bundle'))
      .replaceAll('{{SKILLS_DIR}}', join(this.assetsPath, 'skills'))
      .replaceAll('{{WORK_DIR}}', process.cwd())
      .replaceAll('{{PROJECT_LOCAL_DIR}}', join(process.cwd(), '.finagent-workstation'))
      .replaceAll('{{AGENT_ROLE}}', this.agentRole)
  }

  private buildToolsSection(tools: Tool[]): string {
    const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name))
    const lines = sorted.map((tool) => {
      const capability = summarizeToolCapability(tool)
      const flags = [
        capability.permission,
        capability.requiresUserInteraction ? 'requires-user-input' : '',
        capability.canParallel ? 'parallel-ok' : 'serial',
        capability.schema.actionValues.length
          ? `actions=${capability.schema.actionValues.join('|')}`
          : '',
      ].filter(Boolean)
      return `- ${tool.name} [${flags.join(', ')}]: ${tool.description}`
    })
    return `# Available Tools\n\n${lines.join('\n')}`
  }

  private buildSkillsSection(): string | null {
    const skills = this.discoverSkills()
    if (skills.length === 0) return null

    const lines = skills.map((s) => {
      let entry = `- **${s.name}**: ${s.description}`
      if (s.whenToUse) entry += ` — *When:* ${s.whenToUse.slice(0, 100)}`
      return entry
    })

    return [
      '# Available Skills',
      '',
      'Use the Skill tool to load a skill by name. Skills provide detailed instructions for specific tasks.',
      'Use Skill(skill: "create", content: "...") to save reusable workflows as new skills.',
      'Before creating, check existing skills to avoid duplicates — merge if similar.',
      '',
      ...lines,
    ].join('\n')
  }

  private discoverSkills(): Array<{ name: string; description: string; whenToUse?: string; source: string }> {
    const skills: Map<string, { name: string; description: string; whenToUse?: string; source: string }> = new Map()

    const bundleDir = join(this.assetsPath, 'skills')
    if (existsSync(bundleDir)) {
      for (const entry of this.loadSkillsFromDir(bundleDir, 'bundle')) {
        skills.set(entry.name, entry)
      }
    }

    for (const dir of this.pluginSkillPaths) {
      if (existsSync(dir)) {
        for (const entry of this.loadSkillsFromDir(dir, 'plugin')) {
          skills.set(entry.name, entry)
        }
      }
    }

    const memoryDir = join(this.basePath, 'memory/skills')
    if (existsSync(memoryDir)) {
      for (const entry of this.loadSkillsFromDir(memoryDir, 'memory')) {
        skills.set(entry.name, entry)
      }
    }

    const projectLocalDir = join(process.cwd(), '.finagent-workstation', 'skills')
    if (existsSync(projectLocalDir)) {
      for (const entry of this.loadSkillsFromDir(projectLocalDir, 'project')) {
        skills.set(entry.name, entry)
      }
    }

    return Array.from(skills.values())
  }

  private loadSkillsFromDir(dir: string, source: string) {
    const results: Array<{ name: string; description: string; whenToUse?: string; source: string }> = []
    try {
      for (const name of readdirSync(dir)) {
        const skillMd = join(dir, name, 'skill.md')
        if (!existsSync(skillMd)) continue
        const content = readFileSync(skillMd, 'utf-8')
        const frontmatter = parseFrontmatter(content)
        results.push({
          name: frontmatter.name ?? name,
          description: frontmatter.description ?? '',
          whenToUse: frontmatter.when_to_use,
          source,
        })
      }
    } catch { /* skip */ }
    return results
  }

  private loadMemoryIndex(): string {
    const memoryIndex = join(this.basePath, 'memory/MEMORY.md')
    if (existsSync(memoryIndex)) {
      const content = readFileSync(memoryIndex, 'utf-8').trim()
      if (content) {
        return `# Memory Index (from memory/MEMORY.md — editable)\n${content}`
      }
    }
    return '# Memory Index (from memory/MEMORY.md — editable)\n(No memories saved yet.)'
  }

  private loadWindQuotaStatus(hasWindMcp: boolean): string | null {
    if (!hasWindMcp) return null
    const file = join(this.basePath, 'memory/wind_usage.json')
    if (!existsSync(file)) return windQuotaAvailableStatus('+08:00')
    try {
      const data = JSON.parse(readFileSync(file, 'utf-8'))
      const offset = normalizeUtcOffset(typeof data.resetUtcOffset === 'string' ? data.resetUtcOffset : undefined)
      const today = dateForOffset(offset)
      if (data.exhausted !== true || data.date !== today) return windQuotaAvailableStatus(offset)

      const code = typeof data.exhaustedCode === 'string' ? data.exhaustedCode : 'RATE_LIMIT_DAILY'
      const message = typeof data.exhaustedMessage === 'string'
        ? data.exhaustedMessage
        : 'Wind reported daily quota exhaustion or insufficient balance.'
      const nextDate = nextDateString(today)
      const retryGuidance = code === 'BALANCE_INSUFFICIENT'
        ? 'Do not call WindMcp again until the user tops up the Wind account or configures a different key.'
        : `Do not call WindMcp again until quota date ${nextDate} starts at reset offset ${offset}, unless the user configures a different key.`
      return [
        '# Wind AIFinMarket Quota Status',
        `WindMcp is unavailable for quota date ${today} (reset offset ${offset}).`,
        `Stored error: ${code}. ${message}`,
        retryGuidance,
        'Use non-Wind sources such as cache, AkShare, EastMoney, TDX, Yahoo, or DataStore for this turn.',
      ].join('\n')
    } catch {
      return windQuotaAvailableStatus('+08:00')
    }
  }

  private loadAgentSoul(): string {
    if (!this.agentRole) {
      return '# Your Soul (no role configured)\n(Not configured yet.)'
    }
    const path = `memory/${this.agentRole}/soul.md`
    const content = this.loadFile(join(this.basePath, path))
    if (content) {
      return `# Your Soul (from ${path} — editable)\n${content}`
    }
    return `# Your Soul (from ${path} — editable)\n` +
      '(Not configured yet. You can create this file to customize your behavior, ' +
      'record reflections, and reference other memory files. Keep it concise.)'
  }

  private loadStrategySummary(): string | null {
    const strategiesPath = join(this.basePath, 'strategies.json')
    if (!existsSync(strategiesPath)) return null
    try {
      const data = JSON.parse(readFileSync(strategiesPath, 'utf-8'))
      if (!Array.isArray(data) || data.length === 0) return null

      const lines = data.map((s: any) => {
        const wr = s.timesUsed >= 3
          ? promptBuilderCopy.strategyWinRate(((s.timesCorrect / s.timesUsed) * 100).toFixed(0))
          : ''
        return `- ${s.name} (${s.id}): ${s.description}${wr}`
      })

      return [
        '# Investment Strategies (from strategies.json — editable)',
        '',
        promptBuilderCopy.strategyHeading(),
        ...lines,
        '',
        promptBuilderCopy.strategyHint(),
      ].join('\n')
    } catch {
      return null
    }
  }

  private buildEnvironment(): string {
    return [
      '# Environment',
      '',
      `- Platform: ${process.platform} (${process.arch})`,
      `- Date: ${new Date().toISOString().split('T')[0]}`,
      `- Working directory: ${process.cwd()}`,
      `- Data directory: ${this.basePath}`,
      `- Node: ${process.version}`,
      '',
      '## File System',
      '',
      'All project data paths are rooted at the Data directory shown below.',
      `- Data-directory shorthand \`memory/...\` resolves to \`${this.basePath}/memory/...\`. Prefer the concrete path in generated instructions and file-update tasks.`,
      `- Data-directory shorthand \`bundle/...\` resolves to \`${this.basePath}/bundle/...\`. Prefer the concrete path when referring to bundled assets.`,
      '- Other relative paths resolve from the Working directory shown above.',
      '- Absolute paths are used as-is; verify them before editing.',
      `Use concrete data paths such as \`${this.basePath}/memory/pages/report.html\` for Read/Edit/Write/UIControl.`,
      'Do not guess project data paths by hand. If an absolute path is needed, use the exact Data directory shown below or a path returned by LS/find/tool output.',
      `Project data directory for this session: \`${this.basePath}\`.`,
      '',
      `**Data directory:** \`${this.basePath}\``,
      '',
      '## Directory Structure',
      '',
      '| Directory | Resolved path | Purpose | Access |',
      '|-----------|---------------|---------|--------|',
      `| \`./\` | \`${this.basePath}/\` | Current FinAgent Workstation project data root | Runtime |`,
      `| \`config.json\` | \`${this.basePath}/config.json\` | LLM provider, API keys, app settings | Read |`,
      `| \`memory/\` | \`${this.basePath}/memory/\` | Persistent memory across sessions | Read/Write |`,
      `| \`memory/MEMORY.md\` | \`${this.basePath}/memory/MEMORY.md\` | Memory index file, keep updated | Read/Write |`,
      `| \`memory/${this.agentRole}/soul.md\` | \`${this.basePath}/memory/${this.agentRole}/soul.md\` | Your personal soul (editable) | Read/Write |`,
      `| \`memory/skills/\` | \`${this.basePath}/memory/skills/\` | Skills you create or modify | Read/Write |`,
      `| \`memory/pages/\` | \`${this.basePath}/memory/pages/\` | HTML pages and dashboards you create | Read/Write |`,
      `| \`memory/ai_reflections.md\` | \`${this.basePath}/memory/ai_reflections.md\` | Cross-ticker analysis lessons | Read/Write |`,
      `| \`memory/.screenshots/\` | \`${this.basePath}/memory/.screenshots/\` | WebView screenshots | Auto-managed |`,
      `| \`memory/.file_history/\` | \`${this.basePath}/memory/.file_history/\` | File write backups | Auto-managed |`,
      `| \`memory/.tool_outputs/\` | \`${this.basePath}/memory/.tool_outputs/\` | Tool execution outputs | Auto-managed |`,
      `| \`bundle/\` | \`${this.basePath}/bundle/\` | Preset skills and agent instructions | Read-only |`,
      `| \`watchlists.json\` | \`${this.basePath}/watchlists.json\` | Unified user watchlists for stock/fund/ETF/index items | Via Watchlist tool |`,
      `| \`portfolio.json\` | \`${this.basePath}/portfolio.json\` | Paper trading positions | Via Portfolio tool |`,
      `| \`monitors.json\` | \`${this.basePath}/monitors.json\` | Monitor configurations | Via Monitor tools |`,
      `| \`sessions/\` | \`${this.basePath}/sessions/\` | Conversation history | Auto-managed |`,
      `| \`logs/\` | \`${this.basePath}/logs/\` | Debug logs | Auto-managed |`,
      '',
      `Use \`Grep\` or \`Read\` on \`${this.basePath}/logs/\` when debugging runtime behavior, tool failures, WebView bridge issues, or repeated unexpected errors. Do not read logs for ordinary finance analysis unless the user asks or a tool/runtime problem needs diagnosis.`,
    ].join('\n')
  }

  private loadProviderPrompt(): string | null {
    if (!this.providerHint) return null
    const provider = this.providerHint.toLowerCase()
    const path = `bundle/prompts/${provider}.md`
    const content = this.loadFile(join(this.assetsPath, path))
    return content ? `# Provider Prompt (from ${path} — read-only)\n${content}` : null
  }
}

function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {}
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
  return result
}

const FALLBACK_BASE_PROMPT = promptBuilderCopy.fallbackBasePrompt()

function normalizeUtcOffset(raw?: string): string {
  const text = raw?.trim() || '+08:00'
  const match = /^([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(text)
  if (!match) return '+08:00'
  const hours = Number(match[2])
  const minutes = Number(match[3] ?? '0')
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 14 || minutes > 59) return '+08:00'
  return `${match[1]}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function dateForOffset(normalizedOffset: string): string {
  const sign = normalizedOffset.startsWith('-') ? -1 : 1
  const hours = Number(normalizedOffset.slice(1, 3))
  const minutes = Number(normalizedOffset.slice(4, 6))
  return new Date(Date.now() + sign * (hours * 60 + minutes) * 60_000).toISOString().slice(0, 10)
}

function windQuotaAvailableStatus(offset: string): string {
  return [
    '# Wind AIFinMarket Quota Status',
    'WindMcp is available to try for the current Wind quota day, if WIND_API_KEY is configured.',
    'Use WindMcp for Wind-covered data before spending monthly Brave/Tavily search quota.',
    'Ignore previous-session Wind daily quota errors from older quota dates.',
  ].join('\n')
}

function nextDateString(yyyyMmDd: string): string {
  const next = new Date(`${yyyyMmDd}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}
