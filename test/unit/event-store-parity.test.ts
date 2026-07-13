import { describe, expect, it, beforeEach, vi } from 'vitest'
import { useAgentStore } from '../../src/renderer/store/useAgentStore'
import { useEventStore } from '../../src/renderer/store/useEventStore'

describe('event-agent renderer parity', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    ;(globalThis as any).window = {
      agent: {
        getEventAgentSessionMessages: vi.fn(async () => []),
        clearEventAgentQueue: vi.fn(async () => true),
        pauseEventAgentQueue: vi.fn(async () => true),
      },
    }
    useAgentStore.setState({
      messages: [],
      isLoading: false,
      status: null,
      contextInfo: null,
      pendingConfirm: null,
      _lastPromptTokens: 0,
      _contextWindow: 128_000,
      _outputChars: 0,
      _outputCharsAtLastUsage: 0,
      _assistantChars: 0,
      _toolCallChars: 0,
    })
    useEventStore.setState({
      messages: [],
      isProcessing: false,
      status: null,
      contextInfo: null,
      queueLength: 0,
      droppedCount: 0,
      isQueuePaused: false,
      queueBySource: {},
      _lastPromptTokens: 0,
      _contextWindow: 128_000,
      _outputChars: 0,
      _outputCharsAtLastUsage: 0,
      _assistantChars: 0,
      _toolCallChars: 0,
    })
  })

  it('folds generic tool results into tool-use rows like chat agent', () => {
    const startEvent = {
      type: 'tool-use-start' as const,
      id: 'tc-read',
      name: 'Read',
      input: { file_path: 'memory/pages/a.html' },
    }
    const resultEvent = {
      type: 'tool-result' as const,
      id: 'tc-read',
      name: 'Read',
      result: 'large file content',
      durationMs: 12,
      isError: false,
    }

    useAgentStore.getState().handleEvent(startEvent)
    useAgentStore.getState().handleEvent(resultEvent)
    useEventStore.getState().handleEvent(startEvent)
    useEventStore.getState().handleEvent(resultEvent)

    expect(useAgentStore.getState().messages.map((m) => m.role)).toEqual(['tool-use'])
    expect(useEventStore.getState().messages.map((m) => m.role)).toEqual(['tool-use'])
    expect(useEventStore.getState().messages[0]).toMatchObject({
      toolName: 'Read',
      toolStatus: 'ok',
      durationMs: 12,
    })
  })

  it('clears a matching permission prompt when an external resolver denies it', () => {
    useAgentStore.getState().handleEvent({
      type: 'tool-confirm-request',
      requestId: 'tc-trade',
      name: 'Portfolio',
      input: { action: 'trade' },
    })
    expect(useAgentStore.getState().pendingConfirm?.requestId).toBe('tc-trade')

    useAgentStore.getState().handleEvent({
      type: 'tool-result',
      id: 'tc-trade',
      name: 'Portfolio',
      result: 'Tool use was rejected by the user.',
      durationMs: 0,
      isError: true,
    })

    expect(useAgentStore.getState().pendingConfirm).toBeNull()
  })

  it('clears a matching permission prompt when an external resolver approves it', () => {
    useAgentStore.getState().handleEvent({
      type: 'tool-confirm-request',
      requestId: 'tc-approved',
      name: 'Portfolio',
      input: { action: 'trade' },
    })

    useAgentStore.getState().handleEvent({
      type: 'tool-use-start',
      id: 'tc-approved',
      name: 'Portfolio',
      input: { action: 'trade' },
    })

    expect(useAgentStore.getState().pendingConfirm).toBeNull()
  })

  it('uses the same compact WebView execute label in chat and event stores', () => {
    const startEvent = {
      type: 'tool-use-start' as const,
      id: 'tc-webview',
      name: 'WebView',
      input: {
        action: 'execute',
        id: 'dash-600519-k6j5z3',
        script: '(async () => { const resp = await Bridge.fetch("/api/finance/quote", { code: "600519" }, "GET"); return resp; })();',
      },
    }

    useAgentStore.getState().handleEvent(startEvent)
    useEventStore.getState().handleEvent(startEvent)

    expect(useAgentStore.getState().messages[0].content).toBe('WebView(execute, dash-600519-k6j5z3, script 115 chars)')
    expect(useEventStore.getState().messages[0].content).toBe(useAgentStore.getState().messages[0].content)
    expect(useEventStore.getState().messages[0].content).not.toContain('Bridge.fetch')
  })

  it('restores event sessions without raw tool-result rows by default', async () => {
    const getEventAgentSessionMessages = vi.fn(async () => [
      { role: 'user', content: '[Dashboard] ai_analysis_request' },
      { role: 'assistant', content: '', toolUses: [{ name: 'Read', input: { file_path: 'memory/pages/a.html' } }] },
      { role: 'tool', toolResult: { content: 'raw file content', isError: false } },
      { role: 'assistant', content: 'updated' },
    ])
    ;(globalThis as any).window.agent.getEventAgentSessionMessages = getEventAgentSessionMessages

    useEventStore.getState().restoreSession()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(getEventAgentSessionMessages).toHaveBeenCalledOnce()
    expect(useEventStore.getState().messages.map((m) => m.role)).toEqual(['user', 'tool-use', 'assistant'])
    expect(useEventStore.getState().messages.map((m) => m.content).join('\n')).not.toContain('raw file content')
  })

  it('keeps event context-window accounting aligned with current store state', () => {
    useEventStore.setState({ _contextWindow: 260_000 })

    useEventStore.getState().handleEvent({
      type: 'usage',
      promptTokens: 130_000,
      completionTokens: 10,
    })

    expect(useEventStore.getState()._contextWindow).toBe(260_000)
    expect(useEventStore.getState().contextInfo).toContain('/260k')
  })

  it('updates chat queued status from queue-status events', () => {
    useAgentStore.getState().handleEvent({
      type: 'queue-status',
      queueLength: 1,
      status: 'Queued',
    })

    expect(useAgentStore.getState().isLoading).toBe(true)
    expect(useAgentStore.getState().status).toBe('Queued')

    useAgentStore.getState().handleEvent({
      type: 'queue-status',
      queueLength: 0,
    })

    expect(useAgentStore.getState().isLoading).toBe(false)
    expect(useAgentStore.getState().status).toBeNull()
  })

  it('tracks event queue dropped count, pause state, and source counts', () => {
    useEventStore.getState().handleEvent({
      type: 'queue-status',
      queueLength: 2,
      droppedCount: 3,
      accepting: false,
      countBySource: { cron: 1, dashboard: 1 },
      status: 'Paused',
    })

    expect(useEventStore.getState()).toMatchObject({
      queueLength: 2,
      droppedCount: 3,
      isQueuePaused: true,
      queueBySource: { cron: 1, dashboard: 1 },
      isProcessing: true,
      status: 'Paused',
    })
  })

  it('exposes event queue operator controls through preload API', () => {
    const api = (globalThis as any).window.agent

    useEventStore.getState().toggleQueuePause()
    expect(api.pauseEventAgentQueue).toHaveBeenCalledWith(true)
    expect(useEventStore.getState().isQueuePaused).toBe(true)

    useEventStore.getState().clearQueue()
    expect(api.clearEventAgentQueue).toHaveBeenCalledOnce()
  })

  it('renders typed event-agent cancellation as a terminal row', () => {
    useEventStore.setState({ isProcessing: true, status: 'Processing' })

    useEventStore.getState().handleEvent({ type: 'cancelled', reason: 'user' })

    expect(useEventStore.getState().isProcessing).toBe(false)
    expect(useEventStore.getState().status).toBeNull()
    expect(useEventStore.getState().messages.at(-1)).toMatchObject({
      role: 'assistant',
      source: 'cancelled',
    })
  })
})
