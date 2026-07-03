import type { GoalTemplate, GoalTemplateId } from './goal-automation-types'

export const GOAL_TEMPLATES: GoalTemplate[] = [
  {
    id: 'api_error_triage',
    title: 'API Error Triage',
    objective: 'Triage recent finance API/provider failures, classify the likely cause, and apply a safe fix when the code or configuration problem is clear.',
    defaultMaxTurns: 8,
    persistentDuty: true,
    contextNeeds: ['recent API failures', 'provider health', 'data task queue', 'provider policy', 'related skills'],
    successCriteria: [
      'Inspect only recent API errors from the current debug window by default.',
      'Classify each failure as transport, provider outage, invalid parameters, contract mismatch, quota/config, or local code issue.',
      'Use limited serial probes when needed; do not retry blindly or increase concurrency.',
      'If a code/config fix is clear and safe, implement it and run focused verification.',
      'Record remaining escalation with exact endpoint, source, and next action.',
    ],
    guardrails: [
      'Do not analyze days-old errors unless explicitly asked.',
      'Stop retries on quota, auth, permission, or provider contract mismatch.',
      'Prefer local cache/readback before external fetches.',
      'Do not write failed provider payloads into reusable data tables.',
    ],
    verifierChecks: [
      'Recent errors were inspected from the API health/stat sink.',
      'Failure classes and root cause evidence are stated.',
      'Any changed endpoint passes fetch, persist, and query-readback when persistence is expected.',
      'No unsafe or broad external collection was performed.',
    ],
  },
  {
    id: 'daily_data_health',
    title: 'Daily Data Health',
    objective: 'Check daily market data freshness, feed status, provider health, and reusable local data coverage.',
    defaultMaxTurns: 8,
    persistentDuty: true,
    contextNeeds: ['feed configs', 'coverage summary', 'provider health', 'fetch queue', 'recent API failures'],
    successCriteria: [
      'Identify stale or missing required datasets.',
      'Run only configured daily refresh tasks that are due.',
      'Verify persisted rows are queryable after refresh.',
      'Escalate unavailable providers or repeated failures without retry loops.',
    ],
    guardrails: ['Respect provider rate limits.', 'Do not require paid providers when free/local data is sufficient.'],
    verifierChecks: ['Coverage/readback exists for refreshed datasets.', 'Failed tasks are visible with next action.'],
  },
  {
    id: 'market_pulse_refresh',
    title: 'Market Pulse Refresh',
    objective: 'Refresh stock and fund pulse data from reusable local data first, then provider routes only when stale or missing.',
    defaultMaxTurns: 6,
    persistentDuty: true,
    contextNeeds: ['pulse cache', 'stock/fund list cache', 'provider health'],
    successCriteria: ['Refresh pulse rows with names, prices, change percent, and source freshness.', 'Avoid fetch-on-render loops.'],
    guardrails: ['Do not fetch every panel render.', 'Keep stock and fund pulse paths separate.'],
    verifierChecks: ['Pulse data exists and displays source/freshness.', 'No repeated fetch loop is triggered.'],
  },
  {
    id: 'watchlist_monitor',
    title: 'Watchlist Monitor',
    objective: 'Monitor stock and fund watchlists for configured conditions and queue useful agent summaries.',
    defaultMaxTurns: 6,
    persistentDuty: true,
    contextNeeds: ['stock watchlist', 'fund watchlist', 'latest quotes/NAV', 'monitor rules'],
    successCriteria: ['Use cached data when fresh.', 'Emit actionable alerts for matched conditions only.'],
    guardrails: ['Do not mutate watchlists without user action.', 'Do not place trades.'],
    verifierChecks: ['Inputs and matched rules are visible.', 'No unsupported side effect occurred.'],
  },
  {
    id: 'dashboard_refresh',
    title: 'Dashboard Refresh',
    objective: 'Refresh existing finance dashboards from current reusable data and verify the rendered artifact exists.',
    defaultMaxTurns: 8,
    contextNeeds: ['dashboard files', 'data coverage', 'recent task status'],
    successCriteria: ['Regenerate stale dashboards.', 'Verify output file exists and data source is disclosed.'],
    guardrails: ['Do not replace user-authored dashboard structure unless requested.'],
    verifierChecks: ['Dashboard/report artifact exists.', 'Referenced data is readable.'],
  },
  {
    id: 'report_generation',
    title: 'Report Generation',
    objective: 'Generate a requested finance report with source disclosure, reusable data readback, and a durable artifact.',
    defaultMaxTurns: 12,
    contextNeeds: ['report request', 'market data coverage', 'skills', 'output path'],
    successCriteria: ['Produce the requested report artifact.', 'State assumptions, sources, and unavailable data.'],
    guardrails: ['Do not fabricate missing finance data.', 'Avoid broad paid/quota data collection without need.'],
    verifierChecks: ['Report artifact exists.', 'Source provenance is present.', 'No known required section is missing.'],
  },
  {
    id: 'provider_contract_probe',
    title: 'Provider Contract Probe',
    objective: 'Probe a provider endpoint contract carefully and update parser/normalizer/readback paths when a mismatch is confirmed.',
    defaultMaxTurns: 10,
    contextNeeds: ['provider policy', 'endpoint schema', 'recent failures', 'normalizer/tests'],
    successCriteria: [
      'Run serial low-concurrency probes.',
      'Distinguish parameter errors, transport failures, and parser/contract mismatch.',
      'Update fetch, normalize, persist, query-readback, and tests together when needed.',
    ],
    guardrails: ['Do not mark fetch-only success as reusable.', 'Stop on quota/auth/rate-limit errors.'],
    verifierChecks: ['Parser/normalizer path exists.', 'Canonical write/readback succeeds when expected.', 'Focused regression test covers the endpoint.'],
  },
]

export function getGoalTemplate(id: string): GoalTemplate | null {
  return GOAL_TEMPLATES.find((template) => template.id === id) ?? null
}

export function listGoalTemplates(): GoalTemplateId[] {
  return GOAL_TEMPLATES.map((template) => template.id)
}

export function buildGoalPrompt(template: GoalTemplate, contextSummary?: string): string {
  const sections = [
    template.objective,
    '',
    'Success criteria:',
    ...template.successCriteria.map((item) => `- ${item}`),
    '',
    'Harness guards:',
    ...template.guardrails.map((item) => `- ${item}`),
    '',
    'Verifier checks before marking complete:',
    ...template.verifierChecks.map((item) => `- ${item}`),
  ]
  if (contextSummary?.trim()) {
    sections.push('', 'Current context pack:', contextSummary.trim())
  }
  return sections.join('\n')
}
