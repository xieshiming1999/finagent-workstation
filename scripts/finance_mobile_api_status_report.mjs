#!/usr/bin/env node
// Generate a per-action shared mobile / FinAgent finance API status report from
// the source-derived finance API inventory.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = parseArgs(process.argv.slice(2))
const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(scriptDir, '..', '..')
const inventoryPath = resolveExistingPath(requiredArg('inventory'))
const output = args.output ?? ''
const markdownOutput = args.markdown ?? ''
const probeResultsPath = args['probe-results'] ?? ''

if (!existsSync(inventoryPath)) throw new Error(`Missing inventory file: ${inventoryPath}`)
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf-8'))
const probeResults = readProbeResults(probeResultsPath)
const rows = (Array.isArray(inventory.rows) ? inventory.rows : [])
  .filter((row) => row.runtime === 'shared_mobile')
  .map((row) => withProbeResult(row, probeResults))

const report = {
  generatedAt: new Date().toISOString(),
  source: inventoryPath,
  probeResults: probeResultsPath || null,
  runtime: 'shared_mobile_finagent',
  summary: {
    total: rows.length,
    queryOrLocal: rows.filter((row) => row.kind === 'query-or-local').length,
    providerActions: rows.filter((row) => row.kind === 'provider-action').length,
    derived: rows.filter((row) => row.kind === 'derived-analysis').length,
    schemaCensusRows: rows.filter((row) => row.kind === 'schema-census-row').length,
    needsNativeLiveProbe: rows.filter((row) => row.validationState === 'needs-native-live-probe').length,
    nativeLiveProbed: rows.filter((row) => row.status === 'native-live-probed').length,
    nativeLiveFailed: rows.filter((row) => row.status === 'native-live-failed').length,
    nativeReadbackProbed: rows.filter((row) => row.status === 'native-readback-probed').length,
    nativeReadbackFailed: rows.filter((row) => row.status === 'native-readback-failed').length,
    credentialGated: rows.filter((row) => row.validationState === 'credential-gated').length,
    quotaGated: rows.filter((row) => row.validationState === 'quota-gated').length,
    runtimeBlocked: rows.filter((row) => row.validationState === 'runtime-blocked').length,
    transportOrProviderUnstable: rows.filter((row) => row.validationState === 'transport-or-provider-unstable').length,
    invalidParameters: rows.filter((row) => row.validationState === 'invalid-parameters').length,
    unsupported: rows.filter((row) => row.validationState === 'unsupported-by-provider').length,
    localReadbackActions: rows.filter((row) => row.validationState === 'local-readback-action').length,
    outputOnlyByDesign: rows.filter((row) => row.validationState === 'output-only-by-design').length,
  },
  byProvider: group(rows, 'provider'),
  byValidationState: group(rows, 'validationState'),
  rows,
}

if (output) write(output, `${JSON.stringify(report, null, 2)}\n`)
else console.log(JSON.stringify(report, null, 2))
if (markdownOutput) write(markdownOutput, markdown(report))

function withProbeResult(row, probeResults) {
  const action = row.action ?? row.endpoint
  const probe = probeResults.get(action) ?? probeResults.get(row.endpoint)
  const base = {
    runtime: row.runtime,
    family: row.family,
    provider: row.provider,
    endpoint: row.endpoint,
    action,
    kind: row.kind,
    schemaStatus: row.schemaStatus,
    validationState: mobileValidationState(row),
    status: mobileStatus(row),
    sourceFile: row.sourceFile,
  }
  if (!probe) return base
  const isReadback = base.kind === 'query-or-local' || base.schemaStatus === 'query'
  return {
    ...base,
    validationState: probe.validationState ?? base.validationState,
    status: probe.status === 'passed'
      ? isReadback ? 'native-readback-probed' : 'native-live-probed'
      : probe.status === 'credential-gated'
        ? 'native-live-credential-gated'
        : probe.validationState === 'quota-gated'
          ? 'native-live-quota-gated'
        : isReadback ? 'native-readback-failed' : 'native-live-failed',
    liveProbe: {
      id: probe.id,
      status: probe.status,
      validationState: probe.validationState,
      failureClass: probe.failureClass,
      error: probe.error,
      durationMs: probe.durationMs,
      fetchedAt: probe.fetchedAt,
      rowCount: probe.rowCount,
      columns: probe.columns ?? [],
      firstRowSchema: probe.firstRowSchema ?? {},
      preview: probe.preview,
      params: probe.params,
    },
  }
}

function mobileStatus(row) {
  if (row.kind === 'query-or-local' || row.schemaStatus === 'query') return 'local-readback-contract'
  if (row.kind === 'derived-analysis') return 'derived-local-contract'
  if (row.kind === 'schema-census-row') return 'schema-census-contract'
  if (row.schemaStatus === 'fetch-only') return 'fetch-only-contract'
  if (row.schemaStatus === 'supported-provider-action') return 'native-provider-action-needs-live-proof'
  return 'classified-contract'
}

function mobileValidationState(row) {
  if (row.kind === 'query-or-local' || row.schemaStatus === 'query') return 'local-readback-action'
  if (row.kind === 'derived-analysis') return 'derived-local-analysis'
  if (row.schemaStatus === 'fetch-only') return 'output-only-by-design'
  if (row.kind === 'schema-census-row') return 'classified-contract-row'
  if (row.schemaStatus === 'supported-provider-action') return 'needs-native-live-probe'
  return 'classified-no-runtime-api'
}

function markdown(report) {
  const lines = [
    '# Mobile Finance API Status Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Source: \`${report.source}\``,
    report.probeResults ? `Probe results: \`${report.probeResults}\`` : 'Probe results: none',
    '',
    '## Summary',
    '',
    ...Object.entries(report.summary).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Provider Actions Needing Native Live Proof',
    '',
    ...report.rows
      .filter((row) => row.validationState === 'needs-native-live-probe')
      .map((row) => `- ${row.action} (${row.provider}, ${row.sourceFile})`),
    '',
    '## Native Live Non-Passing Results',
    '',
    ...report.rows
      .filter((row) => row.liveProbe && row.liveProbe.status !== 'passed')
      .map((row) => `- ${row.action}: ${row.liveProbe.validationState} (${row.liveProbe.error || row.liveProbe.failureClass || 'no error'})`),
    '',
    '## Native Readback-Probed Actions',
    '',
    ...report.rows
      .filter((row) => row.status === 'native-readback-probed')
      .map((row) => `- ${row.action}: ${row.liveProbe.rowCount} rows`),
    '',
  ]
  return `${lines.join('\n')}\n`
}

function group(rows, field) {
  const out = {}
  for (const row of rows) out[row[field] || 'unknown'] = (out[row[field] || 'unknown'] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, 'utf-8')
}

function readProbeResults(pathsText) {
  const results = new Map()
  if (!pathsText) return results
  for (const path of pathsText.split(',').map((item) => item.trim()).filter(Boolean)) {
    const resolvedPath = resolveExistingPath(path)
    const payload = JSON.parse(readFileSync(resolvedPath, 'utf-8'))
    const rows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.results) ? payload.results : []
    for (const row of rows) {
      const action = row.action ?? row.endpoint
      if (!action) continue
      results.set(action, row)
    }
  }
  return results
}

function resolveExistingPath(path) {
  const candidates = [path, join(repoRoot, path)]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error(`Missing file: ${path}`)
  return found
}

function requiredArg(name) {
  const value = args[name]
  if (!value) throw new Error(`--${name} is required`)
  return value
}

function parseArgs(argv) {
  const parsed = {}
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    if (!raw.startsWith('--')) continue
    const key = raw.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) parsed[key] = 'true'
    else {
      parsed[key] = next
      i++
    }
  }
  return parsed
}
