import type { Message } from './message'
import type { SSEEvent } from './sse-event'
import type { LLMProvider } from './llm-provider'
import { llmSemaphore } from './semaphore'
import { normalizeMessages } from './anthropic-message'

export interface AnthropicConfig {
  baseURL: string
  apiKey: string
  model: string
  maxTokens?: number
  contextWindow?: number
  effort?: 'low' | 'medium' | 'high'
  extraHeaders?: Record<string, string>
  capabilities?: { vision?: boolean; audio?: boolean }
}

interface ToolSchema {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

const STREAM_READ_TIMEOUT = 180_000
const MAX_RETRIES = 9
const MAX_STREAM_RETRIES = 3

function retryDelayMs(attempt: number, initial = 2000, max = 30000): number {
  const base = initial * (1 << attempt)
  const capped = Math.min(base, max)
  const jitter = capped * 0.5 * Math.random()
  return Math.round(capped + jitter)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeEffortForEndpoint(
  effort: AnthropicConfig['effort'] | undefined,
  baseURL: string,
  model: string,
): AnthropicConfig['effort'] | undefined {
  if (!effort) return effort
  const endpoint = baseURL.toLowerCase()
  const modelName = model.toLowerCase()
  if (
    effort === 'medium' &&
    (endpoint.includes('deepseek.com') ||
      endpoint.includes('kimi') ||
      modelName.includes('deepseek') ||
      modelName.includes('kimi'))
  ) {
    return 'high'
  }
  return effort
}

export class AnthropicLLMClient implements LLMProvider {
  private config: AnthropicConfig
  private abortController: AbortController | null = null

  constructor(config: AnthropicConfig) {
    this.config = config
  }

  clone(): LLMProvider {
    return new AnthropicLLMClient({ ...this.config })
  }

  cancel(): void {
    this.abortController?.abort()
    this.abortController = null
  }

  updateConfig(config: Partial<AnthropicConfig>): void {
    Object.assign(this.config, config)
  }

  get model(): string {
    return this.config.model
  }

  get contextWindow(): number {
    return this.config.contextWindow ?? 200_000
  }

  async *sendMessage(
    systemPrompt: string,
    messages: Message[],
    tools: ToolSchema[],
  ): AsyncGenerator<SSEEvent> {
    await llmSemaphore.acquire()
    try {
      yield* this.stream(systemPrompt, messages, tools)
    } finally {
      llmSemaphore.release()
    }
  }

  private async *stream(
    systemPrompt: string,
    messages: Message[],
    tools: ToolSchema[],
  ): AsyncGenerator<SSEEvent> {
    const effort = normalizeEffortForEndpoint(this.config.effort, this.config.baseURL, this.config.model)
    const normalized = normalizeMessages(messages, effort, {
      includeToolResultImages: this.config.capabilities?.vision ?? false,
    })

    const sorted = [...tools].sort((a, b) => a.function.name.localeCompare(b.function.name))
    const anthropicTools = sorted.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }))

    const body: Record<string, unknown> = {
      model: this.config.model,
      system: systemPrompt,
      messages: normalized,
      max_tokens: this.config.maxTokens ?? 64000,
      stream: true,
    }

    if (anthropicTools.length > 0) {
      body.tools = anthropicTools
    }

    if (effort) {
      body.thinking = { type: 'adaptive' }
      body.output_config = { effort }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
      ...this.config.extraHeaders,
    }
    const jsonBody = JSON.stringify(body)

    // Retry loop for HTTP errors
    let res: Response | null = null
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        res = await fetch(this.config.baseURL, { method: 'POST', headers, body: jsonBody })

        if (res.ok) break

        const text = await res.text()
        const status = res.status
        if ((status === 429 || status === 500 || status === 529) && attempt < MAX_RETRIES) {
          const delay = retryDelayMs(attempt)
          console.log(`[LLM] ${this.config.model} HTTP ${status}, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms...`)
          await sleep(delay)
          res = null
          continue
        }

        console.error(`[LLM] ${this.config.model} ${status}: ${text.slice(0, 200)}`)
        yield { type: 'error', message: `Anthropic API error ${status}: ${text}` }
        return
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          const delay = retryDelayMs(attempt, 2000, 20000)
          console.log(`[LLM] ${this.config.model} fetch error, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms...`)
          await sleep(delay)
          res = null
          continue
        }
        yield { type: 'error', message: `Network error after ${MAX_RETRIES} retries: ${err}` }
        return
      }
    }

    if (!res || !res.ok) {
      yield { type: 'error', message: `Failed after ${MAX_RETRIES} retries` }
      return
    }

    // Stream parsing with retry on break-before-content
    for (let streamAttempt = 0; streamAttempt <= MAX_STREAM_RETRIES; streamAttempt++) {
      const reader = res.body?.getReader()
      if (!reader) {
        yield { type: 'error', message: 'No response body' }
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent: string | null = null
      const toolBlocks = new Map<number, { id: string; name: string; args: string }>()
      let stopReason: string | undefined
      let hasContent = false
      let timedOut = false

      try {
        while (true) {
          const readPromise = reader.read()
          const timeoutPromise = sleep(STREAM_READ_TIMEOUT).then(() => ({ done: true, value: undefined, timedOut: true }))
          const result = await Promise.race([readPromise, timeoutPromise]) as any

          if (result.timedOut) {
            timedOut = true
            reader.cancel()
            break
          }

          if (result.done) break

          buffer += decoder.decode(result.value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            if (trimmed.startsWith('event:')) {
              currentEvent = trimmed.substring(6).trim()
              continue
            }

            if (!trimmed.startsWith('data:')) continue
            const data = trimmed.substring(5).trim()

            try {
              const json = JSON.parse(data) as Record<string, unknown>
              const type = (json.type as string) ?? currentEvent ?? ''

              switch (type) {
                case 'message_start': {
                  const msg = json.message as Record<string, unknown> | undefined
                  if (msg?.usage) {
                    const usage = msg.usage as Record<string, number>
                    const inputTokens = usage.input_tokens ?? 0
                    const cacheCreation = usage.cache_creation_input_tokens ?? 0
                    const cacheRead = usage.cache_read_input_tokens ?? 0
                    yield { type: 'usage', promptTokens: inputTokens + cacheCreation + cacheRead, completionTokens: usage.output_tokens ?? 0 }
                  }
                  break
                }

                case 'content_block_start': {
                  const index = (json.index as number) ?? 0
                  const block = json.content_block as Record<string, unknown> | undefined
                  if (block?.type === 'tool_use') {
                    const id = (block.id as string) ?? ''
                    const name = (block.name as string) ?? ''
                    toolBlocks.set(index, { id, name, args: '' })
                    yield { type: 'tool-call-start', id, name }
                    hasContent = true
                  }
                  break
                }

                case 'content_block_delta': {
                  const delta = json.delta as Record<string, unknown> | undefined
                  if (!delta) break
                  const deltaType = (delta.type as string) ?? ''
                  const index = (json.index as number) ?? 0

                  switch (deltaType) {
                    case 'text_delta': {
                      const text = (delta.text as string) ?? ''
                      if (text) { hasContent = true; yield { type: 'text-delta', text } }
                      break
                    }
                    case 'input_json_delta': {
                      const partial = (delta.partial_json as string) ?? ''
                      if (partial) {
                        const tb = toolBlocks.get(index)
                        if (tb) {
                          tb.args += partial
                          yield { type: 'tool-call-delta', id: tb.id, name: tb.name, text: partial }
                        } else {
                          yield { type: 'tool-call-delta', text: partial }
                        }
                      }
                      break
                    }
                    case 'thinking_delta': {
                      const thinking = (delta.thinking as string) ?? ''
                      if (thinking) yield { type: 'thinking-delta', text: thinking }
                      break
                    }
                    case 'signature_delta':
                      break
                  }
                  break
                }

                case 'content_block_stop': {
                  const index = (json.index as number) ?? 0
                  const tb = toolBlocks.get(index)
                  if (tb) {
                    toolBlocks.delete(index)
                    let args: Record<string, unknown>
                    try {
                      args = tb.args ? JSON.parse(tb.args) : {}
                    } catch {
                      const splitIdx = tb.args.indexOf('}{')
                      if (splitIdx > 0) {
                        try { args = JSON.parse(tb.args.substring(0, splitIdx + 1)) } catch { args = {} }
                      } else {
                        args = {}
                      }
                    }
                    yield { type: 'tool-call', id: tb.id, name: tb.name, arguments: args }
                  }
                  break
                }

                case 'message_delta': {
                  const delta = json.delta as Record<string, unknown> | undefined
                  if (delta?.stop_reason) stopReason = delta.stop_reason as string
                  const usage = json.usage as Record<string, number> | undefined
                  if (usage) {
                    const inputTokens = usage.input_tokens ?? 0
                    const cacheCreation = usage.cache_creation_input_tokens ?? 0
                    const cacheRead = usage.cache_read_input_tokens ?? 0
                    yield { type: 'usage', promptTokens: inputTokens + cacheCreation + cacheRead, completionTokens: usage.output_tokens ?? 0 }
                  }
                  break
                }

                case 'message_stop': {
                  yield { type: 'done', finishReason: mapStopReason(stopReason) }
                  return
                }

                case 'ping':
                  break

                case 'error': {
                  const error = json.error as Record<string, unknown> | undefined
                  yield { type: 'error', message: (error?.message as string) ?? 'Unknown Anthropic error' }
                  return
                }
              }
            } catch {
              // skip malformed JSON
            }

            currentEvent = null
          }
        }
      } catch (err) {
        if (!hasContent && streamAttempt < MAX_STREAM_RETRIES) {
          console.log(`[LLM] ${this.config.model} stream error, retry ${streamAttempt + 1}/${MAX_STREAM_RETRIES}...`)
          await sleep(2000)
          try { res = await fetch(this.config.baseURL, { method: 'POST', headers, body: jsonBody }); if (!res.ok) break } catch { break }
          continue
        }
        yield { type: 'error', message: `Stream error: ${err}` }
        return
      }

      if (timedOut) {
        if (!hasContent && streamAttempt < MAX_STREAM_RETRIES) {
          console.log(`[LLM] ${this.config.model} stream timeout, retry ${streamAttempt + 1}/${MAX_STREAM_RETRIES}...`)
          await sleep(2000)
          try { res = await fetch(this.config.baseURL, { method: 'POST', headers, body: jsonBody }); if (!res.ok) break } catch { break }
          continue
        }
        yield { type: 'error', message: `Stream stalled (no data for ${STREAM_READ_TIMEOUT / 1000}s)` }
        return
      }

      if (!hasContent && streamAttempt < MAX_STREAM_RETRIES) {
        console.log(`[LLM] ${this.config.model} stream broke with no content, retry ${streamAttempt + 1}/${MAX_STREAM_RETRIES}...`)
        await sleep(2000)
        try { res = await fetch(this.config.baseURL, { method: 'POST', headers, body: jsonBody }); if (!res.ok) break } catch { break }
        continue
      }

      yield { type: 'done', finishReason: mapStopReason(stopReason) }
      return
    }

    yield { type: 'error', message: 'Stream failed after retries' }
  }
}

function mapStopReason(reason: string | undefined): string | undefined {
  switch (reason) {
    case 'end_turn': return 'stop'
    case 'tool_use': return 'tool_calls'
    case 'max_tokens': return 'length'
    case 'model_context_window_exceeded': return 'context_exceeded'
    case 'refusal': return 'refusal'
    case 'pause_turn': return 'stop'
    default: return reason
  }
}
