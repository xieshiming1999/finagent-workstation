import { describe, expect, it } from 'vitest'
import { sanitizeToolInputForSession } from '../../src/agent/session'
import { Session } from '../../src/agent/session'
import { TeamRegistry } from '../../src/agent/team-context'
import { TaskRegistry } from '../../src/agent/background-task'
import { Role, assistantMessage, toolMessage, userMessage } from '../../src/agent/message'
import { buildSessionMemoryPrompt, shouldExtractSessionMemory, type SessionMemoryState } from '../../src/agent/session-memory'
import { memoryLifecycleFrontmatter, memoryLifecyclePromptGuidance } from '../../src/agent/memory-lifecycle'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('session hygiene', () => {
  it('summarizes large Write content instead of storing full payload', () => {
    const content = `<html>${'x'.repeat(5000)}</html>`
    const input = sanitizeToolInputForSession('Write', {
      file_path: '/tmp/report.html',
      content,
    })

    expect(input.file_path).toBe('/tmp/report.html')
    expect(input.content).toBeUndefined()
    expect(String(input.content_summary)).toContain('omitted from session')
    expect(String(input.content_preview)).toContain('<html>')
    expect(JSON.stringify(input)).not.toContain('x'.repeat(1000))
  })

  it('summarizes large Edit strings but keeps file identity', () => {
    const input = sanitizeToolInputForSession('Edit', {
      file_path: '/tmp/report.html',
      old_string: 'old',
      new_string: 'new'.repeat(2000),
      replace_all: false,
    })

    expect(input.file_path).toBe('/tmp/report.html')
    expect(input.replace_all).toBe(false)
    expect(input.old_string).toBe('old')
    expect(input.new_string).toBeUndefined()
    expect(String(input.new_string_summary)).toContain('omitted from session')
  })

  it('persists tool result image paths and metadata without raw image bytes', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-session-'))
    const session = new Session(basePath)
    const msg = toolMessage('tc-img', 'Screenshot saved', false, {
      imagePaths: ['/tmp/screen.png'],
      imageMetadata: [{ path: '/tmp/screen.png', mediaType: 'image/png', width: 100, height: 80, sizeBytes: 1234 }],
    })

    session.appendMessage({
      role: Role.Assistant,
      content: '',
      toolUses: [{ id: 'tc-img', name: 'Screenshot', input: { html: '<html></html>' } }],
    })
    session.appendMessage(msg)

    const loaded = session.load().messages.find((m) => m.toolResult)
    expect(loaded?.toolResult?.imagePaths).toEqual(['/tmp/screen.png'])
    expect(loaded?.toolResult?.imageMetadata?.[0]?.width).toBe(100)
    expect(JSON.stringify(loaded)).not.toContain('base64')
  })

  it('keeps resumable sessions separate from immutable audit history', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-session-'))
    const session = new Session(basePath)

    session.appendMessage(userMessage('working context'))
    session.archive()
    session.appendToHistory([
      userMessage('audit stream'),
      assistantMessage('audit reply'),
    ])

    const sessions = session.listSessions()
    const history = session.listHistory()

    expect(sessions).toHaveLength(1)
    expect(sessions[0].firstPrompt).toBe('working context')
    expect(sessions[0].path).toContain('/archive/')
    expect(history).toHaveLength(1)
    expect(history[0].firstPrompt).toBe('audit stream')
    expect(history[0].path).toContain('/history/')
  })

  it('includes the active current session in resumable session listings', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-session-'))
    const session = new Session(basePath)

    session.appendMessage(userMessage('current working context'))

    const sessions = session.listSessions()

    expect(sessions[0]?.isCurrent).toBe(true)
    expect(sessions[0]?.path).toContain('/sessions/current.jsonl')
    expect(sessions[0]?.firstPrompt).toBe('current working context')
  })

  it('resumes an archived working session without treating audit history as resumable context', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-session-'))
    const session = new Session(basePath)

    session.save([
      userMessage('active working context'),
      assistantMessage('active reply'),
    ])
    const archivedActivePath = session.archive()
    expect(archivedActivePath).toBeTruthy()

    session.save([
      userMessage('new working context before resume'),
      assistantMessage('new reply'),
    ])
    session.appendToHistory([
      userMessage('audit stream only'),
      assistantMessage('audit reply only'),
    ])

    const resumed = session.resume(archivedActivePath!)
    expect(resumed.messages.map((m) => m.content)).toEqual([
      'active working context',
      'active reply',
    ])
    expect(session.load().messages.map((m) => m.content)).toEqual([
      'active working context',
      'active reply',
    ])
    expect(session.listHistory()[0].firstPrompt).toBe('audit stream only')
    expect(session.listSessions().some((entry) => entry.firstPrompt === 'audit stream only')).toBe(false)
  })

  it('forks from the active working session before archiving it', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-session-'))
    const session = new Session(basePath)

    session.save([
      userMessage('first prompt'),
      assistantMessage('first reply'),
      userMessage('second prompt'),
    ])

    const forked = session.fork(2)

    expect(forked.messages.map((m) => m.content)).toEqual(['first prompt', 'first reply'])
    expect(session.load().messages.map((m) => m.content)).toEqual(['first prompt', 'first reply'])
    expect(session.listSessions()).toHaveLength(2)
    expect(session.listSessions()[0]?.isCurrent).toBe(true)
    expect(session.listHistory()).toHaveLength(0)
  })

  it('treats resume(current.jsonl) as a no-op instead of archiving away the active context', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-session-'))
    const session = new Session(basePath)

    session.appendMessage(userMessage('still here'))
    const currentPath = join(basePath, 'sessions', 'current.jsonl')

    const resumed = session.resume(currentPath)

    expect(resumed.messages.map((m) => m.content)).toEqual(['still here'])
    expect(session.listSessions()[0]?.isCurrent).toBe(true)
  })
})

describe('team registry', () => {
  it('persists teams and resolves team/member task handles', () => {
    const memoryDir = mkdtempSync(join(tmpdir(), 'fin-team-'))
    const registry = new TeamRegistry()
    registry.configure(memoryDir)

    registry.createTeam('research_team', 'Deep stock research')
    registry.registerRunningMember('research_team', {
      name: 'risk',
      role: 'risk',
      description: '风控分析师',
      prompt: 'check risk',
      taskId: 'agent-7',
      status: 'running',
    })

    const reloaded = new TeamRegistry()
    reloaded.configure(memoryDir)

    expect(reloaded.getTeam('research_team')?.members[0]?.status).toBe('running')
    expect(reloaded.findMemberTaskId('research_team/risk')).toBe('agent-7')
    expect(reloaded.findMemberTaskId('risk')).toBe('agent-7')
  })

  it('marks running team members killed when deleting a team', () => {
    const memoryDir = mkdtempSync(join(tmpdir(), 'fin-team-'))
    const registry = new TeamRegistry()
    registry.configure(memoryDir)

    registry.createTeam('research_team')
    registry.registerRunningMember('research_team', {
      name: 'tech',
      description: '技术分析师',
      taskId: 'agent-8',
      status: 'running',
    })
    registry.deleteTeam('research_team')

    const team = registry.getTeam('research_team', { includeDeleted: true })
    expect(team?.status).toBe('deleted')
    expect(team?.members[0]?.status).toBe('killed')
    expect(team?.members[0]?.lastError).toBe('Team deleted')
  })
})

describe('task registry', () => {
  it('persists completed task metadata and full disk-backed output', () => {
    const memoryDir = mkdtempSync(join(tmpdir(), 'fin-task-'))
    const registry = new TaskRegistry()
    registry.configure(memoryDir)

    const task = registry.register({ description: 'research', prompt: 'analyze' })
    registry.updateStatus(task.id, 'running')
    registry.updateProgress(task.id, { toolUseCount: 2, activity: 'Tool: MarketData' })
    registry.updateStatus(task.id, 'completed', { result: 'x'.repeat(12_000) })

    const reloaded = new TaskRegistry()
    reloaded.configure(memoryDir)

    expect(reloaded.get(task.id)?.status).toBe('completed')
    expect(reloaded.get(task.id)?.toolUseCount).toBe(2)
    expect(reloaded.readOutput(task.id)).toBe('x'.repeat(12_000))
  })

  it('marks pending or running tasks failed after restart instead of pretending they are live', () => {
    const memoryDir = mkdtempSync(join(tmpdir(), 'fin-task-'))
    const registry = new TaskRegistry()
    registry.configure(memoryDir)

    const task = registry.register({ description: 'long task', prompt: 'work' })
    registry.updateStatus(task.id, 'running')

    const reloaded = new TaskRegistry()
    reloaded.configure(memoryDir)

    expect(reloaded.get(task.id)?.status).toBe('failed')
    expect(reloaded.get(task.id)?.error).toContain('Interrupted by application restart')
  })
})

describe('session memory extraction trigger', () => {
  it('labels session memory and exposes memory promotion guidance', () => {
    const frontmatter = memoryLifecycleFrontmatter('session')
    expect(frontmatter).toContain('lifecycle: session')
    expect(frontmatter).toContain('write_target: sessions/')
    expect(memoryLifecyclePromptGuidance).toContain('lifecycle: durable')
    expect(memoryLifecyclePromptGuidance).toContain('memory/skills/<skill>/skill.md')
  })

  it('tells session memory updates to preserve lifecycle frontmatter', () => {
    const prompt = buildSessionMemoryPrompt([userMessage('keep going')], null)
    expect(prompt).toContain('lifecycle: session')
    expect(prompt).toContain('Preserve lifecycle frontmatter')
    expect(prompt).toContain('requires a separate reviewed memory/skill action')
  })

  it('waits for a natural assistant boundary when token threshold is met without tool calls', () => {
    const state: SessionMemoryState = {
      lastSummarizedIndex: null,
      tokensAtLastExtraction: 0,
      initialized: false,
      extracting: false,
    }
    const largePrompt = 'x'.repeat(31_000)

    expect(shouldExtractSessionMemory([
      userMessage(largePrompt),
      {
        role: Role.Assistant,
        content: '',
        toolUses: [{ id: 'tc1', name: 'Read', input: { file_path: 'a.md' } }],
      },
    ], state)).toBe(false)

    expect(shouldExtractSessionMemory([
      userMessage(largePrompt),
      assistantMessage('I have enough context to summarize now.'),
    ], state)).toBe(true)
  })

  it('triggers after enough new tool calls since the summarized message index', () => {
    const state: SessionMemoryState = {
      lastSummarizedIndex: 1,
      tokensAtLastExtraction: 1_000,
      initialized: true,
      extracting: false,
    }
    const messages = [
      userMessage('previous'),
      assistantMessage('previous answer'),
      userMessage('x'.repeat(19_000)),
      {
        role: Role.Assistant,
        content: '',
        toolUses: [
          { id: 'tc1', name: 'Read', input: { file_path: 'a.md' } },
          { id: 'tc2', name: 'Grep', input: { pattern: 'x' } },
          { id: 'tc3', name: 'LS', input: { path: '.' } },
        ],
      },
    ]

    expect(shouldExtractSessionMemory(messages, state)).toBe(true)
  })
})
