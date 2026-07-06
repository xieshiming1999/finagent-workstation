import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { WatchlistTool } from '../../src/agent/tools/watchlist'

describe('watchlist strategy contract', () => {
  it('preserves strategy id and structured strategy rules on add/list', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-watchlist-strategy-'))
    const tool = new WatchlistTool()
    const ctx = { basePath } as any

    const add = await tool.call('add-1', {
      action: 'add',
      symbol: '600519',
      name: '贵州茅台',
      type: 'stock',
      entryCondition: 'StrategySpec entry rules',
      strategyId: 'custom_rsi_volume_rebound_v1',
      strategyRules: {
        entry: { all: [{ left: 'rsi5', op: '<', right: 65 }] },
        exit: { any: [{ type: 'stop_loss_pct', value: 8 }] },
      },
      portfolioEvidence: {
        mode: 'equal_weight_selected_metrics',
        selectedCount: 2,
        aggregateMetrics: {
          selectedSymbols: ['600519', '000858'],
          expectedReturnPct: 8.4,
        },
        tradeBoundary: 'Evidence only. Do not place orders.',
      },
      rebalanceDraft: {
        rebalanceInterval: 'monthly',
        positions: [
          { symbol: '600519', targetWeight: 0.4 },
          { symbol: '000858', targetWeight: 0.4 },
        ],
        tradeBoundary: 'Requires confirmation before any order.',
      },
    }, ctx)
    expect(add).toContain('Added')

    const listed = JSON.parse(await tool.call('list-1', {
      action: 'list',
      status: 'watching',
      type: 'stock',
    }, ctx))
    expect(listed.items[0]).toMatchObject({
      symbol: '600519',
      strategyId: 'custom_rsi_volume_rebound_v1',
      strategyRules: {
        entry: { all: [{ left: 'rsi5', op: '<', right: 65 }] },
        exit: { any: [{ type: 'stop_loss_pct', value: 8 }] },
        portfolioEvidence: {
          mode: 'equal_weight_selected_metrics',
          selectedCount: 2,
        },
        rebalanceDraft: {
          rebalanceInterval: 'monthly',
        },
      },
    })
    expect(listed.items[0].portfolioEvidence).toMatchObject({
      mode: 'equal_weight_selected_metrics',
      selectedCount: 2,
    })
    expect(listed.items[0].rebalanceDraft).toMatchObject({
      rebalanceInterval: 'monthly',
    })
  })

  it('filters duplicate symbols by strategy id for exact readback', async () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-watchlist-strategy-filter-'))
    const tool = new WatchlistTool()
    const ctx = { basePath } as any

    await tool.call('add-old', {
      action: 'add',
      symbol: '600519',
      name: '贵州茅台',
      type: 'stock',
      strategyId: 'older_strategy_v1',
      strategyRules: { id: 'older_strategy_v1', symbol: '600519' },
    }, ctx)
    await tool.call('add-new', {
      action: 'add',
      symbol: '600519',
      name: '贵州茅台',
      type: 'stock',
      strategyId: 'custom_20_v1',
      strategyRules: { id: 'custom_20_v1', symbol: '600519' },
    }, ctx)

    const bySymbol = JSON.parse(await tool.call('list-symbol', {
      action: 'list',
      symbol: '600519',
      status: 'watching',
    }, ctx))
    expect(bySymbol.count).toBe(2)
    expect(bySymbol.items[0].strategyId).toBe('custom_20_v1')
    expect(bySymbol.items[0].addedAt).toEqual(expect.any(String))

    const byStrategy = JSON.parse(await tool.call('list-strategy', {
      action: 'list',
      symbol: '600519',
      strategyId: 'custom_20_v1',
      status: 'watching',
    }, ctx))
    expect(byStrategy.count).toBe(1)
    expect(byStrategy.items[0]).toMatchObject({
      symbol: '600519',
      strategyId: 'custom_20_v1',
      strategyRules: { id: 'custom_20_v1', symbol: '600519' },
    })
  })
})
