import { describe, it, expect } from 'vitest'
import { estimateTokens, shouldAutoCompact, microCompact, applyCompaction } from '../../src/agent/compact'
import { Role } from '../../src/agent/message'
import type { Message } from '../../src/agent/message'

describe('estimateTokens', () => {
  it('approximates token count', () => {
    const t = estimateTokens('hello world this is a test')
    expect(t).toBeGreaterThan(5)
    expect(t).toBeLessThan(15)
  })
})

describe('shouldAutoCompact', () => {
  it('returns false for short conversations', () => {
    const msgs: Message[] = [{ role: Role.User, content: 'hi' }]
    expect(shouldAutoCompact(msgs, 128_000)).toBe(false)
  })

  it('returns true for very long conversations', () => {
    const longContent = 'x'.repeat(400_000)
    const msgs: Message[] = [{ role: Role.User, content: longContent }]
    expect(shouldAutoCompact(msgs, 128_000)).toBe(true)
  })
})

describe('microCompact', () => {
  it('truncates old tool results', () => {
    const msgs: Message[] = [
      { role: Role.Tool, content: '', toolResult: { toolUseId: '1', content: 'x'.repeat(1000), isError: false } },
      { role: Role.User, content: 'old 1' },
      { role: Role.Assistant, content: 'old 2' },
      { role: Role.User, content: 'old 3' },
      { role: Role.Assistant, content: 'old 4' },
      { role: Role.User, content: 'old 5' },
      { role: Role.Assistant, content: 'old 6' },
      { role: Role.User, content: 'recent 1' },
      { role: Role.Assistant, content: 'recent 2' },
      { role: Role.User, content: 'recent 3' },
      { role: Role.Assistant, content: 'recent 4' },
      { role: Role.User, content: 'recent 5' },
      { role: Role.Assistant, content: 'recent 6' },
    ]
    const result = microCompact(msgs, 6)
    expect(result[0].toolResult!.content).toContain('Tool result truncated')
    expect(result[12].content).toBe('recent 6')
  })

  it('truncates old large assistant tool inputs before the recent turn boundary', () => {
    const msgs: Message[] = [
      {
        role: Role.Assistant,
        content: '',
        toolUses: [{ id: '1', name: 'Write', input: { file_path: '/tmp/a.html', content: 'x'.repeat(2000) } }],
      },
      { role: Role.User, content: 'old 1' },
      { role: Role.Assistant, content: 'old 2' },
      { role: Role.User, content: 'old 3' },
      { role: Role.Assistant, content: 'old 4' },
      { role: Role.User, content: 'old 5' },
      { role: Role.Assistant, content: 'old 6' },
      { role: Role.User, content: 'recent 1' },
      { role: Role.Assistant, content: 'recent 2' },
      { role: Role.User, content: 'recent 3' },
      { role: Role.Assistant, content: 'recent 4' },
      { role: Role.User, content: 'recent 5' },
      { role: Role.Assistant, content: 'recent 6' },
    ]
    const result = microCompact(msgs, 6)
    expect(result[0].toolUses?.[0].input).toHaveProperty('_truncated', true)
    expect(JSON.stringify(result[0].toolUses?.[0].input)).not.toContain('x'.repeat(500))
  })

  it('does not truncate recent messages', () => {
    const msgs: Message[] = Array.from({ length: 4 }, (_, i) => ({
      role: Role.User, content: `msg ${i}`,
    }))
    const result = microCompact(msgs, 6)
    expect(result).toEqual(msgs)
  })
})

describe('applyCompaction', () => {
  it('preserves recent messages with summary', () => {
    const msgs: Message[] = Array.from({ length: 20 }, (_, i) => ({
      role: Role.User, content: `msg ${i}`,
    }))
    const result = applyCompaction(msgs, 'summary of conversation', 5)
    expect(result[0].isCompactSummary).toBe(true)
    expect(result[0].content).toContain('summary of conversation')
    expect(result[0].content).toContain('This session is being continued')
    expect(result.length).toBe(6)
    expect(result[5].content).toBe('msg 19')
  })
})
