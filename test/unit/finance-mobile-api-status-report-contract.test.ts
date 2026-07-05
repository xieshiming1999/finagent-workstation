import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('mobile finance API status report contract', () => {
  const script = readFileSync(join(process.cwd(), 'scripts', 'finance_mobile_api_status_report.mjs'), 'utf-8')

  it('derives per-action mobile status from the shared finance inventory', () => {
    expect(script).toContain("row.runtime === 'shared_mobile'")
    expect(script).toContain('needs-native-live-probe')
    expect(script).toContain('local-readback-action')
    expect(script).toContain('schema-census-contract')
    expect(script).toContain("const probeResultsPath = args['probe-results'] ?? ''")
    expect(script).toContain('function readProbeResults')
    expect(script).toContain('native-live-probed')
    expect(script).toContain('native-readback-probed')
    expect(script).toContain('Provider Actions Needing Native Live Proof')
    expect(script).toContain('Native Live Non-Passing Results')
    expect(script).toContain('Native Readback-Probed Actions')
  })
})
