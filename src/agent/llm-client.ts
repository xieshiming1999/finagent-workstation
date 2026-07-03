import type { Message } from './message'
import { Role } from './message'
import type { SSEEvent } from './sse-event'
import type { LLMProvider } from './llm-provider'
import { parseRetryAfter } from './safety-guardrails'
import { llmSemaphore } from './semaphore'

export interface LLMConfig {
  baseURL: string
  apiKey: string
  model: string
  maxTokens?: number
  contextWindow?: number
  temperature?: number
  reasoningEffort?: string
  thinking?: { type: string }
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

export class LLMClient implements LLMProvider {
  private config: LLMConfig
  private abortController: AbortController | null = null

  constructor(config: LLMConfig) {
    this.config = config
  }

  clone(): LLMProvider {
    return new LLMClient({ ...this.config })
  }

  cancel(): void {
    this.abortController?.abort()
    this.abortController = null
  }

  updateConfig(config: Partial<LLMConfig>): void {
    Object.assign(this.config, config)
  }

  get model(): string {
    return this.config.model
  }

  get contextWindow(): number {
    return this.config.contextWindow ?? 128_000
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
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(toOpenAIMessage),
      ],
      stream: true,
      stream_options: { include_usage: true },
      temperature: this.config.temperature ?? 0.7,
      max_completion_tokens: this.config.maxTokens ?? 16384,
    }
    if (tools.length > 0) {
      const sorted = [...tools].sort((a, b) => a.function.name.localeCompare(b.function.name))
      body.tools = sorted
    }
    if (this.config.reasoningEffort) {
      body.reasoning_effort = this.config.reasoningEffort
    }
    if (this.config.thinking) {
      body.thinking = this.config.thinking
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      ...this.config.extraHeaders,
    }
    const url = this.config.baseURL
    const jsonBody = JSON.stringify(body)

    // Retry loop for HTTP errors
    let res: Response | null = null
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        res = await fetch(url, { method: 'POST', headers, body: jsonBody })

        if (res.ok) break

        const text = await res.text()
        const status = res.status
        if ((status === 400 || status === 429 || status === 500 || status === 529 || status === 503) && attempt < MAX_RETRIES) {
          // Prefer server's retry-after header over exponential backoff
          const headers: Record<string, string> = {}
          res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
          const serverDelay = parseRetryAfter(headers)
          const delay = serverDelay ?? retryDelayMs(attempt)
          console.log(`[LLM] ${this.config.model} HTTP ${status}, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms${serverDelay ? ' (server retry-after)' : ''}...`)
          await sleep(delay)
          res = null
          continue
        }

        console.error(`[LLM] ${this.config.model} ${status}: ${text.slice(0, 200)}`)
        yield { type: 'error', message: `LLM API error ${status}: ${text}` }
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
      const toolAccum = new ToolCallAccumulator()
      let lastFinishReason: string | undefined
      let hasContent = false
      let timedOut = false

      let firstRead = true
      try {
        while (true) {
          if (firstRead) console.log(`[LLM] waiting for first chunk...`)
          const readPromise = reader.read()
          const timeoutPromise = sleep(STREAM_READ_TIMEOUT).then(() => ({ done: true, value: undefined, timedOut: true }))
          const result = await Promise.race([readPromise, timeoutPromise]) as any

          if (firstRead) {
            firstRead = false
            console.log(`[LLM] first read result: done=${result.done}, timedOut=${result.timedOut ?? false}, bytes=${result.value?.length ?? 0}`)
          }

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
            if (!trimmed || !trimmed.startsWith('data:')) continue

            const data = trimmed.substring(5).trim()
            if (data === '[DONE]') {
              if (toolAccum.hasData && lastFinishReason !== 'length') {
                for (const tc of toolAccum.build()) {
                  yield { type: 'tool-call', id: tc.id, name: tc.name, arguments: tc.args }
                }
              }
              yield { type: 'done', finishReason: lastFinishReason }
              return
            }

            try {
              const chunk = JSON.parse(data)

              if (chunk.error) {
                yield { type: 'error', message: chunk.error.message ?? 'Unknown API error' }
                continue
              }

              if (chunk.usage) {
                yield {
                  type: 'usage',
                  promptTokens: chunk.usage.prompt_tokens ?? 0,
                  completionTokens: chunk.usage.completion_tokens ?? 0,
                }
              }

              const choices = chunk.choices
              if (!choices?.length) continue

              const choice = choices[0]
              const delta = choice.delta
              const finishReason = choice.finish_reason

              if (finishReason) lastFinishReason = finishReason

              if (delta) {
                // Reasoning/thinking (DeepSeek R1, QwQ, etc.)
                const reasoning = delta.reasoning ?? delta.reasoning_content
                if (reasoning) {
                  yield { type: 'thinking-delta', text: reasoning }
                }

                // Text content
                if (delta.content) {
                  hasContent = true
                  yield { type: 'text-delta', text: delta.content }
                }

                // Tool calls
                if (delta.tool_calls) {
                  hasContent = true
                  for (const tc of delta.tool_calls) {
                    toolAccum.addDelta(tc)
                    const text = tc.function?.arguments
                    if (text) {
                      yield { type: 'tool-call-delta', id: tc.id, name: tc.function?.name, text }
                    }
                  }
                }
              }

              // Flush tool calls on finish_reason: tool_calls
              if (finishReason === 'tool_calls' && toolAccum.hasData) {
                for (const tc of toolAccum.build()) {
                  yield { type: 'tool-call', id: tc.id, name: tc.name, arguments: tc.args }
                }
              }
            } catch {
              // skip malformed JSON lines
            }
          }
        }
      } catch (err) {
        if (!hasContent && streamAttempt < MAX_STREAM_RETRIES) {
          console.log(`[LLM] ${this.config.model} stream error, retry ${streamAttempt + 1}/${MAX_STREAM_RETRIES}...`)
          await sleep(2000)
          try {
            res = await fetch(url, { method: 'POST', headers, body: jsonBody })
            if (!res.ok) break
          } catch { break }
          continue
        }
        yield { type: 'error', message: `Stream error: ${err}` }
        return
      }

      // Stream ended without [DONE]
      if (timedOut) {
        if (!hasContent && streamAttempt < MAX_STREAM_RETRIES) {
          console.log(`[LLM] ${this.config.model} stream timeout, retry ${streamAttempt + 1}/${MAX_STREAM_RETRIES}...`)
          await sleep(2000)
          try {
            res = await fetch(url, { method: 'POST', headers, body: jsonBody })
            if (!res.ok) break
          } catch { break }
          continue
        }
        yield { type: 'error', message: `Stream stalled (no data for ${STREAM_READ_TIMEOUT / 1000}s)` }
        return
      }

      if (!hasContent && streamAttempt < MAX_STREAM_RETRIES) {
        console.log(`[LLM] ${this.config.model} stream broke with no content, retry ${streamAttempt + 1}/${MAX_STREAM_RETRIES}...`)
        await sleep(2000)
        try {
          res = await fetch(url, { method: 'POST', headers, body: jsonBody })
          if (!res.ok) break
        } catch { break }
        continue
      }

      // Had content or exhausted retries — finish
      if (toolAccum.hasData) {
        for (const tc of toolAccum.build()) {
          yield { type: 'tool-call', id: tc.id, name: tc.name, arguments: tc.args }
        }
      }
      yield { type: 'done', finishReason: lastFinishReason }
      return
    }

    // All stream retries exhausted
    yield { type: 'error', message: 'Stream failed after retries' }
  }
}

// ─── Tool Call Accumulator (matches finagent's _ToolCallAccumulator) ───

class ToolCallAccumulator {
  private builders = new Map<number, { id: string | null; name: string | null; args: string }>()

  addDelta(tc: Record<string, unknown>): void {
    const index = (tc.index as number) ?? 0
    if (!this.builders.has(index)) {
      this.builders.set(index, { id: null, name: null, args: '' })
    }
    const builder = this.builders.get(index)!

    if (tc.id) builder.id = tc.id as string

    const fn = tc.function as Record<string, unknown> | undefined
    if (fn) {
      if (fn.name) builder.name = fn.name as string
      if (fn.arguments) {
        const frag = fn.arguments as string
        // Skip leading '{}' sentinel (some proxies emit this)
        if (!(frag === '{}' && builder.args === '')) {
          builder.args += frag
        }
      }
    }
  }

  build(): Array<{ id: string; name: string; args: Record<string, unknown> }> {
    const results: Array<{ id: string; name: string; args: Record<string, unknown> }> = []
    for (const b of this.builders.values()) {
      if (!b.id || !b.name) continue
      let args: Record<string, unknown>
      try {
        args = b.args ? JSON.parse(b.args) : {}
      } catch {
        args = {}
      }
      results.push({ id: b.id, name: b.name, args })
    }
    this.builders.clear()
    return results
  }

  get hasData(): boolean {
    return this.builders.size > 0
  }
}

// ─── Message Conversion ───

function toOpenAIMessage(msg: Message): Record<string, unknown> {
  if (msg.role === Role.Tool && msg.toolResult) {
    return {
      role: 'tool',
      tool_call_id: msg.toolResult.toolUseId,
      content: msg.toolResult.content,
    }
  }
  if (msg.role === Role.Assistant && msg.toolUses?.length) {
    const result: Record<string, unknown> = {
      role: 'assistant',
      content: msg.content || null,
      tool_calls: msg.toolUses.map((tu) => ({
        id: tu.id,
        type: 'function',
        function: { name: tu.name, arguments: JSON.stringify(tu.input) },
      })),
    }
    if (msg.reasoning) result.reasoning = msg.reasoning
    return result
  }
  if (msg.role === Role.Assistant) {
    const result: Record<string, unknown> = { role: 'assistant', content: msg.content }
    if (msg.reasoning) result.reasoning = msg.reasoning
    return result
  }
  if (msg.contentParts?.length) {
    return {
      role: msg.role,
      content: msg.contentParts.map((p) => {
        if (p.type === 'text') return { type: 'text', text: p.text }
        if (p.type === 'audio') return { type: 'input_audio', input_audio: { data: p.data, format: p.format ?? 'mp3' } }
        if (p.source === 'base64') {
          return { type: 'image_url', image_url: { url: `data:${p.mediaType ?? 'image/png'};base64,${p.data}` } }
        }
        return { type: 'image_url', image_url: { url: p.data } }
      }),
    }
  }
  return { role: msg.role, content: msg.content }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
