import { execFileSync } from 'child_process'
import { describe, expect, it } from 'vitest'

describe('finance data API completion audit', () => {
  it('keeps data provenance refactor completion evidence current', () => {
    const output = execFileSync('node', [
      'scripts/finance_data_api_completion_audit.mjs',
      '--no-write',
      'true',
      '--fail-on-problem',
      'true',
      '--jsonOnly',
      'true',
    ], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    })
    const report = JSON.parse(output)

    expect(report.summary).toMatchObject({
      checks: 45,
      checksPassed: 45,
      problems: 0,
      ungovernedProviderRows: 0,
      liveProbeBacklogRows: 0,
      liveProbeBacklogWithSpec: 0,
      liveProbeBacklogMissingSpec: 0,
      dataHealthProviders: 12,
    })
    expect(report.summary.providerMatrixInterfaces).toBeGreaterThanOrEqual(109)
    expect(report.summary.detailedMatrixRows).toBeGreaterThanOrEqual(816)
    expect(report.summary.outputOnlyInterfaceRows).toBeGreaterThanOrEqual(20)
    expect(report.summary.crossRuntimeInterfaces).toBeGreaterThanOrEqual(218)
    expect(report.summary.crossRuntimeCapabilities).toBeGreaterThanOrEqual(731)
    expect(report.summary.liveStatusRows).toBeGreaterThan(0)
    expect(report.summary.liveStatusPassed).toBeGreaterThan(0)
    expect(report.summary.dataHealthInterfaces).toBeGreaterThanOrEqual(109)
    expect(report.summary.dataHealthDatasets).toBeGreaterThanOrEqual(61)
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('live-probe-backlog-policy')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('detailed-matrix-generated-artifact-fresh')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('tool-action-surface-boundary')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('live-status-traceability')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('schema-governance-table-matrix-coverage')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('datastore-matrix-no-broken-rows')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('datastore-matrix-generated-artifact-fresh')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('live-probe-backlog-generated-artifact-fresh')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('no-ungoverned-provider-surfaces')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('recorded-live-probe-status')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('unified-data-health-report')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('unified-data-health-generated-artifact-fresh')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('runtime-data-health-surfaces')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('mobile-data-health-action-surface')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('mobile-native-provider-boundaries')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('output-only-probe-evidence')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('local-surface-classification')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('skills-generated-reference-fresh')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('output-only-skills-generated-reference-fresh')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('skills-no-normal-provider-direct-guidance')
    expect(report.checks.map((check: { id: string }) => check.id)).toContain('skills-disabled-tushare-blocking-guidance')
    expect(report.problems).toEqual([])
  })
})
