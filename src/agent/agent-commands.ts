import { join } from 'path'
import type { AgentEvent } from './agent-event'
import type { LLMProvider } from './llm-provider'
import { Role, userMessage } from './message'
import type { Message } from './message'
import { findCommandWithFileCommands, type CommandContext } from './slash-command'

type HandleSlashCommandDeps = {
  name: string
  args: string
  basePath: string
  projectLocalDir: string
  pluginCommandPaths: string[]
  messages: Message[]
  goalManager: unknown
  promptStash: unknown
  session: {
    listSessions(): Array<{ name: string; path: string; title?: string; firstPrompt?: string }>
    fork(): { messages: Message[] }
  }
  notifications: { enqueue(source: string, prompt: string, when: 'now' | 'next'): string }
  clearSession(): void
  resumeSession(filePath: string): void
  runPostTurnHooks(): Promise<AgentEvent[]>
  appendTurnToHistory(): void
  pushAndPersist(msg: Message): void
  agentLoop(): AsyncGenerator<AgentEvent>
  tryCompact(customInstructions?: string): Promise<{ compacted: boolean }>
  runBtw(question: string): Promise<string>
  setMessages(messages: Message[]): void
  runningRef: { value: boolean }
}

export async function* handleSlashCommand(deps: HandleSlashCommandDeps): AsyncGenerator<AgentEvent> {
  const cmd = findCommandWithFileCommands(deps.name, deps.basePath, deps.projectLocalDir, deps.pluginCommandPaths)
  if (!cmd) {
    yield { type: 'text-delta', text: `Unknown command: /${deps.name}. Type /help for available commands.` }
    yield { type: 'done' }
    deps.runningRef.value = false
    return
  }

  const ctx: CommandContext = {
    basePath: deps.basePath,
    memoryDir: join(deps.basePath, 'memory'),
    messages: deps.messages,
    goalManager: deps.goalManager as any,
    promptStash: deps.promptStash as any,
    compactFn: async (customInstructions?: string) => {
      await deps.tryCompact(customInstructions)
    },
  }

  try {
    const result = await cmd.handler(deps.args, ctx)
    switch (result.type) {
      case 'text':
        yield { type: 'text-delta', text: result.text }
        break
      case 'compact':
        yield { type: 'text-delta', text: 'Conversation compacted.' }
        break
      case 'clear':
        deps.clearSession()
        yield { type: 'text-delta', text: 'Session cleared and archived.' }
        break
      case 'resume':
        deps.resumeSession(result.filePath)
        yield { type: 'text-delta', text: 'Session resumed.' }
        break
      case 'list': {
        const sessions = deps.session.listSessions()
        if (sessions.length === 0) {
          yield { type: 'text-delta', text: 'No previous sessions found.' }
        } else {
          const lines = sessions.slice(0, 10).map((s) => `- ${s.path}${s.title ? ` — ${s.title}` : ''}${s.firstPrompt ? `: ${s.firstPrompt}` : ''}`)
          yield { type: 'text-delta', text: `Previous sessions:\n${lines.join('\n')}\n\nUse /resume <session_path> to resume.` }
        }
        break
      }
      case 'prompt': {
        deps.pushAndPersist(userMessage(result.prompt))
        yield* deps.agentLoop()
        deps.appendTurnToHistory()
        for (const ev of await deps.runPostTurnHooks()) yield ev
        break
      }
      case 'fork': {
        deps.setMessages(deps.session.fork().messages)
        yield { type: 'text-delta', text: `Session forked. New session with ${deps.messages.length} messages. Previous session archived.` }
        break
      }
      case 'goal-set': {
        yield { type: 'text-delta', text: `⊙ Goal set (max ${(deps.goalManager as any).getState?.()?.maxTurns ?? 20} turns). Working...\n` }
        deps.pushAndPersist(userMessage((result as any).goalPrompt))
        yield* deps.agentLoop()
        deps.appendTurnToHistory()
        for (const ev of await deps.runPostTurnHooks()) yield ev
        break
      }
      case 'btw': {
        const question = (result as any).question
        yield { type: 'btw-result', question, answer: await deps.runBtw(question) }
        break
      }
      case 'steer': {
        const steerText = (result as any).text
        deps.notifications.enqueue('user_input', steerText, 'now')
        yield { type: 'steer-queued', text: steerText }
        yield { type: 'text-delta', text: '⏩ Steer queued — will be seen at the next opportunity.' }
        break
      }
      case 'export': {
        const { mkdirSync, writeFileSync } = require('fs')
        const { content, filename } = result as any
        const exportDir = join(deps.basePath, 'exports')
        mkdirSync(exportDir, { recursive: true })
        const exportPath = join(exportDir, filename)
        writeFileSync(exportPath, content, 'utf-8')
        yield { type: 'text-delta', text: `Exported to ${exportPath} (${(content.length / 1024).toFixed(1)}KB)` }
        break
      }
    }
  } catch (e) {
    yield { type: 'error', message: `Command error: ${e}` }
  }

  deps.runningRef.value = false
  yield { type: 'done' }
}

export async function runBtw(llm: LLMProvider, messages: Message[], question: string): Promise<string> {
  const btwSystemPrompt =
    'You are answering an ephemeral /btw side question about the current conversation.\n' +
    'Use the conversation only as background context.\n' +
    'Answer only the side question in the last user message.\n' +
    'Do not continue, resume, or complete any unfinished task from the conversation.\n' +
    'Do not emit tool calls or code unless the side question explicitly asks for them.\n' +
    'If the question can be answered briefly, answer briefly.'

  const contextMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ ...m, toolUses: undefined, toolResults: undefined }))
    .slice(-30)

  contextMessages.push({
    role: Role.User,
    content: `Answer this side question only. Ignore any unfinished task in the conversation.\n\n<btw_side_question>\n${question}\n</btw_side_question>`,
    timestamp: new Date().toISOString(),
  } as any)

  const parts: string[] = []
  try {
    const stream = llm.sendMessage(btwSystemPrompt, contextMessages, [])
    for await (const ev of stream) {
      if (ev.type === 'text-delta') parts.push(ev.text)
    }
  } catch (e) {
    return `Side question failed: ${e instanceof Error ? e.message : String(e)}`
  }
  return parts.join('') || 'No response generated.'
}
