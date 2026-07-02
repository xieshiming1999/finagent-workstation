import { existsSync, writeFileSync, readFileSync, mkdirSync, unlinkSync, renameSync } from 'fs'
import { dirname, join } from 'path'

export const MAX_CONCURRENT_BACKGROUND_AGENTS = 5

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed'

export interface BackgroundTask {
  id: string
  description: string
  prompt: string
  toolUseId?: string
  parentSessionId?: string
  sidechainPath?: string
  status: TaskStatus
  result?: string
  error?: string
  outputFilePath?: string
  startTime: number
  endTime?: number
  notified: boolean
  isBackgrounded: boolean
  toolUseCount: number
  estimatedTokens: number
  recentActivities: string[]
}

interface TaskRegistryState {
  version: 1
  nextId: number
  tasks: BackgroundTask[]
}

export class TaskRegistry {
  private tasks = new Map<string, BackgroundTask>()
  private nextId = 1
  private statePath: string | null = null
  basePath: string | null = null

  configure(memoryDir: string): void {
    this.basePath = memoryDir
    this.statePath = join(memoryDir, 'tasks', 'index.json')
    this.load()
  }

  load(): void {
    if (!this.statePath || !existsSync(this.statePath)) return
    try {
      const state = JSON.parse(readFileSync(this.statePath, 'utf-8')) as Partial<TaskRegistryState>
      this.tasks.clear()
      this.nextId = Math.max(1, Number(state.nextId ?? 1))
      for (const raw of state.tasks ?? []) {
        if (!raw?.id) continue
        const task: BackgroundTask = {
          id: String(raw.id),
          description: String(raw.description ?? ''),
          prompt: String(raw.prompt ?? ''),
          toolUseId: raw.toolUseId,
          parentSessionId: raw.parentSessionId,
          sidechainPath: raw.sidechainPath,
          status: raw.status ?? 'pending',
          result: raw.result,
          error: raw.error,
          outputFilePath: raw.outputFilePath,
          startTime: Number(raw.startTime ?? Date.now()),
          endTime: raw.endTime,
          notified: Boolean(raw.notified),
          isBackgrounded: raw.isBackgrounded ?? true,
          toolUseCount: Number(raw.toolUseCount ?? 0),
          estimatedTokens: Number(raw.estimatedTokens ?? 0),
          recentActivities: Array.isArray(raw.recentActivities) ? raw.recentActivities.map(String).slice(-10) : [],
        }
        if (task.status === 'pending' || task.status === 'running') {
          task.status = 'failed'
          task.error = task.error ?? 'Interrupted by application restart before completion'
          task.endTime = task.endTime ?? Date.now()
        }
        this.tasks.set(task.id, task)
        const numeric = Number(task.id.match(/^agent-(\d+)$/)?.[1] ?? 0)
        if (numeric >= this.nextId) this.nextId = numeric + 1
      }
      this.save()
    } catch {
      this.tasks.clear()
      this.nextId = 1
    }
  }

  save(): void {
    if (!this.statePath) return
    mkdirSync(dirname(this.statePath), { recursive: true })
    const tmp = `${this.statePath}.tmp`
    const state: TaskRegistryState = {
      version: 1,
      nextId: this.nextId,
      tasks: this.list(),
    }
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
    renameSync(tmp, this.statePath)
  }

  register(opts: {
    description: string
    prompt: string
    toolUseId?: string
    parentSessionId?: string
    sidechainPath?: string
    isBackgrounded?: boolean
  }): BackgroundTask {
    const id = `agent-${this.nextId++}`
    const task: BackgroundTask = {
      id,
      description: opts.description,
      prompt: opts.prompt,
      toolUseId: opts.toolUseId,
      parentSessionId: opts.parentSessionId,
      sidechainPath: opts.sidechainPath,
      status: 'pending',
      startTime: Date.now(),
      notified: false,
      isBackgrounded: opts.isBackgrounded ?? true,
      toolUseCount: 0,
      estimatedTokens: 0,
      recentActivities: [],
    }
    this.tasks.set(id, task)
    this.save()
    return task
  }

  get(id: string): BackgroundTask | undefined { return this.tasks.get(id) }

  list(): BackgroundTask[] { return Array.from(this.tasks.values()) }

  get runningCount(): number {
    return Array.from(this.tasks.values()).filter((t) => t.status === 'running').length
  }

  updateStatus(id: string, status: TaskStatus, opts?: { result?: string; error?: string }): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.status = status
    if (opts?.error) task.error = opts.error

    if (opts?.result) {
      if (opts.result.length > 10_000 && this.basePath) {
        const outputDir = join(this.basePath, '.task_outputs')
        mkdirSync(outputDir, { recursive: true })
        const filePath = join(outputDir, `${id}.txt`)
        writeFileSync(filePath, opts.result, 'utf-8')
        task.outputFilePath = filePath
        task.result = `${opts.result.slice(0, 500)}\n\n... (${opts.result.length} chars, full output at ${filePath})`
      } else {
        task.result = opts.result
      }
    }

    if (status === 'completed' || status === 'failed' || status === 'killed') {
      task.endTime = Date.now()
    }
    this.save()
  }

  readOutput(id: string): string | null {
    const task = this.tasks.get(id)
    if (!task) return null
    if (task.outputFilePath && existsSync(task.outputFilePath)) {
      return readFileSync(task.outputFilePath, 'utf-8')
    }
    return task.result ?? task.error ?? null
  }

  getCompletedUnnotified(): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter((t) =>
      !t.notified && (t.status === 'completed' || t.status === 'failed' || t.status === 'killed')
    )
  }

  markNotified(id: string): void {
    const task = this.tasks.get(id)
    if (task) {
      task.notified = true
      this.save()
    }
  }

  updateProgress(id: string, opts: { toolUseCount?: number; tokens?: number; activity?: string }): void {
    const task = this.tasks.get(id)
    if (!task) return
    if (opts.toolUseCount != null) task.toolUseCount = opts.toolUseCount
    if (opts.tokens != null) task.estimatedTokens = opts.tokens
    if (opts.activity) {
      task.recentActivities.push(opts.activity)
      if (task.recentActivities.length > 10) task.recentActivities.shift()
    }
    this.save()
  }

  remove(id: string): void {
    const task = this.tasks.get(id)
    if (task?.outputFilePath) {
      try { unlinkSync(task.outputFilePath) } catch { /* */ }
    }
    this.tasks.delete(id)
    this.save()
  }

  removeCompleted(): void {
    for (const [id, task] of this.tasks) {
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'killed') {
        this.remove(id)
      }
    }
  }
}
