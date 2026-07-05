import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('finance API surface inventory contract', () => {
  const script = readFileSync(join(process.cwd(), 'scripts', 'finance_api_surface_inventory.mjs'), 'utf-8')

  it('derives the finance API inventory from code-owned surfaces', () => {
    expect(script).toContain('finance_live_probe_matrix.mjs')
    expect(script).toContain('data-store-tool.ts')
    expect(script).toContain('market-data-schema.ts')
    expect(script).toContain('ingestion/registry.ts')
    expect(script).toContain('sidecar/gotdx/main.go')
    expect(script).toContain('sidecar/server.py')
    expect(script).toContain('market_data_tool_schema.dart')
    expect(script).toContain('market_data_action_service.dart')
    expect(script).toContain('finance_schema_census.dart')
  })

  it('separates concrete runtime APIs from generic proxy and local-only surfaces', () => {
    expect(script).toContain('finite-provider-endpoint')
    expect(script).toContain('registered-provider-endpoint')
    expect(script).toContain('finite-sidecar-route')
    expect(script).toContain('generic-proxy-unbounded')
    expect(script).toContain('output-only-by-design')
    expect(script).toContain('local-readback-action')
  })

  it('reports schema-validation coverage instead of relying on runtime errors', () => {
    expect(script).toContain('coverageStatus')
    expect(script).toContain('missing-live-probe')
    expect(script).toContain('needs-real-api-validation')
    expect(script).toContain('validationState')
    expect(script).toContain('apiStatus')
    expect(script).toContain('readProbeResults')
    expect(script).toContain('probe-results')
    expect(script).toContain('not-probed')
    expect(script).toContain('classified-without-live-call')
    expect(script).toContain('all-matched-probes-passed')
    expect(script).toContain('credentialPrecedence')
    expect(script).toContain('~/.finagent-workstation/config.json apiKeys')
  })
})
