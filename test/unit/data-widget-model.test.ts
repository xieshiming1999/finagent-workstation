import { describe, expect, it } from 'vitest'
import {
  buildDataWidgetSummary,
  buildDataHealthQueueDisplayText,
  buildDataHealthQueueTitle,
  buildFailureEvidenceText,
  buildInterfaceProvenanceText,
  buildProviderEvidenceText,
  classifyDataTaskFailure,
  dataSurfaceContractSteps,
  isActionableFeedFailure,
  isActionableFetchTaskFailure,
} from '../../src/renderer/components/data-widget-model'

describe('data widget product summary model', () => {
  it('summarizes cache, queue, source, and feed health without provider calls', () => {
    const summary = buildDataWidgetSummary({
      stats: {
        sizeBytes: 2 * 1048576,
        tables: [
          { name: 'quote_snapshot', count: 10 },
          { name: 'kline_daily', count: 30 },
        ],
        reusable: Array.from({ length: 8 }, (_, index) => ({
          name: `dataset_${index}`,
          count: index + 1,
          latest: index === 0 ? '2026-06-15' : null,
          sources: index === 0 ? 'tdx:10' : null,
        })),
      },
      tasks: [
        { id: 1, task_type: 'kline_daily', code: '600519', status: 'running', error: null },
        { id: 2, task_type: 'stock_list', code: null, status: 'pending', error: null },
        { id: 3, task_type: 'fund_nav', code: '110022', status: 'failed', error: 'timeout' },
        { id: 5, task_type: 'fund_money_yield', code: '000580', status: 'failed', error: 'manual data-feed verification recovered stale active task' },
        { id: 6, task_type: 'fund_holding', code: null, status: 'failed', error: 'code required' },
        { id: 7, task_type: 'northbound', code: null, status: 'failed', error: 'manual verification interrupted before completion' },
        { id: 4, task_type: 'fund_list', code: null, status: 'done', error: null },
      ],
      sources: [
        { source: 'tdx', status: 'online', active: 0, errorCount: 0 },
        { source: 'eastmoney', status: 'degraded', active: 0, errorCount: 3 },
        { source: 'akshare', status: 'offline', active: 0, errorCount: 2 },
      ],
      feeds: [
        { feed_id: 'quote', display_name: 'Quotes', enabled: 1, status: 'idle', last_run_at: null, last_error: null },
        { feed_id: 'disabled_fund', display_name: 'Disabled Funds', enabled: 0, status: 'failed', last_run_at: null, last_error: 'All sources failed' },
        { feed_id: 'stale_fund', display_name: 'Stale Funds', enabled: 1, status: 'failed', last_run_at: null, last_error: 'manual data-feed verification recovered stale active task' },
        { feed_id: 'fund', display_name: 'Funds', enabled: 1, status: 'failed', last_run_at: null, last_error: 'All sources failed' },
      ],
    })

    expect(summary.totalRows).toBe(40)
    expect(summary.sizeMb).toBe('2.0')
    expect(summary.reusable).toHaveLength(6)
    expect(summary.reusable[0].sources).toBe('tdx:10')
    expect(summary.activeTasks.map((task) => task.id)).toEqual([1, 2])
    expect(summary.failedTasks.map((task) => task.id)).toEqual([3])
    expect(summary.offlineSources).toBe(2)
    expect(summary.enabledFeeds.map((feed) => feed.feed_id)).toEqual(['quote', 'stale_fund', 'fund'])
    expect(summary.feedFailures.map((feed) => feed.feed_id)).toEqual(['fund'])
    expect(summary.healthState).toBe('attention')
  })

  it('keeps interrupted manual verification rows out of current failure health', () => {
    expect(isActionableFetchTaskFailure({
      id: 1,
      task_type: 'fund_money_yield',
      code: '000580',
      status: 'failed',
      error: 'manual data-feed verification recovered stale active task',
    })).toBe(false)
    expect(isActionableFetchTaskFailure({
      id: 2,
      task_type: 'fund_holding',
      code: null,
      status: 'failed',
      error: 'code required',
    })).toBe(false)
    expect(isActionableFetchTaskFailure({
      id: 4,
      task_type: 'northbound',
      code: null,
      status: 'failed',
      error: 'manual verification interrupted before completion',
    })).toBe(false)
    expect(isActionableFetchTaskFailure({
      id: 5,
      task_type: 'kline_batch',
      code: null,
      status: 'failed',
      error: 'stale active task recovered on startup',
    })).toBe(false)
    expect(isActionableFetchTaskFailure({
      id: 3,
      task_type: 'fund_holding',
      code: '000030',
      status: 'failed',
      error: 'All fund holding interface providers failed: akshare: AkShare fund holding failed: 500',
    })).toBe(true)
  })

  it('keeps stale or inactive feed rows out of current feed failure health', () => {
    expect(isActionableFeedFailure({
      feed_id: 'disabled',
      display_name: 'Disabled',
      enabled: 0,
      status: 'failed',
      last_run_at: null,
      last_error: 'All sources failed',
    })).toBe(false)
    expect(isActionableFeedFailure({
      feed_id: 'stale',
      display_name: 'Stale',
      enabled: 1,
      status: 'failed',
      last_run_at: null,
      last_error: 'manual data-feed verification recovered stale active task',
    })).toBe(false)
    expect(isActionableFeedFailure({
      feed_id: 'needs_codes',
      display_name: 'Needs Codes',
      enabled: 1,
      status: 'idle',
      last_run_at: null,
      last_error: 'Feed 基金持仓 needs codes. Add items to the related watchlist or set scope_codes.',
    })).toBe(false)
    expect(isActionableFeedFailure({
      feed_id: 'waiting',
      display_name: 'Waiting',
      enabled: 1,
      status: 'waiting_prerequisite',
      last_run_at: null,
      last_error: 'Feed 基金持仓 is waiting for prerequisite data: fund_list is required to resolve all-fund feed scope. The target feed has not run yet.',
    })).toBe(false)
    expect(isActionableFeedFailure({
      feed_id: 'current',
      display_name: 'Current',
      enabled: 1,
      status: 'failed',
      last_run_at: null,
      last_error: 'All sources failed',
    })).toBe(true)
  })

  it('classifies task failure messages for actionable recovery text', () => {
    expect(classifyDataTaskFailure({ error: 'The operation was aborted due to timeout' })).toBe('timeout')
    expect(classifyDataTaskFailure({ error: 'All sources failed for stock list' })).toBe('all-sources')
    expect(classifyDataTaskFailure({ error: 'provider contract mismatch' })).toBe('generic')
    expect(classifyDataTaskFailure({ error: null })).toBe('generic')
  })

  it('formats interface provenance for compact data-health rows', () => {
    expect(buildInterfaceProvenanceText({
      canonicalSchema: 'quote_snapshot',
      readbackAction: 'query_quote',
      cachePolicy: 'cache-first',
    })).toBe('schema quote_snapshot · readback query_quote · cache cache-first')
    expect(buildInterfaceProvenanceText({
      canonicalTable: 'finance_data_health_report',
      readbackActions: ['data_health'],
      cacheStatus: 'local-evidence',
    })).toBe('schema finance_data_health_report · readback data_health · cache local-evidence')
  })

  it('formats provider capability evidence for gap and activation queues', () => {
    expect(buildProviderEvidenceText({
      capabilityId: 'wind.market.screening',
      probeId: 'electron_wind_market_screening',
      liveStatus: 'passed',
      normalizer: 'normalizeScreeningSnapshot',
      canonicalTable: 'market_screening_snapshot',
    })).toBe('capability wind.market.screening · probe electron_wind_market_screening · live passed · normalizeScreeningSnapshot/market_screening_snapshot')
    expect(buildProviderEvidenceText({
      liveValidationState: 'runtime-blocked',
    })).toBe('capability - · probe - · live runtime-blocked · -')
  })

  it('formats failure provenance from capability schema and readback evidence', () => {
    expect(buildFailureEvidenceText({
      probeId: 'electron_eastmoney_hot_rank',
      affectedInterfaces: ['market.hot_rank'],
      affectedCapabilities: [{
        interfaceId: 'market.hot_rank',
        capabilityId: 'eastmoney.market.hot_rank',
        canonicalSchema: 'hot_rank',
        readbackAction: 'query_hot_rank',
      }],
    })).toBe('capability eastmoney.market.hot_rank · schema hot_rank · readback query_hot_rank · interface market.hot_rank · probe electron_eastmoney_hot_rank')
    expect(buildFailureEvidenceText({
      canonicalTable: 'quote_snapshot',
      readbackActions: ['query_quote'],
    })).toBe('capability - · schema quote_snapshot · readback query_quote · interface - · probe -')
  })

  it('explains data-health queue presence, exit condition, and retry policy', () => {
    const runtimeBlocked = buildDataHealthQueueDisplayText({
      interfaceId: 'news.finance_feed',
      provider: 'akshare',
      status: 'blocked',
      liveValidationState: 'runtime-blocked',
      recoveryPolicy: 'Restore the runtime dependency before retrying the probe.',
      exitCondition: 'Leaves this queue after runtime dependency is restored and the probe passes.',
      nextAction: 'Restore akshare runtime, then retry serially.',
    }, 'failure')
    expect(runtimeBlocked).toMatchObject({
      label: 'runtime-blocked',
      exitCondition: 'Leaves this queue after runtime dependency is restored and the probe passes.',
      retryPolicy: 'retry only after runtime dependency is restored',
      nextAction: 'Restore akshare runtime, then retry serially.',
      cacheDecision: expect.stringContaining('cache/readback'),
    })
    expect(buildDataHealthQueueTitle(runtimeBlocked)).toBe([
      'akshare/news.finance_feed has failed or blocked live evidence.',
      'Use cache/readback or healthy fallback providers when available; do not treat failed provider output as reusable data.',
      'Leaves this queue after runtime dependency is restored and the probe passes.',
      'retry only after runtime dependency is restored',
      'Restore akshare runtime, then retry serially.',
    ].join('\n'))
    expect(buildDataHealthQueueDisplayText({
      interfaceId: 'fund.company_info',
      provider: 'wind',
      status: 'credential-gated',
      liveStatus: 'passed',
    }, 'credential')).toMatchObject({
      label: 'passed',
      retryPolicy: 'no broad retry; run the registered credential probe serially',
      cacheDecision: expect.stringContaining('cache/readback'),
    })
    expect(buildDataHealthQueueDisplayText({
      interfaceId: 'fund.nav_history',
      provider: 'tushare',
      status: 'disabled',
      reason: 'fund_nav returned 40203 permission errors and is app-disabled.',
    }, 'disabled')).toMatchObject({
      label: 'disabled',
      retryPolicy: 'do not retry while policy-disabled',
      cacheDecision: expect.stringContaining('policy-disabled'),
    })
    expect(buildDataHealthQueueDisplayText({
      interfaceId: 'market.margin_trading',
      provider: 'akshare',
      gapClass: 'route-implementation-required',
    }, 'gap')).toMatchObject({
      label: 'route-implementation-required',
      retryPolicy: 'do not retry until route implementation exists',
      cacheDecision: expect.stringContaining('Normal cache/readback behavior'),
    })
  })

  it('declares the finance surface contract steps in execution order', () => {
    expect(dataSurfaceContractSteps.map((step) => step.id)).toEqual([
      'dataClass',
      'cachePolicy',
      'providerPolicy',
      'normalizer',
      'persistTarget',
      'readbackAction',
      'failureSink',
      'uiSurface',
    ])
    expect(dataSurfaceContractSteps.map((step) => step.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
})
