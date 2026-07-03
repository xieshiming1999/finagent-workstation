import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Message } from './message'
import { listSnapshots, restoreLatest } from './file-utils'
import { discoverCommands, expandCommandTemplate } from './command-loader'
import { runSecurityAudit } from './security-audit'
import type { PromptStash } from './prompt-stash'
import { goalCommands } from './slash-cmd-goal'
import { manageCommands } from './slash-cmd-manage'
import { extraCommands } from './slash-cmd-extras'

export type CommandResult =
  | { type: 'text'; text: string }
  | { type: 'compact' }
  | { type: 'clear' }
  | { type: 'resume'; filePath: string }
  | { type: 'list'; sessions: Array<{ name: string; path: string; title?: string; firstPrompt?: string }> }
  | { type: 'prompt'; prompt: string }
  | { type: 'fork' }
  | { type: 'goal-set'; goalPrompt: string }
  | { type: 'btw'; question: string }
  | { type: 'steer'; text: string }
  | { type: 'export'; format: 'markdown' | 'json'; content: string; filename: string }

export interface CommandContext {
  basePath: string
  memoryDir: string
  messages: Message[]
  compactFn: (customInstructions?: string) => Promise<void>
  goalManager: import('./goal-manager').GoalManager
  promptStash: PromptStash
}

interface SlashCommand {
  name: string
  aliases: string[]
  description: string
  handler: (args: string, ctx: CommandContext) => Promise<CommandResult>
}

export function parseSlashCommand(input: string): { name: string; args: string } | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null
  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx === -1) return { name: trimmed.slice(1).toLowerCase(), args: '' }
  return { name: trimmed.slice(1, spaceIdx).toLowerCase(), args: trimmed.slice(spaceIdx + 1).trim() }
}

export function findCommand(name: string): SlashCommand | undefined {
  return getAllCommands().find((c) => c.name === name || c.aliases.includes(name))
}

export function getAllCommandNames(): string[] {
  return getAllCommands().map((c) => `/${c.name} — ${c.description}`)
}

function getAllCommands(): SlashCommand[] {
  return [...COMMANDS]
}

function commandHelpDetail(rawName: string): string | null {
  if (!rawName.trim()) return null
  const name = rawName.trim().replace(/^\//, '').toLowerCase()
  switch (name) {
    case 'goal':
      return 'Use /goal help for autonomous goal usage, artifact guidance, and side effects.'
    case 'subgoal':
      return 'Use /subgoal help for goal criteria usage.'
    case 'mcp':
      return 'Use /mcp help for MCP server management. Side effects: writes ~/.finagent-workstation/mcp_servers.json and requires restart for connection changes.'
    case 'skill':
      return 'Use /skill help for skill install/remove/list usage. Side effects: writes memory/skills.'
    case 'plugin':
      return 'Use /plugin help for plugin install/remove/enable/disable/list usage. Side effects: writes ~/.finagent-workstation/plugins and may affect tools/commands after restart.'
    case 'compact':
      return '/compact [instructions]\n\nCompress conversation history to save context space.\nSide effects: rewrites compact/session memory for the active session.'
    case 'clear':
    case 'reset':
    case 'new':
      return '/clear\n\nArchive the current session and start a new one.\nSide effects: changes active session; does not delete archived history.'
    case 'resume':
    case 'continue':
      return '/resume [session path | search text]\n\nResume a previous conversation. With no argument, lists available sessions.\nSide effects: changes the active chat session.'
    case 'memory':
      return '/memory\n\nShow the current MEMORY.md index.\nSide effects: read-only.'
    case 'config':
    case 'settings':
      return '/config\n\nShow current model/configuration summary.\nSide effects: read-only.'
    case 'model':
      return '/model\n\nShow current model guidance. Change defaults in Settings.\nSide effects: read-only.'
    case 'cost':
    case 'usage':
      return '/cost\n\nEstimate session size and token usage.\nSide effects: read-only.'
    case 'diff':
      return '/diff\n\nAsk the agent to summarize files changed in this session.\nSide effects: read-only unless the follow-up agent turn chooses tools.'
    case 'status':
      return '/status\n\nAsk the agent to report tools, hooks, plugins, MCP, background tasks, memory, and session info.\nSide effects: read-only.'
    case 'security':
    case 'audit':
      return '/security\n\nRun a local security audit of the agent environment.\nSide effects: read-only.'
    case 'fork':
      return '/fork\n\nFork the current conversation into a new session.\nSide effects: creates/switches session state.'
    case 'btw':
    case 'side':
      return '/btw <question>\n\nAsk a side question using the current context without modifying the main task.\nSide effects: returns a side answer; does not set a goal.'
    case 'export':
      return '/export [markdown|json] [filename]\n\nExport the current session.\nSide effects: writes an export artifact.'
    case 'steer':
    case 'tell':
      return '/steer <message>\n\nInject guidance for the agent at the next safe opportunity.\nSide effects: can change the current turn direction.'
    case 'background':
    case 'bg':
      return '/background <prompt>\n\nRun a prompt in a parallel/background task.\nSide effects: creates background agent/task state.'
    case 'rollback':
    case 'rewind':
      return '/rollback [list|<number>|<hash>]\n\nList or request restore of filesystem checkpoints.\nSide effects: restore actions can modify many files and should be confirmed.'
    case 'agents':
    case 'tasks':
      return '/agents\n\nShow active and recent background agents/tasks.\nSide effects: read-only.'
    case 'stash':
      return '/stash push <text>\n/stash pop\n/stash list\n/stash drop <N>\n/stash clear\n\nSave and restore prompt snippets.\nSide effects: writes prompt-stash state.'
    case 'busy':
      return '/busy <queue|steer|interrupt>\n\nControl how new input is handled while the agent is working.\nSide effects: changes input handling policy.'
    default:
      return `Unknown command: /${name}. Use /help for available commands.`
  }
}

export function getAllCommandsWithFileCommands(basePath: string, projectLocalDir?: string, pluginCommandPaths?: string[]): SlashCommand[] {
  const commands = [...COMMANDS]
  for (const fc of discoverCommands(basePath, projectLocalDir, pluginCommandPaths)) {
    if (commands.some((c) => c.name === fc.name)) continue
    commands.push({
      name: fc.name,
      aliases: [],
      description: fc.description,
      handler: async (args) => {
        const expanded = expandCommandTemplate(fc.promptTemplate, args)
        return { type: 'prompt', prompt: expanded }
      },
    })
  }
  return commands
}

export function findCommandWithFileCommands(name: string, basePath: string, projectLocalDir?: string, pluginCommandPaths?: string[]): SlashCommand | undefined {
  return getAllCommandsWithFileCommands(basePath, projectLocalDir, pluginCommandPaths).find((c) => c.name === name || c.aliases.includes(name))
}

const COMMANDS: SlashCommand[] = [
  {
    name: 'compact',
    aliases: [],
    description: 'Compress conversation history to save context space',
    handler: async (args, ctx) => {
      await ctx.compactFn(args.trim() || undefined)
      return { type: 'compact' }
    },
  },
  {
    name: 'clear',
    aliases: ['reset', 'new'],
    description: 'Clear conversation and start a new session',
    handler: async () => ({ type: 'clear' }),
  },
  {
    name: 'resume',
    aliases: ['continue'],
    description: 'Resume a previous session',
    handler: async (args) => {
      if (!args) return { type: 'list', sessions: [] }
      if (args.includes('/') || args.endsWith('.jsonl')) return { type: 'resume', filePath: args }
      return { type: 'text', text: `Searching sessions for "${args}"...\nUse /resume without args to see all sessions.` }
    },
  },
  {
    name: 'memory',
    aliases: [],
    description: 'Show current memory index',
    handler: async (_args, ctx) => {
      const memoryFile = join(ctx.memoryDir, 'MEMORY.md')
      if (!existsSync(memoryFile)) return { type: 'text', text: 'No memories saved yet.' }
      const content = readFileSync(memoryFile, 'utf-8').trim()
      if (!content) return { type: 'text', text: 'Memory index is empty.' }
      return { type: 'text', text: `# Memory Index\n\n${content}` }
    },
  },
  {
    name: 'help',
    aliases: [],
    description: 'Show available commands',
    handler: async (args) => {
      const detail = commandHelpDetail(args)
      if (detail) return { type: 'text', text: detail }
      const line = (c: SlashCommand) => {
        const aliases = c.aliases.length > 0 ? ` (${c.aliases.map((a) => `/${a}`).join(', ')})` : ''
        return `  /${c.name}${aliases} — ${c.description}`
      }
      const coreNames = new Set(['compact', 'clear', 'resume', 'memory', 'help', 'config', 'model', 'cost', 'diff', 'status', 'security', 'fork', 'export'])
      const goalNames = new Set(['goal', 'subgoal'])
      const manageNames = new Set(['mcp', 'skill', 'plugin'])
      const workflowNames = new Set(['dream', 'undo', 'btw', 'steer', 'background', 'rollback', 'agents', 'stash', 'busy', 'rewind'])
      const coreCmds = COMMANDS.filter((c) => coreNames.has(c.name)).map(line)
      const goalCmds = COMMANDS.filter((c) => goalNames.has(c.name)).map(line)
      const manageCmds = COMMANDS.filter((c) => manageNames.has(c.name)).map(line)
      const workflowCmds = COMMANDS.filter((c) => workflowNames.has(c.name)).map(line)
      const uiCmds = [
        '  /settings — open settings panel',
        '  /watchlist — open watchlist widget',
        '  /dashboard <name> — open dashboard',
        '  /open <url> — open a website',
        '  /layout <mode> — switch layout',
      ]
      return {
        type: 'text',
        text: [
          'Command help',
          '',
          'Core/session commands:',
          coreCmds.join('\n'),
          '',
          'Goal commands:',
          goalCmds.join('\n'),
          '',
          'Management commands:',
          manageCmds.join('\n'),
          '',
          'Workflow/debug commands:',
          workflowCmds.join('\n'),
          '',
          'UI commands:',
          uiCmds.join('\n'),
          '',
          'Use /help <command> for usage and side effects.',
          'Detailed help: /goal help, /mcp help, /skill help, /plugin help, /stash help, /busy help.',
          '',
          'Runtime notes:',
          '- FinAgent and FinAgent Workstation share core command semantics where command names match.',
          '- FinAgent Workstation adds desktop-only MCP/plugin/security/UI commands.',
          '- Test/full-app automation is not a normal slash command; it is enabled only by FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION on loopback.',
        ].join('\n'),
      }
    },
  },
  {
    name: 'dream',
    aliases: [],
    description: 'Consolidate and organize memory files',
    handler: async () => {
      return { type: 'prompt', prompt: 'Review all files in memory/ directory. Consolidate related memories, remove duplicates, update stale information, and ensure MEMORY.md index is accurate and concise. Report what you changed.' }
    },
  },
  {
    name: 'undo',
    aliases: [],
    description: 'Restore a file to its previous version',
    handler: async (args, ctx) => {
      if (!args) return { type: 'text', text: 'Usage: /undo <file_path>\nRestores the file to its most recent snapshot.' }
      const filePath = args.trim()
      const snapshots = listSnapshots(filePath, ctx.basePath)
      if (snapshots.length === 0) return { type: 'text', text: `No snapshots found for "${filePath}".` }
      const restored = restoreLatest(filePath, ctx.basePath)
      if (!restored) return { type: 'text', text: `Failed to restore "${filePath}".` }
      const d = new Date(restored)
      const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
      return { type: 'text', text: `Restored "${filePath}" to snapshot from ${time}.\n${snapshots.length - 1} older snapshots still available.` }
    },
  },
  {
    name: 'config',
    aliases: ['settings'],
    description: 'Show current configuration',
    handler: async (_args, ctx) => {
      const configFile = join(ctx.basePath, '..', '..', 'config.json')
      if (!existsSync(configFile)) return { type: 'text', text: 'No config found.' }
      const config = JSON.parse(readFileSync(configFile, 'utf-8'))
      const models = (config.models ?? []).map((m: any) => `  ${m.name ?? m.model} (${m.provider})${m.isDefault ? ' [default]' : ''}`).join('\n')
      return { type: 'text', text: `Configuration:\n\nModels:\n${models || '  (none)'}\n\nBase path: ${ctx.basePath}` }
    },
  },
  {
    name: 'model',
    aliases: [],
    description: 'Show current LLM model',
    handler: async () => ({ type: 'text', text: 'Use /config to see all models. Change the default model in Settings.' }),
  },
  {
    name: 'cost',
    aliases: ['usage'],
    description: 'Show session token usage',
    handler: async (_args, ctx) => {
      let totalChars = 0
      for (const m of ctx.messages) totalChars += m.content.length
      const estTokens = Math.round(totalChars / 3)
      return { type: 'text', text: `Session: ${ctx.messages.length} messages, ~${estTokens} tokens (${Math.round(totalChars / 1024)}KB)` }
    },
  },
  {
    name: 'diff',
    aliases: [],
    description: 'Show files modified in this session',
    handler: async () => ({ type: 'prompt', prompt: 'List all files that have been created, modified, or deleted in this session. Show a summary of changes.' }),
  },
  {
    name: 'status',
    aliases: [],
    description: 'Show agent status (tools, hooks, plugins, MCP)',
    handler: async () => ({ type: 'prompt', prompt: 'Report your current status: how many tools are registered, any active background tasks, memory usage, and session info.' }),
  },
  {
    name: 'fork',
    aliases: [],
    description: 'Fork the current conversation into a new session',
    handler: async () => ({ type: 'fork' as const }),
  },
  {
    name: 'security',
    aliases: ['audit'],
    description: 'Run security audit on agent environment',
    handler: async (_args, ctx) => {
      const report = runSecurityAudit(ctx.basePath)
      const lines = [`Security Score: ${report.score}/100`, '']
      for (const f of report.findings) {
        lines.push(`[${f.severity.toUpperCase()}] ${f.category}: ${f.message}`)
        if (f.suggestion) lines.push(`  → ${f.suggestion}`)
      }
      if (report.findings.length === 0) lines.push('No issues found.')
      return { type: 'text' as const, text: lines.join('\n') }
    },
  },
  {
    name: 'rewind',
    aliases: [],
    description: 'Revert working directory to last git snapshot',
    handler: async () => ({ type: 'prompt' as const, prompt: 'The user wants to revert to a previous state. Check git log and offer to restore a recent commit.' }),
  },
  ...goalCommands,
  ...manageCommands,
  ...extraCommands,
]
