import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { Tool, ToolContext } from '../tool'
import { readPendingInteractionState } from '../interaction-evidence'

type JsonObject = Record<string, unknown>

export class WorkflowEvidenceTool implements Tool {
  name = 'WorkflowEvidence'
  description = 'Summarize workflow evidence from session messages, tool results, pending user interactions, and UI artifacts.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['help', 'summary'],
        description: 'help or summary',
      },
      limit: {
        type: 'number',
        description: 'Maximum recent session evidence rows to return, default 20',
      },
    },
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'summary')
    if (action === 'help') return JSON.stringify(help())
    if (action !== 'summary') {
      throw new Error(`Invalid WorkflowEvidence action "${action}". Use action="help" for supported actions.`)
    }

    const limit = Math.max(1, Math.min(100, Number(input.limit ?? 20) || 20))
    const pendingInteractions = readPendingInteractionState(ctx)
    const session = readCurrentSession(ctx, limit)
    const artifacts = listArtifacts(ctx, limit)
    return JSON.stringify({
      contract: 'workflow-evidence-summary-v1',
      sources: {
        session: join(ctx.basePath, 'sessions', 'current.jsonl'),
        interactionPending: join(ctx.memoryDir || join(ctx.basePath, 'memory'), 'interaction_pending.json'),
        artifacts: [
          join(ctx.basePath, 'memory', 'pages'),
          join(ctx.basePath, 'memory', 'dashboards'),
        ],
      },
      pendingInteractions,
      session,
      artifacts,
      runtimeState: deriveRuntimeState({
        pendingInteractions,
        session,
        uiArtifactCount: Number((artifacts.pages as JsonObject).count ?? 0) +
          Number((artifacts.dashboards as JsonObject).count ?? 0),
      }),
      guidance: 'Use this summary to verify tool calls, failures, pending human input, and UI artifacts. It is evidence, not a substitute for a full app workflow check.',
    })
  }
}

function help(): JsonObject {
  return {
    contract: 'workflow-evidence-help-v1',
    actions: ['summary'],
    reads: [
      'sessions/current.jsonl',
      'memory/interaction_pending.json',
      'memory/pages',
      'memory/dashboards',
    ],
    guidance: 'Call summary before claiming a workflow is complete, after restart, or when the agent reported tool/UI failures.',
  }
}

function readCurrentSession(ctx: ToolContext, limit: number): JsonObject {
  const file = join(ctx.basePath, 'sessions', 'current.jsonl')
  if (!existsSync(file)) {
    return {
      exists: false,
      messageCount: 0,
      toolCallCount: 0,
      toolResultCount: 0,
      toolErrorCount: 0,
      recent: [],
    }
  }

  const recent: JsonObject[] = []
  let messageCount = 0
  let toolCallCount = 0
  let toolResultCount = 0
  let toolErrorCount = 0
  let lastRole = ''
  let lastAssistantHadToolUse = false
  let lastToolResultIsError = false
  const toolUseIds = new Set<string>()
  const resolvedToolUseIds = new Set<string>()
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const text = line.trim()
    if (!text) continue
    try {
      const decoded = JSON.parse(text) as JsonObject
      if (decoded.type !== 'message') continue
      messageCount++
      lastRole = String(decoded.role ?? '')
      const item: JsonObject = { role: decoded.role }
      if (decoded.timestamp) item.timestamp = decoded.timestamp
      if (typeof decoded.content === 'string' && decoded.content.trim()) {
        item.content = truncate(decoded.content, 300)
      }
      if (Array.isArray(decoded.toolUses) && decoded.toolUses.length > 0) {
        toolCallCount += decoded.toolUses.length
        lastAssistantHadToolUse = lastRole === 'assistant'
        item.toolUses = decoded.toolUses
          .filter((tool): tool is JsonObject => Boolean(tool) && typeof tool === 'object' && !Array.isArray(tool))
          .map((tool) => ({
            name: tool.name,
            input: compactValue(tool.input),
          }))
        for (const tool of decoded.toolUses) {
          if (tool && typeof tool === 'object' && !Array.isArray(tool)) {
            const id = String((tool as JsonObject).id ?? '')
            if (id) toolUseIds.add(id)
          }
        }
      }
      const result = decoded.toolResult ?? decoded.tool_result
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        toolResultCount++
        const row = result as JsonObject
        const isError = row.isError === true
        lastToolResultIsError = isError
        const toolUseId = String(row.toolUseId ?? '')
        if (toolUseId) resolvedToolUseIds.add(toolUseId)
        if (isError) toolErrorCount++
        item.toolResult = {
          isError,
          toolUseId: row.toolUseId,
          content: truncate(String(row.content ?? ''), 500),
        }
      }
      recent.push(item)
      if (recent.length > limit) recent.shift()
    } catch {
      // Ignore malformed JSONL rows; session recovery owns corruption handling.
    }
  }

  return {
    exists: true,
    messageCount,
    toolCallCount,
    toolResultCount,
    toolErrorCount,
    lastRole,
    lastAssistantHadToolUse,
    lastToolResultIsError,
    unresolvedToolCallCount: toolUseIds.size - resolvedToolUseIds.size,
    recent,
  }
}

function listArtifacts(ctx: ToolContext, limit: number): JsonObject {
  return {
    pages: listHtmlFiles(join(ctx.basePath, 'memory', 'pages'), limit),
    dashboards: listHtmlFiles(join(ctx.basePath, 'memory', 'dashboards'), limit),
  }
}

function listHtmlFiles(dir: string, limit: number): JsonObject {
  if (!existsSync(dir)) return { exists: false, count: 0, recent: [] }
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.html'))
    .map((name) => {
      const path = join(dir, name)
      const stat = statSync(path)
      return {
        path,
        updatedAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return {
    exists: true,
    count: files.length,
    recent: files.slice(0, limit),
  }
}

function compactValue(value: unknown): unknown {
  if (typeof value === 'string') return truncate(value, 180)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.fromEntries(Object.entries(value as JsonObject).map(([key, item]) => [
    key,
    typeof item === 'string' ? truncate(item, 120) : item,
  ]))
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`
}

function deriveRuntimeState(input: {
  pendingInteractions: JsonObject[]
  session: JsonObject
  uiArtifactCount: number
}): JsonObject {
  const pendingTypes = input.pendingInteractions.map((item) => String(item.type ?? '').toLowerCase())
  let state = 'idle'
  let reason = 'No active session evidence is visible.'
  let nextAction = 'Start a workflow or inspect tool help before broad action.'

  if (pendingTypes.some((type) => type.includes('approval') || type.includes('permission'))) {
    state = 'waiting_for_approval'
    reason = 'A structured approval or permission interaction is pending.'
    nextAction = 'Resolve the pending approval before continuing the workflow.'
  } else if (input.pendingInteractions.length > 0) {
    state = 'waiting_for_user'
    reason = 'A structured user question is pending.'
    nextAction = 'Answer the pending user question before continuing.'
  } else if (Number(input.session.unresolvedToolCallCount ?? 0) > 0) {
    state = 'using_tool'
    reason = 'At least one tool call has no visible result yet.'
    nextAction = 'Wait for the tool result or inspect session evidence for missing output.'
  } else if (Number(input.session.toolErrorCount ?? 0) > 0) {
    state = 'blocked'
    reason = 'Failed tool results are visible in the current session.'
    nextAction = 'Inspect failed tool results and recover before final claims.'
  } else if (input.session.lastRole === 'tool' && input.session.lastToolResultIsError !== true) {
    state = 'verifying_result'
    reason = 'The latest visible event is a successful tool result.'
    nextAction = 'Verify evidence and synthesize the result before finalizing.'
  } else if (input.session.lastRole === 'assistant' &&
    input.session.lastAssistantHadToolUse !== true &&
    (Number(input.session.toolCallCount ?? 0) > 0 || input.uiArtifactCount > 0)) {
    state = 'complete'
    reason = 'The latest assistant message follows collected tool or UI evidence.'
    nextAction = 'Use WorkflowEvidence or CapabilityStatus evaluation before relying on completion.'
  } else if (Number(input.session.toolCallCount ?? 0) > 0) {
    state = 'thinking'
    reason = 'Tool evidence exists but no terminal assistant synthesis is visible.'
    nextAction = 'Continue reasoning or inspect workflow evidence.'
  }

  return {
    contract: 'agent-runtime-state-v1',
    state,
    reason,
    nextAction,
    observed: {
      pendingInteractions: input.pendingInteractions.length,
      toolCalls: Number(input.session.toolCallCount ?? 0),
      toolErrors: Number(input.session.toolErrorCount ?? 0),
      uiArtifacts: input.uiArtifactCount,
      lastRole: String(input.session.lastRole ?? ''),
    },
  }
}
