import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

let logDir = ''
let logFile = ''

export function initLogger(basePath: string): void {
  logDir = join(basePath, 'logs')
  mkdirSync(logDir, { recursive: true })
  const date = new Date().toISOString().split('T')[0]
  logFile = join(logDir, `${date}.log`)

  const originalLog = console.log
  const originalError = console.error
  const originalWarn = console.warn

  console.log = (...args: unknown[]) => {
    originalLog(...args)
    appendToLog('INFO', args)
  }

  console.error = (...args: unknown[]) => {
    originalError(...args)
    appendToLog('ERROR', args)
  }

  console.warn = (...args: unknown[]) => {
    originalWarn(...args)
    appendToLog('WARN', args)
  }

  appendToLog('INFO', ['Logger initialized', basePath])
}

function appendToLog(level: string, args: unknown[]): void {
  if (!logFile) return
  try {
    const ts = new Date().toISOString()
    const msg = args.map((a) => typeof a === 'string' ? a : JSON.stringify(a, null, 0)?.slice(0, 500) ?? String(a)).join(' ')
    appendFileSync(logFile, `[${ts}] [${level}] ${msg}\n`)
  } catch { /* silent */ }
}

export interface LogSnapshot {
  path: string
  content: string
  files: Array<{ name: string; path: string; size: number; modified: string }>
  truncated: boolean
}

export function readRecentLog(maxBytes = 200_000): LogSnapshot {
  if (!logFile) return { path: '', content: '', files: [], truncated: false }
  try {
    const content = readFileSync(logFile, 'utf-8')
    return {
      path: logFile,
      content: content.length > maxBytes ? content.slice(content.length - maxBytes) : content,
      files: [fileInfo(logFile)],
      truncated: content.length > maxBytes,
    }
  } catch {
    return { path: logFile, content: '', files: [], truncated: false }
  }
}

export function readAllLogs(maxBytes = 2_000_000): LogSnapshot {
  if (!logDir) return { path: '', content: '', files: [], truncated: false }
  try {
    const files = readdirSync(logDir)
      .filter((name) => name.endsWith('.log'))
      .map((name) => fileInfo(join(logDir, name)))
      .sort((a, b) => a.name.localeCompare(b.name))

    const sections = files.map((file) => {
      let content = ''
      try { content = readFileSync(file.path, 'utf-8') } catch { /* ignore */ }
      return `===== ${file.name} =====\n${content.trimEnd()}\n`
    })
    const combined = sections.join('\n')
    const truncated = combined.length > maxBytes
    return {
      path: logDir,
      content: truncated
        ? `[showing last ${maxBytes} bytes across ${files.length} log files]\n` + combined.slice(combined.length - maxBytes)
        : combined,
      files,
      truncated,
    }
  } catch {
    return { path: logDir, content: '', files: [], truncated: false }
  }
}

function fileInfo(path: string): { name: string; path: string; size: number; modified: string } {
  const stat = statSync(path)
  return {
    name: path.split('/').pop() ?? path,
    path,
    size: stat.size,
    modified: stat.mtime.toISOString(),
  }
}
