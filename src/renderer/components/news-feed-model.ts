export interface NewsItem {
  title: string
  time?: string
  publishedAt?: string
  published_at?: string
  fetchedAt?: string
  fetched_at?: string
  updatedAt?: string
  updated_at?: string
  source?: string
  url?: string
  link?: string
  summary?: string
  content?: string
  keyword?: string
  sourceFunc?: string
  relatedSymbols?: string[]
  headlineOnly?: boolean
  interfaceId?: string
  interface_id?: string
  provider?: string
  capabilityId?: string
  capability_id?: string
  canonicalSchema?: string
  canonical_schema?: string
  canonicalTable?: string
  canonical_table?: string
  cacheStatus?: string
  cache_status?: string
}

export interface NewsFeedSummary {
  rows: NewsItem[]
  state: 'empty' | 'headline-only' | 'mixed' | 'enriched'
  sources: number
  headlineOnly: number
  enriched: number
}

export interface NewsFeedRouteProvenance {
  interfaceId?: string
  capabilityId?: string
  provider?: string
  canonicalSchema?: string
  canonicalTable?: string
  cacheStatus?: string
  cacheMode?: string
  cacheDecision?: string
  providerMode?: string
  requestedProvider?: string
  allowFallback?: boolean
}

export interface NewsProvenanceLabels {
  interface: string
  provider: string
  capability: string
  schema: string
  table: string
  cache: string
  dataTime: string
  fetched: string
}

export function newsUrl(item: NewsItem): string {
  return normalizeNewsUrl(item.url) || normalizeNewsUrl(item.link)
}

export function normalizeNewsUrl(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const candidate = raw.startsWith('//') ? `https:${raw}` : raw

  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

export function newsBodyText(item: NewsItem): string {
  return String(item.summary || item.content || '').trim()
}

export function isHeadlineOnlyNews(item: NewsItem): boolean {
  return Boolean(item.headlineOnly) || newsBodyText(item).length === 0
}

export function filterNewsRows(rows: NewsItem[], query: string): NewsItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((item) => [
    item.title,
    item.source,
    item.summary,
    item.content,
    item.relatedSymbols?.join(' '),
  ].some((value) => String(value ?? '').toLowerCase().includes(q)))
}

export function buildNewsFeedSummary(rows: NewsItem[]): NewsFeedSummary {
  const headlineOnly = rows.filter(isHeadlineOnlyNews).length
  const enriched = rows.filter((item) => newsBodyText(item).length > 0).length
  return {
    rows,
    state: rows.length === 0
      ? 'empty'
      : enriched === 0
        ? 'headline-only'
        : headlineOnly > 0
          ? 'mixed'
          : 'enriched',
    sources: new Set(rows.map((item) => item.source).filter(Boolean)).size,
    headlineOnly,
    enriched,
  }
}

export function newsSourceTime(item: NewsItem): string {
  return clean(item.publishedAt) ?? clean(item.published_at) ?? clean(item.time) ?? ''
}

export function newsFetchedAt(item: NewsItem, fallback?: string | null): string {
  return clean(item.fetchedAt) ?? clean(item.fetched_at) ?? clean(item.updatedAt) ?? clean(item.updated_at) ?? clean(fallback) ?? ''
}

export function buildNewsProvenanceTooltip(
  item: NewsItem,
  route: NewsFeedRouteProvenance | null | undefined,
  labels: NewsProvenanceLabels,
  fallbackFetchedAt?: string | null,
): string {
  const lines: string[] = []
  const interfaceId = clean(item.interfaceId) ?? clean(item.interface_id) ?? clean(route?.interfaceId)
  const provider = clean(item.provider) ?? clean(item.source) ?? clean(route?.provider)
  const capabilityId = clean(item.capabilityId) ?? clean(item.capability_id) ?? clean(route?.capabilityId)
  const canonicalSchema = clean(item.canonicalSchema) ?? clean(item.canonical_schema) ?? clean(route?.canonicalSchema)
  const canonicalTable = clean(item.canonicalTable) ?? clean(item.canonical_table) ?? clean(route?.canonicalTable)
  const cacheStatus = clean(item.cacheStatus) ?? clean(item.cache_status) ?? clean(route?.cacheStatus)
  const sourceTime = newsSourceTime(item)
  const fetchedAt = newsFetchedAt(item, fallbackFetchedAt)

  if (interfaceId) lines.push(`${labels.interface}: ${interfaceId}`)
  if (provider) lines.push(`${labels.provider}: ${provider}`)
  if (capabilityId) lines.push(`${labels.capability}: ${capabilityId}`)
  if (canonicalSchema) lines.push(`${labels.schema}: ${canonicalSchema}`)
  if (canonicalTable) lines.push(`${labels.table}: ${canonicalTable}`)
  if (cacheStatus) lines.push(`${labels.cache}: ${cacheStatus}`)
  lines.push(`${labels.dataTime}: ${sourceTime || '-'}`)
  lines.push(`${labels.fetched}: ${fetchedAt || '-'}`)

  return lines.join('\n')
}

function clean(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}
