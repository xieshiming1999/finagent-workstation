import { describe, expect, it } from 'vitest'

import { ScanMarketDataActionService } from '../../src/domain/market/services/scan-market-data-action-service'
import { ScanMarketDataService } from '../../src/domain/market/services/scan-market-data-service'

describe('ScanMarketDataActionService', () => {
  it('routes scan actions through the scan domain service boundary', async () => {
    const service = new ScanMarketDataActionService(new FakeScanMarketDataService())

    await expect(service.readAction('NASDAQ:AAPL', {})).resolves.toBe('fake-scan')
  })
})

class FakeScanMarketDataService extends ScanMarketDataService {
  async readScan(): Promise<string> {
    return 'fake-scan'
  }
}
