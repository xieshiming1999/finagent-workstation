import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Tool, ToolContext } from '../tool'

type EvidenceRow = Record<string, unknown>

export class InteractionEvidenceTool implements Tool {
  name = 'InteractionEvidence'
  description = 'Inspect structured user-question and approval lifecycle evidence. Use summary first, then recent for details.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['help', 'summary', 'recent'],
        description: 'help, summary, or recent interaction evidence rows',
      },
      limit: { type: 'number', description: 'Maximum recent rows to return, default 20' },
      type: {
        type: 'string',
        description: 'Optional evidence type filter, for example user_question_pending or permission_resolved',
      },
    },
  }

  async call(_id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'summary')
    if (action === 'help') return helpText()
    if (action !== 'summary' && action !== 'recent') {
      throw new Error(`Invalid InteractionEvidence action "${action}". Use action="help" for supported actions.`)
    }

    const rows = readRows(ctx)
    const type = input.type ? String(input.type) : ''
    const filtered = type ? rows.filter((row) => row.type === type) : rows
    if (action === 'recent') {
      const limit = Math.max(1, Math.min(100, Number(input.limit ?? 20) || 20))
      return JSON.stringify({
        contract: 'interaction-evidence-result-v1',
        action,
        count: filtered.length,
        returned: Math.min(limit, filtered.length),
        rows: filtered.slice(-limit),
      })
    }
    return JSON.stringify({
      contract: 'interaction-evidence-result-v1',
      action,
      count: filtered.length,
      byType: countByType(filtered),
      pending: latestPending(rows),
      latest: rows.at(-1) ?? null,
    })
  }
}

function helpText(): string {
  return JSON.stringify({
    contract: 'interaction-evidence-help-v1',
    actions: ['summary', 'recent'],
    evidenceTypes: [
      'user_question_pending',
      'user_question_resolved',
      'user_question_timeout',
      'permission_request',
      'permission_resolved',
    ],
    guidance: 'Use summary to inspect whether user input or approval is pending. Use recent with a type filter for detailed rows.',
  })
}

function readRows(ctx: ToolContext): EvidenceRow[] {
  const file = join(ctx.memoryDir, 'interaction_evidence.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const decoded = JSON.parse(line)
        return decoded && typeof decoded === 'object' ? [decoded as EvidenceRow] : []
      } catch {
        return []
      }
    })
}

function countByType(rows: EvidenceRow[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) {
    const type = String(row.type ?? 'unknown')
    out[type] = (out[type] ?? 0) + 1
  }
  return out
}

function latestPending(rows: EvidenceRow[]): EvidenceRow[] {
  const resolved = new Set<string>()
  const pending: EvidenceRow[] = []
  for (const row of rows) {
    const requestId = String(row.requestId ?? '')
    if (!requestId) continue
    if (row.type === 'user_question_resolved' || row.type === 'user_question_timeout' || row.type === 'permission_resolved') {
      resolved.add(requestId)
    }
  }
  for (const row of rows) {
    const requestId = String(row.requestId ?? '')
    if (!requestId || resolved.has(requestId)) continue
    if (row.type === 'user_question_pending' || row.type === 'permission_request') pending.push(row)
  }
  return pending
}
