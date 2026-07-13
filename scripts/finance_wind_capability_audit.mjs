#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const args = parseArgs(process.argv.slice(2))

const paths = {
  providerMatrix: 'reports/integrations/finance_data_api_provider_matrix_2026_06_17.json',
  liveStatusReport: 'reports/integrations/finance_live_status_report_2026_06_18.json',
  unificationAudit: 'reports/integrations/finance_data_unification_audit_2026_06_17.json',
}

const configuredWindReferenceRoot = args.windRoot ?? process.env.WIND_SKILL_REFERENCE_ROOT
const windReferenceRoot = resolve(configuredWindReferenceRoot ?? resolve(repoRoot, 'assets/skills/wind-aifinmarket'))
const detailedContractsPath = resolve(windReferenceRoot, 'references/tool-contracts.md')
const referencePaths = {
  manifest: resolve(windReferenceRoot, 'references/tool-manifest.json'),
  contracts: existsSync(detailedContractsPath)
    ? detailedContractsPath
    : resolve(windReferenceRoot, 'references/tool-reference.md'),
  normalizationRules: resolve(windReferenceRoot, 'references/normalization-rules.json'),
}

const jsonOut = resolve(repoRoot, args.json ?? 'reports/integrations/finance_wind_capability_audit_2026_06_19.json')
const mdOut = resolve(repoRoot, args.md ?? 'reports/integrations/finance_wind_capability_audit_2026_06_19.md')

const report = buildReport()

if (args['no-write'] !== 'true') {
  writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
  writeFileSync(mdOut, renderMarkdown(report), 'utf-8')
}

if (args.jsonOnly === 'true') {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`Finance Wind capability audit: ${report.summary.windCapabilities} Wind capabilities, ${report.summary.referenceTools} reference tools`)
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
  const liveStatusReport = readJson(paths.liveStatusReport)
  const unificationAudit = readJson(paths.unificationAudit)
  const reference = readWindReference()
  const liveByProbe = new Map((liveStatusReport.passedApis ?? []).concat(liveStatusReport.failures ?? []).map((item) => [item.id, item]))
  const unifiedByCapability = new Map((unificationAudit.rows ?? [])
    .filter((row) => row.provider === 'wind')
    .map((row) => [row.capabilityId, row]))
  const referencedTools = new Set()
  const rows = []

  for (const item of providerMatrix.rows ?? []) {
    const wind = item.providers?.wind
    if (!wind || (!wind.capabilityId && wind.status === 'not-supported')) continue
    const text = [wind.adapter, wind.normalizer, wind.reason].filter(Boolean).join(' ')
    const tools = extractReferenceTools(text, reference.toolNames)
    for (const tool of tools) referencedTools.add(tool)
    const live = wind.probeId ? liveByProbe.get(wind.probeId) : null
    const unified = wind.capabilityId ? unifiedByCapability.get(wind.capabilityId) : null
    const canonicalReady = Boolean(wind.normalizer && wind.canonicalTable)
    const manifestCoverage = manifestCoverageFor(tools, reference.toolSet)
    const decision = windDecision({ status: wind.status, tools, manifestCoverage, live, unified, canonicalReady, wind })
    rows.push({
      interfaceId: item.interfaceId,
      category: item.category,
      chinesePurpose: item.chinesePurpose,
      canonicalSchema: item.canonicalSchema,
      dataStoreTables: item.dataStoreTables ?? [],
      queryActions: item.queryActions ?? [],
      status: wind.status,
      capabilityId: wind.capabilityId ?? null,
      adapter: wind.adapter ?? null,
      normalizer: wind.normalizer ?? null,
      canonicalTable: wind.canonicalTable ?? null,
      probeId: wind.probeId ?? null,
      liveStatus: live?.status ?? null,
      liveValidationState: live?.validationState ?? null,
      liveParsedCount: live?.parsedCount ?? null,
      liveDurationMs: live?.durationMs ?? null,
      unified: unified?.unified ?? false,
      unificationProblems: unified?.problems ?? [],
      referencedTools: tools,
      manifestCoverage,
      canonicalReady,
      decision,
      nextAction: windNextAction({ decision, wind, item, tools, manifestCoverage, live, unified, canonicalReady }),
      reason: wind.reason ?? null,
    })
  }

  rows.sort((a, b) => {
    const priority = {
      'implementation-gap': 0,
      'schema-probe-required': 1,
      'implemented-credential-gated': 2,
      'explicit-not-supported': 3,
      'missing-manifest-reference': 4,
      'informational': 5,
    }
    const left = priority[a.decision] ?? 9
    const right = priority[b.decision] ?? 9
    if (left !== right) return left - right
    return a.interfaceId.localeCompare(b.interfaceId)
  })

  const unclaimedReferenceTools = reference.tools.filter((tool) => !referencedTools.has(tool.tool))
  const problems = validateRows(rows, reference)

  return {
    generatedAt: new Date().toISOString(),
    objective: 'Wind-specific capability audit joining the app Data API interface contract, live evidence, unification evidence, and the local AIFinMarket reference manifest.',
    source: {
      providerMatrix: paths.providerMatrix,
      liveStatusReport: paths.liveStatusReport,
      unificationAudit: paths.unificationAudit,
      windReferenceRoot: relativeRepoPath(windReferenceRoot),
      manifest: relativeRepoPath(referencePaths.manifest),
      contracts: relativeRepoPath(referencePaths.contracts),
      normalizationRules: relativeRepoPath(referencePaths.normalizationRules),
    },
    summary: {
      windCapabilities: rows.length,
      referenceTools: reference.tools.length,
      statusCounts: countBy(rows.map((row) => row.status)),
      decisionCounts: countBy(rows.map((row) => row.decision)),
      livePassed: rows.filter((row) => row.liveStatus === 'passed').length,
      canonicalReady: rows.filter((row) => row.canonicalReady).length,
      unified: rows.filter((row) => row.unified).length,
      unclaimedReferenceTools: unclaimedReferenceTools.length,
      problems: problems.length,
    },
    rows,
    unclaimedReferenceTools,
    problems,
  }
}

function relativeRepoPath(path) {
  const prefix = `${repoRoot}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : '<external-wind-reference>'
}

function readWindReference() {
  if (!existsSync(referencePaths.manifest)) {
    return { tools: [], toolNames: [], toolSet: new Set(), problems: [`missing Wind manifest: ${referencePaths.manifest}`] }
  }
  const manifest = JSON.parse(readFileSync(referencePaths.manifest, 'utf-8'))
  const contracts = existsSync(referencePaths.contracts) ? readFileSync(referencePaths.contracts, 'utf-8') : ''
  const normalizationRules = existsSync(referencePaths.normalizationRules)
    ? JSON.parse(readFileSync(referencePaths.normalizationRules, 'utf-8'))
    : {}
  const tools = []
  for (const [server, names] of Object.entries(manifest)) {
    for (const name of names) {
      tools.push({
        id: `${server}.${name}`,
        server,
        tool: name,
        documented: contracts.includes(name),
        normalizationDomain: normalizationDomainFor(server, name, normalizationRules),
      })
    }
  }
  return {
    tools,
    toolNames: tools.map((tool) => tool.tool),
    toolSet: new Set(tools.map((tool) => tool.tool)),
    problems: [],
  }
}

function extractReferenceTools(text, toolNames) {
  const found = []
  const source = String(text ?? '')
  const lower = source.toLowerCase()
  for (const name of toolNames) {
    if (lower.includes(name.toLowerCase()) && !found.includes(name)) found.push(name)
  }
  for (const match of source.matchAll(/\b(?:get|search)_[a-z0-9_]+\b/gi)) {
    const name = match[0]
    if (!found.includes(name)) found.push(name)
  }
  return found.sort()
}

function manifestCoverageFor(tools, toolSet) {
  if (tools.length === 0) return 'no-app-tool-reference'
  const missing = tools.filter((tool) => !toolSet.has(tool))
  return missing.length === 0 ? 'all-referenced-tools-in-manifest' : `missing:${missing.join(',')}`
}

function windDecision({ status, tools, manifestCoverage, live, unified, canonicalReady, wind }) {
  if (status === 'credential-gated' && canonicalReady && unified?.unified && live?.status === 'passed') {
    return 'implemented-credential-gated'
  }
  if (['credential-gated', 'quota-gated', 'transport-unstable'].includes(status) && (!canonicalReady || !unified?.unified)) {
    return 'implementation-gap'
  }
  if (status === 'not-supported' && tools.length > 0 && manifestCoverage === 'all-referenced-tools-in-manifest' && !canonicalReady) {
    return 'schema-probe-required'
  }
  if (status === 'not-supported' && wind.capabilityId) return 'explicit-not-supported'
  if (tools.length > 0 && manifestCoverage !== 'all-referenced-tools-in-manifest') return 'missing-manifest-reference'
  return 'informational'
}

function windNextAction({ decision, wind, item, tools, manifestCoverage, live, unified, canonicalReady }) {
  if (decision === 'implemented-credential-gated') {
    return 'Keep credential gate visible, keep live evidence fresh, and use cache/readback before additional Wind calls.'
  }
  if (decision === 'implementation-gap') {
    return `Implement or repair normalizer/readback/unification for ${wind.capabilityId ?? item.interfaceId}; canonicalReady=${canonicalReady}, unified=${Boolean(unified?.unified)}.`
  }
  if (decision === 'schema-probe-required') {
    return `Run a low-concurrency Wind probe for ${tools.join(', ')} and promote only if the payload maps cleanly to ${item.interfaceId}.`
  }
  if (decision === 'explicit-not-supported') {
    return 'Keep not-supported unless the Wind manifest and a live schema prove an equivalent reusable dataset.'
  }
  if (manifestCoverage.startsWith('missing:')) {
    return 'Reconcile app adapter text with the current Wind manifest before enabling this route.'
  }
  if (live?.status && live.status !== 'passed') return 'Classify the Wind live failure and add a failure action row before retrying.'
  return 'No action required for this audit row.'
}

function normalizationDomainFor(server, tool, rules) {
  for (const [domain, entries] of Object.entries(rules.tool_by_domain ?? {})) {
    if (entries?.[server] === tool) return domain
  }
  return null
}

function validateRows(rows, reference) {
  const problems = [...(reference.problems ?? [])]
  for (const row of rows) {
    if (row.status === 'credential-gated' && row.manifestCoverage === 'no-app-tool-reference') {
      problems.push(`${row.interfaceId}/${row.capabilityId}: credential-gated Wind capability should reference concrete Wind tool names`)
    }
    if (row.decision === 'implemented-credential-gated' && row.unificationProblems.length > 0) {
      problems.push(`${row.interfaceId}/${row.capabilityId}: unification problems remain: ${row.unificationProblems.join('; ')}`)
    }
  }
  return problems
}

function renderMarkdown(report) {
  const lines = []
  lines.push('# Finance Wind Capability Audit')
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push('')
  lines.push('## Objective')
  lines.push('')
  lines.push(report.objective)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- Wind capability rows: ${report.summary.windCapabilities}`)
  lines.push(`- Wind reference tools: ${report.summary.referenceTools}`)
  lines.push(`- live passed rows: ${report.summary.livePassed}`)
  lines.push(`- canonical-ready rows: ${report.summary.canonicalReady}`)
  lines.push(`- unified rows: ${report.summary.unified}`)
  lines.push(`- unclaimed reference tools: ${report.summary.unclaimedReferenceTools}`)
  lines.push(`- problems: ${report.summary.problems}`)
  lines.push('')
  lines.push('Decision counts:')
  lines.push('')
  for (const [status, count] of Object.entries(report.summary.decisionCounts).sort()) {
    lines.push(`- ${status}: ${count}`)
  }
  lines.push('')
  lines.push('Status counts:')
  lines.push('')
  for (const [status, count] of Object.entries(report.summary.statusCounts).sort()) {
    lines.push(`- ${status}: ${count}`)
  }
  lines.push('')
  lines.push('## Wind Capability Rows')
  lines.push('')
  lines.push('| Interface | Purpose | Status | Decision | Capability | Tools | Live | Canonical | Unified | Next action |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const row of report.rows) {
    lines.push([
      code(row.interfaceId),
      escapeCell(row.chinesePurpose || row.category || ''),
      code(row.status),
      code(row.decision),
      code(row.capabilityId ?? '-'),
      escapeCell(row.referencedTools.length ? row.referencedTools.join('<br>') : '-'),
      escapeCell(row.liveStatus ? `${row.liveStatus}${row.liveValidationState ? `<br>${row.liveValidationState}` : ''}` : '-'),
      escapeCell(row.canonicalReady ? `${row.normalizer}<br>${row.canonicalTable}` : '-'),
      row.unified ? 'yes' : 'no',
      escapeCell(row.nextAction),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'))
  }
  lines.push('')
  lines.push('## Unclaimed Reference Tools')
  lines.push('')
  if (report.unclaimedReferenceTools.length === 0) {
    lines.push('- none')
  } else {
    for (const tool of report.unclaimedReferenceTools) {
      lines.push(`- \`${tool.id}\` documented=${tool.documented ? 'yes' : 'no'} normalizationDomain=${tool.normalizationDomain ?? '-'}`)
    }
  }
  lines.push('')
  lines.push('## Problems')
  lines.push('')
  if (report.problems.length === 0) {
    lines.push('- none')
  } else {
    for (const problem of report.problems) lines.push(`- ${problem}`)
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(repoRoot, path), 'utf-8'))
}

function countBy(items) {
  const counts = {}
  for (const item of items) counts[item] = (counts[item] ?? 0) + 1
  return counts
}

function code(value) {
  return `\`${String(value).replaceAll('`', '')}\``
}

function escapeCell(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', '<br>')
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
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
