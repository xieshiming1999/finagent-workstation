import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, it } from 'vitest'
import { normalizeSessionMemoryContent } from '../../src/agent/memory-quality'
import {
  getSessionMemoryPath,
  saveSessionMemory,
  trySessionMemoryCompaction,
  type SessionMemoryState,
} from '../../src/agent/session-memory'
import { Role, type Message } from '../../src/agent/message'

function meaningfulMemory(): string {
  return `---
lifecycle: session
---
## Session Title
Reliability work

## Current State
The agent is implementing OARI-003 memory extraction quality gates across desktop and mobile runtimes.

## Task Specification
The user asked to complete the OARI plan with code, tests, docs, validation, and checkpoint commits.

## Files and Functions
finagent_workstation/src/agent/session-memory.ts and app/lib/agent/session_memory.dart are the active memory extraction paths.

## Workflow
The current slice audits memory extraction, rejects stale placeholder output, and preserves compaction-critical facts.

## Errors & Corrections
No unresolved errors are present in this memory snapshot.

## Key Results
Session memory must carry provenance and enough non-placeholder detail before compaction can use it.

## Worklog
Audited both runtimes, added a normalizer, and prepared focused validation.
`
}

describe('session memory quality', () => {
  it('accepts meaningful memory and adds provenance metadata', () => {
    const result = normalizeSessionMemoryContent(meaningfulMemory(), {
      sessionId: 's-123',
      extractedAt: '2026-06-17T00:00:00.000Z',
    })

    expect(result.accepted).toBe(true)
    expect(result.content).toContain('provenance: session-memory-extraction')
    expect(result.content).toContain('source_session_id: s-123')
    expect(result.content).toContain('extracted_at: 2026-06-17T00:00:00.000Z')
    expect(result.content).toContain('expires: session-end')
    expect(result.content).toContain('## Current State')
  })

  it('rejects placeholder-only template output', () => {
    const result = normalizeSessionMemoryContent(`## Session Title
*Auto-generated title for this conversation*

## Current State
*What the assistant is currently doing*

## Task Specification
*The user's original request and constraints*

## Worklog
*Chronological log of actions taken*
`, {
      sessionId: 's-123',
      extractedAt: '2026-06-17T00:00:00.000Z',
    })

    expect(result.accepted).toBe(false)
    expect(result.issues).toContain('session memory contains too little non-placeholder content')
    expect(result.issues).toContain('session memory is mostly placeholder template text')
  })

  it('rejects content missing compaction-critical sections', () => {
    const result = normalizeSessionMemoryContent(`## Session Title
Reliability work

## Current State
The agent has enough detail in this section, but the document is missing required recovery sections.

## Key Results
This text is intentionally long enough to avoid a short-content rejection and prove the section check is active.
`, {
      sessionId: 's-123',
      extractedAt: '2026-06-17T00:00:00.000Z',
    })

    expect(result.accepted).toBe(false)
    expect(result.issues).toContain('missing required section: ## Task Specification')
    expect(result.issues).toContain('missing required section: ## Worklog')
  })

  it('rejects expired session memory', () => {
    const result = normalizeSessionMemoryContent(meaningfulMemory().replace(
      'lifecycle: session',
      'lifecycle: session\nexpires: 2000-01-01T00:00:00.000Z',
    ), {
      sessionId: 's-123',
      extractedAt: '2026-06-17T00:00:00.000Z',
    })

    expect(result.accepted).toBe(false)
    expect(result.issues).toContain('session memory is expired')
  })

  it('does not save low-value session memory output', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-memory-quality-'))
    try {
      const saved = saveSessionMemory(basePath, 's-123', 'too short')
      expect(saved).toBe(false)
    } finally {
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('does not use unusable session memory for compaction', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-memory-compact-'))
    try {
      const sessionsDir = join(basePath, 'sessions')
      const memoryPath = getSessionMemoryPath(sessionsDir, 's-123')
      mkdirSync(join(sessionsDir, 's-123'), { recursive: true })
      writeFileSync(memoryPath, `## Session Title
*Auto-generated title for this conversation*

## Current State
*What the assistant is currently doing*

## Task Specification
*The user's original request and constraints*

## Worklog
*Chronological log of actions taken*
`)

      const state: SessionMemoryState = {
        initialized: true,
        lastSummarizedIndex: 1,
        tokensAtLastExtraction: 20_000,
        extracting: false,
      }
      const messages: Message[] = [
        { role: Role.User, content: 'x'.repeat(30_000) },
        { role: Role.Assistant, content: 'summarized' },
        { role: Role.User, content: 'continue' },
      ]

      const compact = trySessionMemoryCompaction(
        messages,
        state,
        basePath,
        's-123',
        new Map(),
        120_000,
        8_000,
      )
      expect(compact).toBeNull()
    } finally {
      rmSync(basePath, { recursive: true, force: true })
    }
  })

  it('preserves goal-critical facts when compacting with usable session memory', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-memory-compact-valid-'))
    try {
      expect(saveSessionMemory(basePath, 's-123', meaningfulMemory())).toBe(true)

      const state: SessionMemoryState = {
        initialized: true,
        lastSummarizedIndex: 1,
        tokensAtLastExtraction: 20_000,
        extracting: false,
      }
      const messages: Message[] = [
        { role: Role.User, content: 'x'.repeat(30_000) },
        { role: Role.Assistant, content: 'summarized' },
        { role: Role.User, content: 'continue the OARI plan' },
      ]

      const compact = trySessionMemoryCompaction(
        messages,
        state,
        basePath,
        's-123',
        new Map(),
        120_000,
        8_000,
      )
      expect(compact).not.toBeNull()
      expect(compact?.summary).toContain('OARI-003 memory extraction quality gates')
      expect(compact?.summaryMessage.content).toContain('The user asked to complete the OARI plan')
    } finally {
      rmSync(basePath, { recursive: true, force: true })
    }
  })
})
