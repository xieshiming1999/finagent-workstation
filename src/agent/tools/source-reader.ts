import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { Tool, ToolContext } from '../tool'

export class SourceReaderTool implements Tool {
  name = 'SourceReader'
  description = 'Read a source URL or local file, extract basic text metadata, hash the content, and persist source evidence.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['help', 'read'] },
      url: { type: 'string' },
      path: { type: 'string' },
      source: { type: 'string' },
      topic: { type: 'string' },
    },
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'help').trim()
    if (action === 'help') return JSON.stringify(help())
    if (action !== 'read') {
      throw new Error(`Invalid SourceReader action "${action}". Use action="help" for supported actions.`)
    }
    const url = optionalString(input.url)
    const path = optionalString(input.path)
    if ((!url && !path) || (url && path)) {
      throw new Error('SourceReader(action:"read") requires exactly one of url or path.')
    }
    const content = path ? readPath(path) : await readUrl(url!)
    const hash = createHash('sha256').update(content.body).digest('hex')
    const record = {
      contract: 'source-evidence-record-v1',
      id: `source:${hash}`,
      url,
      path,
      source: optionalString(input.source) ?? sourceFrom(url, path),
      topic: optionalString(input.topic) ?? 'unknown',
      title: title(content.body),
      publishedAt: date(content.body),
      contentType: content.contentType,
      hash,
      bytes: Buffer.byteLength(content.body),
      excerpt: truncate(plainText(content.body), 800),
      storedAt: new Date().toISOString(),
    }
    const file = join(ctx.memoryDir || join(ctx.basePath, 'memory'), 'source_evidence', `${hash}.json`)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
    return JSON.stringify({
      contract: 'source-reader-result-v1',
      record,
      artifactHint: {
        kind: 'research',
        path: file,
        title: record.title,
        source: record.source,
        provenance: {
          sourceHash: hash,
          url,
          path,
          topic: record.topic,
        },
      },
    })
  }
}

function help(): Record<string, unknown> {
  return {
    contract: 'source-reader-help-v1',
    actions: ['read'],
    required: 'Exactly one of url or path.',
    stores: 'memory/source_evidence/<sha256>.json',
    guidance: 'SourceReader records title/date/hash/excerpt as evidence. Use ArtifactRegistry to register reusable source evidence before citing it in analysis.',
  }
}

function readPath(path: string): { body: string, contentType: string } {
  if (!existsSync(path)) throw new Error(`file not found: ${path}`)
  return { body: readFileSync(path, 'utf8'), contentType: 'text/plain' }
}

async function readUrl(url: string): Promise<{ body: string, contentType: string }> {
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return {
    body: await response.text(),
    contentType: response.headers.get('content-type') ?? 'text/plain',
  }
}

function sourceFrom(url?: string, path?: string): string {
  if (url) {
    try { return new URL(url).host } catch { return 'web' }
  }
  return path ?? 'local-file'
}

function title(body: string): string {
  const html = /<title[^>]*>(.*?)<\/title>/is.exec(body)?.[1]
  if (html?.trim()) return plainText(html)
  return plainText(body).split('\n').find((line) => line.trim())?.trim() || 'Untitled source'
}

function date(body: string): string | null {
  return /\b20\d{2}-\d{2}-\d{2}\b/.exec(body)?.[0] ?? null
}

function plainText(value: string): string {
  return value
    .replace(/<script[^>]*>.*?<\/script>/gis, ' ')
    .replace(/<style[^>]*>.*?<\/style>/gis, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`
}

function optionalString(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  return text || undefined
}
