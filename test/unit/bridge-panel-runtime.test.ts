import { describe, expect, it } from 'vitest'
import {
  bridgeMessageTimeoutMs,
  callBridgeMessageWithTimeout,
  handleBridgePanelIpc,
  summarizeBridgeResult,
} from '../../src/renderer/panels/bridgePanelRuntime'

describe('renderer bridge panel runtime', () => {
  it('honors per-message bridge timeout values with sane bounds', () => {
    expect(bridgeMessageTimeoutMs({ type: 'http' })).toBe(30_000)
    expect(bridgeMessageTimeoutMs({ type: 'http', timeoutMs: 250 })).toBe(250)
    expect(bridgeMessageTimeoutMs({ type: 'http', timeoutMs: 1 })).toBe(100)
    expect(bridgeMessageTimeoutMs({ type: 'http', timeoutMs: 500_000 })).toBe(120_000)
    expect(bridgeMessageTimeoutMs({ type: 'http', params: { timeoutMs: 750 } })).toBe(750)
  })

  it('returns concrete error results when bridgeMessage rejects', async () => {
    const result = await callBridgeMessageWithTimeout(
      { id: 'b1', type: 'http', timeoutMs: 500 },
      async () => { throw new Error('main bridge failed') },
    )

    expect(result).toEqual({ error: 'main bridge failed', timeout: false })
  })

  it('returns timeout results instead of leaving page promises unresolved', async () => {
    const started = Date.now()
    const result = await callBridgeMessageWithTimeout(
      { id: 'b2', type: 'http', timeoutMs: 100 },
      async () => new Promise(() => {}),
    ) as Record<string, unknown>

    expect(result.error).toBe('BRIDGE_RENDERER_TIMEOUT: bridge message did not complete within 100ms')
    expect(result.timeout).toBe(true)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('summarizes data responses for WebView trace diagnostics', () => {
    expect(summarizeBridgeResult({
      ok: true,
      source: 'tdx',
      data: [{ code: '000001', price: 4083.97 }],
    })).toMatchObject({
      ok: true,
      source: 'tdx',
      dataCount: 1,
      firstCode: '000001',
    })
  })

  it('handles page Bridge messages and sends a concrete callback result', async () => {
    const sent: unknown[] = []
    const logs: Array<{ event: string; data: Record<string, unknown> }> = []
    ;(globalThis as any).window = {
      agent: {
        bridgeMessage: async (msg: any) => ({ ok: true, queued: true, notificationId: 'n1', echo: msg.type }),
      },
    }

    await handleBridgePanelIpc({
      event: {
        channel: 'bridge-message',
        args: [{ id: 'msg1', type: 'agent_message', message: 'ai_analysis_request', data: { file: 'a.html' } }],
      },
      webview: {
        send: (...args: unknown[]) => sent.push(args),
      },
      panelId: 'dash-a',
      source: 'dashboard-panel',
      log: (event, data) => logs.push({ event, data }),
    })

    expect(sent).toEqual([['bridge-callback', 'msg1', {
      ok: true,
      queued: true,
      notificationId: 'n1',
      echo: 'agent_message',
    }]])
    expect(logs.map((l) => l.event)).toEqual(['bridge-request', 'bridge-response'])
    expect(logs[0].data).toMatchObject({ id: 'msg1', type: 'agent_message', dataKeys: ['file'] })
  })
})
