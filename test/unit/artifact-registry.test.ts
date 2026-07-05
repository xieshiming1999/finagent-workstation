import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { ArtifactRegistry } from '../../src/agent/artifact-registry'

describe('ArtifactRegistry', () => {
  it('adds stable references and default governance metadata', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-artifact-registry-'))
    const record = new ArtifactRegistry(basePath).register({
      kind: 'data_snapshot',
      path: join(basePath, 'memory', 'data', 'snapshot.json'),
      title: 'Reusable data snapshot',
      source: 'DataStore',
      metadata: { templateId: 'daily_data_health' },
    })

    expect(record).toMatchObject({
      stableRef: `artifact:${record.id}`,
      ownerTask: 'daily_data_health',
      verificationStatus: 'unverified',
      freshness: { status: 'unknown' },
      provenance: { source: 'DataStore' },
    })
    expect(record.links).toEqual(expect.arrayContaining([record.stableRef, record.path]))
  })

  it('normalizes legacy registry rows when listed', () => {
    const basePath = mkdtempSync(join(tmpdir(), 'fin-artifact-legacy-'))
    const registryDir = join(basePath, 'memory', 'artifacts')
    mkdirSync(registryDir, { recursive: true })
    writeFileSync(join(registryDir, 'registry.json'), JSON.stringify([{
      id: 'report:/tmp/report.pdf',
      kind: 'report',
      path: '/tmp/report.pdf',
      title: 'Old report',
      source: 'ReportDownload',
      createdAt: '2026-06-17T00:00:00.000Z',
      updatedAt: '2026-06-17T00:00:00.000Z',
      metadata: { reportType: 'annual' },
    }]), 'utf-8')

    const record = new ArtifactRegistry(basePath).list('report')[0]

    expect(record.stableRef).toBe('artifact:report:/tmp/report.pdf')
    expect(record.ownerTask).toBe('annual')
    expect(record.verificationStatus).toBe('unverified')
    expect(record.freshness).toEqual({ status: 'unknown' })
    expect(record.provenance).toEqual({ source: 'ReportDownload' })
    expect(record.links).toEqual(expect.arrayContaining([record.stableRef, record.path]))
  })
})
