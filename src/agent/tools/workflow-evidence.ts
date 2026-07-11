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
      pendingInteractions: readPendingInteractionState(ctx),
      session: readCurrentSession(ctx, limit),
      artifacts: listArtifacts(ctx, limit),
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
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const text = line.trim()
    if (!text) continue
    try {
      const decoded = JSON.parse(text) as JsonObject
      if (decoded.type !== 'message') continue
      messageCount++
      const item: JsonObject = { role: decoded.role }
      if (decoded.timestamp) item.timestamp = decoded.timestamp
      if (typeof decoded.content === 'string' && decoded.content.trim()) {
        item.content = truncate(decoded.content, 300)
      }
      if (Array.isArray(decoded.toolUses) && decoded.toolUses.length > 0) {
        toolCallCount += decoded.toolUses.length
        item.toolUses = decoded.toolUses
          .filter((tool): tool is JsonObject => Boolean(tool) && typeof tool === 'object' && !Array.isArray(tool))
          .map((tool) => ({
            name: tool.name,
            input: compactValue(tool.input),
          }))
      }
      const result = decoded.toolResult ?? decoded.tool_result
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        toolResultCount++
        const row = result as JsonObject
        const isError = row.isError === true
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
