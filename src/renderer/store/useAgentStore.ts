import { create } from 'zustand'
import type { AgentEvent } from '../../agent/agent-event'
import { usePanelStore } from './usePanelStore'
import { restoreChatMessages } from './sessionRestore'
import { summarizeToolInput } from './toolSummary'
import { t } from './useLanguageStore'

let lastContextTraceAt = 0

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool-use' | 'tool-result' | 'thinking' | 'turn-complete'
  content: string
  isRecap?: boolean
  toolName?: string
  toolStatus?: 'running' | 'ok' | 'error'
  errorDetail?: string
  isError?: boolean
  durationMs?: number
  toolCallCount?: number
  timestamp: number
}

interface AgentState {
  messages: ChatMessage[]
  isLoading: boolean
  status: string | null
  contextInfo: string | null
  pendingConfirm: { name: string; input: Record<string, unknown>; requestId: string } | null
  // Real-time context tracking (matching finagent AgentStatus)
  _lastPromptTokens: number
  _contextWindow: number
  _outputChars: number
  _outputCharsAtLastUsage: number
  _assistantChars: number
  _toolCallChars: number

  send: (prompt: string) => void
  cancel: () => void
  handleEvent: (event: AgentEvent) => void
  clearMessages: () => void
  resolvePermission: (approved: boolean, alwaysAllow?: boolean, rejectReason?: string) => void
  restoreSession: () => void
}

export const useAgentStore = create<AgentState>((set, get) => ({
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

  send: (prompt: string) => {
    const { isLoading } = get()

    set((s) => ({
      messages: [...s.messages, { role: 'user', content: prompt, timestamp: Date.now() }],
      isLoading: true,
      status: isLoading ? t('queued') : t('thinkingStatus'),
      _outputChars: isLoading ? s._outputChars : 0,
      _outputCharsAtLastUsage: isLoading ? s._outputCharsAtLastUsage : 0,
      _assistantChars: isLoading ? s._assistantChars : 0,
      _toolCallChars: isLoading ? s._toolCallChars : 0,
    }))

    window.agent?.send(prompt)
  },

  cancel: () => {
    window.agent?.cancel()
    set({ isLoading: false, status: null })
  },

  handleEvent: (event: AgentEvent) => {
    switch (event.type) {
      case 'user-input':
        set((s) => ({
          messages: [...s.messages, { role: 'user', content: event.text, timestamp: Date.now() }],
          isLoading: true,
          status: s.isLoading ? t('queued') : t('thinkingStatus'),
          _outputChars: s.isLoading ? s._outputChars : 0,
          _outputCharsAtLastUsage: s.isLoading ? s._outputCharsAtLastUsage : 0,
          _assistantChars: s.isLoading ? s._assistantChars : 0,
          _toolCallChars: s.isLoading ? s._toolCallChars : 0,
        }))
        break

      case 'stream-start':
        set({ status: t('generating'), _assistantChars: 0, _toolCallChars: 0 })
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
          const newOutputChars = s._outputChars + (event.text as string).length
          const assistantChars = s._assistantChars + (event.text as string).length
          const contextInfo = computeContextInfo(s._lastPromptTokens, s._contextWindow, newOutputChars, s._outputCharsAtLastUsage)
          logContextTraceThrottled('text-delta', s._lastPromptTokens, s._contextWindow, newOutputChars, s._outputCharsAtLastUsage, contextInfo)
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
          logContextTraceThrottled('thinking', s._lastPromptTokens, s._contextWindow, newOutputChars, s._outputCharsAtLastUsage, contextInfo)
          return { messages: msgs, status: t('thinkingStatus'), _outputChars: newOutputChars, contextInfo }
        })
        break

      case 'tool-use-start':
        set((s) => {
          const toolDesc = `${event.name}(${summarizeToolInput(event.name, event.input)})`
          return {
            messages: [
              ...s.messages,
              {
                role: 'tool-use' as const,
                content: toolDesc,
                toolName: event.name,
                toolStatus: 'running' as const,
                timestamp: Date.now(),
              },
            ],
            status: `${t('running')} ${event.name}...`,
            pendingConfirm: s.pendingConfirm?.requestId === event.id
              ? null
              : s.pendingConfirm,
          }
        })
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
                errorDetail: event.isError ? event.result.slice(0, 200) : undefined,
              }
              break
            }
          }
          return {
            messages: msgs,
            pendingConfirm: s.pendingConfirm?.requestId === event.id
              ? null
              : s.pendingConfirm,
          }
        })
        break

      case 'tool-call-streaming':
        set((s) => {
          return { status: `${t('preparing')} ${event.name} (0 ${t('chars')})`, _toolCallChars: 0 }
        })
        break

      case 'tool-call-delta':
        set((s) => {
          const chars = Math.max(0, Number((event as any).chars ?? 0))
          const newOutputChars = s._outputChars + chars
          const toolCallChars = s._toolCallChars + chars
          const contextInfo = computeContextInfo(s._lastPromptTokens, s._contextWindow, newOutputChars, s._outputCharsAtLastUsage)
          logContextTraceThrottled('tool-call-delta', s._lastPromptTokens, s._contextWindow, newOutputChars, s._outputCharsAtLastUsage, contextInfo, { tool: event.name, chars })
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
          const s = get()
          window.agent?.logContextTrace?.({
            source: 'usage',
            promptTokens: event.promptTokens,
            completionTokens: event.completionTokens,
            contextWindow: cw,
            outputChars: s._outputChars,
            outputCharsAtLastUsage: s._outputCharsAtLastUsage,
            contextInfo: s.contextInfo,
          }).catch(() => {})
        }
        break

      case 'turn-complete':
        set((s) => ({
          messages: [...s.messages, {
            role: 'turn-complete' as const,
            content: `${event.toolCallCount} ${t('toolCalls')}`,
            durationMs: event.durationMs,
            toolCallCount: event.toolCallCount,
            timestamp: Date.now(),
          }],
          status: null,
        }))
        break

      case 'done':
        set({ isLoading: false, status: null })
        break

      case 'cancelled':
        set((s) => ({
          messages: [
            ...s.messages,
            { role: 'assistant', content: t('turnCancelled'), timestamp: Date.now() },
          ],
          isLoading: false,
          status: null,
        }))
        break

      case 'backgrounded':
        set((s) => ({
          messages: [
            ...s.messages,
            { role: 'assistant', content: `[${t('backgroundedCurrentTurn')}: ${event.taskId}]`, timestamp: Date.now() },
          ],
          isLoading: false,
          status: null,
        }))
        break

      case 'error':
        set((s) => ({
          messages: [
            ...s.messages,
            { role: 'assistant', content: `${t('errorPrefix')}: ${event.message}`, timestamp: Date.now() },
          ],
          isLoading: false,
          status: null,
        }))
        break

      case 'queue-status':
        set({
          status: event.status ?? null,
          isLoading: Boolean(event.status) || event.queueLength > 0,
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
            role: 'tool-result' as const,
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
            role: 'assistant' as const,
            content: `📢 ${event.title ? `**${event.title}** — ` : ''}${event.message}`,
            timestamp: Date.now(),
          }],
        }))
        break

      case 'tool-confirm-request':
        set({ pendingConfirm: { name: event.name, input: event.input, requestId: event.requestId } })
        break

      case 'compacted':
        set((s) => ({
          messages: [...s.messages, {
            role: 'assistant' as const,
            content: `[Conversation compacted: ${event.preCount} → ${event.postCount} messages]`,
            timestamp: Date.now(),
          }],
        }))
        break

      case 'tool-progress':
        set({ status: `${event.name}: ${(event.output as string).slice(0, 80)}...` })
        break

      case 'suggestion':
        set({ status: `Suggested next prompt: ${event.text}` })
        break
    }
  },

  clearMessages: () => set({ messages: [], contextInfo: null }),

  resolvePermission: (approved, alwaysAllow, rejectReason) => {
    set({ pendingConfirm: null })
    window.agent?.resolvePermission({ approved, alwaysAllow, rejectReason })
  },

  restoreSession: () => {
    window.agent?.getSessionMessages().then((msgs: any[]) => {
      const restored = restoreChatMessages(msgs)
      if (restored.length > 0) set({ messages: restored })
    })
  },
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

/**
 * Compute real-time context info string.
 * Uses lastPromptTokens (API ground truth) + estimated new output since last usage.
 * Matching finagent AgentStatus.contextDisplay.
 */
function computeContextInfo(lastPromptTokens: number, contextWindow: number, outputChars: number, outputCharsAtLastUsage: number): string | null {
  if (lastPromptTokens <= 0 || contextWindow <= 0) return null
  const newChars = outputChars - outputCharsAtLastUsage
  const pendingTokens = Math.round(newChars / 3)
  const currentTokens = lastPromptTokens + pendingTokens
  const pct = ((currentTokens / contextWindow) * 100).toFixed(1)
  return `${pct}% (${formatTokens(currentTokens)}/${formatTokens(contextWindow)})`
}

function logContextTraceThrottled(
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
  if (now - lastContextTraceAt < 5000) return
  lastContextTraceAt = now
  window.agent?.logContextTrace?.({
    source,
    lastPromptTokens,
    contextWindow,
    outputChars,
    outputCharsAtLastUsage,
    estimatedPendingTokens: Math.round((outputChars - outputCharsAtLastUsage) / 3),
    contextInfo,
    ...extra,
  }).catch(() => {})
}
