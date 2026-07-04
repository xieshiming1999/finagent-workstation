export type UiSurfaceType =
  | 'market-bar'
  | 'status-bar'
  | 'bottom-panel'
  | 'event-console'
  | 'calendar-settings'
  | 'market-weather-background'

export type UiSurfaceFetchPolicy =
  | 'poll-readonly'
  | 'event-store'
  | 'manual-action-only'
  | 'static-display'

export interface UiSurfaceContract {
  type: UiSurfaceType
  purpose: string
  ownedData: string[]
  primaryActions: string[]
  fetchPolicy: UiSurfaceFetchPolicy
  pollIntervalMs?: number
  rotateIntervalMs?: number
  emptyState: string
  errorState: string
}

export const uiSurfaceContracts: readonly UiSurfaceContract[] = [
  {
    type: 'market-bar',
    purpose: 'Show compact major-index quotes with provenance without triggering broad market refreshes.',
    ownedData: ['index quote cache', 'index quote provenance'],
    primaryActions: ['poll index quotes', 'rotate additional indices'],
    fetchPolicy: 'poll-readonly',
    pollIntervalMs: 30000,
    rotateIntervalMs: 10000,
    emptyState: 'Show loading or unavailable market data text without hiding the app shell.',
    errorState: 'Show classified index quote failure while preserving any prior loaded quote rows.',
  },
  {
    type: 'status-bar',
    purpose: 'Reserve a stable footer/status surface for low-noise app state.',
    ownedData: ['status text'],
    primaryActions: ['display status'],
    fetchPolicy: 'static-display',
    emptyState: 'Render nothing when no status state exists.',
    errorState: 'Do not block the app if status state cannot be rendered.',
  },
  {
    type: 'bottom-panel',
    purpose: 'Host operator panels for logs, terminal placeholder, API health, and background task visibility.',
    ownedData: ['selected bottom tab', 'log tail', 'API health panel', 'task placeholder'],
    primaryActions: ['switch tab', 'close panel', 'tail logs'],
    fetchPolicy: 'poll-readonly',
    pollIntervalMs: 2000,
    emptyState: 'Show panel-specific empty state such as no logs or no active tasks.',
    errorState: 'Keep the bottom panel open and show failed log/API read state in place.',
  },
  {
    type: 'event-console',
    purpose: 'Expose event-agent conversation, queue status, cancellation, and backgrounding controls.',
    ownedData: ['event messages', 'event queue length', 'event queue pause state', 'event dropped count', 'event-agent status', 'log tail'],
    primaryActions: ['send event-agent input', 'cancel event-agent turn', 'background event-agent turn', 'pause/resume event queue', 'clear event queue', 'tail logs'],
    fetchPolicy: 'event-store',
    pollIntervalMs: 2000,
    emptyState: 'Explain that event-agent messages or background tasks will appear here.',
    errorState: 'Keep queued/event messages visible and show log read failure separately.',
  },
  {
    type: 'calendar-settings',
    purpose: 'Manage trading calendar cache, manual yearly fetches, and local day overrides.',
    ownedData: ['trading calendar cache', 'manual overrides'],
    primaryActions: ['fetch calendar year', 'toggle trading-day override', 'save calendar override'],
    fetchPolicy: 'manual-action-only',
    emptyState: 'Show missing calendar data and provide a fetch action for the selected year.',
    errorState: 'Keep visible local overrides and show calendar fetch/save failure in place.',
  },
  {
    type: 'market-weather-background',
    purpose: 'Read the latest market snapshot regime and render a non-interactive background hint.',
    ownedData: ['latest market snapshot regime'],
    primaryActions: ['poll latest snapshot file'],
    fetchPolicy: 'poll-readonly',
    pollIntervalMs: 60000,
    emptyState: 'Use a neutral regime when no snapshot exists.',
    errorState: 'Ignore failed snapshot reads and preserve the current visual regime.',
  },
] as const

const contractByType = new Map<UiSurfaceType, UiSurfaceContract>(
  uiSurfaceContracts.map((contract) => [contract.type, contract]),
)

export function uiSurfaceContract(type: UiSurfaceType): UiSurfaceContract {
  const contract = contractByType.get(type)
  if (!contract) throw new Error(`Missing UI surface contract for ${type}`)
  return contract
}
