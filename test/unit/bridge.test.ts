import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AgentBridge } from '../../src/main/agent-bridge'

describe('AgentBridge', () => {
  it('returns WebView-compatible shapes for state, config, files, and directories', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-bridge-'))
    const bridge = new AgentBridge(basePath)

    await bridge.handleMessage({ id: '1', type: 'setState', key: 'tab', value: 7, source: 'dash-a' })
    expect(await bridge.handleMessage({ id: '2', type: 'getState', key: 'tab', source: 'dash-a' })).toEqual({ value: 7 })

    expect(await bridge.handleMessage({ id: '3', type: 'writeFile', path: 'pages/a.txt', content: 'hello' })).toEqual({ ok: true })
    expect(readFileSync(join(basePath, 'pages/a.txt'), 'utf-8')).toBe('hello')
    expect(await bridge.handleMessage({ id: '4', type: 'readFile', path: 'pages/a.txt' })).toEqual({ content: 'hello' })
    expect(await bridge.handleMessage({ id: '5', type: 'fileExists', path: 'pages/a.txt' })).toEqual({ exists: true })

    const list = await bridge.handleMessage({ id: '6', type: 'listDir', path: 'pages' }) as any
    expect(list.entries[0]).toMatchObject({ name: 'a.txt', type: 'file' })

    const stat = await bridge.handleMessage({ id: '7', type: 'fileStat', path: 'pages/a.txt' }) as any
    expect(stat).toMatchObject({ type: 'file', isFile: true, isDirectory: false })
  })

  it('delivers dashboard agent messages with source and data payload', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-bridge-'))
    const bridge = new AgentBridge(basePath)
    const delivered: Array<{ msg: string; source: string; data: Record<string, unknown> }> = []

    bridge.setAgentMessageHandler((msg, source, data) => {
      delivered.push({ msg, source, data })
      return { ok: true, queued: true, notificationId: 'dash-1' }
    })

    const result = await bridge.handleMessage({
      id: '1',
      type: 'agent_message',
      message: 'ai_analysis_request',
      source: 'FinAgent 选股推荐 - 2026年6月',
      data: {
        file: 'stock-picks-2026-06-01.html',
        stocks: [{ code: '601919.SH', name: '中远海控' }],
      },
    })

    expect(result).toEqual({ ok: true, queued: true, notificationId: 'dash-1' })
    expect(delivered).toEqual([{
      msg: 'ai_analysis_request',
      source: 'FinAgent 选股推荐 - 2026年6月',
      data: {
        file: 'stock-picks-2026-06-01.html',
        stocks: [{ code: '601919.SH', name: '中远海控' }],
      },
    }])
  })
})
