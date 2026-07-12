import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { ToolContext } from '../../src/agent/tool'
import { SourceReaderTool } from '../../src/agent/tools/source-reader'

describe('SourceReaderTool', () => {
  it('reads local source and persists source evidence', async () => {
    const ctx = tempToolContext()
    const sourcePath = join(ctx.basePath, 'macro.html')
    writeFileSync(sourcePath, '<html><title>Macro Note</title><body>2026-07-11 rates matter</body></html>')

    const result = JSON.parse(await new SourceReaderTool().call('source-1', {
      action: 'read',
      path: sourcePath,
      source: 'local-test',
      topic: 'rates',
    }, ctx))

    expect(result.contract).toBe('source-reader-result-v1')
    expect(result.record.title).toBe('Macro Note')
    expect(result.record.publishedAt).toBe('2026-07-11')
    expect(result.record.hash).toBeTruthy()
    expect(existsSync(result.artifactHint.path)).toBe(true)
  })

  it('rejects missing source locator', async () => {
    await expect(new SourceReaderTool().call(
      'source-2',
      { action: 'read' },
      tempToolContext(),
    )).rejects.toThrow('failureClass=invalid-input')
  })

  it('classifies missing source files', async () => {
    await expect(new SourceReaderTool().call(
      'source-missing-file',
      { action: 'read', path: '/tmp/source-reader-missing-file.html' },
      tempToolContext(),
    )).rejects.toThrow('failureClass=source-file-missing')
  })

  it('classifies blocked HTTP source access', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(403, { 'content-type': 'text/html' })
      res.end('<html><title>blocked</title></html>')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not bind')
    try {
      await expect(new SourceReaderTool().call(
        'source-http-403',
        { action: 'read', url: `http://127.0.0.1:${address.port}/blocked` },
        tempToolContext(),
      )).rejects.toThrow('failureClass=anti-bot-or-access-blocked')
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
    }
  })

  it('creates structured macro evidence from a source record', async () => {
    const ctx = tempToolContext()
    const sourcePath = join(ctx.basePath, 'energy.html')
    writeFileSync(sourcePath, '<html><title>Energy Outlook</title><body>2026-07-10 oil supply risk</body></html>')
    const tool = new SourceReaderTool()

    const sourceResult = JSON.parse(await tool.call('source-read', {
      action: 'read',
      path: sourcePath,
      source: 'local-energy',
      topic: 'energy',
    }, ctx))

    const macroResult = JSON.parse(await tool.call('macro-evidence', {
      action: 'macroEvidence',
      sourceRecordPath: sourceResult.artifactHint.path,
      topic: 'energy price shock',
      region: 'global',
      assetClass: 'commodity/equity/fund',
      keyClaims: ['Oil supply risk may keep energy prices elevated.'],
      affectedAssets: ['energy sector', 'airlines', 'commodity funds'],
      confidenceEffect: 'Raises confidence that energy-sensitive assets need scenario monitoring.',
      freshness: 'current',
      evidenceClass: 'public-research',
      missingEvidence: ['No official inventory series attached yet.'],
    }, ctx))

    expect(macroResult.contract).toBe('source-reader-macro-evidence-result-v1')
    expect(macroResult.record).toMatchObject({
      contract: 'macro-evidence-record-v1',
      title: 'Energy Outlook',
      topic: 'energy price shock',
    })
    expect(macroResult.record.tradeBoundary).toContain('not a direct buy/sell rule')
    expect(existsSync(macroResult.artifactHint.path)).toBe(true)
  })

  it('rejects macro evidence without structured fields', async () => {
    await expect(new SourceReaderTool().call(
      'macro-error',
      {
        action: 'macroEvidence',
        topic: 'rates',
      },
      tempToolContext(),
    )).rejects.toThrow('missing required structured fields')
  })

  it('creates macro evidence from official numeric series row', async () => {
    const ctx = tempToolContext()
    const result = JSON.parse(await new SourceReaderTool().call('macro-numeric', {
      action: 'macroNumericEvidence',
      numericSeriesRow: {
        sourceName: 'EIA',
        provider: 'eia',
        seriesId: 'WCESTUS1',
        metricName: 'US commercial crude oil inventories',
        value: 415200,
        unit: 'thousand barrels',
        frequency: 'weekly',
        sourceDataTime: '2026-07-03',
        fetchedAt: '2026-07-12T02:00:00Z',
        status: 'ok',
      },
      topic: 'oil inventory pressure',
      region: 'US/global',
      assetClass: 'commodity/equity/fund',
      affectedAssets: ['oil', 'energy equities', 'inflation-sensitive funds'],
      confidenceEffect: 'Raises confidence that energy-sensitive analysis should include inventory risk as an invalidation factor.',
    }, ctx))

    expect(result.contract).toBe('source-reader-macro-numeric-evidence-result-v1')
    expect(result.record).toMatchObject({
      contract: 'macro-evidence-record-v1',
      evidenceClass: 'official-numeric-series',
      sourceDate: '2026-07-03',
      numericSeries: {
        seriesId: 'WCESTUS1',
        provider: 'eia',
      },
    })
    expect(result.record.tradeBoundary).toContain('not a direct buy/sell rule')
    expect(existsSync(result.artifactHint.path)).toBe(true)
  })

  it('rejects macro numeric evidence without required structured fields', async () => {
    await expect(new SourceReaderTool().call(
      'macro-numeric-error',
      {
        action: 'macroNumericEvidence',
        seriesId: 'WCESTUS1',
      },
      tempToolContext(),
    )).rejects.toThrow('sourceDataTime')
  })
})

function tempToolContext(): ToolContext {
  const basePath = mkdtempSync(join(tmpdir(), 'fin-source-reader-tool-'))
  const memoryDir = join(basePath, 'memory')
  mkdirSync(memoryDir, { recursive: true })
  return {
    basePath,
    workDir: basePath,
    memoryDir,
    bundleDir: join(basePath, 'bundle'),
    projectLocalDir: join(basePath, '.finagent-workstation'),
    pluginSkillPaths: [],
    skipPermissions: false,
    approvedTools: new Set(),
    planMode: false,
    readFileTimestamps: new Map(),
    taskRegistry: {} as ToolContext['taskRegistry'],
    teamRegistry: {} as ToolContext['teamRegistry'],
  }
}
