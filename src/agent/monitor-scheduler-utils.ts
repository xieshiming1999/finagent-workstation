import * as vm from 'vm'

export function extractHttpCalls(code: string): Array<{ path: string; params: Record<string, unknown>; method: string }> {
  const vars = new Map<string, string>()
  for (const match of code.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:(['"])(.*?)\2|`([^`]+)`)/g)) {
    vars.set(match[1], match[3] ?? match[4] ?? '')
  }
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

export async function directFetch(path: string, params: Record<string, unknown>, method: string): Promise<unknown> {
  if (!path.startsWith('http://') && !path.startsWith('https://')) throw new Error(`No bridge router configured for app path: ${path}`)
  let url = path
  const opts: RequestInit = { method, headers: { 'User-Agent': 'FinAgent-Monitor/1.0' } }
  if (method === 'GET' || method === 'DELETE') {
    const qs = new URLSearchParams(stringifyParams(params)).toString()
    if (qs) url += `${url.includes('?') ? '&' : '?'}${qs}`
  } else {
    opts.headers = { ...(opts.headers as Record<string, string>), 'Content-Type': 'application/json' }
    opts.body = JSON.stringify(params)
  }
  const res = await fetch(url, opts)
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`)
  try { return JSON.parse(text) } catch { return { text } }
}

export function cacheKey(method: string, path: string, params: Record<string, unknown>): string {
  return `${method.toUpperCase()}:${path}|${JSON.stringify(params ?? {})}`
}

export function isErrorResponse(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).error === 'string'
}

export function parseMaybeJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return text }
}

function callFromMatch(fnName: string, path: string, rawParams?: string, rawMethod?: string, vars?: Map<string, string>): { path: string; params: Record<string, unknown>; method: string } {
  let method = rawMethod?.toUpperCase() ?? 'GET'
  if (fnName.endsWith('.post')) method = 'POST'
  if (fnName.endsWith('.put')) method = 'PUT'
  if (fnName.endsWith('.delete')) method = 'DELETE'
  const parsed = rawParams ? evalObject(rawParams, vars) : {}
  const params = (fnName.endsWith('.get') || fnName.endsWith('.delete')) && isRecord(parsed.params)
    ? asRecord(parsed.params)
    : parsed
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

function evalObject(raw: string, vars?: Map<string, string>): Record<string, unknown> {
  try {
    const context = vm.createContext({ JSON, ...Object.fromEntries(vars ?? []) })
    const value = vm.runInContext(`(${raw})`, context, { timeout: 1000 })
    return asRecord(value)
  } catch {
    return {}
  }
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
