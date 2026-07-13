export type AgentEvent =
  | { type: 'user-input'; text: string }
  | { type: 'stream-start' }
  | { type: 'text-delta'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool-call-streaming'; name: string }
  | { type: 'tool-call-delta'; name?: string; chars: number }
  | { type: 'tool-use-start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool-progress'; name: string; output: string; elapsedMs: number }
  | { type: 'tool-result'; id?: string; name: string; result: string; isError: boolean; durationMs: number }
  | { type: 'usage'; promptTokens: number; completionTokens: number; contextWindow?: number }
  | { type: 'turn-complete'; durationMs: number; toolCallCount: number }
  | { type: 'compacted'; preCount: number; postCount: number }
  | { type: 'done' }
  | { type: 'cancelled'; reason?: string }
  | { type: 'error'; message: string }
  | { type: 'tool-confirm-request'; name: string; input: Record<string, unknown>; requestId: string }
  | { type: 'webview-open'; id: string; url: string; title: string }
  | { type: 'webview-navigate'; id: string; url: string }
  | { type: 'webview-execute'; id: string; script: string }
  | { type: 'webview-refresh'; id: string }
  | { type: 'dashboard-open'; id: string; title: string; path: string }
  | { type: 'ui-widget'; action: string; params: Record<string, unknown> }
  | { type: 'ui-open-panel'; id: string; panelType: string; url?: string; title: string }
  | { type: 'ui-close-panel'; id: string }
  | { type: 'ui-notify'; title?: string; message: string; level: string }
  | { type: 'ui-push-data'; channel: string; data: unknown }
  // Agent lifecycle events (matching finagent)
  | { type: 'backgrounded'; taskId: string }
  | { type: 'session-cleared' }
  | { type: 'session-resumed'; messageCount: number }
  | { type: 'command-output'; text: string }
  | { type: 'tasks-changed'; tasks: Array<{ id: string; subject: string; status: string }> }
  | { type: 'suggestion'; text: string }
  | { type: 'notification-received'; prompt: string; source: string }
  | {
    type: 'queue-status'
    queueLength: number
    status?: string
    droppedCount?: number
    accepting?: boolean
    countBySource?: Record<string, number>
  }
  | { type: 'output-chars'; chars: number }
  | { type: 'btw-result'; question: string; answer: string }
  | { type: 'steer-queued'; text: string }
