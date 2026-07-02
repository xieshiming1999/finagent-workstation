/**
 * Agent run status tracking.
 * Matching finagent agent_status.dart.
 */

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export class AgentStatus {
  verb: string
  currentTool: string | null = null
  toolDetail: string | null = null
  readonly startTime = Date.now()
  promptTokens = 0
  completionTokens = 0
  lastPromptTokens = 0
  toolCallCount = 0
  loopCount = 0
  contextUsagePct = 0

  constructor(verb?: string) {
    this.verb = verb ?? pickVerb()
  }

  get elapsedMs(): number { return Date.now() - this.startTime }

  get elapsedStr(): string {
    const ms = this.elapsedMs
    if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`
    if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`
    return `${ms}ms`
  }

  get statusLine(): string {
    const parts: string[] = []
    if (this.currentTool) {
      parts.push(`${this.verb} ${this.currentTool}`)
      if (this.toolDetail) parts.push(`(${this.toolDetail})`)
    } else {
      parts.push(this.verb)
    }
    if (this.lastPromptTokens > 0) {
      parts.push(`ctx:${formatTokenCount(this.lastPromptTokens)}`)
    }
    if (this.toolCallCount > 0) {
      parts.push(`${this.toolCallCount} tools`)
    }
    parts.push(this.elapsedStr)
    return parts.join(' · ')
  }
}

const VERBS = [
  'Thinking', 'Analyzing', 'Processing', 'Evaluating', 'Computing',
  'Reasoning', 'Planning', 'Working', 'Examining', 'Investigating',
]

function pickVerb(): string {
  return VERBS[Math.floor(Math.random() * VERBS.length)]
}
