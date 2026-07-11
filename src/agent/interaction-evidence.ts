import { mkdirSync, appendFileSync } from 'fs'
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
}

export function inputKeys(input: Record<string, unknown>): string[] {
  return Object.keys(input).sort()
}
