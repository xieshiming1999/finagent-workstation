/**
 * Hook Registry — event-driven hook system for tool/message/session lifecycle.
 *
 * Reference: claude-code-best/src/utils/hooks.ts
 * Reference: openclaw/src/hooks/internal-hooks.ts
 *
 * Events:
 * - tool:before — before tool execution (can block/modify input)
 * - tool:after — after tool execution (can modify output)
 * - message:before — before user message is processed
 * - message:after — after assistant response
 * - session:start — when session starts
 * - session:end — when session ends/clears
 */

export type HookEvent =
  | 'tool:before'
  | 'tool:after'
  | 'message:before'
  | 'message:after'
  | 'session:start'
  | 'session:end'

export interface HookInput {
  event: HookEvent
  toolName?: string
  toolInput?: Record<string, unknown>
  toolOutput?: string
  message?: string
  [key: string]: unknown
}

export interface HookResult {
  /** Block the action (tool:before can reject) */
  block?: boolean
  /** Reason for blocking */
  blockReason?: string
  /** Modified input (tool:before can change tool input) */
  updatedInput?: Record<string, unknown>
  /** Additional context to inject */
  additionalContext?: string
  /** Modified output (tool:after can change tool output) */
  updatedOutput?: string
}

export type HookHandler = (input: HookInput) => Promise<HookResult | void>

interface RegisteredHook {
  name: string
  event: HookEvent
  handler: HookHandler
  toolFilter?: string
  async?: boolean  // If true, runs in background without blocking
}

export class HookRegistry {
  private hooks: RegisteredHook[] = []
  /** Callback when an async hook completes and wants to rewake the agent */
  onAsyncRewake: ((hookName: string, result: HookResult) => void) | null = null

  register(name: string, event: HookEvent, handler: HookHandler, toolFilter?: string): void {
    // Remove existing hook with same name + event
    this.hooks = this.hooks.filter((h) => !(h.name === name && h.event === event))
    this.hooks.push({ name, event, handler, toolFilter })
  }

  unregister(name: string, event?: HookEvent): void {
    this.hooks = this.hooks.filter((h) => !(h.name === name && (event === undefined || h.event === event)))
  }

  list(): Array<{ name: string; event: HookEvent; toolFilter?: string }> {
    return this.hooks.map((h) => ({ name: h.name, event: h.event, toolFilter: h.toolFilter }))
  }

  /**
   * Fire all hooks for an event. Returns combined result.
   * Hooks run sequentially; errors are caught per-hook and logged.
   */
  async fire(event: HookEvent, input: HookInput): Promise<HookResult> {
    const result: HookResult = {}

    for (const hook of this.hooks) {
      if (hook.event !== event) continue
      if (hook.toolFilter && input.toolName && !input.toolName.includes(hook.toolFilter)) continue

      // Async hooks: fire-and-forget, rewake on completion
      if (hook.async) {
        const hookName = hook.name
        hook.handler(input).then((r) => {
          if (r && this.onAsyncRewake) this.onAsyncRewake(hookName, r)
        }).catch((e) => console.error(`[Hook:async] ${hookName} error:`, e))
        continue
      }

      try {
        const hookResult = await hook.handler(input)
        if (!hookResult) continue

        if (hookResult.block) {
          result.block = true
          result.blockReason = hookResult.blockReason ?? `Blocked by hook: ${hook.name}`
          break
        }
        if (hookResult.updatedInput) result.updatedInput = hookResult.updatedInput
        if (hookResult.updatedOutput) result.updatedOutput = hookResult.updatedOutput
        if (hookResult.additionalContext) {
          result.additionalContext = (result.additionalContext ?? '') + '\n' + hookResult.additionalContext
        }
      } catch (e) {
        console.error(`[Hook] ${hook.name} error:`, e)
      }
    }

    return result
  }

  /**
   * Register a shell command hook.
   * Spawns the command, passes input as JSON on stdin, reads JSON result from stdout.
   */
  registerCommand(name: string, event: HookEvent, command: string, opts?: { timeout?: number; toolFilter?: string }): void {
    this.register(name, event, async (input) => {
      const { execSync } = require('child_process')
      const timeout = opts?.timeout ?? 10_000
      try {
        const result = execSync(command, {
          input: JSON.stringify(input),
          encoding: 'utf-8',
          timeout,
          env: { ...process.env, HOOK_EVENT: input.event, HOOK_TOOL: input.toolName ?? '' },
        })
        if (!result.trim()) return undefined
        return JSON.parse(result) as HookResult
      } catch (e) {
        console.error(`[Hook:cmd] ${name} error:`, e)
        return undefined
      }
    }, opts?.toolFilter)
  }

  /**
   * Register an HTTP hook.
   * POSTs the input as JSON to the URL, reads JSON result.
   */
  registerHttp(name: string, event: HookEvent, url: string, opts?: { timeout?: number; toolFilter?: string }): void {
    this.register(name, event, async (input) => {
      const timeout = opts?.timeout ?? 10_000
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeout)
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal: controller.signal,
        })
        clearTimeout(timer)
        if (!res.ok) return undefined
        const data = await res.json() as any
        return data as HookResult
      } catch (e) {
        console.error(`[Hook:http] ${name} error:`, e)
        return undefined
      }
    }, opts?.toolFilter)
  }

  /**
   * Load hooks from a config file (hooks.json).
   * Format: [{ name, event, type: 'command'|'http', command?, url?, toolFilter?, timeout? }]
   */
  loadFromConfig(configPath: string): number {
    const { existsSync, readFileSync } = require('fs')
    if (!existsSync(configPath)) return 0
    try {
      const hooks = JSON.parse(readFileSync(configPath, 'utf-8')) as any[]
      let count = 0
      for (const h of hooks) {
        if (!h.name || !h.event || !h.type) continue
        if (h.type === 'command' && h.command) {
          this.registerCommand(h.name, h.event, h.command, { timeout: h.timeout, toolFilter: h.toolFilter })
          count++
        } else if (h.type === 'http' && h.url) {
          this.registerHttp(h.name, h.event, h.url, { timeout: h.timeout, toolFilter: h.toolFilter })
          count++
        }
      }
      return count
    } catch { return 0 }
  }
}

/** Global hook registry singleton */
export const globalHookRegistry = new HookRegistry()
