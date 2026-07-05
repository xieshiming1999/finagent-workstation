import { describe, expect, it } from 'vitest'
import {
  isActionableFeedFailure,
  isActionableFeedTaskFailure,
} from '../../src/agent/data/data-feed-failure-policy'
import type { FeedConfig } from '../../src/agent/data/store/data-store-types'

function feed(overrides: Partial<FeedConfig>): FeedConfig {
  return {
    feed_id: 'fund_holding',
    display_name: '基金持仓',
    feed_type: 'fund_holding',
    enabled: 1,
    scope: 'watchlist',
    scope_codes: null,
    history_years: 1,
    update_frequency: 'daily',
    trigger_time: '09:30',
    source_priority: 'auto',
    status: 'idle',
    last_run_at: null,
    last_error: null,
    config_json: null,
    updated_at: null,
    ...overrides,
  }
}

describe('data feed failure policy', () => {
  it('keeps feed config waiting states out of actionable provider failures', () => {
    expect(isActionableFeedFailure(feed({
      enabled: 0,
      status: 'failed',
      last_error: 'All providers failed',
    }))).toBe(false)
    expect(isActionableFeedFailure(feed({
      status: 'waiting_prerequisite',
      last_error: 'Feed 基金持仓 is waiting for prerequisite data: fund_list is required to resolve all-fund feed scope.',
    }))).toBe(false)
    expect(isActionableFeedFailure(feed({
      status: 'idle',
      last_error: 'Feed 基金持仓 needs codes. Add items to the related watchlist or set scope_codes.',
    }))).toBe(false)
    expect(isActionableFeedFailure(feed({
      status: 'failed',
      last_error: 'manual data-feed verification recovered stale active task',
    }))).toBe(false)
  })

  it('keeps task waiting states out of feed-run failures', () => {
    expect(isActionableFeedTaskFailure({
      status: 'failed',
      code: null,
      error: 'code required',
    })).toBe(false)
    expect(isActionableFeedTaskFailure({
      status: 'failed',
      code: '000580',
      error: 'stale active task recovered on startup',
    })).toBe(false)
    expect(isActionableFeedTaskFailure({
      status: 'failed',
      code: '110022',
      error: 'All fund holding interface providers failed: akshare: AkShare fund holding failed: 500',
    })).toBe(true)
  })
})
