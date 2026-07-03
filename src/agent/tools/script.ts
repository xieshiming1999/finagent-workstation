import * as vm from 'vm'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { dirname, join, resolve } from 'path'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'

export class ScriptTool implements Tool {
  name = 'Script'
  description = 'Execute JavaScript in a sandbox with the unified Bridge API. HTTP calls are pre-fetched and then returned synchronously, matching the mobile FinAgent Script contract.'
  isReadOnly = false
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript code. Use Bridge.callService, Bridge.fetch/get/post/put/delete, or callService for HTTP; do not use fetch/XMLHttpRequest.' },
    },
    required: ['code'],
  }

  validateInput(input: Record<string, unknown>): string | null {
    if (!String(input.code ?? '').trim()) return 'code is required.'
    return null
  }

  needsPermissions(): boolean { return true }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const code = String(input.code)
    const start = Date.now()
    const logs: string[] = []
    const sideEffects = { notifications: [] as Array<Record<string, unknown>>, agentMessages: [] as Array<Record<string, unknown>> }

    try {
      const fetchCache = await prefetchHttpCalls(code, ctx)
      const bridge = createBridge(ctx, fetchCache, logs, sideEffects)
      const context = vm.createContext({
        Bridge: bridge,
        callService: bridge.callService,
        readFile: bridge.readFile,
        writeFile: bridge.writeFile,
        listDir: bridge.listDir,
        fileExists: bridge.fileExists,
        fileStat: bridge.fileStat,
        parseCSV: bridge.parseCSV,
        toCSV: bridge.toCSV,
        sum: bridge.sum,
        avg: bridge.avg,
        median: bridge.median,
        groupBy: bridge.groupBy,
        unique: bridge.unique,
        sortBy: bridge.sortBy,
        flatten: bridge.flatten,
        console: {
          log: (...args: unknown[]) => logs.push(formatLog(args)),
          warn: (...args: unknown[]) => logs.push(formatLog(args)),
          error: (...args: unknown[]) => logs.push(formatLog(args)),
        },
        JSON,
        Math,
        Date,
        Number,
        String,
        Boolean,
        Array,
        Object,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        setTimeout: undefined,
        setInterval: undefined,
        fetch: undefined,
        XMLHttpRequest: undefined,
      })

      const result = vm.runInContext(`(function(){\n${code}\n})()`, context, { timeout: 30_000 })
      return JSON.stringify({
        ok: true,
        result,
        logs,
        sideEffects,
        elapsedMs: Date.now() - start,
        prefetched: Object.keys(fetchCache).length,
      }, null, 2)
    } catch (err) {
      return toolError(`SCRIPT_ERROR: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

function createBridge(
  ctx: ToolContext,
  fetchCache: Record<string, unknown>,
  logs: string[],
  sideEffects: { notifications: Array<Record<string, unknown>>; agentMessages: Array<Record<string, unknown>> }
): Record<string, any> {
  const bridge: Record<string, any> = {}

  const callService = (path: string, params?: Record<string, unknown>, method = 'GET') => {
    const key = cacheKey(method, path, params ?? {})
    const cached = fetchCache[key]
    if (isErrorResponse(cached)) throw new Error(`callService("${path}") error: ${String((cached as Record<string, unknown>).error)}`)
    if (cached !== undefined) return cached
    throw new Error(`callService("${path}") not pre-fetched. Keys: ${Object.keys(fetchCache).join(', ')}`)
  }

  bridge.callService = callService
  bridge.fetch = callService
  bridge.get = (path: string, options?: { params?: Record<string, unknown> }) => callService(path, options?.params ?? {}, 'GET')
  bridge.post = (path: string, body?: Record<string, unknown>) => callService(path, body ?? {}, 'POST')
  bridge.put = (path: string, body?: Record<string, unknown>) => callService(path, body ?? {}, 'PUT')
  bridge.delete = (path: string, options?: { params?: Record<string, unknown> }) => callService(path, options?.params ?? {}, 'DELETE')

  bridge.readFile = (path: string) => readFileSync(resolveBridgePath(ctx, path), 'utf-8')
  bridge.writeFile = (path: string, content: string) => {
    const fullPath = resolveBridgePath(ctx, path)
    if (isInside(fullPath, ctx.bundleDir)) throw new Error(`write denied: bundle is read-only (${path})`)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, String(content), 'utf-8')
    return { ok: true, path: fullPath }
  }
  bridge.listDir = (path = '.') => {
    const fullPath = resolveBridgePath(ctx, path)
    return readdirSync(fullPath).map((name) => {
      const stat = statSync(join(fullPath, name))
      return { name, type: stat.isDirectory() ? 'directory' : 'file', size: stat.size, modified: stat.mtime.toISOString() }
    })
  }
  bridge.fileExists = (path: string) => existsSync(resolveBridgePath(ctx, path))
  bridge.fileStat = (path: string) => {
    const stat = statSync(resolveBridgePath(ctx, path))
    return { size: stat.size, type: stat.isDirectory() ? 'directory' : 'file', isFile: stat.isFile(), isDirectory: stat.isDirectory(), modified: stat.mtime.toISOString() }
  }

  bridge.notify = (message: string, severity?: string) => {
    sideEffects.notifications.push({ type: severity === 'alert' ? 'alert' : 'notify', message })
    return { ok: true }
  }
  bridge.alert = (message: string) => {
    sideEffects.notifications.push({ type: 'alert', message })
    return { ok: true }
  }
  bridge.sendToAgent = (message: string, data?: Record<string, unknown>) => {
    sideEffects.agentMessages.push({ message, data: data ?? {} })
    return { ok: true }
  }
  bridge.getConfig = (key: string) => ctx.getConfigValue?.(key) ?? null

  bridge.parseCSV = parseCSV
  bridge.toCSV = toCSV
  bridge.parseXML = parseXML
  bridge.base64Encode = (text: string) => Buffer.from(String(text), 'utf-8').toString('base64')
  bridge.base64Decode = (text: string) => Buffer.from(String(text), 'base64').toString('utf-8')
  bridge.hexEncode = (text: string) => Buffer.from(String(text), 'utf-8').toString('hex')
  bridge.hexDecode = (hex: string) => Buffer.from(String(hex), 'hex').toString('utf-8')
  bridge.hash = (text: string, algo = 'sha256') => createHash(algo).update(String(text)).digest('hex')
  bridge.sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)
  bridge.avg = (arr: number[]) => arr.length ? bridge.sum(arr) / arr.length : 0
  bridge.median = (arr: number[]) => {
    if (!arr.length) return 0
    const sorted = arr.slice().sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }
  bridge.groupBy = (arr: any[], key: string | ((item: any) => string)) => arr.reduce((out, item) => {
    const value = typeof key === 'function' ? key(item) : item[key]
    ;(out[value] ||= []).push(item)
    return out
  }, {} as Record<string, unknown[]>)
  bridge.unique = (arr: unknown[]) => Array.from(new Set(arr.map((v) => typeof v === 'object' ? JSON.stringify(v) : String(v)))).map((v) => {
    try { return JSON.parse(v) } catch { return v }
  })
  bridge.sortBy = (arr: any[], key: string | ((item: any) => unknown), desc?: boolean) => arr.slice().sort((a, b) => {
    const av = typeof key === 'function' ? key(a) : a[key]
    const bv = typeof key === 'function' ? key(b) : b[key]
    if (av < bv) return desc ? 1 : -1
    if (av > bv) return desc ? -1 : 1
    return 0
  })
  bridge.flatten = (arr: unknown[]): unknown[] => arr.reduce<unknown[]>((out, item) => out.concat(Array.isArray(item) ? bridge.flatten(item) : item), [])
  bridge.consoleLog = (...args: unknown[]) => logs.push(formatLog(args))

  return bridge
}

async function prefetchHttpCalls(code: string, ctx: ToolContext): Promise<Record<string, unknown>> {
  const calls = extractHttpCalls(code)
  const cache: Record<string, unknown> = {}
  await Promise.all(calls.map(async (call) => {
    const key = cacheKey(call.method, call.path, call.params)
    if (key in cache) return
    try {
      cache[key] = ctx.bridgeRequest
        ? await ctx.bridgeRequest(call.path, call.params, call.method)
        : await directFetch(call.path, call.params, call.method)
    } catch (err) {
      cache[key] = { error: err instanceof Error ? err.message : String(err) }
    }
  }))
  return cache
}

function extractHttpCalls(code: string): Array<{ path: string; params: Record<string, unknown>; method: string }> {
  const vars = extractStringVars(code)
  const calls: Array<{ path: string; params: Record<string, unknown>; method: string }> = []
  const pattern = /(callService|Bridge\.(?:callService|fetch|get|post|put|delete))\s*\(/g
  for (const match of code.matchAll(pattern)) {
    const parsed = parseCallArgs(code, match.index + match[0].length)
    if (!parsed) continue
    const path = parseStringLiteral(parsed.args[0]) ?? vars.get(parsed.args[0]?.trim() ?? '')
    if (!path) continue
    calls.push(callFromMatch(match[1], path, parsed.args[1], parseStringLiteral(parsed.args[2]) ?? undefined, vars))
  }

  return calls
}

function callFromMatch(fnName: string, path: string, rawParams?: string, rawMethod?: string, vars?: Map<string, string>): { path: string; params: Record<string, unknown>; method: string } {
  let method = rawMethod?.toUpperCase() ?? 'GET'
  if (fnName.endsWith('.post')) method = 'POST'
  if (fnName.endsWith('.put')) method = 'PUT'
  if (fnName.endsWith('.delete')) method = 'DELETE'
  const parsed = rawParams ? evalObject(rawParams, vars) : {}
  const params = (fnName.endsWith('.get') || fnName.endsWith('.delete')) && isRecord(parsed.params)
    ? asRecord(parsed.params)
    : asRecord(parsed)
  return { path, params, method }
}

function parseCallArgs(code: string, start: number): { args: string[]; end: number } | null {
  const args: string[] = []
  let current = ''
  let depth = 0
  let quote: string | null = null
  let escaped = false
  for (let i = start; i < code.length; i++) {
    const ch = code[i]
    if (quote) {
      current += ch
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      current += ch
      continue
    }
    if (ch === '{' || ch === '[' || ch === '(') {
      depth++
      current += ch
      continue
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      if (depth === 0 && ch === ')') {
        if (current.trim()) args.push(current.trim())
        return { args, end: i }
      }
      depth--
      current += ch
      continue
    }
    if (ch === ',' && depth === 0) {
      args.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  return null
}

function parseStringLiteral(raw: string | undefined): string | null {
  if (!raw) return null
  const text = raw.trim()
  const quote = text[0]
  if ((quote !== '"' && quote !== "'" && quote !== '`') || text[text.length - 1] !== quote) return null
  return text.slice(1, -1)
}

function extractStringVars(code: string): Map<string, string> {
  const vars = new Map<string, string>()
  const pattern = /(?:const|let|var)\s+(\w+)\s*=\s*(?:(['"])(.*?)\2|`([^`]+)`)/g
  for (const match of code.matchAll(pattern)) vars.set(match[1], match[3] ?? match[4] ?? '')
  return vars
}

function evalObject(raw: string, vars?: Map<string, string>): Record<string, unknown> {
  try {
    const sandbox = vm.createContext({ JSON, ...Object.fromEntries(vars ?? []) })
    const value = vm.runInContext(`(${raw})`, sandbox, { timeout: 1000 })
    return asRecord(value)
  } catch {
    return {}
  }
}

async function directFetch(path: string, params: Record<string, unknown>, method: string): Promise<unknown> {
  if (!path.startsWith('http://') && !path.startsWith('https://')) throw new Error(`No bridge router configured for app path: ${path}`)
  let url = path
  const opts: RequestInit = { method, headers: { 'User-Agent': 'FinAgent-Script/1.0' } }
  if (method === 'GET' || method === 'DELETE') {
    const qs = new URLSearchParams(stringifyParams(params)).toString()
    if (qs) url += `${url.includes('?') ? '&' : '?'}${qs}`
  } else {
    opts.headers = { ...opts.headers as Record<string, string>, 'Content-Type': 'application/json' }
    opts.body = JSON.stringify(params)
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`)
    try { return JSON.parse(text) } catch { return { text } }
  } finally {
    clearTimeout(timeout)
  }
}

function resolveBridgePath(ctx: ToolContext, rawPath: string): string {
  return rawPath.startsWith('/') ? resolve(rawPath) : resolve(ctx.basePath, rawPath)
}

function isInside(filePath: string, dirPath: string): boolean {
  const file = resolve(filePath)
  const dir = resolve(dirPath)
  return file === dir || file.startsWith(`${dir}/`)
}

function cacheKey(method: string, path: string, params: Record<string, unknown>): string {
  return `${method.toUpperCase()}:${path}|${JSON.stringify(params ?? {})}`
}

function isErrorResponse(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).error === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function stringifyParams(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) out[key] = String(value)
  return out
}

function formatLog(args: unknown[]): string {
  return args.map((arg) => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ')
}

function parseCSV(text: string, sep = ','): string[][] {
  return String(text).split('\n').filter((line) => line.trim()).map((line) => line.split(sep).map((v) => v.trim()))
}

function toCSV(rows: unknown[][], sep = ','): string {
  return rows.map((row) => row.map((cell) => {
    const value = String(cell)
    return value.includes(sep) || value.includes('"') || value.includes('\n') ? `"${value.replace(/"/g, '""')}"` : value
  }).join(sep)).join('\n')
}

function parseXML(text: string): Record<string, unknown> {
  const trimmed = String(text).trim()
  const tagMatch = trimmed.match(/^<([\w:-]+)([^>]*)>([\s\S]*)<\/\1>$/)
  if (!tagMatch) return { text: trimmed }
  const attrs: Record<string, string> = {}
  for (const attr of tagMatch[2].matchAll(/([\w:-]+)=["']([^"']*)["']/g)) attrs[attr[1]] = attr[2]
  return { tag: tagMatch[1], attrs, text: tagMatch[3].replace(/<[^>]+>/g, '').trim() }
}
