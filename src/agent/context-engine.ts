import type { Message } from './message'

/**
 * Pluggable context engine interface.
 * Allows swapping the compaction algorithm without touching agent core.
 *
 * Reference: hermes-agent/agent/context_engine.py
 */
export interface ContextEngine {
  /** Name of this engine (for logging) */
  name: string

  /** Check if compaction should trigger */
  shouldCompress(messages: Message[], contextWindow: number, lastPromptTokens: number): boolean

  /** Perform compaction. Returns new message array. */
  compress(messages: Message[], contextWindow: number): Promise<Message[]>

  /** Optional: additional tools this engine provides */
  getExtraTools?(): Array<{ name: string; description: string; call: (input: any) => Promise<string> }>

  /** Optional: cleanup on session end */
  onSessionEnd?(): void
}

/**
 * Default context engine — uses the built-in compact.ts logic.
 */
export class DefaultContextEngine implements ContextEngine {
  name = 'default'

  shouldCompress(messages: Message[], contextWindow: number, lastPromptTokens: number): boolean {
    const { shouldAutoCompact } = require('./compact')
    return shouldAutoCompact(messages, contextWindow, 16384, lastPromptTokens, messages.length)
  }

  async compress(messages: Message[], _contextWindow: number): Promise<Message[]> {
    const { microCompact } = require('./compact')
    return microCompact(messages)
  }
}
