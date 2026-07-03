export type GoalTemplateId =
  | 'api_error_triage'
  | 'daily_data_health'
  | 'market_pulse_refresh'
  | 'watchlist_monitor'
  | 'dashboard_refresh'
  | 'report_generation'
  | 'provider_contract_probe'

export type GoalTrigger =
  | 'manual'
  | 'startup'
  | 'schedule'
  | 'stale_data'
  | 'api_failure_threshold'
  | 'watchlist_condition'
  | 'market_open'
  | 'market_close'
  | 'run_now'

export interface GoalVerifierResult {
  status: 'unchecked' | 'passed' | 'failed' | 'needs_escalation'
  checkedAt: number
  reason: string
  evidence?: string[]
}

export interface GoalAutomationInfo {
  enabled?: boolean
  trigger: GoalTrigger
  runId: string
  source: string
}

export interface GoalArtifact {
  objective: string
  source: string
  planSnapshot: string | null
  scope: string | null
  doneCriteria: string[]
  allowedTools: string[]
  verification: string | null
  escalation: string | null
  createdAt: number
  updatedAt: number
}

export interface GoalWorkPacket {
  targetArtifact: string | null
  currentGap: string
  evidence: string[]
  implementationScope: string | null
  progressKind?: 'unknown' | 'progress_only' | 'implementation' | 'verification' | 'blocked'
  progressSummary?: string | null
  nextPrompt: string
  verification: string
  stopCondition: string
  escalationCondition: string
  createdAt: number
  turn: number
}

export interface GoalSetOptions {
  templateId?: GoalTemplateId | null
  successCriteria?: string[]
  checkpoint?: string | null
  verifierResult?: GoalVerifierResult | null
  automation?: GoalAutomationInfo | null
  contextPackPath?: string | null
  tokenBudget?: number | null
  source?: string | null
  planSnapshot?: string | null
  scope?: string | null
  doneCriteria?: string[]
  allowedTools?: string[]
  verification?: string | null
  escalation?: string | null
  goalArtifact?: GoalArtifact | null
}

export interface GoalTemplate {
  id: GoalTemplateId
  title: string
  objective: string
  defaultMaxTurns: number
  persistentDuty?: boolean
  successCriteria: string[]
  contextNeeds: string[]
  guardrails: string[]
  verifierChecks: string[]
}

export interface GoalAutomationRun {
  runId: string
  templateId: GoalTemplateId
  trigger: GoalTrigger
  status: 'queued' | 'skipped' | 'failed'
  reason: string
  prompt?: string
  contextPackPath?: string
  startedAt: number
}
