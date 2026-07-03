import type { CommandResult, CommandContext } from './slash-command'

interface SlashCommand {
  name: string
  aliases: string[]
  description: string
  handler: (args: string, ctx: CommandContext) => Promise<CommandResult>
}

export const extraCommands: SlashCommand[] = [
  {
    name: 'btw',
    aliases: ['side'],
    description: 'Ask a side question using current context without modifying the session',
    handler: async (args: string) => {
      const question = args.trim()
      if (!question) return { type: 'text' as const, text: 'Usage: /btw <question>\nAsk a side question without affecting the main conversation.' }
      return { type: 'btw' as const, question }
    },
  },
  {
    name: 'export',
    aliases: [],
    description: 'Export session: /export [markdown|json] [filename]',
    handler: async (args: string, ctx: CommandContext) => {
      const parts = args.trim().split(/\s+/)
      let format: 'markdown' | 'json' = 'markdown'
      let filename = ''

      for (const p of parts) {
        if (p === 'json') format = 'json'
        else if (p === 'markdown' || p === 'md') format = 'markdown'
        else if (p) filename = p
      }

      const now = new Date()
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`

      if (format === 'json') {
        const data = ctx.messages.map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          ...(m.toolUses ? { toolUses: m.toolUses.map((t) => ({ name: t.name, input: t.input })) } : {}),
        }))
        const content = JSON.stringify(data, null, 2)
        if (!filename) filename = `session-${dateStr}-${timeStr}.json`
        return { type: 'export' as const, format, content, filename }
      }

      const lines: string[] = [`# Session Export — ${dateStr}\n`]
      let toolCallCount = 0
      for (const m of ctx.messages) {
        if (m.isCompactSummary) {
          lines.push('---\n*[Compacted summary]*\n')
          lines.push(m.content + '\n')
          continue
        }
        const roleLabel = m.role === 'user' ? '**User**' : m.role === 'assistant' ? '**Assistant**' : '**Tool**'
        const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : ''
        lines.push(`### ${roleLabel} ${time}\n`)
        lines.push(m.content + '\n')
        if (m.toolUses && m.toolUses.length > 0) {
          toolCallCount += m.toolUses.length
          for (const tu of m.toolUses) {
            lines.push(`> Tool: **${tu.name}**(${JSON.stringify(tu.input).slice(0, 100)}...)\n`)
          }
        }
      }
      lines.push(`\n---\n*${ctx.messages.length} messages, ${toolCallCount} tool calls*\n`)
      const content = lines.join('\n')
      if (!filename) filename = `session-${dateStr}-${timeStr}.md`
      return { type: 'export' as const, format, content, filename }
    },
  },
  {
    name: 'steer',
    aliases: ['tell'],
    description: 'Inject a message for the agent after the current turn (or immediately if idle)',
    handler: async (args: string) => {
      const text = args.trim()
      if (!text) return { type: 'text' as const, text: 'Usage: /steer <message>\nInjects guidance that the agent sees at the next opportunity.' }
      return { type: 'steer' as const, text }
    },
  },
  {
    name: 'background',
    aliases: ['bg'],
    description: 'Run a prompt in the background (parallel to current conversation)',
    handler: async (args: string) => {
      const prompt = args.trim()
      if (!prompt) return { type: 'text' as const, text: 'Usage: /background <prompt>\nRuns the prompt as a parallel background task.' }
      return { type: 'prompt' as const, prompt: `[Background task requested] Run the following in the background as a sub-agent:\n\n${prompt}` }
    },
  },
  {
    name: 'rollback',
    aliases: [],
    description: 'List or restore filesystem checkpoints: /rollback [list|<number>|<hash>]',
    handler: async (args: string) => {
      const subCmd = args.trim()
      if (!subCmd || subCmd === 'list') {
        return { type: 'prompt' as const, prompt: 'List all available git snapshots/checkpoints. Show the index number, time, and description for each.' }
      }
      return { type: 'prompt' as const, prompt: `Rollback the working directory to checkpoint "${subCmd}". Use the GitSnapshot restore function.` }
    },
  },
  {
    name: 'agents',
    aliases: ['tasks'],
    description: 'Show active and recent background agents/tasks',
    handler: async () => {
      return { type: 'prompt' as const, prompt: 'Show the status of all background tasks and sub-agents. Include: task ID, description, status (running/completed/failed), duration, and any results.' }
    },
  },
  {
    name: 'stash',
    aliases: [],
    description: 'Save/restore prompts: /stash push/pop/list/drop/clear',
    handler: async (args: string, ctx: CommandContext) => {
      const parts = args.trim().split(/\s+/)
      const subCmd = parts[0]?.toLowerCase()

      switch (subCmd) {
        case 'push': {
          const text = args.slice(args.indexOf(' ') + 1).trim()
          if (!text || text === 'push') return { type: 'text' as const, text: 'Usage: /stash push <text>' }
          ctx.promptStash.push(text)
          return { type: 'text' as const, text: `Stashed (${ctx.promptStash.length} total).` }
        }
        case 'pop': {
          const entry = ctx.promptStash.pop()
          if (!entry) return { type: 'text' as const, text: 'Stash is empty.' }
          const age = Math.round((Date.now() - entry.timestamp) / 60000)
          return { type: 'text' as const, text: `Popped (${age}min ago):\n${entry.input}` }
        }
        case 'list': {
          const entries = ctx.promptStash.list()
          if (entries.length === 0) return { type: 'text' as const, text: 'Stash is empty.' }
          const lines = entries.map((e, i) => {
            const age = Math.round((Date.now() - e.timestamp) / 60000)
            const preview = e.input.length > 60 ? e.input.slice(0, 60) + '...' : e.input
            return `  ${i + 1}. (${age}min ago) ${preview}`
          })
          return { type: 'text' as const, text: `Stash (${entries.length}):\n${lines.join('\n')}` }
        }
        case 'drop': {
          const n = parts[1] ? parseInt(parts[1]) : NaN
          if (isNaN(n)) return { type: 'text' as const, text: 'Usage: /stash drop <number>' }
          const removed = ctx.promptStash.remove(n - 1)
          if (!removed) return { type: 'text' as const, text: `Invalid index. Range: 1-${ctx.promptStash.length}` }
          return { type: 'text' as const, text: `Dropped #${n}: "${removed.input.slice(0, 50)}..."` }
        }
        case 'clear': {
          const count = ctx.promptStash.length
          while (ctx.promptStash.length > 0) ctx.promptStash.pop()
          return { type: 'text' as const, text: count > 0 ? `Cleared ${count} stashed prompts.` : 'Stash already empty.' }
        }
        case 'help':
        case '':
        case undefined:
          return { type: 'text' as const, text: 'Prompt Stash\n\nCommands:\n  /stash push <text>   Save a prompt for later\n  /stash pop           Restore the most recent prompt\n  /stash list          Show all stashed prompts\n  /stash drop <N>      Remove a specific entry\n  /stash clear         Clear all stashed prompts' }
        default:
          ctx.promptStash.push(args.trim())
          return { type: 'text' as const, text: `Stashed (${ctx.promptStash.length} total).` }
      }
    },
  },
  {
    name: 'busy',
    aliases: [],
    description: 'Control input behavior while agent is working: /busy [queue|steer|interrupt]',
    handler: async (args: string) => {
      const mode = args.trim().toLowerCase()
      if (!mode || !['queue', 'steer', 'interrupt'].includes(mode)) {
        return { type: 'text' as const, text: 'Busy Mode — controls what Enter does while the agent is working\n\nUsage: /busy <mode>\n  queue     — queue the message for after the current turn (default)\n  steer     — inject as guidance after the next tool call\n  interrupt — cancel current turn and send immediately' }
      }
      return { type: 'text' as const, text: `Busy mode set to "${mode}".` }
    },
  },
  {
    name: 'reasoning',
    aliases: ['thinking'],
    description: 'Control reasoning display: /reasoning [show|hide|status]',
    handler: async (args: string) => {
      const mode = args.trim().toLowerCase()
      if (!mode || mode === 'status') {
        return { type: 'text' as const, text: 'Reasoning visibility\n\nUsage: /reasoning <mode>\n  show    — display reasoning blocks in output\n  hide    — suppress reasoning blocks' }
      }
      if (mode === 'show' || mode === 'on') return { type: 'text' as const, text: 'Reasoning display enabled.' }
      if (mode === 'hide' || mode === 'off') return { type: 'text' as const, text: 'Reasoning display disabled.' }
      return { type: 'text' as const, text: 'Usage: /reasoning [show|hide|status]' }
    },
  },
  {
    name: 'data',
    aliases: [],
    description: 'Open the Data Manager panel (⌘K → Data Manager)',
    handler: async () => {
      return { type: 'text' as const, text: 'Use ⌘K → "Data Manager" to open the Data Manager panel, or click the Data widget in the sidebar.' }
    },
  },
]
