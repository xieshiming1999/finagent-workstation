#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(scriptDir, '..')
const workspaceRoot = resolve(appRoot, '..')
const electronContractPath = resolve(appRoot, 'src/agent/data/output-only-interfaces.ts')
const mobileContractPath = resolve(workspaceRoot, 'app/lib/domain/market/providers/output_only_api_interface_contract.dart')
const args = parseArgs(process.argv.slice(2))

const outputs = [
  {
    path: resolve(appRoot, 'assets/skills/data-sources/references/output-only-api-interfaces.md'),
    contract: readElectronContract(),
  },
]
if (existsSync(mobileContractPath)) {
  const mobileContract = readMobileContract()
  outputs.push(
    {
      path: resolve(workspaceRoot, 'app/assets/finance/skills/data-sources/references/output-only-api-interfaces.md'),
      contract: mobileContract,
    },
    {
      path: resolve(workspaceRoot, 'finagent/assets/finance/skills/data-sources/references/output-only-api-interfaces.md'),
      contract: mobileContract,
    },
  )
}

const problems = []

if (args.check === 'true') {
  for (const output of outputs) {
    const expected = render(output.contract)
    let actual = ''
    try {
      actual = readFileSync(output.path, 'utf-8')
    } catch {
      problems.push(`missing generated output-only skill reference: ${relativePath(output.path)}`)
      continue
    }
    if (actual !== expected) problems.push(`stale generated output-only skill reference: ${relativePath(output.path)}`)
  }
} else {
  for (const output of outputs) {
    mkdirSync(dirname(output.path), { recursive: true })
    writeFileSync(output.path, render(output.contract), 'utf-8')
  }
}

if (args.jsonOnly === 'true') {
  console.log(JSON.stringify({
    checked: outputs.length,
    problems,
    outputs: outputs.map((output) => relativePath(output.path)),
  }, null, 2))
} else if (args.check === 'true') {
  console.log(`Finance output-only API skill reference check: ${outputs.length} files, ${problems.length} problems`)
} else {
  console.log(`Finance output-only API skill reference: ${outputs.map((output) => `${output.contract.runtime}:${output.contract.interfaces.length}`).join(', ')} -> ${outputs.length} files`)
}

if (problems.length > 0 && args['fail-on-problem'] === 'true') {
  for (const problem of problems) console.error(problem)
  process.exit(1)
}

function readElectronContract() {
  const source = readFileSync(electronContractPath, 'utf-8')
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  const module = { exports: {} }
  const fn = new Function('exports', 'module', 'require', js)
  fn(module.exports, module, () => {
    throw new Error('output-only registry script should not require dependencies')
  })
  return {
    runtime: 'finagent_workstation',
    version: '2026-06-18',
    interfaces: module.exports.OUTPUT_ONLY_INTERFACES,
    records: module.exports.OUTPUT_ONLY_KNOWLEDGE_RECORDS,
  }
}

function readMobileContract() {
  const text = readFileSync(mobileContractPath, 'utf-8')
  return {
    runtime: 'shared_mobile_finagent',
    version: '2026-06-18',
    interfaces: extractCalls(text, 'OutputOnlyApiInterface').map((block) => ({
      id: readStringField(block, 'id'),
      label: readStringField(block, 'label'),
      schemaId: readStringField(block, 'schemaId'),
      schemaVersion: readStringField(block, 'schemaVersion'),
      persistencePolicy: readStringField(block, 'persistencePolicy'),
      unknownSchemaPolicy: readStringField(block, 'unknownSchemaPolicy'),
      capabilities: extractCalls(block, 'OutputOnlyApiCapability').map((capability) => ({
        id: readStringField(capability, 'id'),
        interfaceId: readStringField(capability, 'interfaceId'),
        provider: readStringField(capability, 'provider'),
        status: readStringField(capability, 'status'),
        priority: Number(readNumberField(capability, 'priority') ?? 0),
        schemaId: readStringField(capability, 'schemaId'),
        adapter: readStringField(capability, 'adapter'),
        normalizer: readStringField(capability, 'normalizer'),
        persistencePolicy: readStringField(capability, 'persistencePolicy'),
      })),
    })).filter((item) => item.id),
    records: extractCalls(text, 'OutputOnlyApiKnowledgeRecord').map((record) => ({
      apiId: readStringField(record, 'apiId'),
      interfaceId: readStringField(record, 'interfaceId'),
      capabilityId: readStringField(record, 'capabilityId'),
      provider: readStringField(record, 'provider'),
      endpointOrAction: readStringField(record, 'endpointOrAction'),
      schemaId: readStringField(record, 'schemaId'),
      persistencePolicy: readStringField(record, 'persistencePolicy'),
      parameterContract: {
        required: readStringList(record, 'requiredParameters'),
        optional: readStringList(record, 'optionalParameters'),
      },
      responseContract: {
        topLevelFields: readStringList(record, 'topLevelFields'),
        rowFields: readStringList(record, 'rowFields'),
      },
      usagePolicy: {
        retryPolicy: readStringField(record, 'retryPolicy'),
      },
    })).filter((item) => item.apiId),
  }
}

function render(contract) {
  const lines = []
  lines.push('# Output-Only API Interfaces')
  lines.push('')
  lines.push(`Generated from the code-owned ${contract.runtime} finance output-only API contract. Use this table for useful non-persisted workflows and diagnostics.`)
  lines.push('')
  lines.push(`Contract version: ${contract.version}`)
  lines.push('')
  lines.push('| Interface | Schema | Unknown schema policy | Providers by priority | Normalizers |')
  lines.push('|---|---|---|---|---|')
  for (const item of contract.interfaces) {
    const capabilities = [...item.capabilities].sort((a, b) => a.priority - b.priority)
    lines.push([
      `\`${item.id}\``,
      `\`${item.schemaId}\` ${item.schemaVersion}`,
      item.unknownSchemaPolicy,
      capabilities.map((capability) => `${capability.priority}. ${capability.provider}:${capability.status}`).join('<br>'),
      capabilities.map((capability) => `\`${capability.normalizer}\``).join('<br>'),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'))
  }
  lines.push('')
  lines.push('Provider parameters are routing constraints. They do not bypass the interface, normalizer, failure classification, provenance, or non-persistence policy.')
  lines.push('')
  lines.push('Output-only means known schema with no canonical reusable table. Unknown provider output must be rejected, routed through a bounded diagnostic envelope, or fail an audit/probe until a code-owned interface/normalizer is added.')
  lines.push('')
  lines.push('## Knowledge Records')
  lines.push('')
  lines.push('| API | Interface | Provider | Endpoint/action | Required params | Optional params | Response fields | Retry / recovery |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const record of contract.records) {
    const required = record.parameterContract?.required ?? record.requiredParameters ?? []
    const optional = record.parameterContract?.optional ?? record.optionalParameters ?? []
    const fields = record.responseContract?.topLevelFields ?? record.topLevelFields ?? []
    const rowFields = record.responseContract?.rowFields ?? record.rowFields ?? []
    lines.push([
      `\`${record.apiId}\``,
      `\`${record.interfaceId}\``,
      record.provider,
      `\`${record.endpointOrAction}\``,
      required.map((item) => `\`${item}\``).join(', ') || '-',
      optional.map((item) => `\`${item}\``).join(', ') || '-',
      [...fields, ...rowFields.map((item) => `row.${item}`)].slice(0, 16).map((item) => `\`${item}\``).join(', ') || '-',
      retryPolicyForRecord(record),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'))
  }
  return `${lines.join('\n')}\n`
}

function retryPolicyForRecord(record) {
  if (record.apiId === 'sina.intraday_ohlcv_bars') {
    return 'Normal workflow uses governed market.intraday_ohlcv_bars via sina_intraday_ohlcv_bars and query_intraday_ohlcv_bars; use this envelope only for bounded diagnostics.'
  }
  return record.usagePolicy?.retryPolicy ?? record.retryPolicy ?? '-'
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
      if (ch === '\'' || ch === '"') quote = ch
      else if (ch === '(') depth++
      else if (ch === ')') {
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
  const match = block.match(new RegExp(`${field}:\\s*'([^']*)'`))
  return match ? match[1] : null
}

function readNumberField(block, field) {
  const match = block.match(new RegExp(`${field}:\\s*([0-9]+)`))
  return match ? match[1] : null
}

function readStringList(block, field) {
  const match = block.match(new RegExp(`${field}:\\s*\\[([\\s\\S]*?)\\]`))
  if (!match) return []
  return [...match[1].matchAll(/'([^']*)'/g)].map((item) => item[1])
}

function relativePath(path) {
  return path.replace(`${appRoot}/`, '')
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
