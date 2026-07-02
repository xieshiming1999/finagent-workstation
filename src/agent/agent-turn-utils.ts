import { toolMessage, Role, type Message, type ToolUse } from './message'
import { sanitizeToolInputForSession } from './session'
import { needsPermissionForInput, type Tool, type ToolContext } from './tool'
import { globalHookRegistry } from './hook-registry'
import { checkHardlineBlock, type ToolGuardrailController } from './safety-guardrails'
import { maybePersistResult, parseStructuredToolResult } from './agent-runtime-utils'
import { detectDoomLoop, enforceImageBudget, stripOldImages, trimIncompleteToolUse } from './agent-helpers'
import type { ToolExecutionResult } from './agent-tool-execution'
import type { PermissionManager } from './permission-manager'

interface ExecuteSingleToolCallArgs {
  tc: ToolUse
  tool: Tool
  ctx: ToolContext
  basePath: string
  budgetConsume: (toolName: string) => void
  budgetRefund: (toolName: string) => void
  recordRecentToolCall: (entry: string) => void
  incrementToolCallCount: () => void
  incrementTurnToolCallCount: () => void
  pushAndPersist: (msg: Message) => void
  toolGuardrail: ToolGuardrailController
}

export async function executeSingleToolCall(args: ExecuteSingleToolCallArgs): Promise<ToolExecutionResult> {
  const {
    tc,
    tool,
    ctx,
    basePath,
    budgetConsume,
    budgetRefund,
    recordRecentToolCall,
    incrementToolCallCount,
    incrementTurnToolCallCount,
    pushAndPersist,
    toolGuardrail,
  } = args

  if (tool.validateInput) {
    const error = tool.validateInput(tc.input, ctx)
    if (error) {
      const content = `Validation error: ${error}`
      pushAndPersist(toolMessage(tc.id, content, true))
      return { name: tc.name, result: error, isError: true, durationMs: 0 }
    }
  }

  if (tc.name === 'Bash' && tc.input.command) {
    const blocked = checkHardlineBlock(String(tc.input.command))
    if (blocked) {
      const content = `BLOCKED: ${blocked}. This command is never allowed.`
      pushAndPersist(toolMessage(tc.id, content, true))
      return { name: tc.name, result: `BLOCKED: ${blocked}`, isError: true, durationMs: 0 }
    }
  }

  const hookBefore = await globalHookRegistry.fire('tool:before', { event: 'tool:before', toolName: tc.name, toolInput: tc.input })
  if (hookBefore.block) {
    const content = hookBefore.blockReason ?? 'Blocked by hook'
    pushAndPersist(toolMessage(tc.id, content, true))
    return { name: tc.name, result: content, isError: true, durationMs: 0 }
  }
  const effectiveInput = hookBefore.updatedInput ?? tc.input

  const start = Date.now()
  incrementToolCallCount()
  incrementTurnToolCallCount()
  budgetConsume(tc.name)
  recordRecentToolCall(`${tc.name}:${JSON.stringify(sanitizeToolInputForSession(tc.name, effectiveInput))}`)

  try {
    const rawResult = await tool.call(tc.id, effectiveInput, ctx)
    const durationMs = Date.now() - start
    if (tool.isReadOnly) budgetRefund(tc.name)

    const hookAfter = await globalHookRegistry.fire('tool:after', { event: 'tool:after', toolName: tc.name, toolInput: effectiveInput, toolOutput: rawResult })
    const finalResult = hookAfter.updatedOutput ?? rawResult
    const isToolError = false

    toolGuardrail.check(tc.name, effectiveInput, finalResult, isToolError)

    const parsedResult = parseStructuredToolResult(finalResult)
    const result = isToolError ? parsedResult.content : maybePersistResult(basePath, parsedResult.content)
    pushAndPersist(toolMessage(tc.id, result, isToolError, parsedResult.extras))
    return { name: tc.name, result, isError: isToolError, durationMs }
  } catch (err) {
    const durationMs = Date.now() - start
    const errMsg = err instanceof Error ? err.message : String(err)

    const guardrailResult = toolGuardrail.check(tc.name, effectiveInput, errMsg, true)
    const finalErr = guardrailResult.action === 'block'
      ? `${errMsg}\n\n⚠️ ${guardrailResult.message}`
      : errMsg

    pushAndPersist(toolMessage(tc.id, finalErr, true))
    return { name: tc.name, result: finalErr, isError: true, durationMs }
  }
}

export function permissionDecisionForTool(
  skipPermissions: boolean,
  permissionManager: PermissionManager,
  approvedTools: Set<string>,
  tool: Tool,
  input: Record<string, unknown>,
): 'allow' | 'deny' | 'ask' {
  if (skipPermissions) return 'allow'

  const explicitRule = permissionManager.matchRule(tool.name, input)
  if (explicitRule) return explicitRule.action

  if (!needsPermissionForInput(tool, input, approvedTools, false)) return 'allow'
  return 'allow'
}

export function sanitizeStoredToolInputs(messages: Message[]): Message[] {
  return messages.map((msg) => {
    if (msg.role !== Role.Assistant || !msg.toolUses?.length) return msg
    return {
      ...msg,
      toolUses: msg.toolUses.map((tu) => ({
        ...tu,
        input: sanitizeToolInputForSession(tu.name, tu.input),
      })),
    }
  })
}

export function trimAndBudgetImages(messages: Message[], keepTurns = 3, maxBytes = 8 * 1024 * 1024): void {
  const trimmed = trimIncompleteToolUse(messages)
  messages.splice(0, messages.length, ...trimmed)
  stripOldImages(messages, keepTurns)
  enforceImageBudget(messages, maxBytes)
}

export function updateDoomLoopState(recentToolCalls: string[], warningCount: number): { result: 'warn' | 'stop' | false; warningCount: number } {
  const { result, newWarningCount } = detectDoomLoop(recentToolCalls, warningCount)
  return { result, warningCount: newWarningCount }
}
