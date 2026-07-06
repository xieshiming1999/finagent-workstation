import { describe, expect, it } from 'vitest'

import { MarketDataActionService } from '../../src/domain/market/services/market-data-action-service'
import { MarketDataActionServiceFactory } from '../../src/domain/market/services/market-data-action-service-factory'

describe('MarketDataActionServiceFactory', () => {
  it('creates the top-level market data action service', () => {
    const service = MarketDataActionServiceFactory.create()
    expect(service).toBeInstanceOf(MarketDataActionService)
  })
})
