import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'
import { resolveToolPath } from './path-resolver'

const SKIP_DIRS = new Set(['.git', '.svn', '.hg', 'node_modules', '__pycache__', '.bzr'])
const DEFAULT_HEAD_LIMIT = 250

export class GrepTool implements Tool {
  name = 'Grep'
  description = 'Search for a regex pattern in files. Supports content, files_with_matches, and count modes with context lines.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'Directory or file to search (default: working dir)' },
      glob: { type: 'string', description: 'Glob pattern to filter files (e.g. "*.ts")' },
      output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'], description: 'Output mode (default: files_with_matches)' },
      '-i': { type: 'boolean', description: 'Case insensitive search' },
      '-n': { type: 'boolean', description: 'Show line numbers (default true, content mode only)' },
      '-B': { type: 'number', description: 'Lines of context before each match' },
      '-A': { type: 'number', description: 'Lines of context after each match' },
      '-C': { type: 'number', description: 'Lines of context before and after each match' },
      head_limit: { type: 'number', description: 'Limit output entries (default 250, 0 for unlimited)' },
    },
    required: ['pattern'],
  }

  validateInput(input: Record<string, unknown>): string | null {
    if (!input.pattern || String(input.pattern).trim() === '') return 'pattern is required.'
    try { new RegExp(String(input.pattern)) } catch (e) {
      return `Invalid regex: ${e instanceof Error ? e.message : String(e)}`
    }
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const pattern = String(input.pattern)
    const searchPath = input.path ? resolveToolPath(String(input.path), ctx) : resolveToolPath('.', ctx)
    const globFilter = input.glob ? String(input.glob) : undefined
    const outputMode = String(input.output_mode ?? input.mode ?? 'files_with_matches')
    const caseInsensitive = Boolean(input['-i'] ?? false)
    const showLineNumbers = input['-n'] !== false
    const contextLines = input['-C'] != null ? Number(input['-C']) : undefined
    const beforeCtx = contextLines ?? (input['-B'] != null ? Number(input['-B']) : 0)
    const afterCtx = contextLines ?? (input['-A'] != null ? Number(input['-A']) : 0)
    const headLimit = Number(input.head_limit ?? DEFAULT_HEAD_LIMIT)

    try {
      const regex = new RegExp(pattern, caseInsensitive ? 'i' : '')
      const files = collectFiles(searchPath, globFilter)
      switch (outputMode) {
        case 'content':
          return searchContent(files, regex, ctx.basePath, { showLineNumbers, beforeCtx, afterCtx, headLimit })
        case 'count':
          return searchCount(files, regex, ctx.basePath, headLimit)
        case 'files_with_matches':
        default:
          return searchFilesWithMatches(files, regex, ctx.basePath, headLimit)
      }
    } catch (e) {
      return toolError(`Grep failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

function collectFiles(searchPath: string, globFilter?: string): string[] {
  if (!existsSync(searchPath)) return []
  const stat = statSync(searchPath)
  if (stat.isFile()) return [searchPath]

  const files: string[] = []
  const walk = (dir: string) => {
    let entries: string[]
    try { entries = readdirSync(dir).sort() } catch { return }
    for (const name of entries) {
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue
      const fullPath = join(dir, name)
      try {
        const s = statSync(fullPath)
        if (s.isDirectory()) walk(fullPath)
        else if (s.isFile()) {
          if (globFilter && !matchGlob(name, relative(searchPath, fullPath), globFilter)) continue
          if (s.size > 512 * 1024) continue
          // Binary check
          try {
            const buf = Buffer.alloc(512)
            const fd = require('fs').openSync(fullPath, 'r')
            const bytesRead = require('fs').readSync(fd, buf, 0, 512, 0)
            require('fs').closeSync(fd)
            if (buf.slice(0, bytesRead).includes(0)) continue
          } catch { continue }
          files.push(fullPath)
        }
      } catch { /* skip */ }
    }
  }
  walk(searchPath)
  return files
}

function searchFilesWithMatches(files: string[], regex: RegExp, basePath: string, headLimit: number): string {
  const matches: Array<{ path: string; mtime: number }> = []

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8')
      if (regex.test(content)) {
        matches.push({ path: file, mtime: statSync(file).mtimeMs })
      }
    } catch { /* skip */ }
  }

  if (matches.length === 0) return 'No matches found.'

  matches.sort((a, b) => b.mtime - a.mtime)
  const limit = headLimit === 0 ? matches.length : headLimit
  const shown = matches.slice(0, limit)
  const filenames = shown.map((m) => toRelPath(m.path, basePath))

  let output = `Found ${matches.length} file(s)\n${filenames.join('\n')}`
  if (matches.length > limit) output += `\n\n(Showing ${limit} of ${matches.length} matching files)`
  return output
}

function searchContent(files: string[], regex: RegExp, basePath: string, opts: { showLineNumbers: boolean; beforeCtx: number; afterCtx: number; headLimit: number }): string {
  const outputLines: string[] = []
  let lineCount = 0
  let matchCount = 0
  let fileMatchCount = 0
  const limit = opts.headLimit === 0 ? -1 : opts.headLimit

  for (const file of files) {
    if (limit > 0 && lineCount >= limit) break
    try {
      const content = readFileSync(file, 'utf-8')
      const lines = content.split('\n')
      const rel = toRelPath(file, basePath)

      const matchingIndices: number[] = []
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) matchingIndices.push(i)
      }
      if (matchingIndices.length === 0) continue

      matchCount += matchingIndices.length
      fileMatchCount++

      const linesToShow = new Set<number>()
      for (const idx of matchingIndices) {
        const start = Math.max(0, idx - opts.beforeCtx)
        const end = Math.min(lines.length - 1, idx + opts.afterCtx)
        for (let i = start; i <= end; i++) linesToShow.add(i)
      }

      const sorted = [...linesToShow].sort((a, b) => a - b)
      let prevLine = -2
      for (const idx of sorted) {
        if (limit > 0 && lineCount >= limit) break
        if (prevLine >= 0 && idx > prevLine + 1) { outputLines.push('--'); lineCount++ }
        const lineNum = idx + 1
        outputLines.push(opts.showLineNumbers ? `${rel}:${lineNum}:${lines[idx]}` : `${rel}:${lines[idx]}`)
        lineCount++
        prevLine = idx
      }
    } catch { /* skip */ }
  }

  if (outputLines.length === 0) return 'No matches found.'
  const truncated = limit > 0 && lineCount >= limit
  return outputLines.join('\n') + `\n\n(${matchCount} matches across ${fileMatchCount} files${truncated ? `, output truncated at ${limit} lines` : ''})`
}

function searchCount(files: string[], regex: RegExp, basePath: string, headLimit: number): string {
  const counts: Array<{ file: string; count: number }> = []
  let total = 0
  const limit = headLimit === 0 ? -1 : headLimit

  for (const file of files) {
    if (limit > 0 && counts.length >= limit) break
    try {
      const content = readFileSync(file, 'utf-8')
      const matches = content.match(new RegExp(regex.source, regex.flags + 'g'))
      if (matches && matches.length > 0) {
        counts.push({ file: toRelPath(file, basePath), count: matches.length })
        total += matches.length
      }
    } catch { /* skip */ }
  }

  if (counts.length === 0) return 'No matches found.'
  return counts.map((c) => `${c.file}:${c.count}`).join('\n') + `\n\nFound ${total} total match(es) across ${counts.length} file(s).`
}

function toRelPath(filePath: string, basePath: string): string {
  return relative(basePath, filePath)
}

function matchGlob(filename: string, relativePath: string, glob: string): boolean {
  const pattern = glob.replace(/\./g, '\\.').replace(/\*\*/g, '{{DOUBLESTAR}}').replace(/\*/g, '[^/]*').replace(/\{\{DOUBLESTAR\}\}/g, '.*')
  return new RegExp(`^${pattern}$`).test(filename) || new RegExp(`^${pattern}$`).test(relativePath)
}
