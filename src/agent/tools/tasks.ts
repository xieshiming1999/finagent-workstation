import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'
import { TaskStore, type TaskItem } from '../task-store'
import type { Agent } from '../agent'
import type { BackgroundTask } from '../background-task'

const store = new TaskStore()
let storeLoaded = false

function ensureLoaded(basePath: string) {
  if (storeLoaded) return
  store.load(basePath)
  storeLoaded = true
}

let nextId = 1

export class TaskCreateTool implements Tool {
  name = 'TaskCreate'
  description = 'Create a task to track work progress.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Brief task title' },
      description: { type: 'string', description: 'What needs to be done' },
    },
    required: ['subject', 'description'],
  }


  validateInput(input: Record<string, unknown>): string | null {
    if (!input.subject) return 'subject is required. Brief title for the task.'
    if (!input.description) return 'description is required. What needs to be done.'
    return null
  }

    async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    ensureLoaded(ctx.basePath)
    const id = String(nextId++)
    const task: TaskItem = {
      id,
      subject: String(input.subject),
      description: String(input.description),
      status: 'pending',
      blockedBy: [],
      blocks: [],
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    store.add(task)
    return `Task #${id} created: ${task.subject}`
  }
}

export class TaskGetTool implements Tool {
  name = 'TaskGet'
  description = 'Get details of a specific task by ID.'
  isReadOnly = true
  inputSchema = {
    type: 'object',
    properties: { taskId: { type: 'string', description: 'Task ID' } },
    required: ['taskId'],
  }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.taskId) return 'taskId is required.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    ensureLoaded(ctx.basePath)
    const task = store.get(String(input.taskId))
    if (!task) return toolError(`Task not found: ${input.taskId}`)
    return JSON.stringify(task, null, 2)
  }
}

export class TaskUpdateTool implements Tool {
  name = 'TaskUpdate'
  description = 'Update a task status or details.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      taskId: { type: 'string', description: 'Task ID to update' },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'deleted'] },
      subject: { type: 'string' },
      description: { type: 'string' },
    },
    required: ['taskId'],
  }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.taskId) return 'taskId is required.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    ensureLoaded(ctx.basePath)
    const taskId = String(input.taskId)
    if (input.status === 'deleted') {
      store.remove(taskId)
      return `Task #${taskId} deleted`
    }
    const task = store.get(taskId)
    if (!task) return toolError(`Task not found: ${taskId}`)
    store.update(taskId, (t) => {
      if (input.status) t.status = input.status as TaskItem['status']
      if (input.subject) t.subject = String(input.subject)
      if (input.description) t.description = String(input.description)
    })
    return `Task #${taskId} updated: ${input.status ?? task.status}`
  }
}

export class TaskListTool implements Tool {
  name = 'TaskList'
  description = 'List all tasks and their status.'
  isReadOnly = true
  inputSchema = { type: 'object', properties: {} }

  async call(_id: string, _input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    ensureLoaded(ctx.basePath)
    const tasks = store.list()
    if (tasks.length === 0) return 'No tasks.'
    return tasks.map((t) => `#${t.id} [${t.status}] ${t.subject}`).join('\n')
  }
}

export class TaskOutputTool implements Tool {
  name = 'TaskOutput'
  description = 'Get output from a background task. Use block=true to wait for completion, block=false for non-blocking check.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'Task ID to get output from' },
      block: { type: 'boolean', description: 'Wait for completion (default true)' },
      timeout: { type: 'number', description: 'Max wait time in ms (default 30000, max 600000)' },
      expectedContract: { type: 'string', description: 'Optional JSON contract value required in completed task output.' },
      requiredEvidence: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional evidence keys that must appear in structured completed task output.',
      },
    },
    required: ['task_id'],
  }

  needsPermissions(): boolean { return false }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.task_id) return 'task_id is required.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const taskId = String(input.task_id)
    const block = input.block !== false
    const timeoutMs = Math.min(Number(input.timeout ?? 30000), 600000)

    const findTask = () => ctx.taskRegistry.get(taskId)
    let task = findTask()
    if (!task) return toolError(`Task not found: ${taskId}`)

    if (block && (task.status === 'running' || task.status === 'pending')) {
      const deadline = Date.now() + timeoutMs
      while (task && (task.status === 'running' || task.status === 'pending') && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250))
        task = findTask()
      }
      if (!task) return toolError(`Task disappeared: ${taskId}`)
      if (task.status === 'running' || task.status === 'pending') {
        return JSON.stringify({
          retrieval_status: 'timeout',
          task_id: taskId,
          status: task.status,
          ownership: taskOwnership(task),
          progress: {
            toolUseCount: task.toolUseCount,
            estimatedTokens: task.estimatedTokens,
            recentActivities: task.recentActivities,
          },
        })
      }
    }

    if (task.status === 'running' || task.status === 'pending') {
      return JSON.stringify({
        retrieval_status: 'not_ready',
        task_id: taskId,
        status: task.status,
        ownership: taskOwnership(task),
        progress: {
          toolUseCount: task.toolUseCount,
          estimatedTokens: task.estimatedTokens,
          recentActivities: task.recentActivities,
        },
      })
    }

    if (task.status === 'failed' || task.status === 'killed') {
      return toolError(`Task ${taskId} ${task.status}: ${task.error ?? ctx.taskRegistry.readOutput(taskId) ?? 'no error detail available'}`)
    }

    const output = ctx.taskRegistry.readOutput(taskId)
    const validation = validateTaskOutput(output, {
      expectedContract: optionalString(input.expectedContract),
      requiredEvidence: stringList(input.requiredEvidence),
    })
    if (validation) {
      return toolError(JSON.stringify({
        retrieval_status: 'validation_failed',
        task_id: taskId,
        status: task.status,
        ownership: taskOwnership(task),
        outputValidation: validation,
      }))
    }

    return JSON.stringify({
      retrieval_status: 'success',
      task_id: taskId,
      status: task.status,
      ownership: taskOwnership(task),
      ...(output ? { result: output } : {}),
      ...(task.error ? { error: task.error } : {}),
      toolUseCount: task.toolUseCount,
      estimatedTokens: task.estimatedTokens,
    })
  }
}

function validateTaskOutput(
  output: unknown,
  opts: { expectedContract?: string, requiredEvidence: string[] },
): Record<string, unknown> | null {
  if (!opts.expectedContract && opts.requiredEvidence.length === 0) return null
  const decoded = jsonObject(output)
  if (!decoded) {
    return {
      ok: false,
      reason: 'Task output is not structured JSON; cannot validate expectedContract or requiredEvidence.',
      ...(opts.expectedContract ? { expectedContract: opts.expectedContract } : {}),
      ...(opts.requiredEvidence.length ? { requiredEvidence: opts.requiredEvidence } : {}),
    }
  }
  if (opts.expectedContract && decoded.contract !== opts.expectedContract) {
    return {
      ok: false,
      reason: 'Task output contract did not match expectedContract.',
      expectedContract: opts.expectedContract,
      actualContract: decoded.contract,
    }
  }
  const missing = opts.requiredEvidence.filter((key) => !containsEvidence(decoded, key))
  if (missing.length > 0) {
    return {
      ok: false,
      reason: 'Task output is missing required evidence.',
      missingEvidence: missing,
    }
  }
  return null
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  try {
    const decoded = typeof value === 'string' ? JSON.parse(value) : value
    return decoded && typeof decoded === 'object' && !Array.isArray(decoded)
      ? decoded as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function containsEvidence(output: Record<string, unknown>, key: string): boolean {
  const refs = output.evidenceRefs
  if (Array.isArray(refs) && refs.map(String).includes(key)) return true
  const evidence = output.evidence
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence) && key in evidence) return true
  const provenance = output.provenance
  return Boolean(provenance && typeof provenance === 'object' && !Array.isArray(provenance) && key in provenance)
}

function optionalString(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  return text || undefined
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item ?? '').trim()).filter(Boolean)
}

function taskOwnership(task: BackgroundTask): Record<string, unknown> {
  return {
    mode: task.parentSessionId ? 'parent-owned-background' : 'standalone-background',
    isBackgrounded: task.isBackgrounded,
    parentSessionId: task.parentSessionId ?? null,
    toolUseId: task.toolUseId ?? null,
    sidechainPath: task.sidechainPath ?? null,
  }
}

export class TaskStopTool implements Tool {
  name = 'TaskStop'
  description = 'Stop a running background task.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'Task ID to stop' },
    },
    required: ['task_id'],
  }

  private parentAgent: Agent | null = null

  setParentAgent(agent: Agent): void { this.parentAgent = agent }

  needsPermissions(): boolean { return false }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.task_id) return 'task_id is required.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const taskId = String(input.task_id)
    const task = ctx.taskRegistry.get(taskId)
    if (!task) return toolError(`Task not found: ${taskId}`)
    if (task.status !== 'running' && task.status !== 'pending') return toolError(`Task is not running or pending (status: ${task.status})`)
    this.parentAgent?.cancelBackgroundAgent(taskId)
    ctx.taskRegistry.updateStatus(taskId, 'killed', { error: 'Stopped by user' })
    ctx.teamRegistry.updateMemberStatusByTask(taskId, 'killed', 'Stopped by user')
    const running = ctx.taskRegistry.runningCount
    return `Task ${taskId} stopped. ${running} background task(s) still running.`
  }
}
