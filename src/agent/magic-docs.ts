import { existsSync, readFileSync } from 'fs'
import type { LLMProvider } from './llm-provider'
import type { Message } from './message'
import { ToolRegistry } from './tool'
import { FileReadTool } from './tools/file-read'
import { FileEditTool } from './tools/file-edit'

/**
 * Magic docs: when a file is read, check for MAGIC DOC pattern and track it.
 * Matching finagent magic_docs.dart.
 */

const MAGIC_DOC_PATTERN = /^#\s*MAGIC\s+DOC:\s*(.+)$/m

export interface MagicDocsState {
  trackedDocs: Map<string, string>  // filePath → title
  inProgress: boolean
  turnsSinceLastCheck: number
}

export function createMagicDocsState(): MagicDocsState {
  return { trackedDocs: new Map(), inProgress: false, turnsSinceLastCheck: 0 }
}

/**
 * Called when a file is read — check for MAGIC DOC header.
 */
export function onFileRead(state: MagicDocsState, filePath: string, content: string): void {
  const match = content.match(MAGIC_DOC_PATTERN)
  if (match) {
    state.trackedDocs.set(filePath, match[1].trim())
  }
}

/**
 * Post-turn hook: check if tracked magic docs need updating.
 * Runs every 20 completed top-level agent runs when there are tracked docs.
 * This counts post-turn hook executions, not individual tool-call loop
 * iterations inside a single user prompt.
 */
export async function hookMagicDocs(opts: {
  llm: LLMProvider
  basePath: string
  assetsPath: string
  messages: Message[]
  state: MagicDocsState
}): Promise<void> {
  const { llm, basePath, assetsPath, messages, state } = opts
  if (state.inProgress) return
  if (state.trackedDocs.size === 0) return

  state.turnsSinceLastCheck++
  if (state.turnsSinceLastCheck < 20) return
  state.turnsSinceLastCheck = 0

  // Filter out deleted files.
  for (const path of Array.from(state.trackedDocs.keys())) {
    if (!existsSync(path)) state.trackedDocs.delete(path)
  }
  if (state.trackedDocs.size === 0) return

  state.inProgress = true
  try {
    for (const [path, title] of state.trackedDocs) {
      await updateMagicDoc({ llm, basePath, assetsPath, messages, path, title })
    }
  } catch (e) {
    console.error('[MagicDocs] Error:', e)
  } finally {
    state.inProgress = false
  }
}

async function updateMagicDoc(opts: {
  llm: LLMProvider
  basePath: string
  assetsPath: string
  messages: Message[]
  path: string
  title: string
}): Promise<void> {
  const currentContent = readFileSync(opts.path, 'utf-8')
  if (!MAGIC_DOC_PATTERN.test(currentContent)) {
    console.log(`[MagicDocs] Skipping ${opts.path}: header removed`)
    return
  }

  const customInstructions = extractCustomInstructions(currentContent)
  const recentMessages = opts.messages.length > 15 ? opts.messages.slice(opts.messages.length - 15) : opts.messages
  const conversationSummary = recentMessages.map((m) => {
    const role = m.role.toUpperCase()
    const tools = m.toolUses?.length ? ` [tools: ${m.toolUses.map((t) => t.name).join(', ')}]` : ''
    return `${role}:${tools} ${truncate(m.content, 300)}`
  }).join('\n')

  const updatePrompt = `Update this magic document with new information from the recent conversation.

## Document: ${opts.title}
## Path: ${opts.path}
${customInstructions ? `## Custom instructions: ${customInstructions}` : ''}

## Current content

${currentContent}

## Recent conversation

${conversationSummary}

## Rules

- Use the Edit tool to update the document.
- Only add high-signal information: architecture, patterns, key decisions, and entry points.
- Do not add code walkthroughs or obvious information.
- Keep the document concise and well-organized.
- Preserve the # MAGIC DOC header and any custom instructions line.
- If nothing new should be added, do not make any edits.`

  const { Agent } = await import('./agent')
  const tools = new ToolRegistry()
  tools.register(new FileReadTool())
  tools.register(new FileEditTool())
  const subAgent = new Agent({
    llm: opts.llm.clone(),
    tools,
    basePath: opts.basePath,
    assetsPath: opts.assetsPath,
    sessionBasePath: `${opts.basePath}/sessions/magic_docs`,
    skipPermissions: true,
    iterationLimit: 5,
    systemPrompt: 'You are a document updater. Update the specified magic document with new information from the conversation. Only use Read and Edit.',
  })
  ;(subAgent as any).readFileTimestamps?.set?.(opts.path, require('fs').statSync(opts.path).mtimeMs)
  const result = await subAgent.runToCompletion(updatePrompt)
  console.log(`[MagicDocs] ${opts.title}: ${truncate(result, 120)}`)
}

function extractCustomInstructions(content: string): string | null {
  const secondLine = content.split('\n')[1]?.trim()
  if (secondLine?.startsWith('*') && secondLine.endsWith('*')) return secondLine.slice(1, -1)
  return null
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}
