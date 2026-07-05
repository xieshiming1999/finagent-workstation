import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('finance schema governance audit contract', () => {
  const script = readFileSync(join(process.cwd(), 'scripts', 'finance_schema_governance_audit.mjs'), 'utf-8')

  it('consolidates inventory, live status, matrix evidence, and mobile proof', () => {
    expect(script).toContain('finance_api_surface_inventory_2026_06_17.json')
    expect(script).toContain('finance_api_live_status_2026_06_17.json')
    expect(script).toContain('finance_mobile_api_status_2026_06_17.json')
    expect(script).toContain('matrixDefinitions')
    expect(script).toContain('missingLiveProbe')
    expect(script).toContain('nativeReadbackProbed')
    expect(script).toContain('missing-matrix-evidence')
    expect(script).toContain('registered-table-not-in-matrix')
    expect(script).toContain('fetch-only-has-table')
  })
})
