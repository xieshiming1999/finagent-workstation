import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface TaskItem {
  id: string
  subject: string
  description: string
  status: 'pending' | 'in_progress' | 'completed'
  owner?: string
  blockedBy: string[]
  blocks: string[]
  activeForm?: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/**
 * Persistent task store (matching finagent task_store.dart).
 * Tasks survive session clears and compaction.
 */
export class TaskStore {
  private tasks = new Map<string, TaskItem>()
  private filePath = ''

  load(basePath: string): void {
    this.filePath = join(basePath, 'memory', 'tasks.json')
    if (!existsSync(this.filePath)) return
    try {
      const list = JSON.parse(readFileSync(this.filePath, 'utf-8')) as TaskItem[]
      for (const t of list) this.tasks.set(t.id, t)
    } catch { /* */ }
  }

  save(): void {
    if (!this.filePath) return
    mkdirSync(join(this.filePath, '..'), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(Array.from(this.tasks.values()), null, 2), 'utf-8')
  }

  get(id: string): TaskItem | undefined { return this.tasks.get(id) }

  list(): TaskItem[] { return Array.from(this.tasks.values()) }

  add(task: TaskItem): void { this.tasks.set(task.id, task); this.save() }

  update(id: string, updater: (t: TaskItem) => void): void {
    const t = this.tasks.get(id)
    if (t) { updater(t); t.updatedAt = new Date().toISOString(); this.save() }
  }

  remove(id: string): void { this.tasks.delete(id); this.save() }

  removeCompleted(): void {
    for (const [id, t] of this.tasks) {
      if (t.status === 'completed') this.tasks.delete(id)
    }
    this.save()
  }
}
