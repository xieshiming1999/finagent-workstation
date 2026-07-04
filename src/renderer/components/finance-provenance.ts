export interface FinanceProvenanceFields {
  source?: unknown
  timestamp?: unknown
  provider_time?: unknown
  nav_date?: unknown
  date?: unknown
  fetched_at?: unknown
  fetchedAt?: unknown
  updated_at?: unknown
  cache_status?: unknown
  cacheStatus?: unknown
}

export interface ProvenanceLabels {
  source: string
  asOf: string
  fetched: string
  updated: string
  cache: string
  fresh: string
}

export function formatFinanceProvenance(row: FinanceProvenanceFields, labels: ProvenanceLabels): string {
  const parts: string[] = []
  const source = clean(row.source)
  const providerTime = clean(row.provider_time) ?? clean(row.timestamp) ?? clean(row.nav_date) ?? clean(row.date)

  if (source) parts.push(`${labels.source}: ${source}`)
  if (providerTime) parts.push(`${labels.asOf}: ${compactTime(providerTime)}`)

  return parts.join(' · ')
}

export function formatFinanceProvenanceTooltip(row: FinanceProvenanceFields, labels: ProvenanceLabels): string {
  const lines: string[] = []
  const source = clean(row.source)
  const providerTime = clean(row.provider_time) ?? clean(row.timestamp) ?? clean(row.nav_date) ?? clean(row.date)
  const fetched = clean(row.fetchedAt) ?? clean(row.fetched_at) ?? clean(row.updated_at)

  if (source) lines.push(`${labels.source}: ${source}`)
  if (providerTime) lines.push(`${labels.asOf}: ${compactTime(providerTime)}`)
  if (fetched) lines.push(`${labels.fetched}: ${compactTime(fetched)}`)

  return lines.join('\n')
}

function clean(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

function compactTime(value: string): string {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T')
  const date = new Date(normalized)
  if (!Number.isFinite(date.getTime())) return value
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${yyyy}-${mm}-${dd}`
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}
