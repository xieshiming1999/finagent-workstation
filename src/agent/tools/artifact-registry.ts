import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { ArtifactRegistry, type ArtifactKind, type ArtifactVerificationStatus } from '../artifact-registry'
import type { Tool, ToolContext } from '../tool'

const ARTIFACT_KINDS: ArtifactKind[] = [
  'analysis',
  'goal',
  'plan_snapshot',
  'work_packet',
  'context_pack',
  'api_error',
  'data_snapshot',
  'research',
  'macro_evidence',
  'dashboard',
  'strategy',
  'backtest',
  'report',
  'trade_preparation',
]

const VERIFICATION_STATUSES: ArtifactVerificationStatus[] = [
  'unverified',
  'verified',
  'stale',
  'failed',
  'unsupported',
]

export class ArtifactRegistryTool implements Tool {
  name = 'ArtifactRegistry'
  description = 'Create and inspect durable workflow artifacts such as analyses, dashboards, strategies, backtests, reports, and data evidence.'
  isReadOnly = false
  canParallel = false
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['help', 'list', 'get', 'register', 'graph'],
      },
      kind: {
        type: 'string',
        enum: ARTIFACT_KINDS,
        description: 'Optional for list; required for register.',
      },
      id: { type: 'string', description: 'Artifact id or stable id.' },
      path: { type: 'string', description: 'Runtime artifact path.' },
      title: {
        type: 'string',
        description: 'Required for register. Human-readable artifact title.',
      },
      source: {
        type: 'string',
        description: 'Required for register. Name the workflow, provider, tool, or evidence source that produced the artifact.',
      },
      ownerTask: { type: 'string' },
      verificationStatus: {
        type: 'string',
        enum: VERIFICATION_STATUSES,
      },
      freshness: { type: 'object' },
      provenance: { type: 'object' },
      links: {
        type: 'array',
        items: { type: 'string' },
      },
      metadata: { type: 'object' },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
  }

  needsPermissions(_input: Record<string, unknown>): boolean {
    return false
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'list').trim()
    const registry = new ArtifactRegistry(ctx.basePath)
    if (action === 'help') return JSON.stringify(help())
    if (action === 'list') return JSON.stringify(listArtifacts(registry, input))
    if (action === 'get') return JSON.stringify(getArtifact(registry, input))
    if (action === 'register') return JSON.stringify(registerArtifact(registry, input, ctx))
    if (action === 'graph') return JSON.stringify(graphArtifacts(registry, input))
    throw new Error(`Invalid ArtifactRegistry action "${action}". Use action="help" for supported actions.`)
  }
}

function help(): Record<string, unknown> {
  return {
    contract: 'artifact-registry-help-v1',
    actions: ['help', 'list', 'get', 'register', 'graph'],
    kinds: ARTIFACT_KINDS,
    guidance: [
      'Register artifacts after creating durable workflow outputs; do not rely only on chat text.',
      'For action="register", always provide kind, title, and source. If path is omitted, ArtifactRegistry creates a managed JSON artifact file.',
      'Use provenance and freshness to explain where evidence came from and whether it is reusable.',
      'Use get/list before reusing an existing artifact in later turns.',
      'Use graph to inspect claim/evidence/source relationships before citing a prior artifact.',
    ],
  }
}

function listArtifacts(registry: ArtifactRegistry, input: Record<string, unknown>): Record<string, unknown> {
  const kind = parseKind(input.kind, false)
  const limit = Math.max(1, Math.min(100, Number(input.limit ?? 20) || 20))
  const artifacts = registry.list(kind).slice(0, limit)
  return {
    contract: 'artifact-registry-list-v1',
    count: artifacts.length,
    kind,
    artifacts,
  }
}

function getArtifact(registry: ArtifactRegistry, input: Record<string, unknown>): Record<string, unknown> {
  const id = String(input.id ?? '').trim()
  if (!id) throw new Error('ArtifactRegistry(action:"get") requires id.')
  const normalizedId = id.startsWith('artifact:') ? id.slice('artifact:'.length) : id
  const record = registry.list().find((item) => item.id === normalizedId || item.stableRef === id)
  if (!record) {
    throw new Error(`Artifact "${id}" was not found. Use ArtifactRegistry(action:"list") to inspect available artifacts.`)
  }
  return {
    contract: 'artifact-registry-record-v1',
    artifact: record,
  }
}

function registerArtifact(registry: ArtifactRegistry, input: Record<string, unknown>, ctx: ToolContext): Record<string, unknown> {
  const kind = parseKind(input.kind, true)
  let path = String(input.path ?? '').trim()
  const title = String(input.title ?? '').trim()
  const source = String(input.source ?? '').trim()
  if (!title || !source) {
    throw new Error('ArtifactRegistry(action:"register") requires non-empty title and source. Provide path for an existing artifact, or omit path to let ArtifactRegistry create a managed artifact file.')
  }
  let managedArtifact = false
  if (!path) {
    path = writeManagedArtifact(ctx, kind, input, title, source)
    managedArtifact = true
  }
  const normalized = normalizeArtifactEvidence(kind, input)
  const record = registry.register({
    kind,
    path,
    title,
    source,
    id: optionalString(input.id),
    ownerTask: optionalString(input.ownerTask),
    verificationStatus: parseVerificationStatus(input.verificationStatus),
    freshness: normalized.freshness,
    provenance: normalized.provenance,
    links: stringList(input.links),
    metadata: normalized.metadata,
  })
  return {
    contract: 'artifact-registry-record-v1',
    managedArtifact,
    artifact: record,
  }
}

function writeManagedArtifact(
  ctx: ToolContext,
  kind: ArtifactKind,
  input: Record<string, unknown>,
  title: string,
  source: string,
): string {
  const createdAt = new Date().toISOString()
  const metadata = objectValue(input.metadata) ?? {}
  const provenance = objectValue(input.provenance) ?? {}
  const freshness = objectValue(input.freshness) ?? {}
  const normalized = normalizeArtifactEvidence(kind, input)
  const digest = createHash('sha256')
    .update(JSON.stringify({ kind, title, source, metadata, provenance, freshness }))
    .digest('hex')
    .slice(0, 16)
  const relativePath = `memory/artifacts/${kind}/${digest}.json`
  const absolutePath = join(ctx.basePath, relativePath)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, `${JSON.stringify({
    contract: 'managed-artifact-v1',
    kind,
    title,
    source,
    createdAt,
    freshness,
    macroEvidenceSummary: normalized.macroEvidenceSummary,
    provenance: Object.keys(normalized.provenance ?? {}).length ? normalized.provenance : { source },
    links: stringList(input.links),
    metadata: normalized.metadata ?? metadata,
  }, null, 2)}\n`, 'utf-8')
  return relativePath
}

function normalizeArtifactEvidence(kind: ArtifactKind, input: Record<string, unknown>): {
  freshness?: Record<string, unknown>
  provenance?: Record<string, unknown>
  metadata?: Record<string, unknown>
  macroEvidenceSummary?: Record<string, unknown>
} {
  const metadata = objectValue(input.metadata) ?? {}
  const provenance = objectValue(input.provenance) ?? {}
  const freshness = objectValue(input.freshness) ?? {}
  const summary = macroEvidenceSummary(kind, { ...input, ...metadata, ...provenance, ...freshness })
  if (!summary) return { freshness, provenance, metadata }
  const sourceTime = optionalString(summary.sourceTime)
  const fetchedAt = optionalString(summary.fetchedAt)
  const freshnessStatus = optionalString(summary.freshnessStatus)
  return {
    freshness: {
      ...freshness,
      ...(sourceTime ? { sourceTime } : {}),
      ...(fetchedAt ? { fetchedAt } : {}),
      ...(freshnessStatus ? { status: freshnessStatus } : {}),
    },
    provenance: {
      ...provenance,
      macroEvidenceSummary: summary,
      ...(summary.failureClass ? { failureClass: summary.failureClass } : {}),
      ...(summary.sourceTime ? { sourceDataTime: summary.sourceTime } : {}),
      ...(summary.fetchedAt ? { fetchedAt: summary.fetchedAt } : {}),
    },
    metadata: {
      ...metadata,
      macroEvidenceSummary: summary,
    },
    macroEvidenceSummary: summary,
  }
}

function macroEvidenceSummary(kind: ArtifactKind, row: Record<string, unknown>): Record<string, unknown> | null {
  const direct = objectValue(row.macroEvidenceSummary)
  if (direct) return direct
  const macroEvidence = objectValue(row.macroEvidence) ?? objectValue(row.macro)
  const source = macroEvidence ?? row
  const affectedAssets = stringList(source.affectedAssets ?? source.affected_assets) ?? []
  const missingEvidence = stringList(source.missingEvidence ?? source.missing_evidence) ?? []
  const confidenceEffect = optionalString(source.confidenceEffect ?? source.confidence_effect)
  const sourceTime = optionalString(source.sourceDataTime ?? source.source_time ?? source.sourceTime)
  const fetchedAt = optionalString(source.fetchedAt ?? source.fetched_at)
  const failureClass = optionalString(source.failureClass ?? source.failure_class)
  const freshnessStatus = optionalString(source.freshnessStatus ?? source.status)
  const topic = optionalString(source.topic ?? source.family ?? source.target)
  const hasMacroFields = affectedAssets.length > 0
    || missingEvidence.length > 0
    || Boolean(confidenceEffect || sourceTime || fetchedAt || failureClass || topic)
  const macroKind = kind === 'macro_evidence' || kind === 'report' || kind === 'dashboard' || kind === 'analysis'
  if (!macroKind || !hasMacroFields) return null
  return {
    contract: 'macro-artifact-evidence-summary-v1',
    topic: topic ?? null,
    sourceTime: sourceTime ?? null,
    fetchedAt: fetchedAt ?? null,
    freshnessStatus: freshnessStatus ?? 'unknown',
    confidenceEffect: confidenceEffect ?? null,
    affectedAssets,
    missingEvidence,
    failureClass: failureClass ?? null,
  }
}

function graphArtifacts(registry: ArtifactRegistry, input: Record<string, unknown>): Record<string, unknown> {
  const kind = parseKind(input.kind, false)
  const limit = Math.max(1, Math.min(100, Number(input.limit ?? 50) || 50))
  const records = registry.list(kind).slice(0, limit)
  const nodes = new Map<string, Record<string, unknown>>()
  const edges: Record<string, unknown>[] = []

  function addNode(id: string, type: string, data: Record<string, unknown>): void {
    if (!id.trim()) return
    nodes.set(id, { id, type, ...data })
  }

  for (const artifact of records) {
    const artifactId = artifact.stableRef
    addNode(artifactId, 'artifact', {
      kind: artifact.kind,
      title: artifact.title,
      verificationStatus: artifact.verificationStatus,
      freshness: artifact.freshness,
    })
    const sourceId = `source:${artifact.source}`
    addNode(sourceId, 'source', { source: artifact.source })
    edges.push({ from: artifactId, to: sourceId, relation: 'from_source' })

    for (const [key, value] of Object.entries(artifact.provenance ?? {})) {
      if (typeof value !== 'string' || !value.trim()) continue
      const nodeId = `${key}:${value}`
      addNode(nodeId, key, { value })
      edges.push({ from: artifactId, to: nodeId, relation: 'proves_with' })
    }
    for (const link of artifact.links ?? []) {
      addNode(link, link.startsWith('artifact:') ? 'artifact_ref' : 'reference', { value: link })
      edges.push({ from: artifactId, to: link, relation: 'links_to' })
    }
  }
  return {
    contract: 'artifact-evidence-graph-v1',
    artifactCount: records.length,
    nodeCount: nodes.size,
    edgeCount: edges.length,
    nodes: [...nodes.values()],
    edges,
    guidance: 'Use this graph to connect claims, artifacts, source/provider evidence, freshness, and missing links before reusing prior analysis.',
  }
}

function parseKind(value: unknown, required: true): ArtifactKind
function parseKind(value: unknown, required: false): ArtifactKind | undefined
function parseKind(value: unknown, required: boolean): ArtifactKind | undefined {
  const text = String(value ?? '').trim()
  if (!text && !required) return undefined
  if (ARTIFACT_KINDS.includes(text as ArtifactKind)) return text as ArtifactKind
  throw new Error('ArtifactRegistry received an unsupported kind. Use action="help" to inspect kinds.')
}

function parseVerificationStatus(value: unknown): ArtifactVerificationStatus | undefined {
  const text = String(value ?? '').trim()
  if (!text) return undefined
  if (VERIFICATION_STATUSES.includes(text as ArtifactVerificationStatus)) return text as ArtifactVerificationStatus
  throw new Error('ArtifactRegistry received an unsupported verificationStatus. Use action="help" to inspect statuses.')
}

function optionalString(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  return text || undefined
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}
