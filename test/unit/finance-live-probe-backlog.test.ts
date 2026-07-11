import { execFileSync } from 'child_process'
import { describe, expect, it } from 'vitest'

describe('finance live probe backlog', () => {
  it('keeps remaining API probes serial, resumable, and visible', () => {
    const output = execFileSync('node', [
      'scripts/finance_live_probe_backlog.mjs',
      '--no-write',
      'true',
      '--fail-on-problem',
      'true',
      '--jsonOnly',
      'true',
    ], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    })
    const report = JSON.parse(output)

    expect(report.policy).toMatchObject({
      defaultConcurrency: 1,
      defaultWaitMs: 1500,
      defaultEastmoneyTimeoutMs: 120000,
    })
    expect(report.policy.concurrencyRule).toContain('requires --concurrency 1')
    expect(report.policy.timeoutRule).toContain('--eastmoney-timeout-ms 120000')
    expect(report.summary).toMatchObject({
      detailedMatrixRows: 861,
      matrixRowsNeedingLiveProbe: 0,
      totalBacklog: 0,
      withProbeSpec: 0,
      missingProbeDefinition: 0,
    })
    expect(report.summary.liveTested).toBeGreaterThan(0)
    expect(report.summary.notRequiredLocalOrControl).toBeGreaterThan(0)
    expect(report.summary.alreadyCoveredByLiveStatusByState).toEqual({})
    expect(report.problems).toEqual([])
    expect(report.warnings).toEqual([])

    const commands = [
      ...report.commandTemplates.map((item: { command: string }) => item.command),
      ...report.rows.map((row: { recommendedCommand: string }) => row.recommendedCommand),
    ]
    expect(commands.length).toBe(0)
    for (const command of commands) {
      expect(command).toContain('--concurrency 1')
      expect(command).toContain('--wait-ms 1500')
      expect(command).toContain('--eastmoney-timeout-ms 120000')
      expect(command).toContain('--checkpoint ')
      expect(command).toContain('--resume true')
    }
    expect(report.rows).toEqual([])
    expect(report.commandTemplates).toEqual([])
    expect(report.rows.some((row: { probeStatus: string }) => row.probeStatus === 'has-probe-spec')).toBe(false)
    expect(report.rows.some((row: { probeStatus: string }) => row.probeStatus === 'missing-probe-definition')).toBe(false)
  })
})
