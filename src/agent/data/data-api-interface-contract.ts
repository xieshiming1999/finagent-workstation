import contract from './data-api-interfaces.json'
import cacheCoverage from './data-api-cache-coverage.json'
import type { DataApiCacheMode } from './data-api-cache-policy'
import type { FinanceProvider } from './provider-policy'

export type DataApiProvider = typeof contract.providers[number]

export type DataApiCapabilityStatus =
  | 'supported'
  | 'disabled'
  | 'credential-gated'
  | 'quota-gated'
  | 'transport-unstable'
  | 'not-supported'
  | 'output-only'
  | 'global-only'

export type DataApiProviderMode = 'auto' | 'preferred' | 'strict'
export interface DataApiProviderCapability {
  id: string
  provider: DataApiProvider
  status: DataApiCapabilityStatus
  upstreamOrigin?: DataApiProvider | string
  adapter?: string
  normalizer?: string
  canonicalTable?: string
  probeId?: string
  priority?: number
  reason?: string
  marketScope?: string[]
}

export interface DataApiInterfaceDefinition {
  id: string
  label: string
  canonicalSchema: string
  dataStoreTables: string[]
  queryActions: string[]
  params: string[]
  freshnessPolicy: string
  capabilities: DataApiProviderCapability[]
}

export type DataApiCacheCoverageStatus = 'implemented' | 'not-implemented' | 'none'

export interface DataApiCacheCoverage {
  status: DataApiCacheCoverageStatus
  reader: string | null
  policy: string
}

export interface DataApiInterfaceContract {
  version: string
  providers: DataApiProvider[]
  interfaces: DataApiInterfaceDefinition[]
}

export interface DataApiProviderConstraint {
  provider?: DataApiProvider | FinanceProvider | string
  providerMode?: DataApiProviderMode
  cacheMode?: DataApiCacheMode
  allowFallback?: boolean
  allowDegraded?: boolean
}

export interface DataApiCapabilityMatrixRow {
  interfaceId: string
  label: string
  canonicalSchema: string
  dataStoreTables: string[]
  queryActions: string[]
  cacheLookup: DataApiCacheCoverage
  providers: Record<DataApiProvider, DataApiCapabilityStatus>
}

export const dataApiInterfaceContract = contract as DataApiInterfaceContract
export const dataApiCacheCoverage = cacheCoverage as {
  version: string
  interfaces: Record<string, DataApiCacheCoverage>
}

export function listDataApiInterfaces(): DataApiInterfaceDefinition[] {
  return dataApiInterfaceContract.interfaces.map((item) => ({
    ...item,
    dataStoreTables: [...item.dataStoreTables],
    queryActions: [...item.queryActions],
    params: [...item.params],
    capabilities: item.capabilities.map((capability) => ({ ...capability })),
  }))
}

export function listDataApiProviders(): DataApiProvider[] {
  return [...dataApiInterfaceContract.providers]
}

export function getDataApiInterface(id: string): DataApiInterfaceDefinition | null {
  return dataApiInterfaceContract.interfaces.find((item) => item.id === id) ?? null
}

export function registeredCapabilitiesForInterface(
  interfaceId: string,
  constraint: DataApiProviderConstraint = {},
): DataApiProviderCapability[] {
  const definition = getDataApiInterface(interfaceId)
  if (!definition) return []
  const provider = normalizeDataApiProvider(constraint.provider)
  const mode = constraint.providerMode ?? (provider ? 'strict' : 'auto')
  const capabilities = [...definition.capabilities].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
  if (!provider) return capabilities
  const matched = capabilities.filter((item) => item.provider === provider)
  if (mode === 'strict') return matched
  if (mode === 'preferred') {
    const rest = capabilities.filter((item) => item.provider !== provider)
    return constraint.allowFallback === false ? matched : [...matched, ...rest]
  }
  return capabilities
}

export function eligibleCapabilitiesForInterface(
  interfaceId: string,
  constraint: DataApiProviderConstraint = {},
): DataApiProviderCapability[] {
  const requestedProvider = normalizeDataApiProvider(constraint.provider)
  const providerMode = constraint.providerMode ?? (requestedProvider ? 'strict' : 'auto')
  return registeredCapabilitiesForInterface(interfaceId, constraint)
    .filter((capability) => {
      if (capability.status === 'supported' || capability.status === 'global-only') return true
      if (
        requestedProvider === capability.provider &&
        providerMode !== 'auto' &&
        (capability.status === 'credential-gated' || capability.status === 'quota-gated')
      ) return true
      return constraint.allowDegraded === true && capability.status === 'transport-unstable'
    })
}

export function buildDataApiCapabilityMatrix(): DataApiCapabilityMatrixRow[] {
  const providers = listDataApiProviders()
  return dataApiInterfaceContract.interfaces.map((item) => {
    const cells = Object.fromEntries(providers.map((provider) => [provider, 'not-supported'])) as Record<DataApiProvider, DataApiCapabilityStatus>
    for (const capability of item.capabilities) cells[capability.provider] = capability.status
    return {
      interfaceId: item.id,
      label: item.label,
      canonicalSchema: item.canonicalSchema,
      dataStoreTables: [...item.dataStoreTables],
      queryActions: [...item.queryActions],
      cacheLookup: cacheCoverageForInterface(item.id),
      providers: cells,
    }
  })
}

export function cacheCoverageForInterface(interfaceId: string): DataApiCacheCoverage {
  return dataApiCacheCoverage.interfaces[interfaceId] ?? {
    status: 'not-implemented',
    reader: null,
    policy: 'missing cache coverage declaration',
  }
}

export function normalizeDataApiProvider(value: unknown): DataApiProvider | null {
  if (typeof value !== 'string') return null
  const key = value.trim()
  if (!key) return null
  if (key === 'eastmoneyDirect' || key === 'eastmoney') return 'eastmoney'
  if (key === 'yfinance' || key === 'yahoo') return 'yahoo'
  return (dataApiInterfaceContract.providers as string[]).includes(key) ? key as DataApiProvider : null
}

export function validateDataApiInterfaceContract(): string[] {
  const problems: string[] = []
  const providerSet = new Set(dataApiInterfaceContract.providers)
  const interfaceIds = new Set<string>()
  const statuses = new Set<DataApiCapabilityStatus>([
    'supported',
    'disabled',
    'credential-gated',
    'quota-gated',
    'transport-unstable',
    'not-supported',
    'output-only',
    'global-only',
  ])

  for (const item of dataApiInterfaceContract.interfaces) {
    if (interfaceIds.has(item.id)) problems.push(`duplicate interface id: ${item.id}`)
    interfaceIds.add(item.id)
    if (!item.canonicalSchema) problems.push(`${item.id}: canonicalSchema required`)
    if (!Array.isArray(item.params) || item.params.length === 0) problems.push(`${item.id}: params required`)
    if (!item.params.includes('provider')) problems.push(`${item.id}: provider param required`)
    if (!item.params.includes('providerMode')) problems.push(`${item.id}: providerMode param required`)
    if (!Array.isArray(item.capabilities) || item.capabilities.length === 0) problems.push(`${item.id}: at least one provider capability required`)
    const cache = cacheCoverageForInterface(item.id)
    if (cache.status !== 'implemented' && cache.status !== 'not-implemented' && cache.status !== 'none') {
      problems.push(`${item.id}: invalid cache coverage status ${cache.status}`)
    }
    if (item.dataStoreTables.length > 0 && cache.status === 'none') {
      problems.push(`${item.id}: DataStore-backed interface cannot declare cache coverage as none`)
    }
    if (cache.status === 'implemented' && !cache.reader) {
      problems.push(`${item.id}: implemented cache coverage requires reader`)
    }
    const capabilityIds = new Set<string>()
    const eligiblePriorityOwners = new Map<number, string>()
    for (const capability of item.capabilities) {
      if (capabilityIds.has(capability.id)) problems.push(`${item.id}: duplicate capability id ${capability.id}`)
      capabilityIds.add(capability.id)
      if (capability.status === 'supported' || capability.status === 'global-only') {
        const priority = capability.priority ?? 999
        const existing = eligiblePriorityOwners.get(priority)
        if (existing) {
          problems.push(`${item.id}: duplicate eligible provider priority ${priority}: ${existing} and ${capability.id}`)
        } else {
          eligiblePriorityOwners.set(priority, capability.id)
        }
      }
      if (!providerSet.has(capability.provider)) problems.push(`${item.id}: unknown provider ${capability.provider}`)
      if (!statuses.has(capability.status)) problems.push(`${item.id}: invalid status ${capability.status}`)
      if (requiresOperationalReason(capability.status) && capability.id && !capability.reason?.trim()) {
        problems.push(`${item.id}/${capability.id}: ${capability.status} capability requires reason`)
      }
      if (requiresCanonicalProviderShape(capability.status) && !capability.normalizer) {
        problems.push(`${item.id}/${capability.id}: normalizer required for reusable provider capability`)
      }
      if (requiresCanonicalProviderShape(capability.status) && item.dataStoreTables.length > 0 && !capability.canonicalTable) {
        problems.push(`${item.id}/${capability.id}: canonicalTable required for reusable provider capability`)
      }
      if (requiresCanonicalProviderShape(capability.status) && capability.canonicalTable && item.dataStoreTables.length > 0 && !item.dataStoreTables.includes(capability.canonicalTable)) {
        problems.push(`${item.id}/${capability.id}: canonicalTable ${capability.canonicalTable} is not owned by interface tables ${item.dataStoreTables.join(',')}`)
      }
    }
  }
  for (const interfaceId of Object.keys(dataApiCacheCoverage.interfaces)) {
    if (!interfaceIds.has(interfaceId)) problems.push(`cache coverage references unknown interface: ${interfaceId}`)
  }

  return problems
}

function requiresCanonicalProviderShape(status: DataApiCapabilityStatus): boolean {
  return status === 'supported' ||
    status === 'global-only' ||
    status === 'credential-gated' ||
    status === 'quota-gated' ||
    status === 'transport-unstable'
}

function requiresOperationalReason(status: DataApiCapabilityStatus): boolean {
  return status === 'not-supported' ||
    status === 'credential-gated' ||
    status === 'quota-gated' ||
    status === 'disabled'
}
