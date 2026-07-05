import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('finance live probe schema census contract', () => {
  const script = readFileSync(join(process.cwd(), 'scripts', 'finance_live_probe_matrix.mjs'), 'utf-8')

  it('keeps live probes serial, resumable, and artifact-backed', () => {
    expect(script).toContain('checkpoint')
    expect(script).toContain('const concurrency = Number(args.concurrency ?? 1)')
    expect(script).toContain('Live finance API probes must run with --concurrency 1')
    expect(script).toContain('console.log(`  concurrency: ${concurrency}`)')
    expect(script).toContain('DEFAULT_EASTMONEY_TIMEOUT_MS = 120_000')
    expect(script).toContain("args['eastmoney-timeout-ms']")
    expect(script).toContain('isEastmoneyBackedSpec')
    expect(script).toContain('console.log(`  eastmoneyTimeoutMs: ${eastmoneyTimeoutMs}`)')
    expect(script).toContain('readCheckpoint')
    expect(script).toContain('writeCheckpoint')
    expect(script).toContain('completedById')
    expect(script).toContain('registerDataSnapshotArtifact')
    expect(script).toContain("kind: 'data_snapshot'")
    expect(script).toContain("ownerTask: 'data_schema_live_probe'")
  })

  it('captures schema, provider time, and failure class evidence for data governance', () => {
    expect(script).toContain('Array.isArray(value?.List)')
    expect(script).toContain('schemaOf(rows[0])')
    expect(script).toContain('providerTimeOf(parsed, rows[0])')
    expect(script).toContain('classifyProbeFailure')
    expect(script).toContain('isRuntimeUnavailableFailure')
    expect(script).toContain('return await runWindProbe')
    expect(script).toContain('contract_mismatch')
    expect(script).toContain('quota_rate_limit')
    expect(script).toContain('runtime_unavailable')
    expect(script).toContain('transport')
  })

  it('does not classify every sidecar-backed upstream failure as runtime unavailable', () => {
    expect(script).not.toContain('/runtime_unavailable|sidecar|gotdx.*unavailable/')
    expect(script).toContain('/python sidecar unavailable/')
    expect(script).toContain('/gotdx unavailable/')
    expect(script).toContain('/provider runtime circuit open/')
    expect(script).toContain('/timeout|aborted|socket|econnreset|fetch failed|network|proxy|blocked|hang up|remote.*disconnect|und_err|unavailable/')
  })

  it('keeps gotdx standard, ExTDX, and MAC transport circuits separate', () => {
    expect(script).toContain("return 'gotdx:standard'")
    expect(script).toContain("return 'gotdx:ex'")
    expect(script).toContain("return 'gotdx:mac'")
  })

  it('can bootstrap runtime dependencies and records executable gated states', () => {
    expect(script).toContain('bootstrapGotdxRuntime')
    expect(script).toContain('bootstrapPythonRuntime')
    expect(script).toContain('--bootstrap-sidecars')
    expect(script).toContain('loadFinElectronConfig')
    expect(script).toContain("'.finagent-workstation'")
    expect(script).toContain("'config.json'")
    expect(script).toContain('credentialSource')
    expect(script).toContain("finElectronConfig.apiKeys?.TUSHARE_TOKEN")
    expect(script).toContain("finElectronConfig.apiKeys?.WIND_API_KEY")
    expect(script).toContain("status: 'blocked'")
    expect(script).toContain("status: 'credential-gated'")
    expect(script).toContain("status: 'quota-gated'")
    expect(script).toContain('capabilityStates')
    expect(script).toContain('runtime.capabilities')
  })

  it('has a real exhaustive stage for code-used API schema validation', () => {
    expect(script).toContain("selectedStage === 'exhaustive'")
    expect(script).toContain('tdxExhaustiveSpecs')
    expect(script).toContain('sidecarExhaustiveSpecs')
    expect(script).toContain('akshareExhaustiveSpecs')
    expect(script).toContain('yfinanceExhaustiveSpecs')
    expect(script).toContain('tushareExhaustiveSpecs')
    expect(script).toContain('windExhaustiveSpecs')
    expect(script).toContain('validationStateForResult')
    expect(script).toContain('valid-schema-observed')
    expect(script).toContain('valid-empty-response')
    expect(script).toContain('invalid-parameters')
    expect(script).toContain('unsupported-by-provider')
    expect(script).toContain('transport-or-provider-unstable')
  })
})
