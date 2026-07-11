#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const args = parseArgs(process.argv.slice(2))

const paths = {
  providerMatrix: 'reports/integrations/finance_data_api_provider_matrix_2026_06_17.json',
  detailedMatrix: 'reports/integrations/finance_detailed_api_call_provider_matrix_2026_06_17.json',
  electronContract: 'src/agent/data/data-api-interfaces.json',
  electronProviderPolicy: 'src/agent/data/provider-policy.ts',
  mobileProviderPolicy: '../app/lib/agent/data_fetcher/provider_policy.dart',
  akshareEastmoneyRegistry: 'src/agent/data/ingestion/registry-akshare-eastmoney.ts',
}

const jsonOut = resolve(repoRoot, args.json ?? 'reports/integrations/finance_eastmoney_akshare_separation_audit_2026_06_19.json')
const mdOut = resolve(repoRoot, args.md ?? 'reports/integrations/finance_eastmoney_akshare_separation_audit_2026_06_19.md')

const report = buildReport()

if (args['no-write'] !== 'true') {
  mkdirSync(dirname(jsonOut), { recursive: true })
  mkdirSync(dirname(mdOut), { recursive: true })
  writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
  writeFileSync(mdOut, renderMarkdown(report), 'utf-8')
}

if (args.jsonOnly === 'true') {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`Finance EastMoney/AkShare separation audit: ${report.summary.rows} rows, ${report.summary.problems} problems`)
  if (args['no-write'] !== 'true') {
    console.log(`JSON: ${jsonOut}`)
    console.log(`Markdown: ${mdOut}`)
  }
}

if (args['fail-on-problem'] === 'true' && report.problems.length > 0) {
  for (const problem of report.problems) console.error(problem)
  process.exit(1)
}

function buildReport() {
  const providerMatrix = readJson(paths.providerMatrix)
  const detailedMatrix = readJson(paths.detailedMatrix)
  const rows = []
  for (const item of providerMatrix.rows ?? []) {
    for (const provider of ['eastmoney', 'akshare', 'sina']) {
      const capability = item.providers?.[provider]
      if (!capability?.capabilityId && capability?.status !== 'supported') continue
      const adapterText = [capability.adapter, capability.normalizer, capability.reason].filter(Boolean).join(' ')
      const usesAkshareSidecar = /AkShare sidecar|via AkShare|sidecar \/(?:akshare|quote|kline|fund|index|news|margin|holders|chip)/i.test(adapterText)
      const eastmoneyOriginSignal = /(?:_em\b|EastMoney|eastmoney|push2|fundcode_search|pingzhongdata|rankhandler|FundArchivesDatas|FundDataPortfolio|RPT_|stockrank|getAllStockChanges)/i.test(adapterText)
      const directProviderEvidence = directProviderEvidenceFor(provider, capability, adapterText)
      const decision = separationDecision({ provider, capability, usesAkshareSidecar, eastmoneyOriginSignal, directProviderEvidence })
      rows.push({
        interfaceId: item.interfaceId,
        category: item.category,
        chinesePurpose: item.chinesePurpose,
        provider,
        status: capability.status,
        capabilityId: capability.capabilityId ?? null,
        upstreamOrigin: capability.upstreamOrigin ?? null,
        adapter: capability.adapter ?? null,
        normalizer: capability.normalizer ?? null,
        canonicalTable: capability.canonicalTable ?? null,
        probeId: capability.probeId ?? null,
        reason: capability.reason ?? null,
        usesAkshareSidecar,
        eastmoneyOriginSignal,
        directProviderEvidence,
        decision,
        nextAction: separationNextAction({ decision, provider, item, capability }),
      })
    }
  }

  rows.sort((a, b) => {
    const priority = {
      'provider-boundary-problem': 0,
      'akshare-with-eastmoney-origin': 1,
      'direct-eastmoney': 2,
      'direct-or-native-provider': 3,
      'explicit-not-supported': 4,
    }
    const left = priority[a.decision] ?? 9
    const right = priority[b.decision] ?? 9
    if (left !== right) return left - right
    return `${a.provider}:${a.interfaceId}`.localeCompare(`${b.provider}:${b.interfaceId}`)
  })

  const detailedRows = (detailedMatrix.rows ?? []).filter((row) => ['eastmoney', 'akshare', 'sina'].includes(row.provider))
  const sourceEvidence = sourceEvidenceChecks()
  const problems = validateRows(rows, detailedRows, sourceEvidence)

  return {
    generatedAt: new Date().toISOString(),
    objective: 'Verify EastMoney direct providers, AkShare sidecar providers, and EastMoney-origin AkShare wrappers remain separate in app-level provider provenance.',
    source: Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, resolve(repoRoot, value)])),
    summary: {
      rows: rows.length,
      detailedRows: detailedRows.length,
      statusCounts: countBy(rows.map((row) => row.status)),
      decisionCounts: countBy(rows.map((row) => row.decision)),
      directEastmoneyRows: rows.filter((row) => row.decision === 'direct-eastmoney').length,
      akshareEastmoneyOriginRows: rows.filter((row) => row.decision === 'akshare-with-eastmoney-origin').length,
      boundaryProblems: rows.filter((row) => row.decision === 'provider-boundary-problem').length,
      problems: problems.length,
    },
    sourceEvidence,
    rows,
    detailedRows: detailedRows.map((row) => ({
      rowId: row.rowId,
      runtime: row.runtime,
      family: row.family,
      action: row.action,
      endpoint: row.endpoint,
      provider: row.provider,
      interfaceId: row.interfaceId,
      surfaceId: row.surfaceId,
      governanceAction: row.governanceAction,
    })),
    problems,
  }
}

function directProviderEvidenceFor(provider, capability, adapterText) {
  if (provider === 'eastmoney') {
    return /push2|push2his|_provider=eastmoney|fundcode_search|pingzhongdata|rankhandler|FundArchivesDatas|FundDataPortfolio|RPT_|stockrank|getAllStockChanges|readQuote|fetchSector|earnings\/finance analysis|direct/i.test(adapterText)
      && !/AkShare sidecar|via AkShare/i.test(adapterText)
      && String(capability.probeId ?? '').includes('eastmoney')
  }
  if (provider === 'akshare') {
    return /sidecar|stock_|fund_|index_|margin|holders|akshare/i.test(adapterText)
  }
  if (provider === 'sina') {
    return /Sina|sina/i.test(adapterText) && !/AkShare sidecar|via AkShare/i.test(adapterText)
  }
  return false
}

function separationDecision({ provider, capability, usesAkshareSidecar, eastmoneyOriginSignal, directProviderEvidence }) {
  if (capability.status === 'not-supported') return 'explicit-not-supported'
  if (provider !== 'akshare' && usesAkshareSidecar) return 'provider-boundary-problem'
  if (provider === 'eastmoney') return directProviderEvidence ? 'direct-eastmoney' : 'provider-boundary-problem'
  if (provider === 'akshare' && eastmoneyOriginSignal) {
    return capability.upstreamOrigin === 'eastmoney' ? 'akshare-with-eastmoney-origin' : 'provider-boundary-problem'
  }
  return directProviderEvidence ? 'direct-or-native-provider' : 'provider-boundary-problem'
}

function separationNextAction({ decision, provider, item, capability }) {
  if (decision === 'provider-boundary-problem') {
    return `Fix ${provider}.${item.interfaceId}: provider id, adapter, upstreamOrigin, probe, or supported status does not prove the app-level provider boundary.`
  }
  if (decision === 'akshare-with-eastmoney-origin') {
    return 'Keep provider=akshare and preserve upstreamOrigin=eastmoney; do not relabel as direct EastMoney.'
  }
  if (decision === 'direct-eastmoney') {
    return 'Keep direct EastMoney adapter/probe separate from AkShare compatibility wrappers.'
  }
  if (decision === 'explicit-not-supported') {
    return 'Keep not-supported unless a real app-level provider implementation and probe are added.'
  }
  return 'No action required.'
}

function sourceEvidenceChecks() {
  const electronPolicy = readText(paths.electronProviderPolicy)
  const mobilePolicy = readText(paths.mobileProviderPolicy)
  const registry = readText(paths.akshareEastmoneyRegistry)
  const contract = readText(paths.electronContract)
  return {
    electronPolicySeparatesProviders: electronPolicy.includes("'eastmoneyDirect'") && electronPolicy.includes("'akshare'"),
    mobilePolicySeparatesProviders: mobilePolicy.includes('FinanceProvider.eastmoneyDirect') && mobilePolicy.includes('FinanceProvider.akshare'),
    nonEquivalentAkshareWrappersAreBlocked: registry.includes('isNonEquivalentAkshareCompatibilityWrapper') && registry.includes('not semantically equivalent'),
    akshareOriginMetadataExists: contract.includes('"upstreamOrigin": "eastmoney"'),
    noNonAkshareCapabilityAdvertisesAkshareSidecar: !nonAkshareSidecarContractRows(contract).length,
  }
}

function validateRows(rows, detailedRows, sourceEvidence) {
  const problems = []
  const boundaryProblems = rows.filter((row) => row.decision === 'provider-boundary-problem')
  for (const row of boundaryProblems) {
    problems.push(`${row.provider}.${row.interfaceId}/${row.capabilityId}: ${row.nextAction}`)
  }
  if (!rows.some((row) => row.decision === 'direct-eastmoney')) problems.push('no direct EastMoney provider rows found')
  if (!rows.some((row) => row.decision === 'akshare-with-eastmoney-origin')) problems.push('no AkShare EastMoney-origin rows found')
  if (!detailedRows.some((row) => row.provider === 'eastmoney')) problems.push('detailed matrix has no EastMoney provider rows')
  if (!detailedRows.some((row) => row.provider === 'akshare')) problems.push('detailed matrix has no AkShare provider rows')
  for (const [key, value] of Object.entries(sourceEvidence)) {
    if (!value) problems.push(`source evidence failed: ${key}`)
  }
  return problems
}

function nonAkshareSidecarContractRows(contractText) {
  const contract = JSON.parse(contractText)
  const rows = []
  for (const item of contract.interfaces ?? []) {
    for (const capability of item.capabilities ?? []) {
      const text = [capability.adapter, capability.reason].filter(Boolean).join(' ')
      if (capability.status !== 'not-supported' && capability.provider !== 'akshare' && /AkShare sidecar|via AkShare/i.test(text)) {
        rows.push({ interfaceId: item.id, capabilityId: capability.id })
      }
    }
  }
  return rows
}

function renderMarkdown(report) {
  const lines = []
  lines.push('# Finance EastMoney / AkShare Separation Audit')
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push('')
  lines.push('## Objective')
  lines.push('')
  lines.push(report.objective)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- provider rows: ${report.summary.rows}`)
  lines.push(`- detailed EM/AK/Sina rows: ${report.summary.detailedRows}`)
  lines.push(`- direct EastMoney rows: ${report.summary.directEastmoneyRows}`)
  lines.push(`- AkShare rows with EastMoney upstream origin: ${report.summary.akshareEastmoneyOriginRows}`)
  lines.push(`- boundary problems: ${report.summary.boundaryProblems}`)
  lines.push(`- problems: ${report.summary.problems}`)
  lines.push('')
  lines.push('Decision counts:')
  lines.push('')
  for (const [status, count] of Object.entries(report.summary.decisionCounts).sort()) {
    lines.push(`- ${status}: ${count}`)
  }
  lines.push('')
  lines.push('Source evidence:')
  lines.push('')
  for (const [key, value] of Object.entries(report.sourceEvidence)) {
    lines.push(`- ${key}: ${value ? 'pass' : 'fail'}`)
  }
  lines.push('')
  lines.push('## Provider Rows')
  lines.push('')
  lines.push('| Interface | Provider | Status | Capability | Upstream | Adapter | Probe | Decision | Next Action |')
  lines.push('|---|---|---|---|---|---|---|---|---|')
  for (const row of report.rows) {
    lines.push([
      row.interfaceId,
      row.provider,
      row.status,
      row.capabilityId ?? '-',
      row.upstreamOrigin ?? '-',
      row.adapter ?? '-',
      row.probeId ?? '-',
      row.decision,
      row.nextAction,
    ].map(cell).join('|').replace(/^/, '|').concat('|'))
  }
  if (report.problems.length > 0) {
    lines.push('')
    lines.push('## Problems')
    lines.push('')
    for (const problem of report.problems) lines.push(`- ${problem}`)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

function cell(value) {
  return ` ${String(value ?? '').replace(/\|/g, '\\|')} `
}

function readJson(path) {
  return JSON.parse(readText(path))
}

function readText(path) {
  const fullPath = resolve(repoRoot, path)
  if (!existsSync(fullPath)) throw new Error(`missing required file: ${path}`)
  return readFileSync(fullPath, 'utf-8')
}

function countBy(values) {
  const counts = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

function parseArgs(values) {
  const parsed = {}
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (!value.startsWith('--')) continue
    const key = value.slice(2)
    const next = values[i + 1]
    if (!next || next.startsWith('--')) {
      parsed[key] = 'true'
    } else {
      parsed[key] = next
      i += 1
    }
  }
  return parsed
}
