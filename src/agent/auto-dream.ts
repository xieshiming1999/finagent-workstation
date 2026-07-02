import { join } from 'path'
import { readLastConsolidatedAt, tryAcquireConsolidationLock, releaseConsolidationLock, rollbackConsolidationLock, recordConsolidation } from './consolidation-lock'
import { readdirSync, statSync, existsSync } from 'fs'
import type { LLMProvider } from './llm-provider'
import { Role } from './message'

const DEFAULT_MIN_HOURS = 24
const DEFAULT_MIN_MODIFIED_FILES = 5

export interface AutoDreamState {
  inProgress: boolean
}

export function createAutoDreamState(): AutoDreamState {
  return { inProgress: false }
}

function countModifiedFilesSince(memoryDir: string, sinceMs: number): number {
  if (!existsSync(memoryDir)) return 0
  let count = 0
  function scan(dir: string) {
    try {
      for (const name of readdirSync(dir)) {
        if (name.startsWith('.')) continue
        const full = join(dir, name)
        const stat = statSync(full)
        if (stat.isDirectory()) scan(full)
        else if (name.endsWith('.md') && stat.mtimeMs > sinceMs) count++
      }
    } catch { /* */ }
  }
  scan(memoryDir)
  return count
}

/**
 * Check all 3 gates and run dream if they pass. Fire-and-forget.
 * Gates (cheapest first):
 * 1. Time gate: >= 24h since last dream
 * 2. Change gate: >= 5 modified .md files since last dream
 * 3. Lock gate: no other dream in progress
 */
export async function maybeRunAutoDream(opts: {
  llm: LLMProvider
  basePath: string
  state: AutoDreamState
  minHours?: number
  minModifiedFiles?: number
}): Promise<void> {
  const { llm, basePath, state, minHours = DEFAULT_MIN_HOURS, minModifiedFiles = DEFAULT_MIN_MODIFIED_FILES } = opts
  if (state.inProgress) return

  const memoryDir = join(basePath, 'memory')

  // Gate 1: Time
  const lastDreamMs = readLastConsolidatedAt(memoryDir)
  const elapsedMs = Date.now() - lastDreamMs
  if (elapsedMs < minHours * 60 * 60 * 1000) return

  // Gate 2: Change count
  const modifiedCount = countModifiedFilesSince(memoryDir, lastDreamMs)
  if (modifiedCount < minModifiedFiles) return

  // Gate 3: Lock
  const priorMtime = tryAcquireConsolidationLock(memoryDir)
  if (priorMtime === null) return

  state.inProgress = true
  console.log(`[AutoDream] Starting (elapsed: ${Math.floor(elapsedMs / 3600000)}h, modified: ${modifiedCount} files)`)

  try {
    await runDreamLLM(llm, memoryDir)
    releaseConsolidationLock(memoryDir)
    console.log('[AutoDream] Completed successfully')
  } catch (e) {
    rollbackConsolidationLock(memoryDir, priorMtime)
    console.error('[AutoDream] Failed:', e)
  } finally {
    state.inProgress = false
  }
}

/**
 * Run dream manually (for /dream command). Skips gates.
 */
export async function runDreamManually(llm: LLMProvider, basePath: string): Promise<string> {
  const memoryDir = join(basePath, 'memory')
  const priorMtime = tryAcquireConsolidationLock(memoryDir)
  if (priorMtime === null) return 'Another dream process is already running.'

  try {
    const result = await runDreamLLM(llm, memoryDir)
    releaseConsolidationLock(memoryDir)
    recordConsolidation(memoryDir)
    return result
  } catch (e) {
    rollbackConsolidationLock(memoryDir, priorMtime)
    return `Dream failed: ${e}`
  }
}

async function runDreamLLM(llm: LLMProvider, memoryDir: string): Promise<string> {
  const prompt = buildDreamPrompt(memoryDir)
  const parts: string[] = []
  const stream = llm.sendMessage(
    'You are a memory consolidation agent. Organize and clean up the memory directory.',
    [{ role: Role.User, content: prompt, timestamp: new Date().toISOString() }],
    [],
  )
  for await (const ev of stream) {
    if (ev.type === 'text-delta') parts.push(ev.text)
  }
  return parts.join('')
}

function buildDreamPrompt(memoryDir: string): string {
  return `You are the memory consolidation sub-agent. Organize, deduplicate, and prune the memory directory.

## Phase 1 — Orient
- List the memory/ directory
- Read MEMORY.md index
- Skim existing memory files

## Phase 2 — Analyze
Identify: duplicates, contradictions, stale entries, similar skills, orphaned index entries

## Phase 3 — Consolidate
- Merge duplicates, delete stale, convert relative→absolute dates
- Update frontmatter, consolidate small files into topic-based files

## Phase 4 — Prune index
- Update MEMORY.md (keep under 200 lines)
- Remove dead pointers, add unindexed files

## Rules
- Only write to memory/ directory
- Do not delete bundle/skills/ (read-only)
- Be conservative: keep rather than delete when unsure
- Report changes at the end

memory/ is at: ${memoryDir}`
}
