import type { Message } from './message'
import type { SSEEvent } from './sse-event'

export interface LLMProvider {
  readonly model: string
  readonly contextWindow: number
  clone(): LLMProvider
  cancel(): void
  sendMessage(
    systemPrompt: string,
    messages: Message[],
    tools: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>,
  ): AsyncGenerator<SSEEvent>
}
