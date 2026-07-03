import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Tool, ToolContext } from '../tool'
import { SessionIndex } from '../session-index'

let sessionIndex: SessionIndex | null = null

export function setSessionIndex(index: SessionIndex) {
  sessionIndex = index
}

export class SessionSearchTool implements Tool {
  name = 'SessionSearch'
  description = 'Search across conversation history for past discussions, decisions, and file references.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Max results (default: 10)' },
    },
    required: ['query'],
  }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.query) return 'query is required.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const query = String(input.query)
    const limit = Number(input.limit ?? 10)

    // Use SessionIndex if available (indexed search)
    if (sessionIndex) {
      const results = sessionIndex.search(query, limit)
      if (results.length === 0) return `No matches for "${query}" in session history.`
      return results.map((r, i) =>
        `${i + 1}. [${r.sessionTitle ?? r.sessionId}] ${r.role}: ${r.content}`
      ).join('\n\n')
    }

    // Fallback: brute-force JSONL scan
    const historyDir = join(ctx.basePath, 'sessions/history')
    if (!existsSync(historyDir)) return 'No session history found.'

    const files = readdirSync(historyDir).filter((f) => f.endsWith('.jsonl')).sort().reverse()
    const results: Array<{ file: string; line: string }> = []
    const lower = query.toLowerCase()

    for (const file of files.slice(0, 50)) {
      try {
        const content = readFileSync(join(historyDir, file), 'utf-8')
        for (const line of content.split('\n')) {
          if (!line.trim() || !line.toLowerCase().includes(lower)) continue
          try {
            const entry = JSON.parse(line)
            if (entry.type === 'message' && entry.content) {
              results.push({ file: file.replace('.jsonl', ''), line: String(entry.content).slice(0, 200) })
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
      if (results.length >= limit * 3) break
    }

    if (results.length === 0) return `No matches for "${query}" in session history.`
    return results.slice(0, limit).map((r, i) => `${i + 1}. [${r.file}] ${r.line}`).join('\n\n')
  }
}
