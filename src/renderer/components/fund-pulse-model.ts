import { buildAnalysisActionPrompt } from '../../domain/market/analysis/analysis-evidence-contract'

export interface FundPulseData {
  etfMovers: EtfMover[]
  fundLeaders: FundLeader[]
  navMovers: FundLeader[]
  cache?: FundPulseCache
  tasks?: FundTask[]
  staleInfo?: FundPulseStaleInfo
}

export interface FundPulseCache {
  fundListCount: number
  fundNavCount: number
  fundPerformanceCount?: number
  etfCount: number
  etfQuoteCount: number
}

export interface FundTask {
  id: number
  task_type: string
  code: string | null
  status: string
  created_at?: string
  updated_at?: string
  error?: string | null
  progress?: string | null
}

export interface FundPulseStaleInfo {
  fundLeaderStaleCount: number
  navMoverStaleCount: number
  latestFundLeaderDate?: string | null
  latestNavMoverDate?: string | null
}

export interface EtfMover {
  code: string
  name: string
  price: number | null
  change_pct: number | null
  volume: number | null
  timestamp: string | null
  fetched_at?: string | null
  source?: string | null
  provider_time?: string | null
  cache_status?: string | null
}

export interface FundLeader {
  code: string
  name: string
  fund_type?: string | null
  company?: string | null
  nav?: number | null
  nav_date?: string | null
  daily_return?: number | null
  return_ytd?: number | null
  return_1y?: number | null
  source?: string | null
  provider_time?: string | null
  fetched_at?: string | null
  updated_at?: string | null
  cache_status?: string | null
}

export type FundPulseAction = 'analyze' | 'compare' | 'dashboard'
export type FundPulseTargetKind = 'etf' | 'fund' | 'nav'

export interface FundPulseActionTarget {
  kind: FundPulseTargetKind
  code: string
  name: string
}

export type FundPulseState = 'ready' | 'empty-cache' | 'building' | 'failed'

export interface FundPulseSummary {
  state: FundPulseState
  hasRows: boolean
  cacheRows: number
  activeTasks: FundTask[]
  failedTasks: FundTask[]
  visibleTasks: FundTask[]
}

export function buildFundPulseSummary(data: FundPulseData): FundPulseSummary {
  const hasRows = data.etfMovers.length > 0 || data.fundLeaders.length > 0 || data.navMovers.length > 0
  const tasks = data.tasks ?? []
  const activeTasks = tasks.filter((task) => task.status === 'running' || task.status === 'pending')
  const failedTasks = tasks.filter((task) => task.status === 'failed')
  const cacheRows =
    (data.cache?.fundListCount ?? 0) +
    (data.cache?.fundNavCount ?? 0) +
    (data.cache?.fundPerformanceCount ?? 0) +
    (data.cache?.etfCount ?? 0) +
    (data.cache?.etfQuoteCount ?? 0)

  let state: FundPulseState = 'ready'
  if (!hasRows && failedTasks.length > 0) state = 'failed'
  else if (!hasRows && activeTasks.length > 0) state = 'building'
  else if (!hasRows) state = 'empty-cache'

  return {
    state,
    hasRows,
    cacheRows,
    activeTasks,
    failedTasks,
    visibleTasks: [
      ...failedTasks,
      ...activeTasks,
      ...tasks.filter((task) => task.status !== 'failed' && task.status !== 'running' && task.status !== 'pending'),
    ].slice(0, 6),
  }
}

export function buildFundPulseActionPrompt(action: FundPulseAction, target: FundPulseActionTarget): string {
  return buildAnalysisActionPrompt({
    action,
    kind: 'fund_analysis',
    sourceSurface: 'the Fund Pulse panel',
    subject: {
      type: target.kind === 'nav' ? 'fund_nav_mover' : target.kind,
      id: target.code,
      name: target.name,
    },
  })
}
