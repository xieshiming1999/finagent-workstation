import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { NotificationQueue } from './notification-queue'
import { globalApiStats } from './data/resilience'

type DataTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface DataTask {
  id: string
  type: string
  params: Record<string, unknown>
  status: DataTaskStatus
  progress: number
  result?: string
  error?: string
  createdAt: string
  completedAt?: string
}

type DataTaskDeps = {
  getQuote?: (code: string) => Promise<unknown>
  getQuoteBatch?: (codes: string[]) => Promise<unknown[]>
  screenStock?: (input: Record<string, unknown>) => Promise<string>
}

/**
 * DataTaskEngine: background data operations (full-market screening, batch scoring).
 * Matches finagent's data_task_engine.dart.
 * Tasks are persisted to memory/data_tasks/index.json and results to individual files.
 */
export class DataTaskEngine {
  private basePath: string
  private tasks: DataTask[] = []
  private running = false
  notificationQueue: NotificationQueue | null = null

  constructor(basePath: string, private deps: DataTaskDeps = {}) {
    this.basePath = basePath
  }

  private get storagePath(): string { return join(this.basePath, 'memory', 'data_tasks') }
  private get indexPath(): string { return join(this.storagePath, 'index.json') }

  load(): void {
    if (!existsSync(this.indexPath)) return
    try {
      this.tasks = JSON.parse(readFileSync(this.indexPath, 'utf-8'))
    } catch { /* */ }
  }

  save(): void {
    mkdirSync(this.storagePath, { recursive: true })
    writeFileSync(this.indexPath, JSON.stringify(this.tasks, null, 2), 'utf-8')
  }

  list(): DataTask[] { return [...this.tasks] }

  get(id: string): DataTask | undefined { return this.tasks.find((t) => t.id === id) }

  create(type: string, params: Record<string, unknown>): DataTask {
    const task: DataTask = {
      id: `dt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      params,
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString(),
    }
    this.tasks.push(task)
    this.save()
    this.processNext()
    return task
  }

  cancel(id: string): boolean {
    const task = this.tasks.find((t) => t.id === id)
    if (!task || task.status !== 'running' && task.status !== 'pending') return false
    task.status = 'cancelled'
    task.completedAt = new Date().toISOString()
    this.save()
    return true
  }

  getResult(id: string): string | null {
    const resultPath = join(this.storagePath, `${id}.json`)
    if (existsSync(resultPath)) return readFileSync(resultPath, 'utf-8')
    return this.tasks.find((t) => t.id === id)?.result ?? null
  }

  resumePending(): void {
    for (const task of this.tasks) {
      if (task.status === 'running') task.status = 'pending'
    }
    this.save()
    this.processNext()
  }

  private async processNext(): Promise<void> {
    if (this.running) return
    const task = this.tasks.find((t) => t.status === 'pending')
    if (!task) return

    this.running = true
    task.status = 'running'
    this.save()
    const startedAt = Date.now()

    try {
      const result = await this.execute(task)
      task.status = 'completed'
      task.progress = 1
      task.completedAt = new Date().toISOString()

      // Save large results to file
      if (result.length > 10_000) {
        const resultPath = join(this.storagePath, `${task.id}.json`)
        writeFileSync(resultPath, result, 'utf-8')
        task.result = `${result.slice(0, 500)}... (full: ${resultPath})`
      } else {
        task.result = result
      }

      this.notificationQueue?.enqueue('task-notification',
        `DataTask ${task.type} completed: ${task.result?.slice(0, 200)}`, 'next')
    } catch (e) {
      task.status = 'failed'
      task.error = e instanceof Error ? e.message : String(e)
      task.completedAt = new Date().toISOString()
      this.recordFailure(task, Date.now() - startedAt)
    }

    this.save()
    this.running = false
    this.processNext() // Process next in queue
  }

  private async execute(task: DataTask): Promise<string> {
    switch (task.type) {
      case 'screen_advanced': {
        const screenStock = this.deps.screenStock ?? (await import('./tools/data-store-tool-remote')).screenStock
        const result = await screenStock({
          ...task.params,
          gates: task.params.gates ?? task.params.conditions ?? [],
        })
        if (/^(Error:|Validation error:|Stock screener error:)/i.test(result.trim())) {
          throw new Error(result.trim())
        }
        task.progress = 1
        return result
      }

      case 'batch_quote': {
        const dm = this.deps.getQuote
          ? null
          : await import('./data/data-manager')
        const codes = (task.params.codes as string[]) ?? []
        if (codes.length === 0) throw new Error('codes required')
        const results: any[] = []
        const failures: string[] = []
        for (let i = 0; i < codes.length; i++) {
          try {
            const q = await (this.deps.getQuote ?? dm!.getQuote)(codes[i])
            if (q) results.push(q)
          } catch (e) {
            failures.push(`${codes[i]}: ${e instanceof Error ? e.message : String(e)}`)
          }
          task.progress = (i + 1) / codes.length
        }
        if (results.length === 0 && failures.length > 0) {
          throw new Error(`${task.type} returned no rows after ${failures.length} failed code(s): ${failures.slice(0, 3).join('; ')}`)
        }
        return JSON.stringify(results, null, 2)
      }

      case 'batch_score': {
        const dm = this.deps.getQuoteBatch
          ? null
          : await import('./data/data-manager')
        const codes = (task.params.codes as string[]) ?? []
        if (codes.length === 0) throw new Error('codes required')
        const quotes = await (this.deps.getQuoteBatch ?? dm!.getQuoteBatch)(codes)
        if (quotes.length === 0) throw new Error(`batch_score returned no rows for ${codes.length} code(s)`)
        return JSON.stringify(quotes, null, 2)
      }

      default:
        throw new Error(`Unknown task type: ${task.type}`)
    }
  }

  private recordFailure(task: DataTask, durationMs: number): void {
    globalApiStats.record({
      source: 'data_task',
      url: `data_task:${task.type}`,
      status: 0,
      durationMs,
      success: false,
      error: task.error,
      timestamp: new Date().toISOString(),
      tool: 'DataTask',
      action: task.type,
    })
  }
}
