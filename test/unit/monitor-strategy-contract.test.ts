import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { MonitorStore } from '../../src/agent/monitor-store'
import { MonitorCreateTool, MonitorListTool } from '../../src/agent/tools/monitor'

describe('monitor strategy contract', () => {
  it('preserves strategy id and structured strategy rules on create/list', async () => {
    const memoryDir = mkdtempSync(join(tmpdir(), 'fin-monitor-strategy-'))
    const store = new MonitorStore(memoryDir)
    const create = new MonitorCreateTool(store)
    const list = new MonitorListTool(store)

    const created = JSON.parse(await create.call('create-1', {
      name: 'Strategy monitor',
      script: 'return { value: 1 };',
      strategyId: 'custom_rsi_volume_rebound_v1',
      strategyRules: {
        entry: { all: [{ left: 'rsi5', op: '<', right: 65 }] },
      },
      monitorDraft: {
        mode: 'fund_rule_monitor',
        entryRules: [{ left: 'nav_trend_20', op: '>', right: 0 }],
      },
      dcaObservation: {
        mode: 'fund_observation_only',
        cadenceDays: 30,
      },
    }))
    expect(created.ok).toBe(true)

    const listed = await list.call()
    expect(listed).toContain('custom_rsi_volume_rebound_v1')
    expect(listed).toContain('strategyRules')
    expect(listed).toContain('rsi5')
    expect(listed).toContain('fund_rule_monitor')
    expect(listed).toContain('fund_observation_only')
  })

  it('supports strategy_signal template without raw script fallback', async () => {
    const memoryDir = mkdtempSync(join(tmpdir(), 'fin-monitor-strategy-signal-'))
    const store = new MonitorStore(memoryDir)
    const create = new MonitorCreateTool(store)

    const created = JSON.parse(await create.call('create-strategy-signal', {
      name: 'custom_20_v1 signal',
      template: 'strategy_signal',
      interval: '30m',
      params: {
        name: '贵州茅台',
        minBars: 120,
      },
      strategyId: 'custom_20_v1',
      strategyRules: {
        id: 'custom_20_v1',
        symbol: '600519',
        indicators: [
          { id: 'sma20', type: 'sma', source: 'close', params: { period: 20 } },
          { id: 'vol20', type: 'volume_sma', source: 'volume', params: { period: 20 } },
        ],
        dataRequirements: { adjust: 'qfq', minBars: 120 },
      },
    }))

    expect(created.ok).toBe(true)
    const monitor = store.get(created.id)
    expect(monitor?.strategyId).toBe('custom_20_v1')
    expect(monitor?.displayType).toBe('value_card')
    expect(monitor?.condition).toBe("result.signal === 'entry'")
    expect(monitor?.script).toContain("template: 'strategy_signal'")
    expect(monitor?.script).toContain("Bridge.callService('/api/finance/kline'")
    expect(monitor?.script).toContain("code: \"600519\"")
    expect(monitor?.script).toContain('Bridge.sendToAgent')
    expect(monitor?.script).toContain('confirmationRequired: true')
    expect(monitor?.script).toContain('custom_20_v1')
    expect(monitor?.script).toContain('No Portfolio or XueqiuTrade action before explicit user confirmation')
    expect(monitor?.strategyRules).toMatchObject({ id: 'custom_20_v1', symbol: '600519' })
  })

  it('supports fund_rule_monitor template with structured fund evidence', async () => {
    const memoryDir = mkdtempSync(join(tmpdir(), 'fin-monitor-fund-rule-'))
    const store = new MonitorStore(memoryDir)
    const create = new MonitorCreateTool(store)

    const created = JSON.parse(await create.call('create-fund-rule', {
      name: 'fund_dca_nav_guard_v1 observation',
      template: 'fund_rule_monitor',
      interval: '1d',
      params: {
        name: 'E Fund',
        min_rows: 30,
      },
      strategyId: 'fund_dca_nav_guard_v1',
      monitorDraft: {
        mode: 'fund_rule_monitor',
        symbol: '110011.OF',
        entryRules: [{ left: 'nav_trend_20', op: '>', right: 0 }],
        exitRules: [{ left: 'drawdown_20', op: '<', right: -8 }],
      },
      dcaObservation: {
        mode: 'fund_observation_only',
        cadenceDays: 30,
      },
    }))

    expect(created.ok).toBe(true)
    const monitor = store.get(created.id)
    expect(monitor?.strategyId).toBe('fund_dca_nav_guard_v1')
    expect(monitor?.displayType).toBe('value_card')
    expect(monitor?.condition).toBe("result.signal === 'observe_or_prepare' || result.signal === 'review_or_pause'")
    expect(monitor?.script).toContain("template: 'fund_rule_monitor'")
    expect(monitor?.script).toContain("Bridge.callService('/api/finance/fund/nav'")
    expect(monitor?.script).toContain("code: \"110011.OF\"")
    expect(monitor?.script).toContain('sourceDataTime')
    expect(monitor?.script).toContain('fetchedAt')
    expect(monitor?.script).toContain('cacheStatus')
    expect(monitor?.script).toContain('allRows.slice(-30)')
    expect(monitor?.script).toContain('monitorDraft')
    expect(monitor?.script).toContain('dcaObservation')
    expect(monitor?.script).toContain('Bridge.sendToAgent')
    expect(monitor?.script).toContain('confirmationRequired: true')
    expect(monitor?.script).toContain('No subscription, redemption, Portfolio trade, or XueqiuTrade action')
    expect(monitor?.strategyRules).toMatchObject({
      monitorDraft: { mode: 'fund_rule_monitor' },
      dcaObservation: { mode: 'fund_observation_only' },
    })
  })

  it('supports portfolio_rebalance_monitor template with portfolio evidence', async () => {
    const memoryDir = mkdtempSync(join(tmpdir(), 'fin-monitor-portfolio-rebalance-'))
    const store = new MonitorStore(memoryDir)
    const create = new MonitorCreateTool(store)

    const created = JSON.parse(await create.call('create-portfolio-rebalance', {
      name: 'ranked_portfolio_v1 review',
      template: 'portfolio_rebalance_monitor',
      interval: '1d',
      strategyId: 'ranked_portfolio_v1',
      portfolioEvidence: {
        mode: 'equal_weight_selected_metrics',
        selectedCount: 2,
        portfolioBacktestEvidence: {
          portfolioReturnPct: 6.2,
          portfolioMaxDrawdownPct: -4.1,
        },
      },
      rebalanceDraft: {
        mode: 'equal_weight_top_n',
        rebalanceInterval: 'monthly',
        maxPositionWeight: 0.4,
        positions: [
          { symbol: '300059', targetWeight: 0.4 },
          { symbol: '600519', targetWeight: 0.4 },
        ],
      },
    }))

    expect(created.ok).toBe(true)
    const monitor = store.get(created.id)
    expect(monitor?.strategyId).toBe('ranked_portfolio_v1')
    expect(monitor?.displayType).toBe('status_row')
    expect(monitor?.condition).toBe("result.signal === 'review_rebalance'")
    expect(monitor?.script).toContain("template: 'portfolio_rebalance_monitor'")
    expect(monitor?.script).toContain('portfolioEvidence')
    expect(monitor?.script).toContain('rebalanceDraft')
    expect(monitor?.script).toContain('Bridge.sendToAgent')
    expect(monitor?.script).toContain('confirmationRequired: true')
    expect(monitor?.script).toContain('Do not place Portfolio or XueqiuTrade orders')
    expect(monitor?.strategyRules).toMatchObject({
      portfolioEvidence: { selectedCount: 2 },
      rebalanceDraft: { rebalanceInterval: 'monthly' },
    })
  })

  it('rejects portfolio_rebalance_monitor without ranked portfolio evidence modes', async () => {
    const memoryDir = mkdtempSync(join(tmpdir(), 'fin-monitor-portfolio-rebalance-weak-'))
    const store = new MonitorStore(memoryDir)
    const create = new MonitorCreateTool(store)

    await expect(create.call('create-weak-portfolio-rebalance', {
      name: 'weak portfolio review',
      template: 'portfolio_rebalance_monitor',
      interval: '1d',
      strategyId: 'ranked_portfolio_v1',
      portfolioEvidence: {
        selectedCount: 2,
        tradeBoundary: 'review_only',
      },
      rebalanceDraft: {
        rebalanceInterval: 'monthly',
        positions: [
          { symbol: '300059', targetWeight: 0.4 },
          { symbol: '600519', targetWeight: 0.4 },
        ],
      },
    })).rejects.toThrow(/custom_strategy_list\/read|custom_strategy_rank/)
    expect(store.list).toHaveLength(0)
  })
})
