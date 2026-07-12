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
      action: { type: 'string', enum: ['help', 'read', 'macroEvidence', 'macroNumericEvidence'] },
      url: { type: 'string' },
      path: { type: 'string' },
      source: { type: 'string' },
      topic: { type: 'string' },
      sourceRecordPath: { type: 'string' },
      sourceHash: { type: 'string' },
      title: { type: 'string' },
      sourceDate: { type: 'string' },
      region: { type: 'string' },
      assetClass: { type: 'string' },
      keyClaims: { type: 'array', items: { type: 'string' } },
      affectedAssets: { type: 'array', items: { type: 'string' } },
      confidenceEffect: { type: 'string' },
      freshness: { type: 'string' },
      evidenceClass: { type: 'string' },
      missingEvidence: { type: 'array', items: { type: 'string' } },
      numericSeriesRow: { type: 'object' },
      seriesId: { type: 'string' },
      metricName: { type: 'string' },
      value: {},
      unit: { type: 'string' },
      frequency: { type: 'string' },
      sourceDataTime: { type: 'string' },
      fetchedAt: { type: 'string' },
      provider: { type: 'string' },
      status: { type: 'string' },
    },
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'help').trim()
    if (action === 'help') return JSON.stringify(help())
    if (action === 'macroEvidence') return JSON.stringify(macroEvidence(input, ctx))
    if (action === 'macroNumericEvidence') return JSON.stringify(macroNumericEvidence(input, ctx))
    if (action !== 'read') {
      throw new Error(`Invalid SourceReader action "${action}". Use action="help" for supported actions.`)
    }
    const url = optionalString(input.url)
    const path = optionalString(input.path)
    if ((!url && !path) || (url && path)) {
      throw new Error(sourceReaderFailureMessage(
        new Error('SourceReader(action:"read") requires exactly one of url or path.'),
      ))
    }
    let content: { body: string, contentType: string }
    try {
      content = path ? readPath(path) : await readUrl(url!)
    } catch (error) {
      throw new Error(sourceReaderFailureMessage(error))
    }
    if (plainText(content.body).length === 0) {
      throw new Error(sourceReaderFailureMessage(new Error('empty extracted source content')))
    }
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
    actions: ['read', 'macroEvidence', 'macroNumericEvidence'],
    required: 'Exactly one of url or path.',
    stores: 'memory/source_evidence/<sha256>.json',
    macroEvidenceStores: 'memory/macro_evidence/<id>.json',
    guidance: 'SourceReader records title/date/hash/excerpt as evidence. Use macroEvidence with explicit keyClaims, topic, region, assetClass, affectedAssets, freshness, and confidenceEffect before using macro sources in analysis. Use macroNumericEvidence to turn official query_macro_numeric_series rows into durable macro evidence records. Use ArtifactRegistry to register reusable source evidence before citing it in analysis.',
  }
}

function macroNumericEvidence(input: Record<string, unknown>, ctx: ToolContext): Record<string, unknown> {
  const row = isRecord(input.numericSeriesRow) ? input.numericSeriesRow : input
  const source =
    optionalString(input.source) ??
    optionalString(row.sourceName) ??
    optionalString(row.source_name) ??
    optionalString(row.provider) ??
    optionalString(input.provider) ??
    'official macro series'
  const provider = optionalString(input.provider) ?? optionalString(row.provider) ?? source
  const seriesId = optionalString(input.seriesId) ?? optionalString(row.seriesId)
  const metricName = optionalString(input.metricName) ?? optionalString(row.metricName) ?? seriesId
  const value = Object.prototype.hasOwnProperty.call(input, 'value') ? input.value : row.value
  const valueText = optionalString(value)
  const unit = optionalString(input.unit) ?? optionalString(row.unit)
  const sourceDataTime = optionalString(input.sourceDataTime) ?? optionalString(row.sourceDataTime)
  const fetchedAt = optionalString(input.fetchedAt) ?? optionalString(row.fetchedAt)
  const topic = optionalString(input.topic)
  const region = optionalString(input.region)
  const assetClass = optionalString(input.assetClass)
  const affectedAssets = stringList(input.affectedAssets)
  const confidenceEffect = optionalString(input.confidenceEffect)
  const freshness = optionalString(input.freshness) ?? optionalString(row.status) ?? 'unknown'
  const keyClaims = stringList(input.keyClaims)
  const missing = [
    ...(!seriesId ? ['seriesId'] : []),
    ...(!metricName ? ['metricName'] : []),
    ...(!valueText ? ['value'] : []),
    ...(!sourceDataTime ? ['sourceDataTime'] : []),
    ...(!topic ? ['topic'] : []),
    ...(!region ? ['region'] : []),
    ...(!assetClass ? ['assetClass'] : []),
    ...(affectedAssets.length === 0 ? ['affectedAssets'] : []),
    ...(!confidenceEffect ? ['confidenceEffect'] : []),
  ]
  if (missing.length > 0) {
    throw new Error(`SourceReader(action:"macroNumericEvidence") missing required structured fields: ${missing.join(', ')}. Pass a query_macro_numeric_series row plus explicit topic/region/assetClass/affectedAssets/confidenceEffect.`)
  }
  const claim = `${metricName} ${seriesId} = ${valueText}${unit ? ` ${unit}` : ''} as of ${sourceDataTime}.`
  const idInput = JSON.stringify({
    source,
    provider,
    seriesId,
    sourceDataTime,
    value: valueText,
    topic,
    affectedAssets,
  })
  const id = `macro:${createHash('sha256').update(idInput).digest('hex')}`
  const record = {
    contract: 'macro-evidence-record-v1',
    id,
    source,
    provider,
    sourceHash: null,
    url: optionalString(input.url) ?? optionalString(row.sourceUrl),
    path: null,
    title: optionalString(input.title) ?? `${source} official series ${seriesId}`,
    sourceDate: sourceDataTime,
    topic,
    region,
    assetClass,
    keyClaims: keyClaims.length > 0 ? keyClaims : [claim],
    affectedAssets,
    confidenceEffect,
    freshness,
    evidenceClass: 'official-numeric-series',
    numericSeries: {
      seriesId,
      metricName,
      value,
      unit,
      frequency: optionalString(input.frequency) ?? optionalString(row.frequency),
      sourceDataTime,
      fetchedAt,
      provider,
      status: optionalString(input.status) ?? optionalString(row.status),
    },
    fetchedAt,
    storedAt: new Date().toISOString(),
    tradeBoundary: 'Macro numeric evidence is context, hypothesis, and invalidation input. It is not a direct buy/sell rule.',
    missingEvidence: stringList(input.missingEvidence),
  }
  const file = join(ctx.memoryDir || join(ctx.basePath, 'memory'), 'macro_evidence', `${id.replace(':', '_')}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
  return {
    contract: 'source-reader-macro-numeric-evidence-result-v1',
    record,
    artifactHint: {
      kind: 'macroEvidence',
      path: file,
      title: record.title,
      source,
      provenance: {
        provider,
        seriesId,
        sourceDataTime,
        fetchedAt,
        topic,
        region,
        assetClass,
      },
    },
  }
}

function macroEvidence(input: Record<string, unknown>, ctx: ToolContext): Record<string, unknown> {
  const sourceRecord = readSourceRecord(input, ctx)
  const sourceHash = optionalString(input.sourceHash) ?? optionalString(sourceRecord?.hash)
  const url = optionalString(input.url) ?? optionalString(sourceRecord?.url)
  const path = optionalString(input.path) ?? optionalString(sourceRecord?.path)
  const source = optionalString(input.source) ?? optionalString(sourceRecord?.source) ?? sourceFrom(url, path)
  const titleValue = optionalString(input.title) ?? optionalString(sourceRecord?.title) ?? 'Untitled macro evidence'
  const sourceDate = optionalString(input.sourceDate) ?? optionalString(sourceRecord?.publishedAt)
  const topic = optionalString(input.topic)
  const region = optionalString(input.region)
  const assetClass = optionalString(input.assetClass)
  const keyClaims = stringList(input.keyClaims)
  const affectedAssets = stringList(input.affectedAssets)
  const confidenceEffect = optionalString(input.confidenceEffect)
  const freshness = optionalString(input.freshness) ?? 'unknown'
  const evidenceClass = optionalString(input.evidenceClass) ?? 'macro-research'
  const missing = [
    ...(!topic ? ['topic'] : []),
    ...(!region ? ['region'] : []),
    ...(!assetClass ? ['assetClass'] : []),
    ...(keyClaims.length === 0 ? ['keyClaims'] : []),
    ...(affectedAssets.length === 0 ? ['affectedAssets'] : []),
    ...(!confidenceEffect ? ['confidenceEffect'] : []),
  ]
  if (missing.length > 0) {
    throw new Error(`SourceReader(action:"macroEvidence") missing required structured fields: ${missing.join(', ')}. Provide explicit values; do not rely on prompt text inference.`)
  }
  const idInput = JSON.stringify({ sourceHash, url, path, topic, keyClaims, affectedAssets })
  const id = `macro:${createHash('sha256').update(idInput).digest('hex')}`
  const record = {
    contract: 'macro-evidence-record-v1',
    id,
    source,
    sourceHash,
    url,
    path,
    title: titleValue,
    sourceDate,
    topic,
    region,
    assetClass,
    keyClaims,
    affectedAssets,
    confidenceEffect,
    freshness,
    evidenceClass,
    sourceRecordPath: optionalString(input.sourceRecordPath),
    fetchedAt: optionalString(sourceRecord?.storedAt),
    storedAt: new Date().toISOString(),
    tradeBoundary: 'Macro evidence is context, hypothesis, and invalidation input. It is not a direct buy/sell rule.',
    missingEvidence: stringList(input.missingEvidence),
  }
  const file = join(ctx.memoryDir || join(ctx.basePath, 'memory'), 'macro_evidence', `${id.replace(':', '_')}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`)
  return {
    contract: 'source-reader-macro-evidence-result-v1',
    record,
    artifactHint: {
      kind: 'macroEvidence',
      path: file,
      title: titleValue,
      source,
      provenance: {
        sourceHash,
        url,
        path,
        topic,
        region,
        assetClass,
      },
    },
  }
}

function readSourceRecord(input: Record<string, unknown>, ctx: ToolContext): Record<string, unknown> | null {
  const sourceRecordPath = optionalString(input.sourceRecordPath)
  if (sourceRecordPath && existsSync(sourceRecordPath)) {
    return JSON.parse(readFileSync(sourceRecordPath, 'utf8')) as Record<string, unknown>
  }
  const sourceHash = optionalString(input.sourceHash)
  if (sourceHash) {
    const file = join(ctx.memoryDir || join(ctx.basePath, 'memory'), 'source_evidence', `${sourceHash}.json`)
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  }
  return null
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

function sourceReaderFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const status = /HTTP\s+(\d{3})/i.exec(message)?.[1]
  const failureClass = sourceReaderFailureClass(message, status)
  return [
    `SourceReader failureClass=${failureClass}`,
    status ? `status=${status}` : null,
    `nextAction=${sourceReaderNextAction(failureClass)}`,
    `detail=${message}`,
  ].filter(Boolean).join('; ')
}

function sourceReaderFailureClass(message: string, status?: string): string {
  if (status === '401') return 'credential-or-access-blocked'
  if (status === '403') return 'anti-bot-or-access-blocked'
  if (status === '404') return 'source-not-found'
  if (status === '429') return 'rate-limited'
  if (/file not found/i.test(message)) return 'source-file-missing'
  if (/requires exactly one|invalid/i.test(message)) return 'invalid-input'
  if (/empty extracted source content|empty source/i.test(message)) return 'extraction-empty'
  if (/timeout|fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(message)) return 'transport'
  return 'source-read-failed'
}

function sourceReaderNextAction(failureClass: string): string {
  switch (failureClass) {
    case 'credential-or-access-blocked':
      return 'Check source credential/session access, then retry with an authorized source or attach a manually captured source file.'
    case 'anti-bot-or-access-blocked':
      return 'Use browser/WebView/manual source handoff, official PDF, or an allowed alternate source before retrying; do not loop automated fetches.'
    case 'source-not-found':
      return 'Verify the URL or provider directory and search for the current report permalink.'
    case 'rate-limited':
      return 'Stop immediate retries, wait for the provider limit window, or reuse cached evidence.'
    case 'source-file-missing':
      return 'Create or attach the source file before calling SourceReader again.'
    case 'invalid-input':
      return 'Call SourceReader(action:"help") and pass exactly one valid url or path.'
    case 'extraction-empty':
      return 'Use PDF rendering, browser capture, or manual source text extraction before creating macro evidence.'
    case 'transport':
      return 'Check network/proxy/provider health and retry once with bounded scope.'
    default:
      return 'Inspect source health and use an alternate evidence path before relying on this source.'
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

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter(Boolean)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
