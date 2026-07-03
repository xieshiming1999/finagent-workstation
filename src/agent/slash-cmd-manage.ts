import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'fs'
import { join, basename } from 'path'
import { execSync } from 'child_process'
import { installPlugin, uninstallPlugin, setPluginEnabled } from './plugin-loader'
import type { CommandResult, CommandContext } from './slash-command'

interface SlashCommand {
  name: string
  aliases: string[]
  description: string
  handler: (args: string, ctx: CommandContext) => Promise<CommandResult>
}

const MCP_HELP = `MCP Server Management

Commands:
  /mcp add <name> <command> [args...]       Add a stdio server
  /mcp add --http <name> <url>              Add an HTTP/SSE server
  /mcp add <name> -e KEY=VAL <command>      Add with env vars
  /mcp remove <name>                        Remove a server
  /mcp enable <name>                        Enable a disabled server
  /mcp disable <name>                       Disable without removing
  /mcp list                                 List all configured servers
  /mcp help                                 Show this help

Config: ~/.finagent-workstation/mcp_servers.json
Plugins can also provide MCP servers via manifest.json mcpServers field.`

const SKILL_HELP = `Skill Management

Commands:
  /skill install <git-url>                  Install from git repository
  /skill install <local-path>               Install from local directory (symlink)
  /skill remove <name>                      Remove an installed skill
  /skill list                               List all skills (bundle + memory)
  /skill help                               Show this help

Skills are directories containing a skill.md file with frontmatter.
Installed skills go to memory/skills/<name>/.`

const PLUGIN_HELP = `Plugin Management

Commands:
  /plugin install <git-url>                 Install from git repository
  /plugin install <local-path>              Install from local directory (symlink)
  /plugin remove <name>                     Uninstall a plugin
  /plugin enable <name>                     Enable a disabled plugin
  /plugin disable <name>                    Disable without removing
  /plugin list                              List installed plugins
  /plugin help                              Show this help

Install dir: ~/.finagent-workstation/plugins/<name>/`

export const manageCommands: SlashCommand[] = [
  {
    name: 'mcp',
    aliases: [],
    description: 'Manage MCP servers: /mcp add/remove/enable/disable/list/help',
    handler: async (args: string, ctx: CommandContext) => {
      const parts = args.trim().split(/\s+/)
      const subCmd = parts[0]
      const globalPath = join(ctx.basePath, '..', '..')
      const configPath = join(globalPath, 'mcp_servers.json')

      const loadConfigs = (): Array<{ name: string; type: string; command?: string; args?: string[]; url?: string; env?: Record<string, string>; enabled?: boolean }> => {
        if (!existsSync(configPath)) return []
        try { return JSON.parse(readFileSync(configPath, 'utf-8')) } catch { return [] }
      }
      const saveConfigs = (cfgs: unknown[]) => {
        mkdirSync(join(configPath, '..'), { recursive: true })
        writeFileSync(configPath, JSON.stringify(cfgs, null, 2), 'utf-8')
      }

      switch (subCmd) {
        case 'add': {
          const rest = parts.slice(1)
          let type: 'stdio' | 'http' = 'stdio'
          const env: Record<string, string> = {}
          const filtered: string[] = []

          for (let i = 0; i < rest.length; i++) {
            if (rest[i] === '--http' || rest[i] === '--sse') { type = 'http'; continue }
            if (rest[i] === '-e' && rest[i + 1]?.includes('=')) {
              const [k, ...v] = rest[i + 1].split('=')
              env[k] = v.join('=')
              i++
              continue
            }
            filtered.push(rest[i])
          }

          if (filtered.length < 2) {
            return { type: 'text' as const, text: 'Usage:\n  /mcp add <name> <command> [args...]\n  /mcp add --http <name> <url>\n  /mcp add <name> -e KEY=VAL <command>' }
          }

          const name = filtered[0]
          const configs = loadConfigs()
          if (configs.some((c) => c.name === name)) {
            return { type: 'text' as const, text: `MCP server "${name}" already exists. Remove it first with /mcp remove ${name}` }
          }

          const entry: Record<string, unknown> = { name, type }
          if (type === 'http') { entry.url = filtered[1] }
          else { entry.command = filtered[1]; if (filtered.length > 2) entry.args = filtered.slice(2) }
          if (Object.keys(env).length > 0) entry.env = env

          configs.push(entry as any)
          saveConfigs(configs)
          return { type: 'text' as const, text: `Added MCP server "${name}" (${type}). Restart to connect.` }
        }
        case 'remove':
        case 'rm': {
          const name = parts[1]
          if (!name) return { type: 'text' as const, text: 'Usage: /mcp remove <name>' }
          const configs = loadConfigs()
          const idx = configs.findIndex((c) => c.name === name)
          if (idx < 0) return { type: 'text' as const, text: `MCP server "${name}" not found.` }
          configs.splice(idx, 1)
          saveConfigs(configs)
          return { type: 'text' as const, text: `Removed MCP server "${name}". Restart to apply.` }
        }
        case 'enable': {
          const name = parts[1]
          if (!name) return { type: 'text' as const, text: 'Usage: /mcp enable <name>' }
          const configs = loadConfigs()
          const cfg = configs.find((c) => c.name === name)
          if (!cfg) return { type: 'text' as const, text: `MCP server "${name}" not found.` }
          cfg.enabled = true; saveConfigs(configs)
          return { type: 'text' as const, text: `MCP server "${name}" enabled. Restart to apply.` }
        }
        case 'disable': {
          const name = parts[1]
          if (!name) return { type: 'text' as const, text: 'Usage: /mcp disable <name>' }
          const configs = loadConfigs()
          const cfg = configs.find((c) => c.name === name)
          if (!cfg) return { type: 'text' as const, text: `MCP server "${name}" not found.` }
          cfg.enabled = false; saveConfigs(configs)
          return { type: 'text' as const, text: `MCP server "${name}" disabled. Restart to apply.` }
        }
        case 'list': {
          const configs = loadConfigs()
          if (configs.length === 0) return { type: 'text' as const, text: 'No MCP servers configured. Use /mcp help for usage.' }
          const lines = configs.map((c) => {
            const status = c.enabled === false ? ' (disabled)' : ''
            const target = c.type === 'http' ? c.url : `${c.command} ${(c.args ?? []).join(' ')}`.trim()
            return `  ${c.name} [${c.type}]${status} — ${target}`
          })
          return { type: 'text' as const, text: `MCP servers (${configs.length}):\n${lines.join('\n')}` }
        }
        case 'help':
        default:
          return { type: 'text' as const, text: MCP_HELP }
      }
    },
  },
  {
    name: 'skill',
    aliases: [],
    description: 'Install/manage skills: /skill install/remove/list/help',
    handler: async (args: string, ctx: CommandContext) => {
      const [subCmd, ...rest] = args.trim().split(/\s+/)
      const arg = rest.join(' ')
      const skillsDir = join(ctx.basePath, 'memory', 'skills')

      switch (subCmd) {
        case 'install': {
          if (!arg) return { type: 'text' as const, text: 'Usage: /skill install <git-url-or-path>' }
          if (arg.startsWith('http') || arg.startsWith('git@') || arg.includes('github.com')) {
            const repoName = basename(arg).replace('.git', '')
            const targetDir = join(skillsDir, repoName)
            if (existsSync(targetDir)) return { type: 'text' as const, text: `Skill "${repoName}" already exists.` }
            try {
              mkdirSync(skillsDir, { recursive: true })
              execSync(`git clone --depth 1 ${arg} ${targetDir}`, { stdio: 'pipe', timeout: 60_000 })
              const hasSkillMd = existsSync(join(targetDir, 'skill.md'))
              return { type: 'text' as const, text: `Installed skill "${repoName}" from ${arg}${hasSkillMd ? '' : '\n⚠ No skill.md found.'}` }
            } catch (e) { return { type: 'text' as const, text: `Failed: ${e instanceof Error ? e.message : String(e)}` } }
          }
          const name = basename(arg)
          const targetDir = join(skillsDir, name)
          if (existsSync(targetDir)) return { type: 'text' as const, text: `Skill "${name}" already exists.` }
          if (!existsSync(arg)) return { type: 'text' as const, text: `Path not found: ${arg}` }
          if (!existsSync(join(arg, 'skill.md'))) return { type: 'text' as const, text: `No skill.md found at ${arg}` }
          try {
            mkdirSync(skillsDir, { recursive: true })
            require('fs').symlinkSync(arg, targetDir, 'dir')
            return { type: 'text' as const, text: `Installed skill "${name}" (symlinked from ${arg})` }
          } catch (e) { return { type: 'text' as const, text: `Failed: ${e instanceof Error ? e.message : String(e)}` } }
        }
        case 'remove':
        case 'uninstall': {
          if (!arg) return { type: 'text' as const, text: 'Usage: /skill remove <name>' }
          const targetDir = join(skillsDir, arg)
          if (!existsSync(targetDir)) return { type: 'text' as const, text: `Skill "${arg}" not found.` }
          try { require('fs').rmSync(targetDir, { recursive: true }); return { type: 'text' as const, text: `Removed skill "${arg}".` } }
          catch (e) { return { type: 'text' as const, text: `Failed: ${e instanceof Error ? e.message : String(e)}` } }
        }
        case 'list': {
          const sources: Array<{ name: string; source: string }> = []
          const bundleDir = join(ctx.basePath, '..', 'bundle', 'skills')
          if (existsSync(bundleDir)) { try { for (const n of readdirSync(bundleDir)) { if (existsSync(join(bundleDir, n, 'skill.md'))) sources.push({ name: n, source: 'bundle' }) } } catch {} }
          if (existsSync(skillsDir)) { try { for (const n of readdirSync(skillsDir)) { if (existsSync(join(skillsDir, n, 'skill.md'))) sources.push({ name: n, source: 'memory' }) } } catch {} }
          if (sources.length === 0) return { type: 'text' as const, text: 'No skills installed. Use /skill help for usage.' }
          return { type: 'text' as const, text: `Skills (${sources.length}):\n${sources.map((s) => `  ${s.name} (${s.source})`).join('\n')}` }
        }
        case 'help':
        default:
          return { type: 'text' as const, text: SKILL_HELP }
      }
    },
  },
  {
    name: 'plugin',
    aliases: [],
    description: 'Manage plugins: /plugin install/remove/enable/disable/list/help',
    handler: async (args: string, ctx: CommandContext) => {
      const [subCmd, ...rest] = args.trim().split(/\s+/)
      const arg = rest.join(' ')
      const globalPath = join(ctx.basePath, '..', '..')

      switch (subCmd) {
        case 'install':
          if (!arg) return { type: 'text' as const, text: 'Usage: /plugin install <git-url-or-path>' }
          return { type: 'text' as const, text: installPlugin(arg, globalPath) }
        case 'remove':
        case 'uninstall':
          if (!arg) return { type: 'text' as const, text: 'Usage: /plugin remove <name>' }
          return { type: 'text' as const, text: uninstallPlugin(arg, globalPath) }
        case 'enable':
          if (!arg) return { type: 'text' as const, text: 'Usage: /plugin enable <name>' }
          setPluginEnabled(arg, true, globalPath)
          return { type: 'text' as const, text: `Plugin "${arg}" enabled. Restart to apply.` }
        case 'disable':
          if (!arg) return { type: 'text' as const, text: 'Usage: /plugin disable <name>' }
          setPluginEnabled(arg, false, globalPath)
          return { type: 'text' as const, text: `Plugin "${arg}" disabled. Restart to apply.` }
        case 'list': {
          const pluginsDir = join(globalPath, 'plugins')
          if (!existsSync(pluginsDir)) return { type: 'text' as const, text: 'No plugins installed. Use /plugin help for usage.' }
          const dirs = readdirSync(pluginsDir).filter((d) => existsSync(join(pluginsDir, d, 'manifest.json')))
          if (dirs.length === 0) return { type: 'text' as const, text: 'No plugins installed. Use /plugin help for usage.' }
          const lines = dirs.map((d) => { try { const m = JSON.parse(readFileSync(join(pluginsDir, d, 'manifest.json'), 'utf-8')); return `  ${m.name ?? d} v${m.version ?? '?'}` } catch { return `  ${d}` } })
          return { type: 'text' as const, text: `Plugins (${dirs.length}):\n${lines.join('\n')}` }
        }
        case 'help':
        default:
          return { type: 'text' as const, text: PLUGIN_HELP }
      }
    },
  },
]
