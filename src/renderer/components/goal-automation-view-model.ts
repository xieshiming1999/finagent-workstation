export interface GoalAutomationViewItem {
  template: {
    id: string
    title: string
    objective: string
    contextNeeds?: string[]
    guardrails?: string[]
  }
  activeGoal?: {
    status: string
    turnsUsed: number
    maxTurns: number
    tokenBudget?: number | null
    tokensUsed?: number | null
    artifact?: GoalArtifactView | null
    successCriteria?: string[]
    checkpoint?: string | null
    contextPackPath?: string | null
    workPacket?: GoalWorkPacketView | null
    verifierResult?: {
      status?: string
      reason?: string
      evidence?: string[]
    } | null
  } | null
  state: {
    enabled: boolean
    paused: boolean
    lastRunAt: number | null
    nextRunAt: number | null
    lastTrigger: string | null
    lastTriggerEvidence: string | null
    lastCheckpoint: string | null
    lastError: string | null
    lastResult: string | null
    escalationNeeded: boolean
    failureCount: number
    triggerLedger?: GoalTriggerLedgerEntry[]
  }
}

export interface GoalWorkPacketView {
  targetArtifact?: string | null
  currentGap: string
  evidence?: string[]
  implementationScope?: string | null
  nextPrompt: string
  progressKind?: string | null
  progressSummary?: string | null
  verification?: string | null
  escalationCondition?: string | null
}

export interface GoalArtifactView {
  objective?: string
  source?: string
  planSnapshot?: string | null
  scope?: string | null
  doneCriteria?: string[]
  allowedTools?: string[]
  verification?: string | null
  escalation?: string | null
}

export interface GoalTriggerLedgerEntry {
  at: number
  requestedTrigger: string
  resolvedTrigger: string
  status: string
  reason: string
  evidence: string | null
  nextRunAt: number | null
  runId: string | null
  repeatCount: number
}

export interface GoalAutomationDisplay {
  state: 'disabled' | 'enabled' | 'paused' | 'attention'
  latestDecision: GoalTriggerLedgerEntry | null
  decisionHistory: GoalTriggerLedgerEntry[]
  latestDecisionText: string
  evidence: string
  lastResult: string
  activeWorkPacket: GoalWorkPacketView | null
  activeWorkText: string
  taskSummary: GoalTaskSummary | null
}

export interface GoalTaskSummary {
  objective: string
  scope: string
  dataRequirements: string
  riskBoundary: string
  budget: string
  doneCriteria: string
  verification: string
  escalation: string
  evidence: string
}

export function buildGoalAutomationDisplay(
  item: GoalAutomationViewItem,
  formatTime: (value: number) => string,
): GoalAutomationDisplay {
  const decisionHistory = item.state.triggerLedger?.slice(0, 30) ?? []
  const latestDecision = decisionHistory[0] ?? null
  const latestDecisionText = latestDecision
    ? `${formatTime(latestDecision.at)} · ${latestDecision.status} · ${latestDecision.reason}${latestDecision.repeatCount > 1 ? ` (${latestDecision.repeatCount}x)` : ''}`
    : '-'
  return {
    state: item.state.escalationNeeded || item.state.lastError
      ? 'attention'
      : item.state.enabled
        ? item.state.paused ? 'paused' : 'enabled'
        : 'disabled',
    latestDecision,
    decisionHistory,
    latestDecisionText,
    evidence: item.state.lastTriggerEvidence ?? item.template.objective,
    lastResult: item.state.lastError ?? item.state.lastResult ?? '-',
    activeWorkPacket: item.activeGoal?.workPacket ?? null,
    activeWorkText: formatActiveWorkText(item.activeGoal?.workPacket ?? null),
    taskSummary: buildTaskSummary(item),
  }
}

function formatActiveWorkText(packet: GoalWorkPacketView | null): string {
  if (!packet) return '-'
  const kind = packet.progressKind && packet.progressKind !== 'unknown' ? `${packet.progressKind}: ` : ''
  return `${kind}${packet.currentGap}`
}

function buildTaskSummary(item: GoalAutomationViewItem): GoalTaskSummary | null {
  const goal = item.activeGoal
  if (!goal) return null
  const artifact = goal.artifact ?? {}
  const contextNeeds = stringList(item.template.contextNeeds)
  const guardrails = stringList(item.template.guardrails)
  const criteria = [
    ...stringList(artifact.doneCriteria),
    ...stringList(goal.successCriteria),
  ]
  const verifierEvidence = stringList(goal.verifierResult?.evidence)
  const packetEvidence = stringList(goal.workPacket?.evidence)
  const budget = goal.tokenBudget && goal.tokenBudget > 0
    ? `${goal.tokensUsed ?? 0}/${goal.tokenBudget} tokens · ${goal.turnsUsed}/${goal.maxTurns} turns`
    : `${goal.turnsUsed}/${goal.maxTurns} turns`

  return {
    objective: firstText(artifact.objective, item.template.objective),
    scope: firstText(artifact.scope, goal.workPacket?.implementationScope, '-'),
    dataRequirements: contextNeeds.length > 0 ? contextNeeds.join('; ') : '-',
    riskBoundary: guardrails.length > 0 ? guardrails.join('; ') : firstText(artifact.escalation, '-'),
    budget,
    doneCriteria: criteria.length > 0 ? Array.from(new Set(criteria)).join('; ') : '-',
    verification: firstText(artifact.verification, goal.workPacket?.verification, goal.verifierResult?.reason, '-'),
    escalation: firstText(artifact.escalation, goal.workPacket?.escalationCondition, '-'),
    evidence: [...packetEvidence, ...verifierEvidence, goal.contextPackPath, goal.checkpoint]
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, 6)
      .join('; ') || '-',
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter(Boolean)
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed.length > 0) return trimmed
  }
  return '-'
}
