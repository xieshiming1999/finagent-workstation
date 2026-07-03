import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { DataStore } from './data/store/data-store'
import type { ReusableDataSummaryRow } from './data/store/data-store-reuse'
import type { GoalTemplateId, GoalTrigger } from './goal-automation-types'
import { ArtifactRegistry } from './artifact-registry'
import { classifyApiFailures, isFinanceApiFailure } from './api-failure-classifier'
import type { ApiFailureClass } from './api-failure-classifier'

export interface GoalContextPack {
  id: string
  templateId: GoalTemplateId
  trigger: GoalTrigger
  createdAt: string
  recentApiFailures: Array<Record<string, unknown>>
  recentApiFailureClasses: ApiFailureClass[]
  providerHealth: Array<Record<string, unknown>>
  activeTasks: Array<Record<string, unknown>>
  sessionState: Record<string, unknown>
  watchlists: Record<string, unknown>
  dataCoverage: ReusableDataSummaryRow[]
  relevantFiles: string[]
  relevantSkills: string[]
}

export function buildGoalContextPack(args: {
  basePath: string
  templateId: GoalTemplateId
  trigger: GoalTrigger
  dataStore?: DataStore | null
  minutes?: number
  sessionState?: Record<string, unknown>
}): { pack: GoalContextPack; path: string; summary: string } {
  const id = `${args.templateId}-${Date.now()}`
  const ds = args.dataStore?.isReady ? args.dataStore : null
  const minutes = Math.max(1, Math.min(1440, args.minutes ?? 30))
  const since = new Date(Date.now() - minutes * 60_000).toISOString()
  const rawRecentApiFailures = ds
    ? ds.query<Record<string, unknown>>(
      'SELECT * FROM api_call_log WHERE created_at >= ? AND success = 0 ORDER BY created_at DESC LIMIT 80',
      since,
    )
    : []
  const recentApiFailures = args.templateId === 'api_error_triage'
    ? rawRecentApiFailures.filter(isFinanceApiFailure)
    : rawRecentApiFailures
  const recentApiFailureClasses = classifyApiFailures(recentApiFailures)
  const activeTasks = ds
    ? ds.query<Record<string, unknown>>(
      "SELECT * FROM fetch_tasks WHERE status IN ('pending','running','failed') ORDER BY created_at DESC LIMIT 50",
    )
    : []
  const rawProviderHealth = ds
    ? Object.entries(ds.getApiCallSummary(minutes)).map(([source, summary]) => ({ source, ...summary }))
    : []
  const providerHealth =
    args.templateId === 'api_error_triage' ? rawProviderHealth.filter(isFinanceApiFailure) : rawProviderHealth
  const dataCoverage = ds ? ds.getReusableDataSummary().slice(0, 80) : []
  const pack: GoalContextPack = {
    id,
    templateId: args.templateId,
    trigger: args.trigger,
    createdAt: new Date().toISOString(),
    recentApiFailures,
    recentApiFailureClasses,
    providerHealth,
    activeTasks,
    sessionState: args.sessionState ?? {},
    watchlists: readWatchlists(args.basePath),
    dataCoverage,
    relevantFiles: relevantFilesForTemplate(args.templateId),
    relevantSkills: skillsForTemplate(args.templateId),
  }
  const dir = join(args.basePath, 'memory', 'goal-context')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const path = join(dir, `${id}.json`)
  writeFileSync(path, JSON.stringify(pack, null, 2), 'utf-8')
  registerContextArtifacts(args.basePath, pack, path, minutes)
  return { pack, path, summary: summarizeContextPack(pack, path, minutes) }
}

function registerContextArtifacts(basePath: string, pack: GoalContextPack, path: string, minutes: number): void {
  const registry = new ArtifactRegistry(basePath)
  const expiresAt = new Date(new Date(pack.createdAt).getTime() + minutes * 60_000).toISOString()
  registry.register({
    kind: 'context_pack',
    path,
    title: `Goal context pack: ${pack.templateId}`,
    source: 'goal-context-pack',
    id: `context_pack:${pack.id}`,
    ownerTask: pack.templateId,
    expiresAt,
    verificationStatus: 'verified',
    freshness: {
      sourceTime: pack.createdAt,
      fetchedAt: pack.createdAt,
      windowMinutes: minutes,
      status: 'fresh',
    },
    provenance: {
      source: 'goal-context-pack',
      trigger: pack.trigger,
      dataSources: ['api_call_log', 'fetch_tasks', 'provider_health', 'watchlists', 'reusable_data_summary'],
    },
    metadata: {
      templateId: pack.templateId,
      trigger: pack.trigger,
      recentApiFailures: pack.recentApiFailures.length,
      activeTasks: pack.activeTasks.length,
      windowMinutes: minutes,
    },
  })
  if (pack.recentApiFailures.length > 0 || pack.templateId === 'api_error_triage') {
    registry.register({
      kind: 'api_error',
      path,
      title: `API error context: ${pack.templateId}`,
      source: 'goal-context-pack',
      id: `api_error:${pack.id}`,
      ownerTask: pack.templateId,
      expiresAt,
      verificationStatus: 'verified',
      freshness: {
        sourceTime: pack.createdAt,
        fetchedAt: pack.createdAt,
        windowMinutes: minutes,
        status: pack.recentApiFailures.length > 0 ? 'fresh' : 'unknown',
      },
      provenance: {
        source: 'api_call_log',
        trigger: pack.trigger,
        classifier: 'api-failure-classifier',
      },
      metadata: {
        trigger: pack.trigger,
        recentApiFailures: pack.recentApiFailures.length,
        classes: pack.recentApiFailureClasses,
        windowMinutes: minutes,
      },
    })
  }
}

function readWatchlists(basePath: string): Record<string, unknown> {
  const candidates = [
    join(basePath, 'watchlists.json'),
    join(basePath, 'memory', 'watchlists.json'),
    join(basePath, 'memory', 'watchlist.json'),
    join(basePath, 'fund_watchlists.json'),
    join(basePath, 'memory', 'fund_watchlists.json'),
    join(basePath, 'memory', 'fund-watchlist.json'),
  ]
  const out: Record<string, unknown> = {}
  for (const file of candidates) {
    if (!existsSync(file)) continue
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf-8'))
      if (file.endsWith('watchlists.json')) {
        out.unified = parsed
      } else if (file.includes('fund')) {
        out.fund = parsed
      } else {
        out.stock = parsed
      }
    } catch {
      out[file] = 'unreadable'
    }
  }
  return out
}

function skillsForTemplate(templateId: GoalTemplateId): string[] {
  switch (templateId) {
    case 'api_error_triage':
    case 'provider_contract_probe':
      return ['api-diagnostics', 'data-sources']
    case 'daily_data_health':
      return ['data-management', 'data-sources']
    case 'market_pulse_refresh':
      return ['market-overview', 'fund']
    case 'watchlist_monitor':
      return ['monitor-templates', 'scheduled-analysis']
    case 'dashboard_refresh':
      return ['dashboard', 'live-dashboard']
    case 'report_generation':
      return ['finance-report', 'html-artifact']
  }
}

function relevantFilesForTemplate(templateId: GoalTemplateId): string[] {
  switch (templateId) {
    case 'api_error_triage':
    case 'provider_contract_probe':
      return [
        'finagent_workstation/src/agent/data/provider-policy.ts',
        'finagent_workstation/src/agent/tools/data-store-tool-queries.ts',
        'finagent_workstation/src/agent/data/store/data-store-reuse.ts',
      ]
    case 'daily_data_health':
      return [
        'finagent_workstation/src/agent/data/queue/fetch-queue.ts',
        'finagent_workstation/src/agent/data/queue/fetch-scheduler.ts',
        'finagent_workstation/src/renderer/components/DataWidget.tsx',
      ]
    case 'market_pulse_refresh':
      return [
        'finagent_workstation/src/agent/data/market-snapshot.ts',
        'finagent_workstation/src/renderer/components/MarketPulseWidget.tsx',
        'finagent_workstation/src/renderer/components/FundPulseWidget.tsx',
      ]
    case 'watchlist_monitor':
      return [
        'finagent_workstation/src/agent/watchlist-refresher.ts',
        'finagent_workstation/src/renderer/components/WatchlistWidget.tsx',
        'finagent_workstation/src/renderer/components/FundWatchlistWidget.tsx',
      ]
    case 'dashboard_refresh':
      return ['finagent_workstation/src/agent/tools/dashboard.ts', 'finagent_workstation/src/renderer/panels/DashboardPanel.tsx']
    case 'report_generation':
      return ['finagent_workstation/assets/skills/finance-report/skill.md', 'finagent_workstation/assets/skills/html-artifact/skill.md']
  }
}

function summarizeContextPack(pack: GoalContextPack, path: string, minutes: number): string {
  const failures = pack.recentApiFailures.slice(0, 8).map((row) => {
    const source = String(row.source ?? '-')
    const endpoint = String(row.endpoint ?? '').replace(/^https?:\/\/[^/]+/i, '')
    const error = row.error ? ` error=${String(row.error).slice(0, 120)}` : ''
    return `- ${row.created_at ?? row.timestamp ?? '-'} ${source} ${endpoint}${error}`
  })
  return [
    `Context pack path: ${path}`,
    `Recent failure window: ${minutes} minutes`,
    `Recent API failures: ${pack.recentApiFailures.length}`,
    `Recent API failure classes: ${pack.recentApiFailureClasses.map((row) => `${row.classification}:${row.count}`).join(', ') || '-'}`,
    ...failures,
    `Active/failed data tasks: ${pack.activeTasks.length}`,
    `Session state keys: ${Object.keys(pack.sessionState).join(', ') || '-'}`,
    `Provider health rows: ${pack.providerHealth.length}`,
    `Reusable data summaries: ${pack.dataCoverage.length}`,
    `Relevant files: ${pack.relevantFiles.join(', ') || '-'}`,
    `Relevant skills: ${pack.relevantSkills.join(', ') || '-'}`,
  ].join('\n')
}
