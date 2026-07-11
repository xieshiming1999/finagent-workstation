import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export type ArtifactKind =
  | 'analysis'
  | 'goal'
  | 'plan_snapshot'
  | 'work_packet'
  | 'context_pack'
  | 'api_error'
  | 'data_snapshot'
  | 'research'
  | 'macro_evidence'
  | 'dashboard'
  | 'strategy'
  | 'backtest'
  | 'report'
  | 'trade_preparation'

export type ArtifactVerificationStatus = 'unverified' | 'verified' | 'stale' | 'failed' | 'unsupported'

export type ArtifactFreshness = {
  sourceTime?: string | null
  fetchedAt?: string | null
  windowMinutes?: number | null
  status?: 'fresh' | 'stale' | 'unknown'
}

export type ArtifactRecord = {
  id: string
  kind: ArtifactKind
  stableRef: string
  path: string
  title: string
  source: string
  ownerTask: string | null
  createdAt: string
  updatedAt: string
  expiresAt: string | null
  verificationStatus: ArtifactVerificationStatus
  freshness: ArtifactFreshness
  provenance: Record<string, unknown>
  links: string[]
  metadata: Record<string, unknown>
}

export class ArtifactRegistry {
  private readonly filePath: string

  constructor(private readonly basePath: string) {
    this.filePath = join(basePath, 'memory', 'artifacts', 'registry.json')
  }

  register(input: {
    kind: ArtifactKind
    path: string
    title: string
    source: string
    id?: string
    ownerTask?: string | null
    expiresAt?: string | null
    verificationStatus?: ArtifactVerificationStatus
    freshness?: ArtifactFreshness
    provenance?: Record<string, unknown>
    links?: string[]
    metadata?: Record<string, unknown>
    now?: Date
  }): ArtifactRecord {
    const now = (input.now ?? new Date()).toISOString()
    const id = input.id ?? `${input.kind}:${input.path}`
    const records = this.readAll()
    const previous = records.find((record) => record.id === id)
    const record: ArtifactRecord = {
      id,
      kind: input.kind,
      stableRef: `artifact:${id}`,
      path: input.path,
      title: input.title,
      source: input.source,
      ownerTask: input.ownerTask ?? inferredOwnerTask(input.metadata) ?? previous?.ownerTask ?? null,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      expiresAt: input.expiresAt ?? previous?.expiresAt ?? null,
      verificationStatus: input.verificationStatus ?? previous?.verificationStatus ?? 'unverified',
      freshness: input.freshness ?? previous?.freshness ?? { status: 'unknown' },
      provenance: input.provenance ?? previous?.provenance ?? { source: input.source },
      links: uniqueStrings([`artifact:${id}`, input.path, ...(input.links ?? previous?.links ?? [])]),
      metadata: input.metadata ?? {},
    }
    const next = [record, ...records.filter((item) => item.id !== id)]
    this.writeAll(next)
    return record
  }

  list(kind?: ArtifactKind): ArtifactRecord[] {
    const records = this.readAll()
    return kind ? records.filter((record) => record.kind === kind) : records
  }

  private readAll(): ArtifactRecord[] {
    if (!existsSync(this.filePath)) return []
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8'))
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isArtifactRecord).map(normalizeArtifactRecord)
    } catch {
      return []
    }
  }

  private writeAll(records: ArtifactRecord[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, `${JSON.stringify(records, null, 2)}\n`, 'utf-8')
  }
}

function isArtifactRecord(value: unknown): value is ArtifactRecord {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string'
    && typeof row.kind === 'string'
    && typeof row.path === 'string'
    && typeof row.title === 'string'
    && typeof row.source === 'string'
    && typeof row.createdAt === 'string'
    && typeof row.updatedAt === 'string'
}

function normalizeArtifactRecord(record: ArtifactRecord): ArtifactRecord {
  const row = record as ArtifactRecord & Partial<ArtifactRecord>
  const stableRef = typeof row.stableRef === 'string' ? row.stableRef : `artifact:${record.id}`
  return {
    ...record,
    stableRef,
    ownerTask: typeof row.ownerTask === 'string' ? row.ownerTask : inferredOwnerTask(row.metadata) ?? null,
    expiresAt: typeof row.expiresAt === 'string' ? row.expiresAt : null,
    verificationStatus: isVerificationStatus(row.verificationStatus) ? row.verificationStatus : 'unverified',
    freshness: row.freshness && typeof row.freshness === 'object' ? row.freshness : { status: 'unknown' },
    provenance: row.provenance && typeof row.provenance === 'object' ? row.provenance : { source: record.source },
    links: uniqueStrings([stableRef, record.path, ...(Array.isArray(row.links) ? row.links : [])]),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
  }
}

function isVerificationStatus(value: unknown): value is ArtifactVerificationStatus {
  return value === 'unverified' || value === 'verified' || value === 'stale' || value === 'failed' || value === 'unsupported'
}

function inferredOwnerTask(metadata?: Record<string, unknown>): string | null {
  const value = metadata?.templateId ?? metadata?.goalArtifactId ?? metadata?.dashboardId ?? metadata?.reportType
  return typeof value === 'string' && value.trim() ? value : null
}

function uniqueStrings(values: unknown[]): string[] {
  const out: string[] = []
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim() || out.includes(value)) continue
    out.push(value)
  }
  return out
}
