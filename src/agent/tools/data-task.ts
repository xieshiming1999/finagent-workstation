import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'
import type { DataTaskEngine } from '../data-task-engine'

export class DataTaskTool implements Tool {
  name = 'DataTask'
  description = 'Submit and query data tasks. submit blocks by default until the task completes, fails, or times out; use block:false only for intentional background work and then follow with status/result.'
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['submit', 'status', 'result', 'cancel', 'list'], description: 'Task action' },
      type: { type: 'string', description: 'Alias for taskType. Task type: screen_advanced, batch_quote, batch_score' },
      taskType: { type: 'string', description: 'Task type: screen_advanced, batch_quote, batch_score' },
      params: { type: 'object', description: 'Task parameters' },
      codes: { type: 'array', items: { type: 'string' }, description: 'Stock codes for batch tasks' },
      symbols: { type: 'array', items: { type: 'string' }, description: 'Alias for codes' },
      conditions: { type: 'array', items: { type: 'object' }, description: 'Screening conditions for screen_advanced' },
      taskId: { type: 'string', description: 'Task ID (for status/result/cancel)' },
      block: { type: 'boolean', description: 'For submit: wait for completion by default. Set false to return immediately with a taskId.' },
      timeout: { type: 'number', description: 'For blocking submit: maximum wait in ms (default 60000, max 300000).' },
    },
    required: ['action'],
  }

  constructor(private engine: DataTaskEngine | null = null) {}

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.action) return 'action is required. Available: submit, status, result, cancel, list'
    return null
  }

  async call(_id: string, input: Record<string, unknown>): Promise<string> {
    if (!this.engine) {
      return toolError('DataTask engine not configured. Use DataStore(action:"fetch") for persisted fetch queue operations.')
    }

    const action = String(input.action)
    switch (action) {
      case 'submit': {
        const taskType = String(input.taskType ?? input.type ?? '')
        if (!taskType) return toolError('taskType/type required for submit. Available: screen_advanced, batch_quote, batch_score.')
        const params = buildTaskParams(input)
        const task = this.engine.create(taskType, params)
        const block = input.block !== false
        if (block) {
          return await this.waitForTask(task.id, normalizeTimeout(input.timeout))
        }
        return JSON.stringify({
          ok: true,
          action: 'submit',
          taskId: task.id,
          type: task.type,
          status: task.status,
          progress: task.progress,
          createdAt: task.createdAt,
          next: `Use DataTask(action:"status", taskId:"${task.id}") to query progress, then DataTask(action:"result", taskId:"${task.id}") for output.`,
        }, null, 2)
      }
      case 'status': {
        const task = this.engine.get(String(input.taskId ?? ''))
        if (!task) return toolError(`Task not found: ${input.taskId}`)
        return JSON.stringify({
          taskId: task.id,
          type: task.type,
          status: task.status,
          progress: task.progress,
          createdAt: task.createdAt,
          completedAt: task.completedAt,
          error: task.error,
          resultPreview: task.result?.slice(0, 500),
        }, null, 2)
      }
      case 'result': {
        const taskId = String(input.taskId ?? '')
        const task = this.engine.get(taskId)
        if (!task) return toolError(`Task not found: ${input.taskId}`)
        if (task.status === 'pending' || task.status === 'running') {
          return JSON.stringify({ retrieval_status: 'not_ready', taskId, status: task.status, progress: task.progress })
        }
        if (task.status === 'failed') {
          return toolError(`DataTask ${taskId} failed: ${task.error ?? 'unknown error'}`)
        }
        if (task.status === 'cancelled') {
          return toolError(`DataTask ${taskId} was cancelled.`)
        }
        const result = this.engine.getResult(taskId)
        return JSON.stringify({
          retrieval_status: 'success',
          taskId,
          status: task.status,
          result: result ?? '',
        }, null, 2)
      }
      case 'cancel': {
        const taskId = String(input.taskId ?? '')
        const ok = this.engine.cancel(taskId)
        if (!ok) return toolError(`Task not found or not cancellable: ${input.taskId}`)
        return JSON.stringify({ ok: true, action: 'cancel', taskId })
      }
      case 'list': {
        const tasks = this.engine.list()
        return JSON.stringify({
          count: tasks.length,
          tasks: tasks.map((t) => ({
            taskId: t.id,
            type: t.type,
            status: t.status,
            progress: t.progress,
            createdAt: t.createdAt,
            completedAt: t.completedAt,
            error: t.error,
          })),
        }, null, 2)
      }
      default:
        return toolError(`Unknown action: ${action}`)
    }
  }

  private async waitForTask(taskId: string, timeoutMs: number): Promise<string> {
    if (!this.engine) return toolError('DataTask engine not configured.')
    const deadline = Date.now() + timeoutMs
    while (Date.now() <= deadline) {
      const task = this.engine.get(taskId)
      if (!task) return toolError(`Task not found while waiting: ${taskId}`)
      if (task.status === 'completed') {
        return JSON.stringify({
          ok: true,
          retrieval_status: 'success',
          taskId,
          status: task.status,
          progress: task.progress,
          result: this.engine.getResult(taskId) ?? task.result ?? '',
        }, null, 2)
      }
      if (task.status === 'failed') {
        return toolError(`DataTask ${taskId} failed: ${task.error ?? 'unknown error'}`)
      }
      if (task.status === 'cancelled') {
        return toolError(`DataTask ${taskId} was cancelled.`)
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    const task = this.engine.get(taskId)
    return toolError(`DataTask ${taskId} did not complete within ${timeoutMs}ms. Current status: ${task?.status ?? 'unknown'}, progress: ${task?.progress ?? 'unknown'}. The task may still be running; use DataTask(action:"status", taskId:"${taskId}") and DataTask(action:"result", taskId:"${taskId}") later.`)
  }
}

function normalizeTimeout(raw: unknown): number {
  const value = Number(raw ?? 60_000)
  if (!Number.isFinite(value)) return 60_000
  return Math.max(1_000, Math.min(Math.floor(value), 300_000))
}

function buildTaskParams(input: Record<string, unknown>): Record<string, unknown> {
  const explicit = input.params
  if (explicit && typeof explicit === 'object' && !Array.isArray(explicit)) {
    return explicit as Record<string, unknown>
  }
  const params: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (['action', 'taskType', 'type', 'taskId', 'block', 'timeout'].includes(key)) continue
    params[key] = value
  }
  if (!params.codes && Array.isArray(params.symbols)) params.codes = params.symbols
  return params
}
