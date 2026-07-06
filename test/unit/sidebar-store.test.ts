import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  defaultSidebarWidgetTypes,
  sidebarWidgetCategory,
  useSidebarStore,
} from '../../src/renderer/store/useSidebarStore'
import { useLanguageStore } from '../../src/renderer/store/useLanguageStore'
import { sidebarPanelContract, sidebarPanelContracts } from '../../src/renderer/panels/sidebar-panel-contract'

describe('sidebar store product surface contract', () => {
  it('keeps stock, fund, user, system, and agent panels in the intended order', () => {
    expect(defaultSidebarWidgetTypes).toEqual([
      'pulse',
      'watchlist',
      'fund-pulse',
      'fund-watchlist',
      'news',
      'data',
      'strategy-library',
      'api-health',
      'session',
      'sessions',
    ])

    expect(defaultSidebarWidgetTypes.map(sidebarWidgetCategory)).toEqual([
      'user',
      'user',
      'user',
      'user',
      'user',
      'system',
      'system',
      'system',
      'agent',
      'agent',
    ])
  })

  it('keeps every default sidebar panel backed by an explicit product contract', () => {
    const contractedTypes = sidebarPanelContracts.map((contract) => contract.type)

    for (const type of defaultSidebarWidgetTypes) {
      expect(contractedTypes).toContain(type)
      const contract = sidebarPanelContract(type)
      expect(contract.purpose.length).toBeGreaterThan(20)
      expect(contract.ownedData.length).toBeGreaterThan(0)
      expect(contract.primaryActions.length).toBeGreaterThan(0)
      expect(contract.renderFetchPolicy).toMatch(/^(read-cache-only|poll-readonly|manual-action-only)$/)
      expect(contract.emptyState.length).toBeGreaterThan(20)
      expect(contract.errorState.length).toBeGreaterThan(20)
    }
  })

  it('documents polling behavior in the panel contract instead of component-only constants', () => {
    expect(sidebarPanelContract('data').pollIntervalMs).toBe(5000)
    expect(sidebarPanelContract('watchlist').pollIntervalMs).toBe(15000)
    expect(sidebarPanelContract('pulse').pollIntervalMs).toBe(60000)
    expect(sidebarPanelContract('fund-pulse').pollIntervalMs).toBe(60000)
    expect(sidebarPanelContract('news').pollIntervalMs).toBe(300000)
    expect(sidebarPanelContract('strategy-library').pollIntervalMs).toBe(15000)
    expect(sidebarPanelContract('api-health').pollIntervalMs).toBe(10000)
    expect(sidebarPanelContract('portfolio').pollIntervalMs).toBe(30000)

    for (const contract of sidebarPanelContracts) {
      if (contract.renderFetchPolicy === 'poll-readonly') {
        expect(contract.pollIntervalMs).toBeGreaterThanOrEqual(5000)
      } else {
        expect(contract.pollIntervalMs).toBeUndefined()
      }
      if (contract.pollIntervalMs !== undefined) {
        expect(contract.pollIntervalMs).toBeGreaterThanOrEqual(5000)
      }
    }
  })

  it('keeps panel render fetch behavior explicit to avoid fetch-on-render loops', () => {
    expect(sidebarPanelContract('pulse').renderFetchPolicy).toBe('poll-readonly')
    expect(sidebarPanelContract('fund-pulse').renderFetchPolicy).toBe('poll-readonly')
    expect(sidebarPanelContract('data').renderFetchPolicy).toBe('poll-readonly')
    expect(sidebarPanelContract('strategy-library').renderFetchPolicy).toBe('poll-readonly')
    expect(sidebarPanelContract('fund-watchlist').renderFetchPolicy).toBe('read-cache-only')
    expect(sidebarPanelContract('calendar').renderFetchPolicy).toBe('manual-action-only')
    expect(sidebarPanelContract('session').renderFetchPolicy).toBe('read-cache-only')
    expect(sidebarPanelContract('sessions').renderFetchPolicy).toBe('read-cache-only')
    expect(sidebarPanelContract('portfolio').renderFetchPolicy).toBe('poll-readonly')
  })

  it('keeps sidebar polling intervals sourced from the panel contract registry', () => {
    const sourceByType: Partial<Record<string, string[]>> = {
      pulse: ['src/renderer/components/MarketPulseWidget.tsx'],
      watchlist: ['src/renderer/components/WatchlistWidget.tsx'],
      'fund-pulse': ['src/renderer/components/FundPulseWidget.tsx'],
      news: ['src/renderer/components/NewsFeedWidget.tsx'],
      research: ['src/renderer/components/ResearchWorkspaceWidget.tsx'],
      data: ['src/renderer/components/DataWidget.tsx', 'src/renderer/panels/DataPanel.tsx'],
      'strategy-library': ['src/renderer/components/StrategyLibrary.tsx'],
      'api-health': ['src/renderer/components/ApiHealthPanel.tsx'],
      portfolio: ['src/renderer/components/PortfolioCard.tsx'],
    }

    for (const contract of sidebarPanelContracts) {
      if (contract.renderFetchPolicy !== 'poll-readonly') continue
      const files = sourceByType[contract.type] ?? []
      expect(files, `${contract.type} should declare checked source files`).not.toHaveLength(0)
      for (const file of files) {
        const source = readFileSync(join(process.cwd(), file), 'utf-8')
        expect(source, `${file} should read sidebarPanelContract('${contract.type}')`).toContain(`sidebarPanelContract('${contract.type}')`)
        expect(source, `${file} should not hardcode numeric setInterval delay`).not.toMatch(/setInterval\([^,\n]+,\s*\d[\d_]*\s*\)/)
      }
    }
  })

  it('keeps the visible category order derived from the panel contract registry', () => {
    expect(defaultSidebarWidgetTypes.map((type) => sidebarPanelContract(type).category)).toEqual(
      defaultSidebarWidgetTypes.map(sidebarWidgetCategory),
    )
  })

  it('localizes builtin sidebar titles without changing panel identity or order', () => {
    useLanguageStore.setState({ mode: 'zh-CN', resolved: 'zh-CN' })
    useSidebarStore.getState().localizeBuiltinTitles()

    expect(useSidebarStore.getState().widgets.map((widget) => widget.type)).toEqual(defaultSidebarWidgetTypes)
    expect(useSidebarStore.getState().widgets.find((widget) => widget.type === 'watchlist')?.title).toBe('股票自选')
    expect(useSidebarStore.getState().widgets.find((widget) => widget.type === 'fund-watchlist')?.title).toBe('基金自选')

    useLanguageStore.setState({ mode: 'en', resolved: 'en' })
    useSidebarStore.getState().localizeBuiltinTitles()

    expect(useSidebarStore.getState().widgets.map((widget) => widget.type)).toEqual(defaultSidebarWidgetTypes)
    expect(useSidebarStore.getState().widgets.find((widget) => widget.type === 'watchlist')?.title).toBe('Stock Watchlist')
    expect(useSidebarStore.getState().widgets.find((widget) => widget.type === 'fund-watchlist')?.title).toBe('Fund Watchlist')
  })
})
