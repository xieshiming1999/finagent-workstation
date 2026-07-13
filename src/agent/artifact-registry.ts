import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { dirname, join } from 'path'
import { externalReportRevisionContract } from './external-orchestration-contract'

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

  registerReportRevision(input: {
    logicalReportId: string
    title: string
    source: string
    content: unknown
    changeSummary: string
    evidenceEntryIds: string[]
    sourceCoordinates: Record<string, unknown>
    parentArtifactId?: string | null
    now?: Date
  }): ArtifactRecord {
    const logicalReportId = input.logicalReportId.trim()
    if (!logicalReportId) throw new Error('logicalReportId is required')
    const changeSummary = input.changeSummary.trim()
    if (!changeSummary) throw new Error('changeSummary is required')
    if (input.evidenceEntryIds.some((id) => !id.trim())) {
      throw new Error('evidenceEntryIds must be non-empty')
    }
    const parent = input.parentArtifactId
      ? this.readAll().find((record) => record.id === input.parentArtifactId || record.stableRef === input.parentArtifactId)
      : undefined
    if (input.parentArtifactId && !parent) {
      throw new Error(`parent artifact not found: ${input.parentArtifactId}`)
    }
    const digestInput = JSON.stringify({
      contract: externalReportRevisionContract,
      logicalReportId,
      parentArtifactId: parent?.id ?? null,
      content: input.content,
      changeSummary,
      evidenceEntryIds: input.evidenceEntryIds,
      sourceCoordinates: input.sourceCoordinates,
    })
    const revisionId = createHash('sha256').update(digestInput).digest('hex')
    const safeLogicalId = logicalReportId.replace(/[^A-Za-z0-9_.-]+/g, '-')
    const relativePath = join('memory', 'artifacts', 'revisions', safeLogicalId, `${revisionId}.json`)
    const artifactId = `report-revision:${safeLogicalId}:${revisionId}`
    const timestamp = input.now ?? new Date()
    const revision = {
      contract: externalReportRevisionContract,
      logicalReportId,
      revisionId,
      artifactId,
      parentArtifactId: parent?.id ?? null,
      createdAt: timestamp.toISOString(),
      changeSummary,
      evidenceEntryIds: input.evidenceEntryIds,
      sourceCoordinates: input.sourceCoordinates,
      content: input.content,
    }
    const filePath = join(this.basePath, relativePath)
    if (!existsSync(filePath)) {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, `${JSON.stringify(revision, null, 2)}\n`, 'utf-8')
    }
    return this.register({
      kind: 'report',
      path: relativePath,
      title: input.title,
      source: input.source,
      id: artifactId,
      ownerTask: logicalReportId,
      verificationStatus: 'verified',
      provenance: { source: input.source, sourceCoordinates: input.sourceCoordinates },
      links: parent ? [parent.stableRef] : [],
      metadata: {
        contract: externalReportRevisionContract,
        logicalReportId,
        revisionId,
        parentArtifactId: parent?.id ?? null,
        changeSummary,
        evidenceEntryIds: input.evidenceEntryIds,
        sourceCoordinates: input.sourceCoordinates,
      },
      now: timestamp,
    })
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
