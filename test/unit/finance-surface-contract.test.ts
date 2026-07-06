import { describe, expect, it } from 'vitest'
import {
  fetchOnlyFinanceSurfaceContract,
  reusableFinanceSurfaceContract,
  validateFinanceSurfaceContract,
} from '../../scripts/finance_surface_contract.mjs'

describe('finance surface contract validator', () => {
  it('accepts reusable and fetch-only contract builders', () => {
    expect(validateFinanceSurfaceContract({
      status: 'proven',
      surfaceContract: reusableFinanceSurfaceContract({ dataClass: 'stock_quote' }),
    })).toEqual([])

    expect(validateFinanceSurfaceContract({
      status: 'fetch-only',
      surfaceContract: fetchOnlyFinanceSurfaceContract({ dataClass: 'provider_policy' }),
    })).toEqual([])

    expect(validateFinanceSurfaceContract({
      status: 'fetch-only',
      surfaceContract: fetchOnlyFinanceSurfaceContract({ dataClass: 'provider_policy', failureSink: 'none' }),
    })).toEqual([])
  })

  it('rejects stale or invented contract vocabulary', () => {
    const problems = validateFinanceSurfaceContract({
      status: 'proven',
      surfaceContract: {
        ...reusableFinanceSurfaceContract({ dataClass: 'stock_quote' }),
        cachePolicy: 'local-provider',
        providerPolicy: 'prompt-owned',
        failureSink: 'persist-errors',
        timestampPolicy: 'fetch-time-only',
      },
    })

    expect(problems).toContain('surfaceContract.cachePolicy invalid: local-provider')
    expect(problems).toContain('surfaceContract.providerPolicy invalid: prompt-owned')
    expect(problems).toContain('surfaceContract.failureSink invalid: persist-errors')
    expect(problems).toContain('surfaceContract.timestampPolicy invalid: fetch-time-only')
  })
})
