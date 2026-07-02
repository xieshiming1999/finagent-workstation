import type { AgentEvent } from './agent-event'
import { toolMessage, type ToolUse } from './message'
import type { Tool, ToolContext, ToolRegistry } from './tool'

export interface ToolExecutionResult {
  name: string
  result: string
  isError: boolean
  durationMs: number
}

interface ExecuteToolCallsArgs {
  toolCalls: ToolUse[]
  tools: ToolRegistry
  ctx: ToolContext
  isCancelled: () => boolean
  permissionDecision: (tool: Tool, input: Record<string, unknown>) => 'allow' | 'deny' | 'ask'
  waitForPermissionConfirmation: (requestId: string) => Promise<{ approved: boolean; alwaysAllow?: boolean; rejectReason?: string }>
  approveToolPermanently: (toolName: string) => void
  executeToolCall: (tc: ToolUse, tool: Tool, ctx: ToolContext) => Promise<ToolExecutionResult>
  pushAndPersist: (msg: ReturnType<typeof toolMessage>) => void
}

export async function* executeToolCalls(args: ExecuteToolCallsArgs): AsyncGenerator<AgentEvent> {
  const {
    toolCalls,
    tools,
    ctx,
    isCancelled,
    permissionDecision,
    waitForPermissionConfirmation,
    approveToolPermanently,
    executeToolCall,
    pushAndPersist,
  } = args

  let i = 0
  while (i < toolCalls.length && !isCancelled()) {
    const batchStart = i
    while (i < toolCalls.length) {
      const tc = toolCalls[i]
      const tool = tools.get(tc.name)
      if (!tool) break
      const parallel = tool.canParallel ?? tool.isReadOnly
      if (!parallel) break
      if (permissionDecision(tool, tc.input) !== 'allow') break
      i++
    }

    if (i > batchStart) {
      const batch = toolCalls.slice(batchStart, i)
      for (const tc of batch) {
        yield { type: 'tool-use-start', name: tc.name, input: tc.input }
      }
      const start = Date.now()
      const results = await Promise.all(batch.map(async (tc) => executeToolCall(tc, tools.get(tc.name)!, ctx)))
      const durationMs = Date.now() - start

      for (const result of results) {
        yield {
          type: 'tool-result',
          name: result.name,
          result: result.result,
          isError: result.isError,
          durationMs: result.durationMs || Math.round(durationMs / results.length),
        }
      }
    }

    if (i >= toolCalls.length || isCancelled()) continue

    const tc = toolCalls[i]
    i++
    const tool = tools.get(tc.name)
    if (!tool) {
      const available = tools.list().map((t) => t.name).join(', ')
      pushAndPersist(toolMessage(tc.id, `Unknown tool "${tc.name}". Available tools: ${available}`, true))
      yield { type: 'tool-result', name: tc.name, result: `Unknown tool. Available: ${available}`, isError: true, durationMs: 0 }
      continue
    }

    const permission = permissionDecision(tool, tc.input)
    if (permission === 'deny') {
      const content = `Tool use was rejected by permission rule: ${tc.name}`
      pushAndPersist(toolMessage(tc.id, content, true))
      yield { type: 'tool-result', name: tc.name, result: content, isError: true, durationMs: 0 }
      break
    }

    if (permission === 'ask') {
      yield { type: 'tool-confirm-request', name: tc.name, input: tc.input, requestId: tc.id }
      const confirmResult = await waitForPermissionConfirmation(tc.id)
      if (!confirmResult.approved) {
        const reason = confirmResult.rejectReason
        const content = reason ? `Tool use was rejected by the user. Feedback: ${reason}` : 'Tool use was rejected by the user.'
        pushAndPersist(toolMessage(tc.id, content, true))
        yield { type: 'tool-result', name: tc.name, result: content, isError: true, durationMs: 0 }
        break
      }
      if (confirmResult.alwaysAllow) {
        approveToolPermanently(tc.name)
      }
    }

    yield { type: 'tool-use-start', name: tc.name, input: tc.input }
    const result = await executeToolCall(tc, tool, ctx)
    yield { type: 'tool-result', name: result.name, result: result.result, isError: result.isError, durationMs: result.durationMs }
  }
}
