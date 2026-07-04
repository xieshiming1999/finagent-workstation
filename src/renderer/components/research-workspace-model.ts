export interface ResearchWorkspaceArtifact {
  id: string
  title: string
  path: string
  source: string
  updatedAt: string
  verificationStatus?: string
  freshness?: { status?: string; fetchedAt?: string; sourceTime?: string }
  metadata?: Record<string, unknown>
  provenance?: Record<string, unknown>
  payload?: {
    hypotheses?: string[]
    evidence?: Array<Record<string, unknown>>
    citations?: Array<{ title?: string; url?: string; source?: string; date?: string }>
    unverifiedItems?: string[]
    draft?: string | null
    query?: string
    action?: string
  } | null
}

export interface ResearchWorkspaceSummary {
  artifacts: number
  citations: number
  unverified: number
  drafts: number
  latestAt: string | null
}

export function buildResearchWorkspaceSummary(rows: ResearchWorkspaceArtifact[]): ResearchWorkspaceSummary {
  return rows.reduce<ResearchWorkspaceSummary>((acc, row) => {
    acc.artifacts += 1
    acc.citations += row.payload?.citations?.length ?? numberValue(row.metadata?.citations)
    acc.unverified += row.payload?.unverifiedItems?.length ?? numberValue(row.metadata?.unverifiedItems)
    acc.drafts += row.payload?.draft ? 1 : (row.metadata?.draft === true ? 1 : 0)
    if (!acc.latestAt || (row.updatedAt && row.updatedAt > acc.latestAt)) acc.latestAt = row.updatedAt
    return acc
  }, { artifacts: 0, citations: 0, unverified: 0, drafts: 0, latestAt: null })
}

export function primaryHypothesis(row: ResearchWorkspaceArtifact): string {
  return row.payload?.hypotheses?.[0] || String(row.metadata?.query ?? row.title)
}

export function evidencePreview(row: ResearchWorkspaceArtifact): string {
  const evidence = row.payload?.evidence?.[0]
  if (!evidence) return ''
  return [evidence.title, evidence.content, evidence.summary, evidence.url].map(stringValue).find(Boolean) ?? ''
}

export function citationUrl(row: ResearchWorkspaceArtifact): string {
  return row.payload?.citations?.map((c) => c.url).find(Boolean) ?? ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
