import { create } from 'zustand'
import type { AgentEvent } from '../../agent/agent-event'
import type { ChatMessage } from './useAgentStore'
import { usePanelStore } from './usePanelStore'
import { restoreChatMessages } from './sessionRestore'
import { summarizeToolInput } from './toolSummary'
import { t } from './useLanguageStore'

export type EventMessage = ChatMessage & {
  source?: string
}

let lastEventContextTraceAt = 0

interface EventAgentState {
  messages: EventMessage[]
  isProcessing: boolean
  status: string | null
  contextInfo: string | null
  queueLength: number
  droppedCount: number
  isQueuePaused: boolean
  queueBySource: Record<string, number>
  _lastPromptTokens: number
  _contextWindow: number
  _outputChars: number
  _outputCharsAtLastUsage: number
  _assistantChars: number
  _toolCallChars: number

  handleEvent: (event: AgentEvent) => void
  addEvent: (source: string, content: string) => void
  send: (prompt: string) => void
  cancel: () => void
  background: () => void
  clearQueue: () => void
  toggleQueuePause: () => void
  clearMessages: () => void
  restoreSession: () => void
  setQueueLength: (n: number) => void
}

export const useEventStore = create<EventAgentState>((set, get) => ({
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

  handleEvent: (event: AgentEvent) => {
    switch (event.type) {
      case 'stream-start':
        set({ isProcessing: true, status: t('generating'), _assistantChars: 0, _toolCallChars: 0 })
        break
      case 'text-delta':
        set((s) => {
          const msgs = [...s.messages]
          const last = msgs[msgs.length - 1]
          if (last?.role === 'assistant') {
            msgs[msgs.length - 1] = { ...last, content: last.content + event.text }
          } else {
            msgs.push({ role: 'assistant', content: event.text, timestamp: Date.now() })
          }
          const chars = (event.text as string).length
          const newOutputChars = s._outputChars + chars
          const assistantChars = s._assistantChars + chars
          const contextInfo = computeContextInfo(s._lastPromptTokens, s._contextWindow, newOutputChars, s._outputCharsAtLastUsage)
          logEventContextTraceThrottled('text-delta', s._lastPromptTokens, s._contextWindow, newOutputChars, s._outputCharsAtLastUsage, contextInfo)
          return { messages: msgs, status: `${t('writing')} (${formatChars(assistantChars)})`, _assistantChars: assistantChars, _outputChars: newOutputChars, contextInfo }
        })
        break
      case 'thinking':
        set((s) => {
          const msgs = [...s.messages]
          const last = msgs[msgs.length - 1]
          if (last?.role === 'thinking') {
            msgs[msgs.length - 1] = { ...last, content: last.content + event.text }
          } else {
            msgs.push({ role: 'thinking', content: event.text, timestamp: Date.now() })
          }
          const newOutputChars = s._outputChars + (event.text as string).length
          const contextInfo = computeContextInfo(s._lastPromptTokens, s._contextWindow, newOutputChars, s._outputCharsAtLastUsage)
          logEventContextTraceThrottled('thinking', s._lastPromptTokens, s._contextWindow, newOutputChars, s._outputCharsAtLastUsage, contextInfo)
          return { messages: msgs, status: t('thinkingStatus'), _outputChars: newOutputChars, contextInfo }
        })
        break
      case 'tool-use-start':
        set((s) => ({
          messages: [...s.messages, {
            role: 'tool-use',
            content: `${event.name}(${summarizeToolInput(event.name, event.input)})`,
            toolName: event.name,
            toolStatus: 'running',
            timestamp: Date.now(),
          }],
          status: `${t('running')} ${event.name}...`,
        }))
        break
      case 'tool-result':
        set((s) => {
          const msgs = [...s.messages]
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'tool-use' && msgs[i].toolStatus === 'running') {
              msgs[i] = {
                ...msgs[i],
                toolStatus: event.isError ? 'error' : 'ok',
                durationMs: event.durationMs,
                errorDetail: event.isError ? event.result.slice(0, 500) : undefined,
              }
              break
            }
          }
          return { messages: msgs }
        })
        break
      case 'tool-call-streaming':
        set({ status: `${t('preparing')} ${event.name} (0 ${t('chars')})`, _toolCallChars: 0 })
        break
      case 'tool-call-delta':
        set((s) => {
          const chars = Math.max(0, Number((event as any).chars ?? 0))
          const newOutputChars = s._outputChars + chars
          const toolCallChars = s._toolCallChars + chars
          const contextInfo = computeContextInfo(s._lastPromptTokens, s._contextWindow, newOutputChars, s._outputCharsAtLastUsage)
          logEventContextTraceThrottled('tool-call-delta', s._lastPromptTokens, s._contextWindow, newOutputChars, s._outputCharsAtLastUsage, contextInfo, { tool: event.name, chars })
          return {
            status: event.name ? `${t('preparing')} ${event.name} (${formatChars(toolCallChars)})` : `${t('preparing')} ${t('toolCall')} (${formatChars(toolCallChars)})`,
            _toolCallChars: toolCallChars,
            _outputChars: newOutputChars,
            contextInfo,
          }
        })
        break
      case 'usage':
        if (event.promptTokens > 0) {
          const cw = (event as any).contextWindow ?? get()._contextWindow
          set((s) => ({
            _lastPromptTokens: event.promptTokens,
            _contextWindow: cw,
            _outputCharsAtLastUsage: s._outputChars,
            contextInfo: computeContextInfo(event.promptTokens, cw, s._outputChars, s._outputChars),
          }))
        }
        break
      case 'turn-complete':
        set((s) => ({
          isProcessing: false,
          status: null,
          messages: [...s.messages, {
            role: 'turn-complete',
            content: `${event.toolCallCount} ${t('toolCalls')}`,
            durationMs: event.durationMs,
            toolCallCount: event.toolCallCount,
            timestamp: Date.now(),
          }],
        }))
        break
      case 'done':
        set({ isProcessing: false, status: null })
        break
      case 'cancelled':
        set((s) => ({
          isProcessing: false,
          status: null,
          messages: [...s.messages, { role: 'assistant', content: t('turnCancelled'), source: 'cancelled', timestamp: Date.now() }],
        }))
        break
      case 'error':
        set((s) => ({
          isProcessing: false,
          status: null,
          messages: [...s.messages, { role: 'assistant', content: `${t('errorPrefix')}: ${event.message}`, source: 'error', timestamp: Date.now() }],
        }))
        break
      case 'backgrounded':
        set((s) => ({
          isProcessing: false,
          status: null,
          messages: [...s.messages, { role: 'assistant', content: `[${t('backgroundedCurrentEventTurn')}: ${event.taskId}]`, timestamp: Date.now() }],
        }))
        break
      case 'compacted':
        set((s) => ({
          messages: [...s.messages, {
            role: 'assistant',
            content: `[${t('conversationCompacted')}: ${event.preCount} -> ${event.postCount} messages]`,
            timestamp: Date.now(),
          }],
        }))
        break
      case 'tool-progress':
        set({ status: `${event.name}: ${(event.output as string).slice(0, 80)}...` })
        break
      case 'suggestion':
        set({ status: `${t('suggestedNextPrompt')}: ${event.text}` })
        break
      case 'queue-status':
        set({
          queueLength: event.queueLength,
          droppedCount: event.droppedCount ?? get().droppedCount,
          isQueuePaused: event.accepting === undefined ? get().isQueuePaused : !event.accepting,
          queueBySource: event.countBySource ?? get().queueBySource,
          status: event.status ?? null,
          isProcessing: Boolean(event.status) || event.queueLength > 0,
        })
        break
      case 'webview-open':
        usePanelStore.getState().openWebView(event.id, event.url, event.title)
        break
      case 'webview-navigate':
        usePanelStore.getState().openWebView(event.id, event.url)
        break
      case 'webview-refresh':
        usePanelStore.getState().refreshPanel(event.id)
        break
      case 'dashboard-open':
        usePanelStore.getState().addPanel({
          id: `dash-${event.id}`,
          type: 'dashboard',
          title: event.title,
          url: event.path,
          closable: true,
        })
        break
      case 'ui-widget':
        set((s) => ({
          messages: [...s.messages, {
            role: 'tool-result',
            content: JSON.stringify({ _widget: true, action: event.action, params: event.params }),
            timestamp: Date.now(),
          }],
        }))
        break
      case 'ui-open-panel':
        if (event.panelType === 'webview' && event.url) {
          usePanelStore.getState().openWebView(event.id, event.url, event.title)
        } else {
          usePanelStore.getState().addPanel({
            id: event.id,
            type: (event.panelType as any) ?? 'dashboard',
            title: event.title ?? event.id,
            url: event.url,
            closable: true,
          })
        }
        break
      case 'ui-close-panel':
        usePanelStore.getState().removePanel(event.id)
        break
      case 'ui-push-data': {
        const channel = String(event.channel ?? '')
        const webviews = Array.from(document.querySelectorAll('webview')) as any[]
        for (const wv of webviews) {
          wv.send?.('bridge-push', channel, event.data ?? {})
        }
        break
      }
      case 'ui-notify':
        set((s) => ({
          messages: [...s.messages, {
            role: 'assistant',
            content: `${event.title ? `**${event.title}** - ` : ''}${event.message}`,
            timestamp: Date.now(),
          }],
        }))
        break
      case 'session-cleared':
        set({ messages: [], contextInfo: null })
        break
      case 'session-resumed':
        set((s) => ({
          messages: [...s.messages, { role: 'assistant', content: `[${t('sessionResumedSummary')}: ${event.messageCount} ${t('messagesLabel')}]`, timestamp: Date.now() }],
        }))
        break
      case 'command-output':
        set((s) => ({
          messages: [...s.messages, { role: 'assistant', content: event.text, timestamp: Date.now() }],
        }))
        break
      case 'tasks-changed':
        set({ status: `${event.tasks.length} ${t('tasksBackgroundCount')}` })
        break
      case 'notification-received':
        set((s) => ({
          messages: [...s.messages, { role: 'assistant', content: `[${event.source}] ${event.prompt}`, source: event.source, timestamp: Date.now() }],
        }))
        break
      case 'output-chars':
        set((s) => {
          const newOutputChars = s._outputChars + event.chars
          const contextInfo = computeContextInfo(s._lastPromptTokens, s._contextWindow, newOutputChars, s._outputCharsAtLastUsage)
          return { _outputChars: newOutputChars, contextInfo }
        })
        break
      case 'btw-result':
        set((s) => ({
          messages: [...s.messages, { role: 'assistant', content: `**${event.question}**\n\n${event.answer}`, timestamp: Date.now() }],
        }))
        break
      case 'steer-queued':
        set({ status: t('queuedUserInput') })
        break
    }
  },

  addEvent: (source, content) => {
    set((s) => ({
      messages: [...s.messages, { role: 'assistant', content, source, timestamp: Date.now() }],
    }))
  },

  send: (prompt) => {
    set((s) => ({
      messages: [...s.messages, { role: 'user', content: prompt, timestamp: Date.now() }],
      isProcessing: true,
      status: t('queued'),
      _outputChars: 0,
      _outputCharsAtLastUsage: 0,
      _assistantChars: 0,
      _toolCallChars: 0,
    }))
    window.agent?.sendEventAgent(prompt)
  },

  cancel: () => {
    window.agent?.cancelEventAgent()
    set({ isProcessing: false, status: null })
  },

  background: () => {
    window.agent?.backgroundEventAgent()
  },

  clearQueue: () => {
    window.agent?.clearEventAgentQueue?.()
  },

  toggleQueuePause: () => {
    const paused = !get().isQueuePaused
    window.agent?.pauseEventAgentQueue?.(paused)
    set({ isQueuePaused: paused })
  },

  clearMessages: () => set({ messages: [], contextInfo: null }),
  restoreSession: () => {
    window.agent?.getEventAgentSessionMessages?.().then((msgs: any[]) => {
      const restored: EventMessage[] = restoreChatMessages(msgs)
      if (restored.length > 0) set({ messages: restored })
    })
  },
  setQueueLength: (n) => set({ queueLength: n }),
}))

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

function formatChars(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M chars`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k chars`
  return `${n} chars`
}

function computeContextInfo(lastPromptTokens: number, contextWindow: number, outputChars: number, outputCharsAtLastUsage: number): string | null {
  if (lastPromptTokens <= 0 || contextWindow <= 0) return null
  const newChars = outputChars - outputCharsAtLastUsage
  const pendingTokens = Math.round(newChars / 3)
  const currentTokens = lastPromptTokens + pendingTokens
  const pct = ((currentTokens / contextWindow) * 100).toFixed(1)
  return `${pct}% (${formatTokens(currentTokens)}/${formatTokens(contextWindow)})`
}

function logEventContextTraceThrottled(
  source: string,
  lastPromptTokens: number,
  contextWindow: number,
  outputChars: number,
  outputCharsAtLastUsage: number,
  contextInfo: string | null,
  extra: Record<string, unknown> = {},
): void {
  if (lastPromptTokens <= 0 || contextWindow <= 0) return
  const now = Date.now()
  if (now - lastEventContextTraceAt < 5000) return
  lastEventContextTraceAt = now
  window.agent?.logContextTrace?.({
    source: `event:${source}`,
    lastPromptTokens,
    contextWindow,
    outputChars,
    outputCharsAtLastUsage,
    estimatedPendingTokens: Math.round((outputChars - outputCharsAtLastUsage) / 3),
    contextInfo,
    ...extra,
  }).catch(() => {})
}
