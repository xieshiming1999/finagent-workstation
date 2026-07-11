#!/usr/bin/env node
// Cross-check finance API/schema governance artifacts against the exhaustive
// schema goal. This script is deliberately artifact-driven: it verifies the
// generated inventory, live status ledgers, mobile native probe status, and
// provider matrix evidence agree on what is reusable, fetch-only, probed, or
// explicitly non-passing.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { matrixDefinitions } from './finance_api_datastore_matrix_manifest.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(scriptDir, '..')
const args = parseArgs(process.argv.slice(2).filter((arg) => arg !== '--'))

const inventoryPath = resolveExistingPath(args.inventory ?? 'reports/integrations/finance_api_surface_inventory_2026_06_17.json')
const electronStatusPath = resolveExistingPath(args.electron ?? 'reports/integrations/finance_api_live_status_2026_06_17.json')
const mobileStatusPath = resolveExistingPath(args.mobile ?? 'reports/integrations/finance_mobile_api_status_2026_06_17.json')
const output = args.output ?? ''
const markdownOutput = args.markdown ?? ''
const failOnGap = args['fail-on-gap'] === 'true'

const inventory = readJson(inventoryPath)
const electron = readJson(electronStatusPath)
const mobile = readJson(mobileStatusPath)

const rows = Array.isArray(inventory.rows) ? inventory.rows : []
const matrixRows = matrixDefinitions.filter((definition) => definition.status === 'proven')
const fetchOnlyRows = matrixDefinitions.filter((definition) => definition.status === 'fetch-only')
const matrixQueries = new Set(matrixRows.flatMap((definition) => asArray(definition.query)))
const inventoryActions = new Set(rows.map((row) => row.action ?? row.endpoint).filter(Boolean))
const matrixTables = new Set(matrixRows.flatMap((definition) => asArray(definition.tables)))
const registryTables = new Set(rows.flatMap((row) => asArray(row.canonicalTables)))

const gaps = [
  ...inventoryGaps(inventory),
  ...matrixEvidenceGaps(matrixRows, fetchOnlyRows),
  ...matrixInventoryGaps(matrixQueries, inventoryActions, matrixTables, registryTables),
  ...statusGaps(electron, mobile),
]

const report = {
  generatedAt: new Date().toISOString(),
  source: 'finance_schema_governance_audit',
  inputs: {
    inventory: inventoryPath,
    electronStatus: electronStatusPath,
    mobileStatus: mobileStatusPath,
    matrix: 'scripts/finance_api_datastore_matrix_manifest.mjs',
  },
  summary: {
    inventoryRows: rows.length,
    finElectronRows: rows.filter((row) => row.runtime === 'finagent_workstation').length,
    sharedMobileRows: rows.filter((row) => row.runtime === 'shared_mobile').length,
    liveProbedInventoryRows: inventory.summary?.liveProbed ?? rows.filter((row) => row.coverageStatus === 'live-probed').length,
    missingLiveProbe: inventory.summary?.missingLiveProbe ?? rows.filter((row) => row.coverageStatus === 'missing-live-probe').length,
    classifiedNoLiveProbeRequired: inventory.summary?.classifiedNoLiveProbeRequired ?? rows.filter((row) => row.coverageStatus === 'classified-no-live-probe-required').length,
    reusableMatrixRows: matrixRows.length,
    reusableTables: matrixTables.size,
    registeredReusableTables: registryTables.size,
    fetchOnlyMatrixRows: fetchOnlyRows.length,
    genericProxyRows: rows.filter((row) => row.kind === 'generic-proxy' || row.schemaStatus === 'generic-output-only-unbounded').length,
    outputOnlyRows: rows.filter((row) => `${row.schemaStatus}`.includes('output-only') || row.validationState === 'output-only-by-design').length,
    electronPassed: electron.summary?.passed ?? 0,
    electronCredentialGated: electron.summary?.credentialGated ?? 0,
    electronQuotaGated: electron.summary?.quotaGated ?? 0,
    electronUnsupported: electron.summary?.unsupported ?? 0,
    electronInvalidParameters: electron.summary?.invalidParameters ?? 0,
    electronRuntimeBlocked: electron.summary?.runtimeBlocked ?? 0,
    electronTransportOrProviderUnstable: electron.summary?.transportOrProviderUnstable ?? 0,
    mobileNativeLiveProbed: mobile.summary?.nativeLiveProbed ?? 0,
    mobileNativeLiveFailed: mobile.summary?.nativeLiveFailed ?? 0,
    mobileNativeReadbackProbed: mobile.summary?.nativeReadbackProbed ?? 0,
    mobileNativeReadbackFailed: mobile.summary?.nativeReadbackFailed ?? 0,
    mobileNeedsNativeLiveProbe: mobile.summary?.needsNativeLiveProbe ?? 0,
    mobileRuntimeBlocked: mobile.summary?.runtimeBlocked ?? 0,
    mobileTransportOrProviderUnstable: mobile.summary?.transportOrProviderUnstable ?? 0,
    gaps: gaps.length,
  },
  byInventoryApiStatus: inventory.summary?.byApiStatus ?? {},
  byInventoryValidationState: inventory.summary?.byValidationState ?? {},
  gaps,
}

if (output) write(resolveOutputPath(output), `${JSON.stringify(report, null, 2)}\n`)
else console.log(JSON.stringify(report, null, 2))
if (markdownOutput) write(resolveOutputPath(markdownOutput), markdown(report))
if (failOnGap && gaps.length > 0) process.exit(1)

function inventoryGaps(payload) {
  const out = []
  if ((payload.summary?.missingLiveProbe ?? 0) > 0) {
    out.push({ type: 'missing-live-probe', message: `${payload.summary.missingLiveProbe} inventory rows still lack live probe/classification` })
  }
  for (const row of rows) {
    if (!row.schemaStatus) out.push({ type: 'missing-schema-status', id: row.id, runtime: row.runtime })
    const action = row.action ?? row.endpoint
    if (!action) out.push({ type: 'missing-action-or-endpoint', id: row.id, runtime: row.runtime })
    if (row.coverageStatus === 'missing-live-probe') out.push({ type: 'missing-live-probe-row', id: row.id, runtime: row.runtime, action })
  }
  return out
}

function matrixEvidenceGaps(reusableRows, fetchOnlyRows) {
  const out = []
  for (const row of reusableRows) {
    const tables = asArray(row.tables)
    if (tables.length === 0) continue
    for (const field of ['persist', 'readback', 'readbackTest', 'failureNoPersistTest']) {
      if (asArray(row.evidence?.[field]).length === 0) {
        out.push({ type: 'missing-matrix-evidence', id: row.id, field })
      }
    }
    if (asArray(row.query).length === 0) out.push({ type: 'missing-readback-query', id: row.id })
  }
  for (const row of fetchOnlyRows) {
    if (asArray(row.tables).length > 0) out.push({ type: 'fetch-only-has-table', id: row.id, tables: row.tables })
  }
  return out
}

function matrixInventoryGaps(queries, actions, tables, registeredTables) {
  const out = []
  for (const query of queries) {
    if (!actions.has(query)) out.push({ type: 'matrix-query-not-in-inventory', query })
  }
  for (const table of registeredTables) {
    if (!tables.has(table)) out.push({ type: 'registered-table-not-in-matrix', table })
  }
  return out
}

function statusGaps(electronStatus, mobileStatus) {
  const out = []
  if ((electronStatus.summary?.unsupported ?? 0) > 0) out.push({ type: 'electron-unsupported', count: electronStatus.summary.unsupported })
  if ((electronStatus.summary?.invalidParameters ?? 0) > 0) out.push({ type: 'electron-invalid-parameters', count: electronStatus.summary.invalidParameters })
  if ((mobileStatus.summary?.needsNativeLiveProbe ?? 0) > 0) out.push({ type: 'mobile-needs-native-live-probe', count: mobileStatus.summary.needsNativeLiveProbe })
  if ((mobileStatus.summary?.nativeReadbackFailed ?? 0) > 0) out.push({ type: 'mobile-readback-failed', count: mobileStatus.summary.nativeReadbackFailed })
  return out
}

function markdown(report) {
  const lines = [
    '# Finance Schema Governance Audit',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Inputs',
    '',
    ...Object.entries(report.inputs).map(([key, value]) => `- ${key}: \`${value}\``),
    '',
    '## Summary',
    '',
    ...Object.entries(report.summary).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Gaps',
    '',
    report.gaps.length === 0
      ? '- none'
      : report.gaps.map((gap) => `- ${gap.type}: ${gap.message ?? gap.id ?? gap.query ?? gap.table ?? gap.count}`).join('\n'),
    '',
  ]
  return `${lines.flat().join('\n')}\n`
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item != null && item !== '')
  return value == null || value === '' ? [] : [value]
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, 'utf-8')
}

function resolveExistingPath(path) {
  const candidates = [path, join(repoRoot, path)]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error(`Missing file: ${path}`)
  return found
}

function resolveOutputPath(path) {
  return path.startsWith('docs/') ? join(repoRoot, path) : path
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
