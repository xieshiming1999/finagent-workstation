#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const electronContractPath = resolve(repoRoot, 'finagent_workstation/src/agent/data/data-api-interfaces.json')
const electronCachePath = resolve(repoRoot, 'finagent_workstation/src/agent/data/data-api-cache-coverage.json')
const mobileContractPath = resolve(repoRoot, 'app/lib/domain/market/providers/data_api_interface_contract.dart')
const args = parseArgs(process.argv.slice(2))
const jsonOut = resolve(repoRoot, args.json ?? 'reports/integrations/finance_data_unification_audit_2026_06_17.json')
const mdOut = resolve(repoRoot, args.md ?? 'reports/integrations/finance_data_unification_audit_2026_06_17.md')

const electron = readElectronContract()
const mobile = readMobileContract()
const report = buildReport([electron, mobile])

if (args['no-write'] !== 'true') {
  writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
  writeFileSync(mdOut, renderMarkdown(report), 'utf-8')
}

if (args.jsonOnly === 'true') {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`Finance data unification audit: ${report.summary.interfaces} interfaces, ${report.summary.capabilities} capabilities, ${report.summary.problems} problems`)
  if (args['no-write'] !== 'true') {
    console.log(`JSON: ${jsonOut}`)
    console.log(`Markdown: ${mdOut}`)
  }
}

if (report.problems.length > 0 && args['fail-on-problem'] === 'true') {
  for (const problem of report.problems) console.error(problem)
  process.exit(1)
}

function readElectronContract() {
  const contract = JSON.parse(readFileSync(electronContractPath, 'utf-8'))
  const cache = JSON.parse(readFileSync(electronCachePath, 'utf-8'))
  return {
    runtime: 'finagent_workstation',
    source: electronContractPath,
    cacheSource: electronCachePath,
    interfaces: contract.interfaces.map((item) => ({
      id: item.id,
      canonicalSchema: item.canonicalSchema,
      dataStoreTables: item.dataStoreTables ?? [],
      queryActions: item.queryActions ?? [],
      freshnessPolicy: item.freshnessPolicy,
      cache: cache.interfaces?.[item.id] ?? null,
      capabilities: (item.capabilities ?? []).map((capability) => ({
        id: capability.id,
        provider: capability.provider,
        status: capability.status,
        adapter: capability.adapter ?? null,
        normalizer: capability.normalizer ?? null,
        canonicalTable: capability.canonicalTable ?? null,
        reason: capability.reason ?? null,
      })),
    })),
  }
}

function readMobileContract() {
  const text = readFileSync(mobileContractPath, 'utf-8')
  const interfaceStart = text.indexOf('const _interfaces')
  const interfaceText = interfaceStart >= 0 ? text.slice(interfaceStart) : text
  const blocks = extractCalls(interfaceText, 'DataApiInterfaceDefinition')
  return {
    runtime: 'shared_mobile_finagent',
    source: mobileContractPath,
    cacheSource: null,
    interfaces: blocks.map((block) => {
      const dataStoreTables = readStringList(block, 'dataStoreTables')
      const queryActions = readStringList(block, 'queryActions')
      return {
        id: readStringField(block, 'id'),
        canonicalSchema: readStringField(block, 'canonicalSchema'),
        dataStoreTables,
        queryActions,
        freshnessPolicy: readStringField(block, 'freshnessPolicy'),
        cache: queryActions.length > 0
          ? { status: 'readback-declared', reader: queryActions.join(','), policy: 'mobile query action; freshness handled by service/cache policy' }
          : null,
        capabilities: extractCalls(block, 'DataApiProviderCapability').map((capability) => ({
          id: readStringField(capability, 'id'),
          provider: readEnumField(capability, 'provider', 'FinanceProvider'),
          status: toWireStatus(readEnumField(capability, 'status', 'DataApiCapabilityStatus')),
          adapter: readStringField(capability, 'adapter'),
          normalizer: readStringField(capability, 'normalizer'),
          canonicalTable: readStringField(capability, 'canonicalTable'),
          reason: readStringField(capability, 'reason'),
        })),
      }
    }),
  }
}

function buildReport(runtimes) {
  const runtimeReports = runtimes.map((runtime) => {
    const rows = []
    const problems = []
    for (const item of runtime.interfaces) {
      const ownedTables = new Set(item.dataStoreTables)
      if (!item.id) problems.push(`${runtime.runtime}: interface id required`)
      if (!item.canonicalSchema) problems.push(`${runtime.runtime}/${item.id}: canonicalSchema required`)
      if (item.dataStoreTables.length > 0 && item.queryActions.length === 0) {
        problems.push(`${runtime.runtime}/${item.id}: canonical storage requires query/readback action`)
      }
      if (item.dataStoreTables.length > 0 && !item.cache) {
        problems.push(`${runtime.runtime}/${item.id}: canonical storage requires cache/readback declaration`)
      }
      for (const capability of item.capabilities) {
        const reusable = isReusableProviderCapability(capability.status)
        const rowProblems = []
        if (reusable && !capability.adapter) rowProblems.push('missing adapter')
        if (reusable && !capability.normalizer) rowProblems.push('missing provider normalizer')
        if (reusable && item.dataStoreTables.length > 0 && !capability.canonicalTable) rowProblems.push('missing canonical table')
        if (reusable && capability.canonicalTable && item.dataStoreTables.length > 0 && !ownedTables.has(capability.canonicalTable)) {
          rowProblems.push(`canonical table not owned by interface: ${capability.canonicalTable}`)
        }
        for (const problem of rowProblems) problems.push(`${runtime.runtime}/${item.id}/${capability.id}: ${problem}`)
        rows.push({
          runtime: runtime.runtime,
          interfaceId: item.id,
          canonicalSchema: item.canonicalSchema,
          interfaceTables: item.dataStoreTables,
          queryActions: item.queryActions,
          freshnessPolicy: item.freshnessPolicy,
          cacheStatus: item.cache?.status ?? 'missing',
          cacheReader: item.cache?.reader ?? null,
          provider: capability.provider,
          capabilityId: capability.id,
          status: capability.status,
          adapter: capability.adapter,
          normalizer: capability.normalizer,
          canonicalTable: capability.canonicalTable,
          unified: rowProblems.length === 0,
          problems: rowProblems,
        })
      }
    }
    return {
      runtime: runtime.runtime,
      source: runtime.source,
      cacheSource: runtime.cacheSource,
      interfaces: runtime.interfaces.length,
      capabilities: rows.length,
      rows,
      problems,
    }
  })
  const allRows = runtimeReports.flatMap((runtime) => runtime.rows)
  const allProblems = runtimeReports.flatMap((runtime) => runtime.problems)
  return {
    generatedAt: new Date().toISOString(),
    objective: 'Verify every declared reusable data API interface/provider capability normalizes into interface-owned canonical storage and has an explicit cache/readback rule.',
    summary: {
      runtimes: runtimeReports.length,
      interfaces: runtimeReports.reduce((sum, runtime) => sum + runtime.interfaces, 0),
      capabilities: allRows.length,
      unifiedCapabilities: allRows.filter((row) => row.unified).length,
      problems: allProblems.length,
    },
    runtimes: runtimeReports,
    rows: allRows,
    problems: allProblems,
  }
}

function isReusableProviderCapability(status) {
  return status === 'supported' ||
    status === 'global-only' ||
    status === 'credential-gated' ||
    status === 'quota-gated' ||
    status === 'transport-unstable'
}

function renderMarkdown(report) {
  const lines = []
  lines.push('# Finance Data Unification Audit')
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push('')
  lines.push('## Objective')
  lines.push('')
  lines.push(report.objective)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- runtimes: ${report.summary.runtimes}`)
  lines.push(`- interfaces: ${report.summary.interfaces}`)
  lines.push(`- capabilities: ${report.summary.capabilities}`)
  lines.push(`- unified capabilities: ${report.summary.unifiedCapabilities}`)
  lines.push(`- problems: ${report.summary.problems}`)
  lines.push('')
  for (const runtime of report.runtimes) {
    lines.push(`## ${runtime.runtime}`)
    lines.push('')
    lines.push(`- source: \`${runtime.source}\``)
    if (runtime.cacheSource) lines.push(`- cache source: \`${runtime.cacheSource}\``)
    lines.push(`- interfaces: ${runtime.interfaces}`)
    lines.push(`- capabilities: ${runtime.capabilities}`)
    lines.push(`- problems: ${runtime.problems.length}`)
    lines.push('')
    lines.push('| Interface | Tables | Cache/readback | Provider | Capability | Status | Adapter | Normalizer | Canonical table | Unified |')
    lines.push('|---|---|---|---|---|---|---|---|---|---|')
    for (const row of runtime.rows) {
      lines.push(`| \`${row.interfaceId}\` | ${row.interfaceTables.map((item) => `\`${item}\``).join(', ') || '-'} | ${row.cacheStatus}${row.cacheReader ? `<br>\`${row.cacheReader}\`` : ''} | ${row.provider} | \`${row.capabilityId}\` | ${row.status} | ${row.adapter ?? '-'} | ${row.normalizer ?? '-'} | ${row.canonicalTable ? `\`${row.canonicalTable}\`` : '-'} | ${row.unified ? 'yes' : row.problems.join('<br>')} |`)
    }
    lines.push('')
  }
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

function extractCalls(text, name) {
  const blocks = []
  let searchFrom = 0
  while (true) {
    const startName = text.indexOf(`${name}(`, searchFrom)
    if (startName < 0) break
    const start = text.indexOf('(', startName)
    let depth = 0
    let quote = null
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      const prev = text[i - 1]
      if (quote) {
        if (ch === quote && prev !== '\\') quote = null
        continue
      }
      if (ch === '\'' || ch === '"') {
        quote = ch
      } else if (ch === '(') {
        depth++
      } else if (ch === ')') {
        depth--
        if (depth === 0) {
          blocks.push(text.slice(startName, i + 1))
          searchFrom = i + 1
          break
        }
      }
    }
    if (searchFrom <= startName) break
  }
  return blocks
}

function readStringField(block, field) {
  const direct = block.match(new RegExp(`${field}:\\s*'([^']*)'`))
  if (direct) return direct[1]
  const doubleQuoted = block.match(new RegExp(`${field}:\\s*"([^"]*)"`))
  if (doubleQuoted) return doubleQuoted[1]
  const multiline = block.match(new RegExp(`${field}:\\s*([\\s\\S]*?)(?:,\\n\\s*[a-zA-Z_]|,\\n\\s*\\)|\\n\\s*\\))`))
  if (!multiline) return null
  const pieces = [...multiline[1].matchAll(/'([^']*)'/g)].map((match) => match[1])
  return pieces.length ? pieces.join('') : null
}

function readStringList(block, field) {
  const match = block.match(new RegExp(`${field}:\\s*\\[([\\s\\S]*?)\\]`))
  if (!match) return []
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
}

function readEnumField(block, field, enumName) {
  const match = block.match(new RegExp(`${field}:\\s*${enumName}\\.([a-zA-Z0-9_]+)`))
  return match?.[1] ?? null
}

function toWireStatus(value) {
  return ({
    supported: 'supported',
    disabled: 'disabled',
    credentialGated: 'credential-gated',
    quotaGated: 'quota-gated',
    transportUnstable: 'transport-unstable',
    notSupported: 'not-supported',
    outputOnly: 'output-only',
    globalOnly: 'global-only',
  })[value] ?? value
}

function parseArgs(values) {
  const parsed = {}
  for (let i = 0; i < values.length; i++) {
    const item = values[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = values[i + 1]
    if (!next || next.startsWith('--')) {
      parsed[key] = 'true'
    } else {
      parsed[key] = next
      i++
    }
  }
  return parsed
}
