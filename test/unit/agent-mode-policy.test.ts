import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resolveAgentModePolicy } from '../../src/agent/agent-mode-policy'
import { appendTurnToHistory } from '../../src/agent/agent-session-lifecycle'
import { Session } from '../../src/agent/session'
import { assistantMessage, userMessage } from '../../src/agent/message'

describe('agent mode policy', () => {
  it('uses chat defaults for foreground agents', () => {
    expect(resolveAgentModePolicy({ agentRole: 'chat' })).toMatchObject({
      mode: 'chat',
      drainNotificationsInLoop: true,
      enablePostTurnHooks: true,
      enableRecap: true,
      historySource: 'chat',
      allowInteractiveTools: true,
    })
  })

  it('uses event defaults for background event agents', () => {
    expect(resolveAgentModePolicy({ agentRole: 'event' })).toMatchObject({
      mode: 'event',
      drainNotificationsInLoop: false,
      enablePostTurnHooks: false,
      enableRecap: false,
      historySource: 'event',
      allowInteractiveTools: false,
    })
  })

  it('uses subagent defaults for delegated agents', () => {
    expect(resolveAgentModePolicy({ agentRole: 'subagent' })).toMatchObject({
      mode: 'subagent',
      drainNotificationsInLoop: false,
      enablePostTurnHooks: false,
      enableRecap: false,
      historySource: 'subagent',
      allowInteractiveTools: false,
    })
  })

  it('uses goal defaults for verifier-driven continuation agents', () => {
    expect(resolveAgentModePolicy({ agentRole: 'goal' })).toMatchObject({
      mode: 'goal',
      drainNotificationsInLoop: true,
      enablePostTurnHooks: true,
      enableRecap: false,
      historySource: 'goal',
      allowInteractiveTools: false,
    })
  })

  it('uses loop-controller defaults for non-interactive loop orchestration', () => {
    expect(resolveAgentModePolicy({ agentRole: 'loop-controller' })).toMatchObject({
      mode: 'loop-controller',
      drainNotificationsInLoop: false,
      enablePostTurnHooks: false,
      enableRecap: false,
      historySource: 'loop',
      allowInteractiveTools: false,
    })
  })

  it('lets explicit notification drain override preserve current construction compatibility', () => {
    expect(resolveAgentModePolicy({ agentRole: 'event', drainNotificationsInLoop: true }).drainNotificationsInLoop).toBe(true)
  })

  it('writes turn history under the policy source instead of always chat', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-mode-policy-'))
    const session = new Session(basePath)
    const messages = [
      userMessage('event prompt'),
      assistantMessage('event reply'),
    ]
    session.save(messages)

    appendTurnToHistory(session, messages, 0, 'event')

    const historyDir = join(basePath, 'sessions', 'history')
    const files = readdirSync(historyDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toContain('_event.jsonl')
    expect(readFileSync(join(historyDir, files[0]), 'utf-8')).toContain('event prompt')
  })
})
