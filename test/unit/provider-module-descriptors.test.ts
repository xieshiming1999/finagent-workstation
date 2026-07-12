import { describe, expect, it } from 'vitest'
import { providerModuleDescriptors } from '../../src/agent/tools/provider-module-descriptors'

describe('provider module descriptors', () => {
  it('covers required finance provider families', () => {
    const providers = new Set(providerModuleDescriptors.map((descriptor) => descriptor.provider))

    expect([...providers]).toEqual(expect.arrayContaining([
      'local',
      'eastmoney',
      'tdx',
      'yahoo',
      'wind',
      'tushare',
      'sina',
      'tencent',
      'akshare',
      'macro-official',
      'macro-research',
      'search',
      'xueqiu',
      'ui-artifact',
    ]))
  })

  it('exposes routing and evidence contracts', () => {
    for (const descriptor of providerModuleDescriptors) {
      expect(descriptor.provider.trim()).not.toBe('')
      expect(descriptor.title.trim()).not.toBe('')
      expect(descriptor.category.trim()).not.toBe('')
      expect(descriptor.runtimeAvailability.length).toBeGreaterThan(0)
      expect(descriptor.agentPaths.length).toBeGreaterThan(0)
      expect(descriptor.requiredAccess.length).toBeGreaterThan(0)
      expect(descriptor.capabilityFamilies.length).toBeGreaterThan(0)
      expect(descriptor.schemaDecision.trim()).not.toBe('')
      expect(descriptor.cacheReadbackContract.trim()).not.toBe('')
      expect(descriptor.healthEvidence.trim()).not.toBe('')
      expect(descriptor.routingPolicy.trim()).not.toBe('')
      expect(descriptor.uiSurface.trim()).not.toBe('')
      expect(descriptor.discovery.trim()).not.toBe('')
      expect(descriptor.status.trim()).not.toBe('')
    }
  })

  it('keeps macro descriptors evidence-oriented', () => {
    const official = providerModuleDescriptors.find((descriptor) => descriptor.provider === 'macro-official')
    const research = providerModuleDescriptors.find((descriptor) => descriptor.provider === 'macro-research')

    expect(official).toMatchObject({
      category: 'macro-official-api-provider',
    })
    expect(official?.routingPolicy).toContain('not direct buy/sell rules')
    expect(official?.capabilityFamilies).toContain('numeric-series')
    expect(research).toMatchObject({
      category: 'research-source-provider',
    })
    expect(research?.schemaDecision).toContain('key claims/hash')
  })
})
