import { existsSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import type { Tool, ToolContext } from '../tool'
import { resolveToolPath } from './path-resolver'

export class GlobTool implements Tool {
  name = 'Glob'
  description = 'Find files matching a glob pattern, sorted by modification time (most recent first).'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.tsx")' },
      path: { type: 'string', description: 'Search directory (default: working directory)' },
    },
    required: ['pattern'],
  }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.pattern || String(input.pattern).trim() === '') return 'pattern is required'
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const { glob } = await import('fs/promises')
    const pattern = String(input.pattern)
    const cwd = resolveToolPath(String(input.path ?? input.cwd ?? '.'), ctx)
    const results: Array<{ path: string; mtime: number }> = []

    for await (const entry of glob(pattern, { cwd })) {
      if (entry.split('/').some((s) => s.startsWith('.'))) continue
      try {
        const fullPath = join(cwd, entry)
        const s = statSync(fullPath)
        if (s.isFile()) {
          results.push({ path: entry, mtime: s.mtimeMs })
        }
      } catch { /* skip */ }
      if (results.length >= 200) break
    }

    if (results.length === 0) return 'No files matched.'

    results.sort((a, b) => b.mtime - a.mtime)
    let output = results.map((r) => r.path).join('\n')
    if (results.length >= 200) output += '\n\n(truncated at 200 results)'
    output += `\n\n${results.length} files matched`
    return output
  }
}
