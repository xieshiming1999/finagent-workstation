import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  uiSurfaceContract,
  uiSurfaceContracts,
  type UiSurfaceType,
} from '../../src/renderer/panels/ui-surface-contract'

describe('broader UI surface contracts', () => {
  const expected: UiSurfaceType[] = [
    'market-bar',
    'status-bar',
    'bottom-panel',
    'event-console',
    'calendar-settings',
    'market-weather-background',
  ]

  it('covers status, market, bottom, event, calendar, and background surfaces', () => {
    expect(uiSurfaceContracts.map((contract) => contract.type)).toEqual(expected)

    for (const type of expected) {
      const contract = uiSurfaceContract(type)
      expect(contract.purpose.length).toBeGreaterThan(20)
      expect(contract.ownedData.length).toBeGreaterThan(0)
      expect(contract.primaryActions.length).toBeGreaterThan(0)
      expect(contract.fetchPolicy).toMatch(/^(poll-readonly|event-store|manual-action-only|static-display)$/)
      expect(contract.emptyState.length).toBeGreaterThan(20)
      expect(contract.errorState.length).toBeGreaterThan(20)
    }
  })

  it('keeps broader surface polling intervals sourced from the contract registry', () => {
    expect(uiSurfaceContract('market-bar').pollIntervalMs).toBe(30000)
    expect(uiSurfaceContract('market-bar').rotateIntervalMs).toBe(10000)
    expect(uiSurfaceContract('market-weather-background').pollIntervalMs).toBe(60000)
    expect(uiSurfaceContract('bottom-panel').pollIntervalMs).toBe(2000)
    expect(uiSurfaceContract('event-console').pollIntervalMs).toBe(2000)
    expect(uiSurfaceContract('calendar-settings').pollIntervalMs).toBeUndefined()
    expect(uiSurfaceContract('status-bar').pollIntervalMs).toBeUndefined()
  })

  it('makes polling components read uiSurfaceContract instead of hardcoding intervals', () => {
    const files = [
      'src/renderer/components/MarketBar.tsx',
      'src/renderer/components/MarketWeatherBackground.tsx',
      'src/renderer/panels/BottomPanel.tsx',
      'src/renderer/panels/EventConsole.tsx',
    ]

    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), 'utf-8')
      expect(source, `${file} should read uiSurfaceContract`).toContain('uiSurfaceContract(')
      expect(source, `${file} should not hardcode numeric setInterval delay`).not.toMatch(/setInterval\([^,\n]+,\s*\d[\d_]*\s*\)/)
    }
  })
})
