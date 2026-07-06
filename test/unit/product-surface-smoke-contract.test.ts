import { describe, expect, it } from 'vitest'
import {
  productSurfaceSmokeContract,
  requiredProductSurfaceSmokeContracts,
  type ProductSurfaceSmokeState,
} from '../../src/renderer/components/product-surface-smoke-contract'
import { sidebarPanelContract } from '../../src/renderer/panels/sidebar-panel-contract'

describe('OARI product surface smoke contract', () => {
  const expectedIds = [
    'stock-market-pulse',
    'fund-pulse',
    'stock-watchlist',
    'fund-watchlist',
    'data-manager',
    'api-health',
    'history-audit-stream',
    'session-panel',
    'portfolio-risk',
    'task-goal-view',
  ]

  it('covers every OARI-006 required product surface', () => {
    expect(requiredProductSurfaceSmokeContracts.map((surface) => surface.id)).toEqual(expectedIds)
    for (const id of expectedIds) {
      expect(productSurfaceSmokeContract(id).title.length).toBeGreaterThan(5)
    }
  })

  it('records practical empty, loading, error, and cached state evidence', () => {
    const coreStates: ProductSurfaceSmokeState[] = ['empty', 'error', 'cached']
    for (const surface of requiredProductSurfaceSmokeContracts) {
      for (const state of coreStates) {
        expect(surface.states, `${surface.id} should document ${state}`).toContain(state)
      }
      expect(surface.evidence.length, `${surface.id} should name concrete evidence`).toBeGreaterThanOrEqual(2)
      expect(surface.evidence.join('\n'), `${surface.id} evidence should cite tests/contracts/components`).toMatch(/test|Contract|Widget|DataWidget|PortfolioCard/)
    }
  })

  it('links sidebar product surfaces back to their panel contracts', () => {
    for (const surface of requiredProductSurfaceSmokeContracts) {
      if (!surface.sidebarType) continue
      const contract = sidebarPanelContract(surface.sidebarType)
      expect(contract.emptyState.length, surface.id).toBeGreaterThan(20)
      expect(contract.errorState.length, surface.id).toBeGreaterThan(20)
      expect(contract.ownedData.length, surface.id).toBeGreaterThan(0)
      expect(contract.primaryActions.length, surface.id).toBeGreaterThan(0)
    }
  })
})
