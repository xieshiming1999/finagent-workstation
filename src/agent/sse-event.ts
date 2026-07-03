export type SSEEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'thinking-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'tool-call-start'; id: string; name: string }
  | { type: 'tool-call-delta'; id?: string; name?: string; text: string }
  | { type: 'done'; finishReason?: string }
  | { type: 'error'; message: string }
  | { type: 'usage'; promptTokens: number; completionTokens: number }
