import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const MAX_STASH_ENTRIES = 50

export interface StashEntry {
  input: string
  timestamp: number
}

export class PromptStash {
  private readonly filePath: string
  private entries: StashEntry[] = []

  constructor(basePath: string) {
    this.filePath = join(basePath, 'memory', 'prompt-stash.jsonl')
    this.load()
  }

  push(input: string): void {
    const entry: StashEntry = { input, timestamp: Date.now() }
    this.entries.push(entry)

    if (this.entries.length > MAX_STASH_ENTRIES) {
      this.entries = this.entries.slice(-MAX_STASH_ENTRIES)
      this.rewrite()
    } else {
      const dir = join(this.filePath, '..')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf-8')
    }
  }

  pop(): StashEntry | null {
    if (this.entries.length === 0) return null
    const entry = this.entries.pop()!
    this.rewrite()
    return entry
  }

  remove(index: number): StashEntry | null {
    if (index < 0 || index >= this.entries.length) return null
    const [entry] = this.entries.splice(index, 1)
    this.rewrite()
    return entry
  }

  list(): StashEntry[] {
    return [...this.entries]
  }

  get length(): number {
    return this.entries.length
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const lines = readFileSync(this.filePath, 'utf-8').split('\n').filter(Boolean)
      this.entries = []
      for (const line of lines) {
        try {
          const entry = JSON.parse(line)
          if (entry.input && entry.timestamp) this.entries.push(entry)
        } catch { /* skip malformed */ }
      }
    } catch { /* file doesn't exist or is unreadable */ }
  }

  private rewrite(): void {
    const dir = join(this.filePath, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.filePath, this.entries.map((e) => JSON.stringify(e)).join('\n') + (this.entries.length > 0 ? '\n' : ''), 'utf-8')
  }
}
