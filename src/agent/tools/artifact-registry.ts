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
        enum: ['help', 'list', 'get', 'register'],
      },
      kind: {
        type: 'string',
        enum: ARTIFACT_KINDS,
        description: 'Optional for list; required for register.',
      },
      id: { type: 'string', description: 'Artifact id or stable id.' },
      path: { type: 'string', description: 'Runtime artifact path.' },
      title: { type: 'string' },
      source: { type: 'string' },
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
    if (action === 'register') return JSON.stringify(registerArtifact(registry, input))
    throw new Error(`Invalid ArtifactRegistry action "${action}". Use action="help" for supported actions.`)
  }
}

function help(): Record<string, unknown> {
  return {
    contract: 'artifact-registry-help-v1',
    actions: ['help', 'list', 'get', 'register'],
    kinds: ARTIFACT_KINDS,
    guidance: [
      'Register artifacts after creating durable workflow outputs; do not rely only on chat text.',
      'Use provenance and freshness to explain where evidence came from and whether it is reusable.',
      'Use get/list before reusing an existing artifact in later turns.',
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

function registerArtifact(registry: ArtifactRegistry, input: Record<string, unknown>): Record<string, unknown> {
  const kind = parseKind(input.kind, true)
  const path = String(input.path ?? '').trim()
  const title = String(input.title ?? '').trim()
  const source = String(input.source ?? '').trim()
  if (!path || !title || !source) {
    throw new Error('ArtifactRegistry(action:"register") requires non-empty path, title, and source.')
  }
  const record = registry.register({
    kind,
    path,
    title,
    source,
    id: optionalString(input.id),
    ownerTask: optionalString(input.ownerTask),
    verificationStatus: parseVerificationStatus(input.verificationStatus),
    freshness: objectValue(input.freshness),
    provenance: objectValue(input.provenance),
    links: stringList(input.links),
    metadata: objectValue(input.metadata),
  })
  return {
    contract: 'artifact-registry-record-v1',
    artifact: record,
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
