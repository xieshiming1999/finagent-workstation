import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join, basename } from 'path'

interface IndexEntry {
  sessionId: string
  sessionFile: string
  role: string
  content: string
  timestamp: string
  sessionTitle?: string
}

/**
 * Session search index for full-text search across conversation history.
 * Matching finagent session_index.dart.
 */
export class SessionIndex {
  private entries: IndexEntry[] = []
  private sessionsDir: string
  private indexPath: string
  private dirty = false

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir
    this.indexPath = join(sessionsDir, 'search_index.json')
    this.load()
  }

  private load(): void {
    if (!existsSync(this.indexPath)) return
    try {
      this.entries = JSON.parse(readFileSync(this.indexPath, 'utf-8'))
    } catch { /* */ }
  }

  private save(): void {
    if (!this.dirty) return
    mkdirSync(this.sessionsDir, { recursive: true })
    writeFileSync(this.indexPath, JSON.stringify(this.entries), 'utf-8')
    this.dirty = false
  }

  indexMessage(opts: { sessionId: string; sessionFile: string; role: string; content: string; timestamp?: string; sessionTitle?: string }): void {
    this.entries.push({
      sessionId: opts.sessionId,
      sessionFile: opts.sessionFile,
      role: opts.role,
      content: opts.content.slice(0, 500),
      timestamp: opts.timestamp ?? new Date().toISOString(),
      sessionTitle: opts.sessionTitle,
    })
    this.dirty = true
    // Batch save every 50 entries
    if (this.entries.length % 50 === 0) this.save()
  }

  updateSessionTitle(sessionId: string, title: string): void {
    for (const e of this.entries) {
      if (e.sessionId === sessionId) e.sessionTitle = title
    }
    this.dirty = true
    this.save()
  }

  updateSessionFile(sessionId: string, newFile: string): void {
    for (const e of this.entries) {
      if (e.sessionId === sessionId) e.sessionFile = newFile
    }
    this.dirty = true
    this.save()
  }

  search(query: string, limit = 20): Array<{ sessionId: string; sessionFile: string; role: string; content: string; timestamp: string; sessionTitle?: string }> {
    const lower = query.toLowerCase()
    const results = this.entries
      .filter((e) => e.content.toLowerCase().includes(lower))
      .slice(-limit)
      .reverse()
    return results
  }

  flush(): void { this.save() }
}
