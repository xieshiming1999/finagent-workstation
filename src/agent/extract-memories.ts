import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, basename } from 'path'
import type { Message } from './message'
import { Role } from './message'
import type { LLMProvider } from './llm-provider'
import type { BridgeRequestHandler } from './tool'
import { ToolRegistry } from './tool'
import { FileReadTool } from './tools/file-read'
import { FileWriteTool } from './tools/file-write'
import { FileEditTool } from './tools/file-edit'
import { GlobTool } from './tools/glob'
import { GrepTool } from './tools/grep'
import { LSTool } from './tools/ls'
import { SkillTool } from './tools/skill'

const MAX_SUB_AGENT_TURNS = 5

/**
 * Check if the main agent already wrote memory files this turn.
 * If so, extraction is unnecessary.
 */
export function hasMemoryWritesSince(messages: Message[], sinceIndex: number): boolean {
  for (let i = sinceIndex; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role !== Role.Assistant || !msg.toolUses) continue
    for (const tu of msg.toolUses) {
      if (tu.name === 'Write' || tu.name === 'Edit') {
        const filePath = String(tu.input.file_path ?? '')
        if (filePath.includes('memory/')) return true
      }
      if (tu.name === 'Skill') {
        const action = String(tu.input.skill ?? '')
        if (action === 'create' || action === 'update') return true
      }
    }
  }
  return false
}

/**
 * Build a manifest of existing memory files.
 */
export function buildMemoryManifest(memoryDir: string): string {
  if (!existsSync(memoryDir)) return '(empty)'

  const entries: string[] = []
  function scan(dir: string, prefix: string) {
    try {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        const stat = statSync(full)
        if (stat.isDirectory()) {
          if (!name.startsWith('.')) scan(full, `${prefix}${name}/`)
        } else if (name.endsWith('.md')) {
          const modified = stat.mtime.toISOString().slice(0, 10)
          let type = '?', desc = ''
          try {
            const lines = readFileSync(full, 'utf-8').split('\n')
            for (const line of lines.slice(0, 10)) {
              if (line.startsWith('type:')) type = line.slice(5).trim()
              if (line.startsWith('description:')) desc = line.slice(12).trim()
            }
          } catch { /* */ }
          entries.push(`- [${type}] ${prefix}${name} (${modified}): ${desc}`)
        }
      }
    } catch { /* */ }
  }

  scan(memoryDir, '')
  if (entries.length === 0) return '(empty)'
  entries.sort()
  return entries.join('\n')
}

/**
 * Build the extraction prompt.
 */
function buildExtractPrompt(newMessageCount: number, manifest: string): string {
  return `You are the memory extraction sub-agent. Analyze the most recent ~${newMessageCount} messages above and decide if any information should be persisted to memory.

## What to extract

1. **User preferences/role** → write memory file (type: user or feedback)
2. **Project state/deadlines** → write memory file (type: project or reference)
3. **Reusable multi-step workflows** → create skill via Skill tool
4. **Updates to existing memories/skills** → update rather than create duplicates
5. **None of the above** → do nothing (this is the most common outcome)

## What NOT to save

- Code patterns, architecture, file paths — derivable from reading the codebase
- Git history, recent changes — use git log/blame
- Debugging solutions — the fix is in the code
- Ephemeral task details or current conversation context
- Anything already covered by existing memories

## Existing files

<manifest>
${manifest}
</manifest>

## Rules

- You have at most ${MAX_SUB_AGENT_TURNS} turns. Plan efficiently.
- Memory files use frontmatter: name, description, type (user/feedback/project/reference).
- Update MEMORY.md index when creating/modifying memory files.
- Only write to the memory/ directory.
- If nothing worth saving, respond with "No new memories to extract." and stop.
- Convert relative dates to absolute dates.
- For feedback type, include **Why:** and **How to apply:** lines.`
}

/**
 * Run memory extraction. Fire-and-forget — does not block the main agent.
 * Uses the LLM to analyze the conversation and decide what to persist.
 */
export async function runExtractMemories(opts: {
  messages: Message[]
  turnStartIndex: number
  llm: LLMProvider
  basePath: string
  assetsPath: string
  sessionId: string
  readFileTimestamps: Map<string, number>
  pluginSkillPaths: string[]
  bridgeRequest?: BridgeRequestHandler
  getConfigValue?: (key: string) => unknown
}): Promise<void> {
  const { messages, turnStartIndex, llm, basePath, assetsPath, sessionId } = opts
  const memoryDir = join(basePath, 'memory')

  if (hasMemoryWritesSince(messages, turnStartIndex)) {
    console.log('[ExtractMemories] Skipped: agent already wrote memory this turn')
    return
  }

  if (messages.length < 3) {
    console.log('[ExtractMemories] Skipped: too few messages')
    return
  }

  console.log(`[ExtractMemories] Starting extraction (${messages.length} messages)`)

  try {
    const manifest = buildMemoryManifest(memoryDir)
    const newMessageCount = messages.length - turnStartIndex
    const extractPrompt = buildExtractPrompt(newMessageCount, manifest)

    const { Agent } = await import('./agent')
    const tools = createExtractToolRegistry(assetsPath)
    const subAgent = new Agent({
      llm: llm.clone(),
      tools,
      basePath,
      assetsPath,
      sessionBasePath: join(basePath, 'sessions', sessionId || 'unknown', 'extract'),
      skipPermissions: true,
      iterationLimit: MAX_SUB_AGENT_TURNS,
      agentRole: 'chat',
      drainNotificationsInLoop: true,
      bridgeRequest: opts.bridgeRequest,
      getConfigValue: opts.getConfigValue,
    })
    subAgent.pluginSkillPaths = opts.pluginSkillPaths
    subAgent.messages = messages.map((m) => ({
      ...m,
      toolUses: m.toolUses?.map((tu) => ({ ...tu, input: { ...tu.input } })),
      toolResult: m.toolResult ? { ...m.toolResult } : undefined,
    }))
    for (const [path, ts] of opts.readFileTimestamps) {
      ;(subAgent as any).readFileTimestamps?.set?.(path, ts)
    }

    const result = await subAgent.runToCompletion(extractPrompt)
    console.log(`[ExtractMemories] Completed: ${result.slice(0, 100)}...`)
  } catch (e) {
    console.error('[ExtractMemories] Error:', e)
  }
}

function createExtractToolRegistry(assetsPath: string): ToolRegistry {
  const tools = new ToolRegistry()
  tools.register(new FileReadTool())
  tools.register(new FileWriteTool())
  tools.register(new FileEditTool())
  tools.register(new GlobTool())
  tools.register(new GrepTool())
  tools.register(new LSTool())
  tools.register(new SkillTool(assetsPath))
  return tools
}
