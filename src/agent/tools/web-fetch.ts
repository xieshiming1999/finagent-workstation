import { writeFileSync, mkdirSync } from 'fs'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import type { Tool, ToolContext } from '../tool'
import { toolError } from '../tool'

export class WebFetchTool implements Tool {
  name = 'WebFetch'
  description = 'Fetch web content or download files from a URL. Supports GET/POST with custom headers. Binary files (PDF, images) are saved to disk.'
  isReadOnly = false
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch' },
      method: { type: 'string', description: 'HTTP method: GET (default) or POST', enum: ['GET', 'POST'] },
      headers: { type: 'object', description: 'Custom HTTP headers (key-value pairs)' },
      body: { type: 'string', description: 'Request body for POST (typically JSON string)' },
      outputPath: { type: 'string', description: 'Output path for binary files (optional, auto-generated)' },
      maxLength: { type: 'number', description: 'Max content length (default 50000)' },
    },
    required: ['url'],
  }

  needsPermissions(): boolean { return false }

  validateInput(input: Record<string, unknown>, ctx: ToolContext): string | null {
    if (!input.url) return 'url is required.'
    if (input.outputPath) {
      try {
        resolveOutputPath(String(input.outputPath), ctx.basePath)
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
    }
    return null
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const url = String(input.url)
    const maxLength = Number(input.maxLength ?? 50_000)
    const method = String(input.method ?? 'GET').toUpperCase()
    const customHeaders = (input.headers ?? {}) as Record<string, string>
    const body = input.body ? String(input.body) : undefined

    try {
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...customHeaders,
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)

      let res: Response
      try {
        res = await fetch(url, {
          method,
          headers,
          body: method === 'POST' ? body : undefined,
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        return toolError(`HTTP ${res.status}: ${errText.slice(0, 500)}`)
      }

      const contentType = res.headers.get('content-type') ?? ''

      // Binary content (PDF, images) → save to file
      if (isBinaryContent(contentType, url)) {
        const buffer = Buffer.from(await res.arrayBuffer())
        const rawPath = input.outputPath ? String(input.outputPath) : defaultOutputPath(url, ctx.basePath)
        const outputPath = resolveOutputPath(rawPath, ctx.basePath)
        mkdirSync(dirname(outputPath), { recursive: true })
        writeFileSync(outputPath, buffer)
        return `Downloaded to ${outputPath} (${buffer.length} bytes, ${contentType})`
      }

      // Text content
      let text = await res.text()

      if (contentType.includes('html')) {
        text = htmlToText(text)
      }

      if (text.length > maxLength) {
        text = `${text.slice(0, maxLength)}\n\n[Truncated: ${text.length} total chars, showing first ${maxLength}]`
      }

      const lineCount = text.split('\n').length
      const sizeKb = (text.length / 1024).toFixed(1)
      return `${text}\n\n(${sizeKb}KB, ${lineCount} lines, content-type: ${contentType})`
    } catch (e) {
      return toolError(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

function isBinaryContent(contentType: string, url: string): boolean {
  if (contentType.includes('pdf') || contentType.includes('octet-stream') || contentType.includes('image/')) return true
  const lower = url.toLowerCase()
  return lower.endsWith('.pdf') || lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')
}

function defaultOutputPath(url: string, basePath: string): string {
  try {
    const u = new URL(url)
    const segments = u.pathname.split('/').filter(Boolean)
    let filename = segments.length > 0 ? segments[segments.length - 1] : 'download'
    if (!filename.includes('.')) filename += '.pdf'
    return join(basePath, 'tmp', filename)
  } catch {
    return join(basePath, 'tmp', 'download.bin')
  }
}

function resolveOutputPath(rawPath: string, basePath: string): string {
  const outputPath = resolve(isAbsolute(rawPath) ? rawPath : join(basePath, rawPath))
  const root = resolve(basePath)
  const rel = relative(root, outputPath)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return outputPath
  throw new Error(`outputPath "${outputPath}" is outside the allowed directory "${root}".`)
}

function htmlToText(html: string): string {
  let text = html
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
  text = text.replace(/<[^>]+>/g, '')
  text = text.replace(/&amp;/g, '&')
  text = text.replace(/&lt;/g, '<')
  text = text.replace(/&gt;/g, '>')
  text = text.replace(/&quot;/g, '"')
  text = text.replace(/&#39;/g, "'")
  text = text.replace(/&nbsp;/g, ' ')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}
