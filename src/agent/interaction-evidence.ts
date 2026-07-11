import { mkdirSync, appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ToolContext } from './tool'

export type InteractionEvidenceType =
  | 'user_question_pending'
  | 'user_question_resolved'
  | 'user_question_timeout'
  | 'permission_request'
  | 'permission_resolved'

export interface InteractionEvidence {
  type: InteractionEvidenceType
  requestId: string
  toolName: string
  createdAt?: string
  question?: string
  options?: string[]
  answer?: string
  approved?: boolean
  alwaysAllow?: boolean
  rejectReason?: string
  inputKeys?: string[]
}

export function appendInteractionEvidence(ctx: ToolContext, evidence: InteractionEvidence): void {
  const memoryDir = ctx.memoryDir || join(ctx.basePath, 'memory')
  mkdirSync(memoryDir, { recursive: true })
  const row = {
    ...evidence,
    createdAt: evidence.createdAt ?? new Date().toISOString(),
  }
  appendFileSync(join(memoryDir, 'interaction_evidence.jsonl'), `${JSON.stringify(row)}\n`)
  updatePendingInteractionState(memoryDir, row)
}

export function inputKeys(input: Record<string, unknown>): string[] {
  return Object.keys(input).sort()
}

export function readPendingInteractionState(ctx: ToolContext): Array<Record<string, unknown>> {
  const file = join(ctx.memoryDir || join(ctx.basePath, 'memory'), 'interaction_pending.json')
  if (!existsSync(file)) return []
  try {
    const decoded = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(decoded?.pending)
      ? decoded.pending.filter((row: unknown): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
      : []
  } catch {
    return []
  }
}

function updatePendingInteractionState(memoryDir: string, row: InteractionEvidence & { createdAt: string }): void {
  const requestId = String(row.requestId ?? '')
  if (!requestId) return
  const file = join(memoryDir, 'interaction_pending.json')
  const pending = new Map<string, Record<string, unknown>>()
  if (existsSync(file)) {
    try {
      const decoded = JSON.parse(readFileSync(file, 'utf8'))
      if (Array.isArray(decoded?.pending)) {
        for (const item of decoded.pending) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) continue
          const id = String((item as Record<string, unknown>).requestId ?? '')
          if (id) pending.set(id, item as Record<string, unknown>)
        }
      }
    } catch {
      // Ignore corrupt snapshots; the append-only ledger remains authoritative.
    }
  }

  if (row.type === 'user_question_pending' || row.type === 'permission_request') {
    pending.set(requestId, row as unknown as Record<string, unknown>)
  } else if (row.type === 'user_question_resolved' || row.type === 'user_question_timeout' || row.type === 'permission_resolved') {
    pending.delete(requestId)
  }

  const rows = Array.from(pending.values())
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
  writeFileSync(file, JSON.stringify({
    contract: 'interaction-pending-state-v1',
    updatedAt: new Date().toISOString(),
    pending: rows,
  }))
}
