import type { WidgetType } from '../panels/sidebar-panel-contract'

export type ProductSurfaceSmokeState = 'empty' | 'loading' | 'error' | 'cached'

export interface ProductSurfaceSmokeContract {
  id: string
  title: string
  sidebarType?: WidgetType
  states: readonly ProductSurfaceSmokeState[]
  evidence: readonly string[]
  residualGap?: string
}

export const requiredProductSurfaceSmokeContracts: readonly ProductSurfaceSmokeContract[] = [
  {
    id: 'stock-market-pulse',
    title: 'Stock Market Pulse',
    sidebarType: 'pulse',
    states: ['empty', 'loading', 'error', 'cached'],
    evidence: [
      'sidebarPanelContract("pulse") documents empty/error/cache-first policy',
      'MarketPulseWidget renders loading, error, and no-snapshot states through market-pulse-model',
      'product-surface-state-models.test.ts proves Stock Market Pulse loading, empty, error, and cached states',
      'market-pulse-format.test.ts covers row formatting and labels',
    ],
  },
  {
    id: 'fund-pulse',
    title: 'Fund Pulse',
    sidebarType: 'fund-pulse',
    states: ['empty', 'loading', 'error', 'cached'],
    evidence: [
      'fund-pulse-model.test.ts proves ready, empty-cache, building, and failed states',
      'sidebarPanelContract("fund-pulse") documents missing-cache and source-failure behavior',
    ],
  },
  {
    id: 'stock-watchlist',
    title: 'Stock Watchlist',
    sidebarType: 'watchlist',
    states: ['empty', 'loading', 'error', 'cached'],
    evidence: [
      'watchlist-picker-model.test.ts proves cached search and suggestion behavior',
      'WatchlistWidget preserves fallback rows before quote refresh through watchlist-model',
      'product-surface-state-models.test.ts proves Stock Watchlist saved, fallback, empty, and error states',
      'sidebarPanelContract("watchlist") documents saved-list preservation on quote errors',
    ],
  },
  {
    id: 'fund-watchlist',
    title: 'Fund Watchlist',
    sidebarType: 'fund-watchlist',
    states: ['empty', 'loading', 'error', 'cached'],
    evidence: [
      'fund-watchlist-model.test.ts proves saved rows survive missing fetched NAV data',
      'fund-watchlist-model.test.ts proves fetched cached rows merge without dropping saved rows',
      'sidebarPanelContract("fund-watchlist") documents read-cache-only rendering',
    ],
  },
  {
    id: 'data-manager',
    title: 'Data Manager',
    sidebarType: 'data',
    states: ['empty', 'loading', 'error', 'cached'],
    evidence: [
      'data-widget-model.test.ts summarizes cache, queue, source, and feed health',
      'data-widget-model.test.ts classifies timeout and all-sources task failures',
      'sidebarPanelContract("data") documents cache counts and grouped failures',
    ],
  },
  {
    id: 'api-health',
    title: 'API Health',
    sidebarType: 'api-health',
    states: ['empty', 'loading', 'error', 'cached'],
    evidence: [
      'api-health-panel.test.ts filters recent debug windows and groups endpoint failures',
      'sidebarPanelContract("api-health") documents recent-window behavior',
    ],
  },
  {
    id: 'history-audit-stream',
    title: 'History Audit Stream',
    sidebarType: 'sessions',
    states: ['empty', 'loading', 'error', 'cached'],
    evidence: [
      'session-preview-controller.test.ts proves stale loading/error results cannot replace the selected preview',
      'sidebarPanelContract("sessions") documents read-only audit stream behavior',
      'session-hygiene.test.ts covers history/session persistence hygiene',
    ],
  },
  {
    id: 'session-panel',
    title: 'Session Panel',
    sidebarType: 'session',
    states: ['empty', 'loading', 'error', 'cached'],
    evidence: [
      'session-preview-controller.test.ts proves selected preview loading settlement',
      'session-restore.test.ts covers renderer session restoration',
      'sidebarPanelContract("session") documents explicit resume behavior',
    ],
  },
  {
    id: 'portfolio-risk',
    title: 'Portfolio / Risk',
    sidebarType: 'portfolio',
    states: ['empty', 'loading', 'error', 'cached'],
    evidence: [
      'sidebarPanelContract("portfolio") documents empty/error behavior',
      'finance-risk-policy.test.ts and finance_risk_policy_test.dart cover portfolio mutation gates',
      'PortfolioCard renders loading, read-error, no-data, and cached states through portfolio-model',
      'product-surface-state-models.test.ts proves Portfolio/Risk loading, empty, error, and cached states',
    ],
  },
  {
    id: 'task-goal-view',
    title: 'Task / Goal View',
    sidebarType: 'data',
    states: ['empty', 'loading', 'error', 'cached'],
    evidence: [
      'goal-automation-view-model.test.ts surfaces decision history, active work packets, verifier failures, and task summaries',
      'data-widget-model.test.ts summarizes active and failed queue tasks',
      'DataWidget hosts task/goal display inside the data manager surface',
    ],
  },
] as const

export function productSurfaceSmokeContract(id: string): ProductSurfaceSmokeContract {
  const contract = requiredProductSurfaceSmokeContracts.find((surface) => surface.id === id)
  if (!contract) throw new Error(`Missing product surface smoke contract for ${id}`)
  return contract
}
