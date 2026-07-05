#!/usr/bin/env node
// No-network FinAgent Workstation finance API -> datastore concept matrix checker.
//
// This verifies structural coverage: provider/action path, registered
// ingestion where applicable, canonical table, query/readback action, UI/queue
// consumers, and API-health/failure logging hooks. It does not call upstreams.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { matrixDefinitions } from './finance_api_datastore_matrix_manifest.mjs'
import { validateFinanceSurfaceContract } from './finance_surface_contract.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const args = parseArgs(process.argv.slice(2))

const files = {
  dataStoreTool: read('src/agent/tools/data-store-tool.ts'),
  dataStoreQueries: read('src/agent/tools/data-store-tool-queries.ts'),
  remoteTool: readMany([
    'src/agent/tools/data-store-tool-remote.ts',
    'src/agent/tools/data-store-tool-remote-analytics.ts',
    'src/agent/tools/data-store-tool-remote-discovery.ts',
    'src/agent/tools/data-store-tool-remote-fetchers.ts',
    'src/agent/tools/data-store-tool-remote-screening.ts',
    'src/agent/tools/data-store-tool-remote-backtest.ts',
    'src/agent/tools/data-store-tool-remote-common.ts',
  ]),
  marketSchema: read('src/agent/tools/market-data-schema.ts'),
  marketService: readMany([
    'src/domain/market/services/market-data-action-service.ts',
    'src/domain/market/services/scan-market-data-action-service.ts',
    'src/domain/market/services/scan-market-data-service.ts',
    'src/domain/market/providers/tradingview-market-provider.ts',
  ]),
  bridgeRouteService: read('src/domain/market/services/bridge-finance-route-service.ts'),
  eastmoneyServices: readMany([
    'src/domain/market/services/eastmoney-market-data-action-service.ts',
    'src/domain/market/services/eastmoney-market-data-direct-action-service.ts',
    'src/domain/market/services/eastmoney-market-data-persistence-service.ts',
    'src/domain/market/providers/eastmoney-market-provider.ts',
    'src/domain/market/repositories/eastmoney-market-data-repository.ts',
  ]),
  yahooServices: readMany([
    'src/domain/market/services/yahoo-market-data-service.ts',
    'src/domain/market/providers/yahoo-market-data-provider.ts',
    'src/domain/market/repositories/yahoo-market-data-repository.ts',
  ]),
  fundServices: readMany([
    'src/domain/market/services/fund-market-data-fetch-service.ts',
    'src/agent/data/fetchers/fetcher-fund-list.ts',
    'src/agent/data/fetchers/fetcher-fund-nav.ts',
    'src/agent/data/fetchers/fetcher-fund-holding.ts',
    'src/agent/data/fetchers/fetcher-fund-manager.ts',
    'src/agent/data/fetchers/fetcher-etf.ts',
  ]),
  registries: readMany([
    'src/agent/data/ingestion/registry.ts',
    'src/agent/data/ingestion/registry-tdx.ts',
    'src/agent/data/ingestion/registry-akshare-eastmoney.ts',
    'src/agent/data/ingestion/registry-tushare.ts',
    'src/agent/data/ingestion/registry-yfinance.ts',
  ]),
  store: readMany([
    'src/agent/data/store/data-store.ts',
    'src/agent/data/store/data-store-reuse.ts',
    'src/agent/data/store/data-store-market.ts',
  ]),
  dataTaskEngine: read('src/agent/data-task-engine.ts'),
  wind: readMany([
    'src/agent/tools/wind-mcp.ts',
    'src/agent/tools/wind-mcp-persistence.ts',
  ]),
  migrations: readMany(['assets/migrations']),
  ipc: read('src/main/ipc-handlers.ts'),
  queue: read('src/agent/data/queue/fetch-queue.ts'),
  providerPolicy: readMany([
    'src/agent/data/provider-policy.ts',
    'src/agent/data/provider-router.ts',
    'src/domain/market/services/fund-market-data-fetch-service.ts',
    'src/renderer/panels/data-feed-priority-model.ts',
  ]),
  liveProbe: read('scripts/finance_live_probe_matrix.mjs'),
  tests: readMany(['test/unit']),
}

const matrix = matrixDefinitions.map(row)

const report = buildReport(matrix)
if (args.json === 'true') {
  emitJson(report)
} else {
  printReport(report)
}

if (args.output) {
  writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
}

if (args['coverage-only'] === 'true') {
  process.exit(report.summary.failed === 0 ? 0 : 1)
}

function row(def) {
  const declaredFailureSink = def.surfaceContract?.failureSink
  return {
    normalizerRequired: true,
    persistsByDefault: def.status !== 'fetch-only' && def.status !== 'output-only',
    sameRuntimeReadbackTested: def.status === 'proven',
    apiHealthLogsFailures: declaredFailureSink === 'api-health-visible' || def.status === 'proven',
    failureSink: declaredFailureSink === 'none' ? 'none' : 'api_call_log',
    riskStatus: def.riskStatus ?? riskForStatus(def.status),
    uiConsumesCache: Boolean(def.ipc || def.queueTask || def.query),
    ...def,
  }
}

function buildReport(rows) {
  const checked = rows.map((item) => {
    const checks = []
    checks.push(checkPatterns('provider action', item.providerPatterns, allCode()))
    checks.push(checkLiveProbe(item.liveProbe))
    checks.push(checkTables(item.tables))
    checks.push(checkQueries(item.query))
    checks.push(checkIngestion(item))
    checks.push(checkQueue(item.queueTask))
    checks.push(checkIpc(item.ipc))
    checks.push(...checkEvidence(item))
    checks.push(checkTestPatterns(item))
    checks.push(checkFailureLogging(item))
    checks.push(checkSurfaceContract(item))
    checks.push(checkStatusContract(item, checks))
    const failed = checks.filter((check) => check.status === 'failed')
    const status = failed.length > 0 ? 'broken' : item.status
    return { ...item, status, checks }
  })
  const failedRows = checked.filter((item) => item.checks.some((check) => check.status === 'failed'))
  const byStatus = {}
  for (const item of checked) byStatus[item.status] = (byStatus[item.status] ?? 0) + 1
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      rows: checked.length,
      failed: failedRows.length,
      byStatus,
    },
    rows: checked,
  }
}

function checkSurfaceContract(item) {
  const problems = validateFinanceSurfaceContract(item)
  return problems.length === 0
    ? passed('finance surface contract')
    : failed('finance surface contract', problems.join('; '))
}

function checkPatterns(name, patterns, text) {
  const required = array(patterns)
  if (required.length === 0) return skipped(name, 'not required')
  const missing = required.filter((pattern) => !text.includes(pattern))
  return missing.length === 0 ? passed(name) : failed(name, `missing: ${missing.join(', ')}`)
}

function checkLiveProbe(id) {
  if (!id) return skipped('live probe row', 'not applicable')
  return files.liveProbe.includes(id) ? passed('live probe row') : failed('live probe row', `missing ${id}`)
}

function checkTables(tables) {
  const required = array(tables)
  if (required.length === 0) return skipped('canonical table', 'output/fetch-only row')
  const missing = required.filter((table) => !new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${escapeRegExp(table)}\\b`).test(files.migrations))
  return missing.length === 0 ? passed('canonical table') : failed('canonical table', `missing migration table: ${missing.join(', ')}`)
}

function checkQueries(query) {
  const required = array(query)
  if (required.length === 0) return skipped('query/readback action', 'not reusable by design')
  const text = `${files.dataStoreTool}\n${files.dataStoreQueries}`
  const missing = required.filter((action) => !text.includes(`case '${action}'`) && !text.includes(`action:"${action}"`) && !text.includes(action))
  return missing.length === 0 ? passed('query/readback action') : failed('query/readback action', `missing: ${missing.join(', ')}`)
}

function checkIngestion(item) {
  const required = array(item.ingestion)
  if (required.length === 0) {
    return item.persistsByDefault && item.normalizerRequired
      ? skipped('ingestion registry', 'domain service persists directly')
      : skipped('ingestion registry', 'not required')
  }
  const missing = required.filter((endpoint) => !files.registries.includes(endpoint))
  return missing.length === 0 ? passed('ingestion registry') : failed('ingestion registry', `missing endpoint: ${missing.join(', ')}`)
}

function checkQueue(task) {
  const required = array(task)
  if (required.length === 0) return skipped('fetch queue task', 'not queue-backed')
  const missing = required.filter((item) => !files.queue.includes(`case '${item}'`) && !files.queue.includes(`'${item}'`))
  return missing.length === 0 ? passed('fetch queue task') : failed('fetch queue task', `missing: ${missing.join(', ')}`)
}

function checkIpc(channel) {
  const required = array(channel)
  if (required.length === 0) return skipped('IPC/UI cache consumer', 'agent/query only')
  const missing = required.filter((item) => !files.ipc.includes(item))
  return missing.length === 0 ? passed('IPC/UI cache consumer') : failed('IPC/UI cache consumer', `missing: ${missing.join(', ')}`)
}

function checkEvidence(item) {
  const checks = []
  const evidence = item.evidence ?? {}
  checks.push(checkEvidencePatterns('fetch evidence', evidence.fetch, allCode(), 'required'))
  if (item.ipc) {
    checks.push(checkEvidencePatterns('UI cache-read evidence', evidence.uiCacheRead, files.ipc, 'required'))
  } else {
    checks.push(skipped('UI cache-read evidence', 'no IPC/UI cache consumer declared'))
  }
  if (item.persistsByDefault) {
    checks.push(checkEvidencePatterns('normalizer/persist evidence', evidence.persist, allCode(), 'required'))
    checks.push(checkEvidencePatterns('same-runtime readback evidence', evidence.readback, `${files.dataStoreTool}\n${files.dataStoreQueries}\n${files.store}\n${files.tests}`, 'required'))
    checks.push(checkEvidencePatterns('readback regression evidence', evidence.readbackTest, files.tests, 'required'))
    checks.push(checkEvidencePatterns('failure no-persist regression evidence', evidence.failureNoPersistTest, files.tests, 'required'))
  } else {
    checks.push(skipped('normalizer/persist evidence', 'not reusable by design'))
    checks.push(skipped('same-runtime readback evidence', 'not reusable by design'))
    checks.push(skipped('readback regression evidence', 'not reusable by design'))
    checks.push(skipped('failure no-persist regression evidence', 'not reusable by design'))
  }
  checks.push(checkEvidencePatterns('failure sink evidence', evidence.failureSink, allCode(), item.failureSink === 'none' ? 'optional' : 'required'))
  return checks
}

function checkEvidencePatterns(name, patterns, text, mode) {
  const required = array(patterns)
  if (required.length === 0) {
    return mode === 'required' ? failed(name, 'missing manifest evidence') : skipped(name, 'not required')
  }
  const missing = required.filter((pattern) => !text.includes(pattern))
  return missing.length === 0 ? passed(name) : failed(name, `missing: ${missing.join(', ')}`)
}

function checkTestPatterns(item) {
  const required = array(item.testPatterns)
  if (required.length === 0) {
    return item.status === 'proven' || item.apiHealthLogsFailures
      ? failed('declared test coverage', 'missing manifest testPatterns')
      : skipped('declared test coverage', 'not required')
  }
  const missing = required.filter((pattern) => !files.tests.includes(pattern))
  return missing.length === 0 ? passed('declared test coverage') : failed('declared test coverage', `missing: ${missing.join(', ')}`)
}

function checkFailureLogging(item) {
  if (!item.apiHealthLogsFailures) return skipped('API health failure logging', 'not required')
  if (item.failureSink === 'fetch_tasks') {
    return files.queue.includes('updateTaskStatus(task.id, \'failed\'')
      ? passed('API health failure logging')
      : failed('API health failure logging', 'missing failed task status sink')
  }
  const required = array(item.evidence?.failureSink)
  if (required.length === 0) return failed('API health failure logging', 'missing row-specific failure sink evidence')
  const text = allCode()
  const missing = required.filter((pattern) => !text.includes(pattern))
  return missing.length === 0 ? passed('API health failure logging') : failed('API health failure logging', `missing: ${missing.join(', ')}`)
}

function checkStatusContract(item, previousChecks) {
  if (item.status !== 'proven') return passed('status contract')
  const failedRequired = previousChecks.filter((check) => check.status === 'failed')
  if (failedRequired.length === 0) return passed('status contract')
  return failed('status contract', 'proven rows require fetch, persist, readback, failure, logging, and probe evidence')
}

function passed(name) { return { name, status: 'passed' } }
function skipped(name, reason) { return { name, status: 'skipped', reason } }
function failed(name, reason) { return { name, status: 'failed', reason } }

function allCode() {
  return [
    files.dataStoreTool,
    files.dataStoreQueries,
    files.remoteTool,
    files.marketSchema,
    files.marketService,
    files.bridgeRouteService,
    files.eastmoneyServices,
    files.yahooServices,
    files.fundServices,
    files.registries,
    files.store,
    files.dataTaskEngine,
    files.ipc,
    files.queue,
    files.providerPolicy,
    files.wind,
  ].join('\n')
}

function printReport(report) {
  console.log('FinAgent Workstation API/datastore concept matrix')
  console.log(`  rows: ${report.summary.rows}`)
  console.log(`  failed: ${report.summary.failed}`)
  console.log(`  status: ${JSON.stringify(report.summary.byStatus)}`)
  console.log('')
  for (const item of report.rows) {
    const failedChecks = item.checks.filter((check) => check.status === 'failed')
    const suffix = failedChecks.length === 0 ? '' : ` - ${failedChecks.map((check) => `${check.name}: ${check.reason}`).join('; ')}`
    console.log(`${item.status.toUpperCase().padEnd(10)} ${item.id} | ${item.concept} | ${item.provider}${suffix}`)
  }
}

function emitJson(report) {
  console.log(JSON.stringify(report, null, 2))
}

function read(relativePath) {
  const full = join(ROOT, relativePath)
  if (!existsSync(full)) return ''
  return readFileSync(full, 'utf-8')
}

function readMany(paths) {
  return paths.map((path) => {
    const full = join(ROOT, path)
    if (!existsSync(full)) return ''
    const statText = readFileSyncOrDir(full)
    return statText
  }).join('\n')
}

function readFileSyncOrDir(path) {
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return readdirSync(path)
      .filter((name) => /\.(ts|tsx|js|mjs|sql)$/.test(name))
      .map((name) => {
        const child = join(path, name)
        return statSync(child).isDirectory() ? readFileSyncOrDir(child) : readFileSync(child, 'utf-8')
      })
      .join('\n')
  }
}

function array(value) {
  if (value == null || value === false) return []
  return Array.isArray(value) ? value : [value]
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseArgs(values) {
  const parsed = {}
  for (let i = 0; i < values.length; i++) {
    const arg = values[i]
    if (!arg.startsWith('--')) continue
    const raw = arg.slice(2)
    const eq = raw.indexOf('=')
    if (eq >= 0) parsed[raw.slice(0, eq)] = raw.slice(eq + 1)
    else if (i + 1 < values.length && !values[i + 1].startsWith('--')) parsed[raw] = values[++i]
    else parsed[raw] = 'true'
  }
  return parsed
}

function riskForStatus(status) {
  if (status === 'proven') return 'low'
  if (status === 'fetch-only' || status === 'output-only') return 'intentional non-reusable'
  if (status === 'blocked') return 'blocked by external setup'
  return 'needs review'
}
