import {
  eligibleCapabilitiesForInterface,
  normalizeDataApiProvider,
  registeredCapabilitiesForInterface,
  type DataApiProviderCapability,
  type DataApiProviderConstraint,
  type DataApiProviderMode,
} from './data-api-interface-contract'
import { decideRequirementCacheRead, type DataApiCacheMode } from './data-api-cache-policy'
import { getCurrentRuntimeBasePath } from './current-runtime-base-path'
import {
  buildDataInterfaceHealth,
  runtimeEligibleCapabilitiesForInterface,
  runtimeRouteDecisionForCapability,
} from './data-interface-health'

export interface DataApiInterfaceRoute<T> {
  capability: DataApiProviderCapability
  source?: string
  run: () => Promise<T>
}

export interface DataApiInterfaceRouteResult<T> {
  data: T
  interfaceId: string
  capabilityId: string
  provider: string
  source: string
  cachedCapabilityId?: string
  cachedProvider?: string
  cachedSource?: string
  cacheStatus: 'cache-hit' | 'provider-hit'
  cacheMode: DataApiCacheMode
  cacheDecision: string
  providerMode: DataApiProviderMode
  requestedProvider?: string
  allowFallback: boolean
}

export interface DataApiInterfaceCacheHit<T> {
  cacheHit: true
  data: T
  capabilityId?: string
  provider?: string
  source?: string
  cacheDecision?: string
}

export interface DataApiProviderFailure {
  source: string
  error: unknown
  status?: number
  failureClass?: string
}

export class DataApiInterfaceRouteError extends Error {
  constructor(
    message: string,
    readonly failures: DataApiProviderFailure[],
  ) {
    super(message)
    this.name = 'DataApiInterfaceRouteError'
  }
}

export async function runDataApiInterfaceRoute<T>(
  interfaceId: string,
  makeRoute: (capability: DataApiProviderCapability) => DataApiInterfaceRoute<T> | null,
  opts: DataApiProviderConstraint & { label?: string; readCache?: () => Promise<T | DataApiInterfaceCacheHit<T> | null | undefined> | T | DataApiInterfaceCacheHit<T> | null | undefined } = {},
): Promise<DataApiInterfaceRouteResult<T>> {
  const cacheRead = decideRequirementCacheRead(opts)
  const requestedProvider = normalizeDataApiProvider(opts.provider) ?? undefined
  const providerMode = opts.providerMode ?? (requestedProvider ? 'strict' : 'auto')
  const allowFallback = opts.allowFallback !== false
  const cached = cacheRead.readCache ? normalizeCacheHit(await opts.readCache?.()) : null
  let cacheMissDetail: string | null = null
  if (cached) {
    const cachedProvider = cached.provider ?? inferProviderFromCachedData(cached.data) ?? 'local'
    const cachedSource = cached.source ?? inferSourceFromCachedData(cached.data) ?? cachedProvider
    const cachedCapabilityId = cached.capabilityId ?? 'local.cache'
    if (cacheHitSatisfiesProviderConstraint(cachedProvider, cachedSource, requestedProvider, providerMode)) {
      return {
        data: cached.data,
        interfaceId,
        capabilityId: cachedCapabilityId,
        provider: cachedProvider,
        source: cachedSource,
        cachedCapabilityId,
        cachedProvider,
        cachedSource,
        cacheStatus: 'cache-hit',
        cacheMode: cacheRead.mode,
        cacheDecision: cached.cacheDecision ?? `${cacheRead.reason}; cache reader returned reusable canonical rows from ${cachedSource}`,
        providerMode,
        requestedProvider,
        allowFallback,
      }
    }
    cacheMissDetail = `cache rows came from ${cachedSource}, which does not satisfy strict provider ${requestedProvider}`
  }

  if (opts.cacheMode === 'cache-only') {
    throw new Error(`${opts.label ?? interfaceId} cache-only lookup missed; ${cacheMissDetail ?? cacheRead.reason}`)
  }

  const capabilities = eligibleCapabilitiesForInterface(interfaceId, opts)
  const runtimeBasePath = getCurrentRuntimeBasePath()
  const runtimeHealth = runtimeBasePath
    ? buildDataInterfaceHealth(null, undefined, { runtimeBasePath })
    : null
  const routedCapabilities = runtimeHealth
    ? runtimeEligibleCapabilitiesForInterface(runtimeHealth, interfaceId, capabilities, {
        allowDegraded: opts.allowDegraded,
        providerMode,
      }).map((item) => item.capability)
    : capabilities
  const failures: DataApiProviderFailure[] = []

  for (const capability of routedCapabilities) {
    const route = makeRoute(capability)
    if (!route) continue
    const source = route.source ?? route.capability.provider
    try {
      const data = await route.run()
      return {
        data,
        interfaceId,
        capabilityId: route.capability.id,
        provider: route.capability.provider,
        source,
        cacheStatus: 'provider-hit',
        cacheMode: cacheRead.mode,
        cacheDecision: cacheRead.readCache
          ? `${cacheRead.reason}; ${cacheMissDetail ?? 'no reusable cache rows matched the requirement'}`
          : cacheRead.reason,
        providerMode,
        requestedProvider,
        allowFallback,
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      failures.push({
        source,
        error: e,
        status: numericErrorField(e, 'status'),
        failureClass: stringErrorField(e, 'failureClass'),
      })
      if (shouldStopProviderIteration(message)) break
    }
  }

  const registered = registeredCapabilitiesForInterface(interfaceId, opts)
  const runtimeBlocked = runtimeHealth
    ? registered
        .map((capability) => ({
          capability,
          decision: runtimeRouteDecisionForCapability(runtimeHealth, interfaceId, capability, {
            allowDegraded: opts.allowDegraded,
            providerMode,
          }),
        }))
        .filter((item) => !item.decision.eligible)
        .map((item) => `${item.capability.provider}:${item.decision.routeState} (${item.decision.reason})`)
    : []
  const blocked = registered
    .filter((capability) => capability.status !== 'supported' && capability.status !== 'global-only')
    .map((capability) => `${capability.provider}:${capability.status}${capability.reason ? ` (${capability.reason})` : ''}`)
  const detail = failures.length > 0
    ? failures.map((failure) => `${failure.source}: ${failure.error instanceof Error ? failure.error.message : String(failure.error)}`).join('; ')
    : runtimeHealth && routedCapabilities.length === 0
      ? `no runtime-eligible providers after probe evidence and activation-state gating${runtimeBlocked.length > 0 ? `: ${runtimeBlocked.join('; ')}` : ''}`
      : blocked.length > 0
      ? `no eligible providers; blocked capabilities: ${blocked.join('; ')}`
      : 'no compatible providers registered'
  throw new DataApiInterfaceRouteError(`All ${opts.label ?? interfaceId} interface providers failed: ${detail}`, failures)
}

function numericErrorField(error: unknown, field: string): number | undefined {
  if (typeof error !== 'object' || error == null) return undefined
  const value = Number((error as Record<string, unknown>)[field])
  return Number.isFinite(value) ? value : undefined
}

function stringErrorField(error: unknown, field: string): string | undefined {
  if (typeof error !== 'object' || error == null) return undefined
  const value = (error as Record<string, unknown>)[field]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeCacheHit<T>(value: T | DataApiInterfaceCacheHit<T> | null | undefined): DataApiInterfaceCacheHit<T> | null {
  if (value == null) return null
  if (isStructuredCacheHit<T>(value)) return value
  return { cacheHit: true, data: value }
}

function isStructuredCacheHit<T>(value: T | DataApiInterfaceCacheHit<T>): value is DataApiInterfaceCacheHit<T> {
  if (typeof value !== 'object' || value == null) return false
  return (value as { cacheHit?: unknown }).cacheHit === true && 'data' in value
}

function inferProviderFromCachedData(value: unknown): string | null {
  const row = firstCacheRow(value)
  const provider = readStringField(row, ['provider', 'provider_id'])
  if (provider) return provider
  return readStringField(row, ['source'])
}

function inferSourceFromCachedData(value: unknown): string | null {
  const row = firstCacheRow(value)
  return readStringField(row, ['source', 'provider', 'provider_id'])
}

function firstCacheRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === 'object' && item != null)
    return first ? first as Record<string, unknown> : null
  }
  if (typeof value === 'object' && value != null) return value as Record<string, unknown>
  return null
}

function readStringField(row: Record<string, unknown> | null, fields: string[]): string | null {
  if (!row) return null
  for (const field of fields) {
    const value = row[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function cacheHitSatisfiesProviderConstraint(
  cachedProvider: string,
  cachedSource: string,
  requestedProvider: string | undefined,
  providerMode: DataApiProviderMode,
): boolean {
  if (providerMode !== 'strict' || !requestedProvider) return true
  const requested = normalizeDataApiProvider(requestedProvider)
  const provider = normalizeDataApiProvider(cachedProvider)
  const source = normalizeDataApiProvider(cachedSource)
  return provider === requested || source === requested
}

function shouldStopProviderIteration(message: string): boolean {
  const value = message.toLowerCase()
  return /\b(401|403|429)\b/.test(value) ||
    value.includes('permission') ||
    value.includes('unauthorized') ||
    value.includes('forbidden') ||
    value.includes('credential') ||
    value.includes('token') ||
    value.includes('api key') ||
    value.includes('rate limit') ||
    value.includes('too many requests') ||
    value.includes('quota') ||
    value.includes('frequency') ||
    value.includes('权限') ||
    value.includes('频率') ||
    value.includes('参数') ||
    value.includes('invalid argument')
}
