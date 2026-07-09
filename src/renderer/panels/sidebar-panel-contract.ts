export type WidgetType = 'watchlist' | 'fund-watchlist' | 'pulse' | 'fund-pulse' | 'factor-radar' | 'calendar' | 'news' | 'research' | 'api-health' | 'portfolio' | 'session' | 'sessions' | 'data' | 'strategy-library'

export type SidebarWidgetCategory = 'user' | 'system' | 'agent'

export type SidebarRefreshPolicy = 'cache-first' | 'manual-or-stale' | 'recent-window' | 'session-index'
export type SidebarRenderFetchPolicy = 'read-cache-only' | 'poll-readonly' | 'manual-action-only'

export interface SidebarPanelContract {
  type: WidgetType
  category: SidebarWidgetCategory
  purpose: string
  ownedData: string[]
  primaryActions: string[]
  refreshPolicy: SidebarRefreshPolicy
  renderFetchPolicy: SidebarRenderFetchPolicy
  pollIntervalMs?: number
  emptyState: string
  errorState: string
}

export const sidebarPanelContracts: readonly SidebarPanelContract[] = [
  {
    type: 'pulse',
    category: 'user',
    purpose: 'Summarize current stock market breadth, hot stocks, and actionable stock candidates.',
    ownedData: ['index snapshots', 'limit pool', 'sector movers', 'hot stock ranking', 'stock identity cache'],
    primaryActions: ['refresh cached pulse', 'add stock to watchlist', 'copy code', 'start analysis/dashboard workflow'],
    refreshPolicy: 'manual-or-stale',
    renderFetchPolicy: 'poll-readonly',
    pollIntervalMs: 60000,
    emptyState: 'Explain that cached pulse data is unavailable and offer refresh or data task recovery.',
    errorState: 'Show provider/API failure with source and recent timestamp rather than clearing prior cache.',
  },
  {
    type: 'watchlist',
    category: 'user',
    purpose: 'Track user-selected stocks with cached identity, latest quote, change, and volume.',
    ownedData: ['stock watchlist', 'stock identity cache', 'quote snapshot'],
    primaryActions: ['search stock', 'add stock', 'remove stock', 'refresh quotes'],
    refreshPolicy: 'cache-first',
    renderFetchPolicy: 'poll-readonly',
    pollIntervalMs: 15000,
    emptyState: 'Offer a stock search/add workflow and suggested hot stocks.',
    errorState: 'Keep the saved list visible and show quote refresh failure separately.',
  },
  {
    type: 'fund-pulse',
    category: 'user',
    purpose: 'Summarize cached ETF and fund market movement for fund discovery.',
    ownedData: ['fund list', 'fund NAV snapshots', 'ETF list', 'ETF quote snapshots'],
    primaryActions: ['refresh fund pulse cache', 'queue fund data tasks', 'add fund to watchlist'],
    refreshPolicy: 'manual-or-stale',
    renderFetchPolicy: 'poll-readonly',
    pollIntervalMs: 60000,
    emptyState: 'Explain which fund caches are missing and offer refresh/data tasks.',
    errorState: 'Show failed fund data source and preserve last successful cache when available.',
  },
  {
    type: 'fund-watchlist',
    category: 'user',
    purpose: 'Track user-selected funds with cached name, NAV, daily return, and longer returns.',
    ownedData: ['fund watchlist', 'fund list', 'fund NAV snapshots'],
    primaryActions: ['search fund', 'add fund', 'remove fund', 'refresh fund data'],
    refreshPolicy: 'cache-first',
    renderFetchPolicy: 'read-cache-only',
    emptyState: 'Offer fund search/add workflow and suggested funds.',
    errorState: 'Keep the saved fund list visible and show data refresh failure separately.',
  },
  {
    type: 'factor-radar',
    category: 'user',
    purpose: 'Display macro research, policy, index-provider, cross-asset, and official-source evidence with provenance before it is used in analysis.',
    ownedData: ['market_moving_factor_v1 rows', 'macro research source registry', 'source/fetched timestamps', 'retrieval failure classifications'],
    primaryActions: ['refresh macro research evidence', 'open source', 'copy evidence', 'send selected evidence to agent'],
    refreshPolicy: 'manual-or-stale',
    renderFetchPolicy: 'poll-readonly',
    pollIntervalMs: 300000,
    emptyState: 'Explain that no macro research evidence exists and offer refresh.',
    errorState: 'Show source/credential/network/parse failure without clearing prior evidence rows.',
  },
  {
    type: 'news',
    category: 'user',
    purpose: 'Show finance news with readable headlines, source/time, summaries, and safe open actions.',
    ownedData: ['news feed cache', 'news article URLs'],
    primaryActions: ['refresh news', 'open article externally', 'send article to agent'],
    refreshPolicy: 'manual-or-stale',
    renderFetchPolicy: 'poll-readonly',
    pollIntervalMs: 300000,
    emptyState: 'Explain no cached news and offer refresh.',
    errorState: 'Reject unsafe or missing URLs and show feed failure without opening a blank page.',
  },
  {
    type: 'research',
    category: 'user',
    purpose: 'Collect research artifacts with hypotheses, evidence, citations, drafts, and unverified items.',
    ownedData: ['research artifact registry', 'research evidence files', 'citation links', 'unverified research items'],
    primaryActions: ['review evidence', 'open citation', 'continue research with agent', 'draft report from artifacts'],
    refreshPolicy: 'cache-first',
    renderFetchPolicy: 'poll-readonly',
    pollIntervalMs: 30000,
    emptyState: 'Explain that no research artifacts exist and prompt the user to run Research or report-analysis workflows.',
    errorState: 'Show research artifact read failure without clearing older visible artifacts.',
  },
  {
    type: 'data',
    category: 'system',
    purpose: 'Manage local market data cache, source routing, queue status, and data task recovery.',
    ownedData: ['data cache summary', 'fetch queue', 'source connectivity', 'routing policy'],
    primaryActions: ['run data task', 'inspect cache', 'test source', 'open full data manager'],
    refreshPolicy: 'cache-first',
    renderFetchPolicy: 'poll-readonly',
    pollIntervalMs: 5000,
    emptyState: 'Show cache counts and explain which core datasets are missing.',
    errorState: 'Group task/source failures with retry guidance and recent timestamps.',
  },
  {
    type: 'strategy-library',
    category: 'system',
    purpose: 'Inspect saved governed strategy artifacts, evidence, rerun status, and agent-mediated watch or monitor actions.',
    ownedData: ['custom strategy library', 'strategy evidence', 'strategy lifecycle state'],
    primaryActions: ['rerun strategy', 'add watch', 'create monitor', 'inspect strategy evidence'],
    refreshPolicy: 'cache-first',
    renderFetchPolicy: 'poll-readonly',
    pollIntervalMs: 15000,
    emptyState: 'Explain that no governed strategies have been saved yet.',
    errorState: 'Show strategy library read failure without hiding existing strategy state.',
  },
  {
    type: 'api-health',
    category: 'system',
    purpose: 'Triage recent provider/API errors and distinguish network, timeout, and contract failures.',
    ownedData: ['api_call_log recent window', 'endpoint health groups'],
    primaryActions: ['refresh recent errors', 'filter time window', 'inspect endpoint group'],
    refreshPolicy: 'recent-window',
    renderFetchPolicy: 'poll-readonly',
    pollIntervalMs: 10000,
    emptyState: 'State that no recent API calls or failures exist for the selected window.',
    errorState: 'Show API health read failure while preserving any loaded recent summary.',
  },
  {
    type: 'session',
    category: 'agent',
    purpose: 'List resumable working sessions and make resume an explicit action.',
    ownedData: ['session index', 'active session metadata'],
    primaryActions: ['resume session', 'preview session metadata'],
    refreshPolicy: 'session-index',
    renderFetchPolicy: 'read-cache-only',
    emptyState: 'Explain that no resumable sessions are indexed yet.',
    errorState: 'Show session index/read failure without changing the active session.',
  },
  {
    type: 'sessions',
    category: 'agent',
    purpose: 'Provide read-only conversation history/audit stream without switching active session on row selection.',
    ownedData: ['immutable session history', 'history previews', 'message counts'],
    primaryActions: ['search history', 'preview conversation', 'open archived session read-only'],
    refreshPolicy: 'session-index',
    renderFetchPolicy: 'read-cache-only',
    emptyState: 'Explain that no archived history is available yet.',
    errorState: 'Show failed history read/search while preserving active working session.',
  },
  {
    type: 'calendar',
    category: 'system',
    purpose: 'Inspect trading calendar cache and fetch status.',
    ownedData: ['trading calendar rows', 'calendar fetch status'],
    primaryActions: ['fetch calendar year', 'inspect trading days'],
    refreshPolicy: 'cache-first',
    renderFetchPolicy: 'manual-action-only',
    emptyState: 'Show missing calendar year and offer a fetch action.',
    errorState: 'Show provider/calendar fetch failure and current cached year if available.',
  },
  {
    type: 'portfolio',
    category: 'user',
    purpose: 'Summarize portfolio state and user positions when configured.',
    ownedData: ['portfolio holdings', 'position snapshots'],
    primaryActions: ['inspect holdings', 'refresh portfolio'],
    refreshPolicy: 'cache-first',
    renderFetchPolicy: 'poll-readonly',
    pollIntervalMs: 30000,
    emptyState: 'Explain that no portfolio is configured.',
    errorState: 'Show portfolio read failure without hiding existing positions.',
  },
] as const

export const defaultSidebarWidgetTypes: WidgetType[] = [
  'pulse',
  'watchlist',
  'fund-pulse',
  'fund-watchlist',
  'factor-radar',
  'news',
  'data',
  'strategy-library',
  'api-health',
  'session',
  'sessions',
]

const contractByType = new Map<WidgetType, SidebarPanelContract>(
  sidebarPanelContracts.map((contract) => [contract.type, contract]),
)

export function sidebarPanelContract(type: WidgetType): SidebarPanelContract {
  const contract = contractByType.get(type)
  if (!contract) throw new Error(`Missing sidebar panel contract for ${type}`)
  return contract
}

export function sidebarWidgetCategory(type: WidgetType): SidebarWidgetCategory {
  return sidebarPanelContract(type).category
}
