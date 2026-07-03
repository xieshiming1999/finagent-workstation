import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export class ServiceCallTool implements Tool {
  name = 'ServiceCall'
  description = 'Call an app service/API endpoint through the same Bridge router used by dashboards. Supports /api/... paths and absolute HTTP URLs; large responses are saved under memory/data.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: 'HTTP method, default GET' },
      path: { type: 'string', description: 'Relative service path such as /api/finance/quote, or an absolute http(s) URL' },
      params: { type: 'object', description: 'Query/body parameters' },
      headers: { type: 'object', description: 'Optional HTTP headers for absolute requests' },
    },
    required: ['path'],
  }

  validateInput(input: Record<string, unknown>): string | null {
    const path = String(input.path ?? '').trim()
    if (!path) return 'path is required.'
    if (!path.startsWith('/') && !path.startsWith('http://') && !path.startsWith('https://')) {
      return 'path must start with / for app APIs, or with http:// / https:// for direct requests.'
    }
    const method = String(input.method ?? 'GET').toUpperCase()
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) return 'method must be GET, POST, PUT, or DELETE.'
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const method = String(input.method ?? 'GET').toUpperCase() as HttpMethod
    const path = String(input.path)
    const params = asRecord(input.params)
    const headers = asStringRecord(input.headers)

    try {
      const response = ctx.bridgeRequest
        ? await ctx.bridgeRequest(path, params, method, headers)
        : await directFetch(path, params, method, headers)

      if (isErrorResponse(response)) {
        return toolError(`SERVICE_CALL_ERROR: ${String((response as Record<string, unknown>).error)}`)
      }

      return persistLargeResponse(ctx, path, method, response)
    } catch (err) {
      return toolError(`SERVICE_CALL_ERROR: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function directFetch(path: string, params: Record<string, unknown>, method: HttpMethod, headers: Record<string, string>): Promise<unknown> {
  if (!path.startsWith('http://') && !path.startsWith('https://')) {
    throw new Error(`No bridge router configured for app path: ${path}`)
  }
  let url = path
  const requestHeaders: Record<string, string> = {
    'User-Agent': 'FinAgent-ServiceCall/1.0',
    ...headers,
  }
  const opts: RequestInit = { method, headers: requestHeaders }
  if (method === 'GET' || method === 'DELETE') {
    const qs = new URLSearchParams(stringifyParams(params)).toString()
    if (qs) url += `${url.includes('?') ? '&' : '?'}${qs}`
  } else {
    opts.headers = { ...requestHeaders, 'Content-Type': requestHeaders['Content-Type'] ?? 'application/json' }
    opts.body = JSON.stringify(params)
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`)
    return parseResponseText(text, res.headers.get('content-type') ?? '')
  } finally {
    clearTimeout(timeout)
  }
}

function persistLargeResponse(ctx: ToolContext, path: string, method: string, response: unknown): string {
  const data = response && typeof response === 'object' && !Array.isArray(response)
    ? (response as Record<string, unknown>).data
    : undefined
  if (Array.isArray(data) && data.length > 50) {
    const outPath = outputPath(ctx, path, 'jsonl')
    writeRows(outPath, data)
    return JSON.stringify({
      ok: true,
      method,
      path,
      summary: `Large data array saved to ${outPath}`,
      rows: data.length,
      file: outPath,
      sample: data.slice(0, 5),
      note: 'Use Read on the saved file or DataProcess for deeper analysis.',
    }, null, 2)
  }

  if (typeof response === 'string' && response.length > 10_000) {
    const outPath = outputPath(ctx, path, 'txt')
    mkdirSync(join(ctx.memoryDir, 'data'), { recursive: true })
    writeFileSync(outPath, response, 'utf-8')
    return JSON.stringify({
      ok: true,
      method,
      path,
      summary: `Large text response saved to ${outPath}`,
      chars: response.length,
      file: outPath,
      preview: response.slice(0, 1000),
    }, null, 2)
  }

  return typeof response === 'string' ? response : JSON.stringify(response, null, 2)
}

function outputPath(ctx: ToolContext, path: string, ext: string): string {
  const safe = path.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'service_call'
  const file = `${Date.now()}_${safe}.${ext}`
  return join(ctx.memoryDir, 'data', file)
}

function writeRows(path: string, rows: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n'), 'utf-8')
}

function isErrorResponse(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).error === 'string'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asStringRecord(value: unknown): Record<string, string> {
  const raw = asRecord(value)
  const out: Record<string, string> = {}
  for (const [key, val] of Object.entries(raw)) out[key] = String(val)
  return out
}

function stringifyParams(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) out[key] = String(value)
  return out
}

function parseResponseText(text: string, contentType: string): unknown {
  if (contentType.includes('json')) {
    try { return JSON.parse(text) } catch { return { text } }
  }
  try { return JSON.parse(text) } catch { return text }
}
