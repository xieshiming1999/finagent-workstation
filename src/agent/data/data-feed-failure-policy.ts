export interface FeedConfigFailureLike {
  enabled?: unknown
  status?: unknown
  last_error?: unknown
}

export interface FeedTaskFailureLike {
  status?: unknown
  error?: unknown
  code?: unknown
}

export function isActionableFeedFailure(feed: FeedConfigFailureLike): boolean {
  if (Number(feed.enabled) === 0) return false
  if (feed.status === 'waiting_prerequisite') return false
  const error = String(feed.last_error ?? '').toLowerCase()
  if (isStaleOrRecoveredDataFeedError(error)) return false
  if (feed.status !== 'failed' && feed.status !== 'error' && !feed.last_error) return false
  if (error.startsWith('feed ') && error.includes(' needs codes.')) return false
  return true
}

export function isActionableFeedTaskFailure(task: FeedTaskFailureLike): boolean {
  if (task.status !== 'failed') return false
  const error = String(task.error ?? '').toLowerCase()
  if (isStaleOrRecoveredDataFeedError(error)) return false
  if (!task.code && error.startsWith('code required')) return false
  return true
}

export function isStaleOrRecoveredDataFeedError(error: string): boolean {
  return error.includes('manual data-feed verification recovered stale active task')
    || error.includes('manual verification interrupted before completion')
    || error.includes('stale active task recovered on startup')
    || error.includes('recovered stale active task')
}
