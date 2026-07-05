import type { LLMProvider } from '../../src/agent/llm-provider'
import type { Message } from '../../src/agent/message'
import type { SSEEvent } from '../../src/agent/sse-event'

interface MockResponse {
  text?: string
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
}

export class MockLLM implements LLMProvider {
  readonly model = 'mock-model'
  readonly contextWindow = 128_000
  private script: MockResponse[]
  private callIndex = 0
  calls: Array<{ messages: Message[]; toolCount: number }> = []

  constructor(script: MockResponse[]) {
    this.script = script
  }

  async *sendMessage(
    _systemPrompt: string,
    messages: Message[],
    tools: unknown[],
  ): AsyncGenerator<SSEEvent> {
    this.calls.push({ messages: [...messages], toolCount: (tools as unknown[]).length })
    const response = this.script[this.callIndex++] ?? { text: '(no more scripted responses)' }

    if (response.text) {
      yield { type: 'text-delta', text: response.text }
    }

    if (response.toolCalls) {
      for (const tc of response.toolCalls) {
        yield { type: 'tool-call-start', id: tc.id, name: tc.name }
        yield { type: 'tool-call', id: tc.id, name: tc.name, arguments: tc.arguments }
      }
      yield { type: 'done', finishReason: 'tool_calls' }
    } else {
      yield { type: 'done', finishReason: 'stop' }
    }
  }
}
