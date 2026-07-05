#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const args = parseArgs(process.argv.slice(2))
const repoRoot = resolve(new URL('../..', import.meta.url).pathname)
const defaultInputDir = join(homedir(), '.finagent-workstation', 'manual-tests', 'finance-live-matrix')
const inputDir = resolve(args.inputDir ?? defaultInputDir)
const jsonOut = resolve(repoRoot, args.json ?? 'reports/integrations/finance_live_status_report_2026_06_18.json')
const mdOut = resolve(repoRoot, args.md ?? 'reports/integrations/finance_live_status_report_2026_06_18.md')

const report = buildReport(inputDir)

if (args['no-write'] !== 'true') {
  writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
  writeFileSync(mdOut, renderMarkdown(report), 'utf-8')
}

console.log(`Finance API live status report: ${report.summary.total} rows, ${report.summary.passed} passed, ${report.summary.runtimeBlocked} runtime-blocked`)
if (args['no-write'] !== 'true') {
  console.log(`JSON: ${jsonOut}`)
  console.log(`Markdown: ${mdOut}`)
}

if (report.summary.total === 0 && args['fail-on-empty'] === 'true') process.exit(1)

function buildReport(dir) {
  const records = readProbeRecords(dir)
  const currentProbeIds = currentLiveProbeIds()
  const byId = new Map()
  for (const record of records) {
    for (const result of record.results) {
      const row = normalizeResult(result)
      if (!row.id) continue
      if (currentProbeIds.size > 0 && !currentProbeIds.has(row.id)) continue
      const previous = byId.get(row.id)
      if (!previous || record.sortTime >= previous.sortTime) {
        byId.set(row.id, { ...row, sortTime: record.sortTime, sourcePath: record.path })
      }
    }
  }
  const allRows = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
  const passedApis = allRows.filter((row) => row.status === 'passed').map(stripInternal)
  const failures = allRows.filter((row) => row.status !== 'passed').map(stripInternal)
  const unsupportedApis = failures.filter((row) => row.validationState === 'unsupported')
  const credentialOrQuotaGatedApis = failures.filter((row) => row.validationState === 'credential-gated' || row.validationState === 'quota-gated')
  const transportUnstableApis = failures.filter((row) => row.validationState === 'transport-or-provider-unstable')
  const runtimeBlockedApis = failures.filter((row) => row.validationState === 'runtime-blocked')
  return {
    generatedAt: new Date().toISOString(),
    source: [...new Set(records.map((record) => record.path))].join(','),
    summary: summarize({ passedApis, failures, unsupportedApis, credentialOrQuotaGatedApis, transportUnstableApis, runtimeBlockedApis }),
    byProvider: countBy(allRows, (row) => row.provider),
    byValidationState: countBy(allRows, (row) => row.validationState),
    passedApis,
    failures,
    unsupportedApis,
    credentialOrQuotaGatedApis,
    transportUnstableApis,
    runtimeBlockedApis,
  }
}

function readProbeRecords(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => join(dir, name))
    .flatMap((file) => {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf-8'))
        if (!Array.isArray(parsed.results)) return []
        return [{
          path: file,
          sortTime: Date.parse(parsed.generatedAt ?? '') || statSync(file).mtimeMs,
          results: parsed.results,
        }]
      } catch {
        return []
      }
    })
}

function currentLiveProbeIds() {
  const matrixPath = resolve(repoRoot, 'finagent_workstation/scripts/finance_live_probe_matrix.mjs')
  if (!existsSync(matrixPath)) return new Set()
  const source = readFileSync(matrixPath, 'utf-8')
  return new Set([...source.matchAll(/spec\('([^']+)'/g)].map((match) => match[1]))
}

function normalizeResult(result) {
  const validationState = String(result.validationState ?? validationStateFor(result))
  return {
    id: String(result.id ?? ''),
    provider: String(result.provider ?? 'unknown'),
    family: String(result.family ?? result.endpoint ?? 'unknown'),
    kind: String(result.kind ?? 'unknown'),
    status: String(result.status ?? 'failed'),
    validationState,
    failureClass: String(result.failureClass ?? failureClassFor(result, validationState)),
    httpStatus: result.httpStatus ?? null,
    parsedCount: result.parsedCount ?? null,
    durationMs: result.durationMs ?? 0,
    providerTime: result.providerTime ?? null,
    params: result.params ?? {},
    columns: Array.isArray(result.columns) ? result.columns : [],
    schema: result.schema ?? {},
    error: String(result.error ?? ''),
  }
}

function validationStateFor(result) {
  const error = String(result.error ?? '').toLowerCase()
  if (result.status === 'passed') return 'valid-schema-observed'
  if (error.includes('api_key missing') || error.includes('token missing') || error.includes('credential')) return 'credential-gated'
  if (result.status === 'blocked') return 'runtime-blocked'
  if (result.status === 'credential-gated') return 'credential-gated'
  if (result.status === 'quota-gated') return 'quota-gated'
  if (result.status === 'unsupported') return 'unsupported'
  return 'transport-or-provider-unstable'
}

function failureClassFor(result, validationState) {
  const error = String(result.error ?? '').toLowerCase()
  if (validationState === 'credential-gated') return 'credential_gated'
  if (validationState === 'quota-gated') return 'quota_gated'
  if (validationState === 'runtime-blocked') return 'runtime_unavailable'
  if (validationState === 'unsupported') return 'unsupported'
  if (validationState === 'invalid-parameters') return 'invalid_parameters'
  if (validationState === 'transport-or-provider-unstable') return error ? 'transport_or_provider_unstable' : ''
  return ''
}

function summarize({ passedApis, failures, unsupportedApis, credentialOrQuotaGatedApis, transportUnstableApis, runtimeBlockedApis }) {
  return {
    total: passedApis.length + failures.length,
    passed: passedApis.length,
    failed: failures.filter((row) => row.status === 'failed').length,
    skipped: failures.filter((row) => row.status === 'skipped').length,
    blocked: failures.filter((row) => row.status === 'blocked').length,
    credentialGated: credentialOrQuotaGatedApis.filter((row) => row.validationState === 'credential-gated').length,
    quotaGated: credentialOrQuotaGatedApis.filter((row) => row.validationState === 'quota-gated').length,
    unsupported: unsupportedApis.length,
    invalidParameters: failures.filter((row) => row.validationState === 'invalid-parameters').length,
    transportOrProviderUnstable: transportUnstableApis.length,
    runtimeBlocked: runtimeBlockedApis.length,
  }
}

function countBy(rows, fn) {
  const counts = {}
  for (const row of rows) {
    const key = fn(row)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort())
}

function stripInternal(row) {
  const { sortTime: _sortTime, sourcePath: _sourcePath, ...publicRow } = row
  return publicRow
}

function renderMarkdown(report) {
  return [
    '# Finance API Live Status Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Source: \`${report.source}\``,
    '',
    '## Summary',
    '',
    `- total: ${report.summary.total}`,
    `- passed: ${report.summary.passed}`,
    `- failed: ${report.summary.failed}`,
    `- skipped: ${report.summary.skipped}`,
    `- blocked: ${report.summary.blocked}`,
    `- credential gated: ${report.summary.credentialGated}`,
    `- quota gated: ${report.summary.quotaGated}`,
    `- unsupported: ${report.summary.unsupported}`,
    `- invalid parameters: ${report.summary.invalidParameters}`,
    `- transport/provider unstable: ${report.summary.transportOrProviderUnstable}`,
    `- runtime blocked: ${report.summary.runtimeBlocked}`,
    '',
    tableSection('By Provider', ['Provider', 'Count'], Object.entries(report.byProvider).map(([provider, count]) => [provider, count])),
    tableSection('By Validation State', ['Validation state', 'Count'], Object.entries(report.byValidationState).map(([state, count]) => [state, count])),
    apiTable('Failed / Blocked APIs', report.failures),
    apiTable('Unsupported APIs', report.unsupportedApis),
    apiTable('Credential Or Quota Gated APIs', report.credentialOrQuotaGatedApis),
    apiTable('Transport Or Provider Unstable APIs', report.transportUnstableApis),
    apiTable('Runtime Blocked APIs', report.runtimeBlockedApis),
  ].join('\n')
}

function tableSection(title, headers, rows) {
  const align = headers.map((_, index) => index === headers.length - 1 ? '---:' : '---')
  return [
    `## ${title}`,
    '',
    `| ${headers.map(escapePipe).join(' |')} |`,
    `| ${align.join(' |')} |`,
    ...rows.map((row) => `| ${row.map(escapePipe).join(' |')} |`),
    '',
  ].join('\n')
}

function apiTable(title, rows) {
  if (rows.length === 0) return [`## ${title}`, '', 'None recorded.', ''].join('\n')
  return [
    `## ${title}`,
    '',
    '| ID | Provider | Family | Status | Validation | Failure class | Error |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((row) => `| ${escapePipe(row.id)} | ${escapePipe(row.provider)} | ${escapePipe(row.family)} | ${escapePipe(row.status)} | ${escapePipe(row.validationState)} | ${escapePipe(row.failureClass)} | ${escapePipe(row.error)} |`),
    '',
  ].join('\n')
}

function escapePipe(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      out[key] = next
      i += 1
    } else {
      out[key] = 'true'
    }
  }
  return out
}
