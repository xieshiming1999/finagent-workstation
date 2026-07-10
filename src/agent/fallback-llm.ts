import type { LLMProvider } from './llm-provider'
import type { Message } from './message'
import type { SSEEvent } from './sse-event'

/**
 * FallbackLLMProvider: tries providers in order, switches on persistent errors.
 * Matching finagent fallback_llm_client.dart.
 */
export class FallbackLLMProvider implements LLMProvider {
  private providers: LLMProvider[]
  private activeIndex = 0
  private consecutiveErrors = 0
  private static readonly MAX_ERRORS_BEFORE_SWITCH = 3

  constructor(providers: LLMProvider[]) {
    if (providers.length === 0) throw new Error('At least one LLM provider required')
    this.providers = providers
  }

  get model(): string { return this.active.model }
  get contextWindow(): number { return this.active.contextWindow }
  private get active(): LLMProvider { return this.providers[this.activeIndex] }

  clone(): LLMProvider {
    return new FallbackLLMProvider(this.providers.map((p) => p.clone()))
  }

  cancel(): void {
    this.active.cancel()
  }

  async *sendMessage(
    systemPrompt: string,
    messages: Message[],
    tools: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>,
  ): AsyncGenerator<SSEEvent> {
    try {
      let hasContent = false
      for await (const ev of this.active.sendMessage(systemPrompt, messages, tools)) {
        if (ev.type === 'error') {
          const switched = this.switchAfterProviderError(ev.message)
          if (switched) {
            for await (const retryEv of this.active.sendMessage(systemPrompt, messages, tools)) {
              yield retryEv
            }
            return
          }
          yield ev
          return
        }
        hasContent = true
        yield ev
      }
      if (hasContent) {
        this.consecutiveErrors = 0
      }
    } catch (e) {
      if (this.switchAfterProviderError(String(e))) {
        for await (const ev of this.active.sendMessage(systemPrompt, messages, tools)) {
          yield ev
        }
      } else {
        throw e
      }
    }
  }

  private switchAfterProviderError(message: string): boolean {
    this.consecutiveErrors++
    console.error(`[FallbackLLM] Error from ${this.active.model} (${this.consecutiveErrors}/${FallbackLLMProvider.MAX_ERRORS_BEFORE_SWITCH}):`, message)
    if (this.providers.length <= 1) return false
    if (!this.shouldSwitch(message) && this.consecutiveErrors < FallbackLLMProvider.MAX_ERRORS_BEFORE_SWITCH) {
      return false
    }
    const oldIdx = this.activeIndex
    this.activeIndex = (this.activeIndex + 1) % this.providers.length
    this.consecutiveErrors = 0
    console.log(`[FallbackLLM] Switching from ${this.providers[oldIdx].model} to ${this.active.model}`)
    return true
  }

  private shouldSwitch(message: string): boolean {
    const text = message.toLowerCase()
    return text.includes('usage limit') ||
      text.includes('billing cycle') ||
      text.includes('quota') ||
      text.includes('permission_error') ||
      text.includes('authentication') ||
      text.includes('unauthorized') ||
      text.includes('forbidden') ||
      text.includes('api error 401') ||
      text.includes('api error 403') ||
      text.includes('api error 429') ||
      text.includes('http 401') ||
      text.includes('http 403') ||
      text.includes('http 429')
  }
}
