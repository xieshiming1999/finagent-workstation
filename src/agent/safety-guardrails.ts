/**
 * Safety guardrails for tool execution.
 *
 * Reference: hermes-agent/tools/approval.py (hardline + dangerous patterns)
 * Reference: hermes-agent/agent/tool_guardrails.py (loop detection)
 * Reference: opencode/src/session/retry.ts (retry-after header)
 */

// --- Hardline Blocklist ---
// These commands are NEVER allowed, regardless of approval mode.
const HARDLINE_PATTERNS = [
  { pattern: /rm\s+-rf\s+\/\s*$/, reason: 'recursive delete of root filesystem' },
  { pattern: /mkfs/, reason: 'filesystem format' },
  { pattern: /dd\s+.*of=\/dev\//, reason: 'raw disk write' },
  { pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/, reason: 'fork bomb' },
  { pattern: /kill\s+-9?\s+-1/, reason: 'kill all processes' },
  { pattern: /shutdown|reboot|halt|poweroff/, reason: 'system shutdown' },
  { pattern: /rm\s+-rf\s+~\/?\s*$/, reason: 'delete home directory' },
  { pattern: />\s*\/dev\/sda/, reason: 'overwrite disk device' },
]

/**
 * Check if a command is in the hardline blocklist.
 * Returns the reason if blocked, null if safe.
 */
export function checkHardlineBlock(command: string): string | null {
  for (const { pattern, reason } of HARDLINE_PATTERNS) {
    if (pattern.test(command)) return reason
  }
  return null
}

// --- Tool Loop Guardrail ---

interface ToolCallRecord {
  name: string
  argsHash: string
  result?: string
  isError: boolean
  timestamp: number
}

export class ToolGuardrailController {
  private history: ToolCallRecord[] = []
  private maxHistory = 50

  /**
   * Record a tool call and check for loop patterns.
   * Returns 'allow' | 'warn' | 'block' with optional message.
   */
  check(name: string, args: Record<string, unknown>, result?: string, isError = false): { action: 'allow' | 'warn' | 'block'; message?: string } {
    const argsHash = hashArgs(args)
    this.history.push({ name, argsHash, result, isError, timestamp: Date.now() })
    if (this.history.length > this.maxHistory) this.history.shift()

    // Check exact failure repeat (same tool + same args + error)
    if (isError) {
      const recentErrors = this.history.filter((h) => h.name === name && h.argsHash === argsHash && h.isError)
      if (recentErrors.length >= 3) {
        return { action: 'block', message: `Tool "${name}" failed 3+ times with identical args. Try a different approach.` }
      }
      if (recentErrors.length >= 2) {
        return { action: 'warn', message: `Tool "${name}" has failed repeatedly with same args. Consider a different approach.` }
      }
    }

    // Check idempotent no-progress (same tool + same args + same result)
    const IDEMPOTENT_TOOLS = new Set(['Read', 'FileRead', 'Glob', 'Grep', 'LS', 'UIQuery', 'SessionSearch'])
    if (IDEMPOTENT_TOOLS.has(name)) {
      const sameCallSameResult = this.history.filter((h) =>
        h.name === name && h.argsHash === argsHash && h.result === result && !h.isError
      )
      if (sameCallSameResult.length >= 3) {
        return { action: 'warn', message: `Tool "${name}" returned identical results 3 times. No progress being made.` }
      }
    }

    // Check same tool excessive use (any args)
    const sameTool = this.history.filter((h) => h.name === name)
    if (sameTool.length >= 20) {
      return { action: 'warn', message: `Tool "${name}" called ${sameTool.length} times this turn. Consider a different approach.` }
    }

    return { action: 'allow' }
  }

  reset(): void {
    this.history = []
  }
}

function hashArgs(args: Record<string, unknown>): string {
  return JSON.stringify(args, Object.keys(args).sort()).slice(0, 200)
}

// --- Retry-After Header Parsing ---

/**
 * Parse retry delay from HTTP response headers.
 * Supports: retry-after-ms (milliseconds), retry-after (seconds or date).
 * Returns delay in milliseconds, or null if no header found.
 *
 * Reference: opencode/src/session/retry.ts
 */
export function parseRetryAfter(headers: Record<string, string>): number | null {
  // retry-after-ms (preferred, millisecond precision)
  const retryAfterMs = headers['retry-after-ms']
  if (retryAfterMs) {
    const ms = parseInt(retryAfterMs, 10)
    if (!isNaN(ms) && ms > 0) return Math.min(ms, 120_000) // Cap at 2 minutes
  }

  // retry-after (standard HTTP: seconds or HTTP-date)
  const retryAfter = headers['retry-after']
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10)
    if (!isNaN(seconds) && seconds > 0) return Math.min(seconds * 1000, 120_000)

    // Try as HTTP-date
    const date = new Date(retryAfter)
    if (!isNaN(date.getTime())) {
      const delay = date.getTime() - Date.now()
      if (delay > 0) return Math.min(delay, 120_000)
    }
  }

  return null
}

// --- Credential Pool ---

/**
 * Credential pool for API key rotation on rate limits.
 * Reference: hermes-agent/agent/credential_pool.py
 */
export class CredentialPool {
  private keys: string[]
  private activeIndex = 0
  private failCounts: number[]

  constructor(keys: string[]) {
    this.keys = keys.filter(Boolean)
    this.failCounts = new Array(this.keys.length).fill(0)
  }

  get current(): string { return this.keys[this.activeIndex] ?? '' }
  get size(): number { return this.keys.length }

  rotate(): string {
    if (this.keys.length <= 1) return this.current
    this.failCounts[this.activeIndex]++
    this.activeIndex = (this.activeIndex + 1) % this.keys.length
    console.log(`[CredentialPool] Rotated to key ${this.activeIndex + 1}/${this.keys.length}`)
    return this.current
  }

  recordSuccess(): void { this.failCounts[this.activeIndex] = 0 }
}

// --- Smart Approval ---

/**
 * Smart approval: use LLM to auto-approve safe commands.
 * Returns true if the command is safe to run without user approval.
 * Reference: hermes-agent/tools/approval.py smart mode
 */
export async function smartApprove(command: string, llm: any): Promise<boolean> {
  try {
    const parts: string[] = []
    const stream = llm.sendMessage(
      'You are a security reviewer. Respond ONLY with "SAFE" or "UNSAFE".',
      [{ role: 'user', content: `Is this bash command safe to execute without user approval?\n\nCommand: ${command}\n\nRespond SAFE if it only reads data, lists files, checks status, or runs tests.\nRespond UNSAFE if it modifies files, installs packages, changes config, or could cause damage.`, timestamp: new Date().toISOString() }],
      [],
    )
    for await (const ev of stream) {
      if (ev.type === 'text-delta') parts.push(ev.text)
    }
    return parts.join('').trim().toUpperCase().includes('SAFE')
  } catch {
    return false
  }
}
