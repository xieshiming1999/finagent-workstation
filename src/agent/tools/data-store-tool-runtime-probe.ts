import { buildDataInterfaceHealth } from '../data/data-interface-health'
import { FinanceRuntimeProbeService } from '../data/runtime-probe-service'
import type { DataStore } from '../data/store/data-store'
import { toolError } from '../tool'

type RuntimeProbeToolAction = 'status' | 'run'
type RuntimeProbeMode = 'credential' | 'unstable' | 'failures' | 'all'

export async function runtimeProbe(
  ds: DataStore,
  input: Record<string, unknown>,
  runtimeBasePath: string,
): Promise<string> {
  const action = normalizeAction(input.probeAction ?? input.subaction ?? input.modeAction)
  const service = new FinanceRuntimeProbeService(
    runtimeBasePath,
    () => buildDataInterfaceHealth(ds?.isReady ? ds : null, undefined, { runtimeBasePath }),
  )
  if (action === 'status') {
    return JSON.stringify({
      action: 'runtime_probe',
      probeAction: 'status',
      status: service.getStatus(),
      provenance: provenance('status', runtimeBasePath),
      tip: 'Inspect recommendedTargets and blockedTargets before run. Use probeAction:"run" with probeMode:"credential|unstable|failures|all" to refresh governed live provider evidence only for eligible bounded targets.',
    }, null, 2)
  }
  const probeMode = normalizeProbeMode(input.probeMode ?? input.mode)
  const probeIds = normalizeProbeIds(input.probeIds ?? input.ids)
  const status = await service.run(probeMode, probeIds)
  return JSON.stringify({
    action: 'runtime_probe',
    probeAction: 'run',
    probeMode,
    probeIds,
    status,
    provenance: provenance('run', runtimeBasePath),
    tip: 'After runtime probes finish, call data_health or interface_availability again; those surfaces now read the refreshed runtime live-status evidence. Use explicit probeIds only for deliberate bounded provider-specific refreshes; blockedTargets require root-cause changes before broad retry.',
  }, null, 2)
}

function normalizeAction(value: unknown): RuntimeProbeToolAction {
  const text = String(value ?? 'status').trim().toLowerCase()
  if (text === 'status' || text === 'run') return text
  toolError(`runtime_probe probeAction must be "status" or "run", got ${text || '(empty)'}`)
}

function normalizeProbeMode(value: unknown): RuntimeProbeMode {
  const text = String(value ?? 'all').trim().toLowerCase()
  if (text === 'credential' || text === 'unstable' || text === 'failures' || text === 'all') return text
  toolError(`runtime_probe probeMode must be credential|unstable|failures|all, got ${text || '(empty)'}`)
}

function normalizeProbeIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  const text = String(value ?? '').trim()
  if (!text) return []
  return text.split(',').map((item) => item.trim()).filter(Boolean)
}

function provenance(probeAction: RuntimeProbeToolAction, runtimeBasePath: string): Record<string, unknown> {
  return {
    interfaceId: 'data.runtime_probe',
    providerId: 'local',
    provider: 'local',
    capabilityId: 'local.data.runtime_probe',
    canonicalSchema: 'runtime_probe_status',
    canonicalTable: 'runtime_probe_status',
    readbackAction: 'runtime_probe',
    providerMode: 'local-runtime-control',
    cacheStatus: 'runtime-evidence',
    cacheDecision: probeAction === 'run'
      ? 'runtime_probe generated durable operational evidence for provider health and route control; use data_health or interface_availability before normal provider routing'
      : 'runtime_probe reads durable operational evidence for provider health and route control; it does not return reusable market data rows',
    probeAction,
    basePath: runtimeBasePath,
    fetchedAt: new Date().toISOString(),
  }
}
