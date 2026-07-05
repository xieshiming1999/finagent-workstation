#!/usr/bin/env node
// Generate durable finance API status reports from exhaustive live probe output.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const args = parseArgs(process.argv.slice(2))
const input = requiredArg('probe-results')
const jsonOutput = args.output ?? ''
const markdownOutput = args.markdown ?? ''
const inventoryPath = args.inventory ?? ''

const results = readProbeResults(input)
const activeProbeIds = readActiveProbeIds(inventoryPath)
const generatedAt = new Date().toISOString()
const rows = results
  .filter((row) => activeProbeIds.size === 0 || activeProbeIds.has(row.id))
  .map(statusRow)
const nonPassing = rows.filter((row) => row.status !== 'passed')
const report = {
  generatedAt,
  source: input,
  summary: {
    total: rows.length,
    passed: rows.filter((row) => row.status === 'passed').length,
    failed: rows.filter((row) => row.status === 'failed').length,
    skipped: rows.filter((row) => row.status === 'skipped').length,
    blocked: rows.filter((row) => row.status === 'blocked').length,
    credentialGated: rows.filter((row) => row.validationState === 'credential-gated').length,
    quotaGated: rows.filter((row) => row.validationState === 'quota-gated').length,
    unsupported: rows.filter((row) => row.validationState === 'unsupported-by-provider').length,
    invalidParameters: rows.filter((row) => row.validationState === 'invalid-parameters').length,
    transportOrProviderUnstable: rows.filter((row) => row.validationState === 'transport-or-provider-unstable').length,
    runtimeBlocked: rows.filter((row) => row.validationState === 'runtime-blocked').length,
  },
  byProvider: group(rows, 'provider'),
  byValidationState: group(rows, 'validationState'),
  passedApis: rows.filter((row) => row.status === 'passed'),
  failures: nonPassing,
  unsupportedApis: rows.filter((row) => row.validationState === 'unsupported-by-provider' || /unknown .*action|not found|unsupported/i.test(row.error)),
  credentialOrQuotaGatedApis: rows.filter((row) => ['credential-gated', 'quota-gated'].includes(row.validationState)),
  transportUnstableApis: rows.filter((row) => row.validationState === 'transport-or-provider-unstable'),
  runtimeBlockedApis: rows.filter((row) => row.validationState === 'runtime-blocked'),
}

if (jsonOutput) write(jsonOutput, `${JSON.stringify(report, null, 2)}\n`)
else console.log(JSON.stringify(report, null, 2))
if (markdownOutput) write(markdownOutput, markdown(report))

function statusRow(row) {
  const validationState = normalizeValidationState(row)
  const failureClass = normalizeFailureClass(row, validationState)
  return {
    id: row.id,
    provider: row.provider,
    family: row.family,
    kind: row.kind,
    status: row.status,
    validationState,
    failureClass,
    httpStatus: row.httpStatus ?? null,
    parsedCount: row.parsedCount ?? null,
    durationMs: row.durationMs ?? null,
    providerTime: row.providerTime ?? null,
    params: row.params ?? {},
    columns: row.columns ?? [],
    schema: row.schema ?? {},
    error: row.error ?? '',
  }
}

function normalizeValidationState(row) {
  if (row.validationState) return row.validationState
  const text = `${row.status ?? ''} ${row.error ?? ''}`.toLowerCase()
  if (text.includes('api_key missing') || text.includes('token missing') || text.includes('missing credential')) return 'credential-gated'
  if (text.includes('quota') || text.includes('rate limit')) return 'quota-gated'
  if (text.includes('unsupported') || text.includes('not supported')) return 'unsupported-by-provider'
  if (text.includes('invalid parameter') || text.includes('bad request')) return 'invalid-parameters'
  if (row.status === 'skipped') return 'runtime-blocked'
  return ''
}

function normalizeFailureClass(row, validationState) {
  if (row.failureClass) return row.failureClass
  if (validationState === 'credential-gated') return 'credential'
  if (validationState === 'quota-gated') return 'quota'
  if (validationState === 'unsupported-by-provider') return 'unsupported'
  if (validationState === 'invalid-parameters') return 'invalid_parameters'
  if (validationState === 'runtime-blocked') return 'runtime_unavailable'
  return ''
}

function readProbeResults(paths) {
  const byId = new Map()
  for (const path of paths.split(',').map((item) => item.trim()).filter(Boolean)) {
    if (!existsSync(path)) throw new Error(`Missing probe results file: ${path}`)
    const payload = JSON.parse(readFileSync(path, 'utf-8'))
    for (const result of Array.isArray(payload.results) ? payload.results : []) {
      if (result?.id) byId.set(result.id, result)
    }
  }
  return [...byId.values()]
}

function readActiveProbeIds(path) {
  if (!path) return new Set()
  if (!existsSync(path)) throw new Error(`Missing inventory file: ${path}`)
  const payload = JSON.parse(readFileSync(path, 'utf-8'))
  const ids = new Set()
  for (const probe of Array.isArray(payload.liveProbeRows) ? payload.liveProbeRows : []) {
    if (probe?.id) ids.add(probe.id)
  }
  for (const row of Array.isArray(payload.rows) ? payload.rows : []) {
    for (const id of Array.isArray(row.liveProbeIds) ? row.liveProbeIds : []) ids.add(id)
  }
  return ids
}

function markdown(report) {
  const lines = [
    '# Finance API Live Status Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Source: \`${report.source}\``,
    '',
    '## Summary',
    '',
    ...Object.entries(report.summary).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Non-Passing APIs',
    '',
    '| ID | Provider | Family | Status | Validation | Failure | Error |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...report.failures.map((row) => `| ${cell(row.id)} | ${cell(row.provider)} | ${cell(row.family)} | ${cell(row.status)} | ${cell(row.validationState)} | ${cell(row.failureClass)} | ${cell(row.error)} |`),
    '',
    '## Unsupported APIs',
    '',
    report.unsupportedApis.length > 0
      ? report.unsupportedApis.map((row) => `- ${row.id}: ${row.error || row.validationState}`).join('\n')
      : 'None recorded.',
    '',
    '## Credential Or Quota Gated APIs',
    '',
    report.credentialOrQuotaGatedApis.length > 0
      ? report.credentialOrQuotaGatedApis.map((row) => `- ${row.id}: ${row.error || row.validationState}`).join('\n')
      : 'None recorded.',
    '',
    '## Transport Or Provider Unstable APIs',
    '',
    report.transportUnstableApis.length > 0
      ? report.transportUnstableApis.map((row) => `- ${row.id}: ${row.error || row.validationState}`).join('\n')
      : 'None recorded.',
    '',
    '## Runtime Blocked APIs',
    '',
    report.runtimeBlockedApis.length > 0
      ? report.runtimeBlockedApis.map((row) => `- ${row.id}: ${row.error || row.validationState}`).join('\n')
      : 'None recorded.',
    '',
  ]
  return `${lines.join('\n')}\n`
}

function group(rows, field) {
  const out = {}
  for (const row of rows) out[row[field] || 'unknown'] = (out[row[field] || 'unknown'] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

function cell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 240)
}

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, 'utf-8')
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
