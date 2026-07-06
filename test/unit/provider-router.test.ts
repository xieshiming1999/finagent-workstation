import { describe, expect, it, vi } from 'vitest'
import { runProviderRoute } from '../../src/agent/data/provider-router'

describe('provider router', () => {
  it('falls back to the next compatible provider after failure', async () => {
    const tdx = vi.fn(async () => {
      throw new Error('tdx unavailable')
    })
    const eastmoney = vi.fn(async () => ({ ok: true }))

    const result = await runProviderRoute('quote', (provider) => {
      if (provider === 'tdx') return { provider, run: tdx }
      if (provider === 'eastmoneyDirect') return { provider, source: 'eastmoney', run: eastmoney }
      return null
    })

    expect(tdx).toHaveBeenCalled()
    expect(eastmoney).toHaveBeenCalled()
    expect(result).toMatchObject({ provider: 'eastmoneyDirect', source: 'eastmoney', data: { ok: true } })
  })

  it('honors scoped preferred provider order for a route', async () => {
    const tdx = vi.fn(async () => ({ provider: 'tdx' }))
    const akshare = vi.fn(async () => ({ provider: 'akshare' }))

    const result = await runProviderRoute('kline', (provider) => {
      if (provider === 'tdx') return { provider, run: tdx }
      if (provider === 'akshare') return { provider, run: akshare }
      return null
    }, { preferredProviders: ['akshare', 'tdx'] })

    expect(akshare).toHaveBeenCalledOnce()
    expect(tdx).not.toHaveBeenCalled()
    expect(result).toMatchObject({ provider: 'akshare', data: { provider: 'akshare' } })
  })

  it('does not route through temporarily blocked providers even when preferred', async () => {
    const tdx = vi.fn(async () => ({ provider: 'tdx' }))
    const eastmoney = vi.fn(async () => ({ provider: 'eastmoneyDirect' }))

    const result = await runProviderRoute('quote', (provider) => {
      if (provider === 'tdx') return { provider, run: tdx }
      if (provider === 'eastmoneyDirect') return { provider, source: 'eastmoney', run: eastmoney }
      return null
    }, {
      gates: { temporarilyBlockedProviders: ['tdx'] },
      preferredProviders: ['tdx', 'eastmoneyDirect'],
    })

    expect(tdx).not.toHaveBeenCalled()
    expect(eastmoney).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ provider: 'eastmoneyDirect', source: 'eastmoney' })
  })
})
