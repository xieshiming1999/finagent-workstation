import { watch, type FSWatcher } from 'fs'
import { join } from 'path'

type ChangeHandler = (event: string, filename: string) => void

const IGNORE = new Set(['.git', 'node_modules', '.DS_Store', '__pycache__', '.swp', '.swo'])

export class FileWatcher {
  private watchers: Map<string, FSWatcher> = new Map()
  private handlers: ChangeHandler[] = []
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

  onFileChange(handler: ChangeHandler): () => void {
    this.handlers.push(handler)
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler)
    }
  }

  watchDirectory(dir: string): void {
    if (this.watchers.has(dir)) return

    try {
      const watcher = watch(dir, { recursive: true }, (event, filename) => {
        if (!filename) return
        if (IGNORE.has(filename) || filename.split('/').some((s) => IGNORE.has(s))) return

        const key = `${dir}/${filename}`
        const existing = this.debounceTimers.get(key)
        if (existing) clearTimeout(existing)

        this.debounceTimers.set(key, setTimeout(() => {
          this.debounceTimers.delete(key)
          for (const handler of this.handlers) {
            try { handler(event, join(dir, filename)) } catch { /* ignore */ }
          }
        }, 200))
      })

      this.watchers.set(dir, watcher)
    } catch (err) {
      console.error(`Failed to watch ${dir}:`, err)
    }
  }

  unwatchDirectory(dir: string): void {
    const watcher = this.watchers.get(dir)
    if (watcher) {
      watcher.close()
      this.watchers.delete(dir)
    }
  }

  close(): void {
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
    for (const timer of this.debounceTimers.values()) clearTimeout(timer)
    this.debounceTimers.clear()
  }
}
