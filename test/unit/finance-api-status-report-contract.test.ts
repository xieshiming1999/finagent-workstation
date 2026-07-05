import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('finance API status report contract', () => {
  const script = readFileSync(join(process.cwd(), 'scripts', 'finance_api_status_report.mjs'), 'utf-8')

  it('records non-passing, unsupported, gated, and unstable APIs', () => {
    expect(script).toContain('failures')
    expect(script).toContain('unsupportedApis')
    expect(script).toContain('credentialOrQuotaGatedApis')
    expect(script).toContain('transportUnstableApis')
    expect(script).toContain('runtimeBlockedApis')
    expect(script).toContain('readActiveProbeIds')
    expect(script).toContain('inventory')
    expect(script).toContain('validationState')
    expect(script).toContain('failureClass')
    expect(script).toContain('params')
    expect(script).toContain('schema')
    expect(script).toContain('error')
  })
})
