#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')
const appRoot = resolve(scriptDir, '..')
const args = parseArgs(process.argv.slice(2))
const electronContractPath = resolve(appRoot, 'src/agent/data/data-api-interfaces.json')
const electronCacheCoveragePath = resolve(appRoot, 'src/agent/data/data-api-cache-coverage.json')
const mobileContractPath = resolve(repoRoot, 'app/lib/domain/market/providers/data_api_interface_contract.dart')

const outputs = [
  {
    path: resolve(repoRoot, 'finagent_workstation/assets/skills/data-sources/references/data-api-interfaces.md'),
    contract: readElectronContract(),
  },
  {
    path: resolve(repoRoot, 'app/assets/finance/skills/data-sources/references/data-api-interfaces.md'),
    contract: readMobileContract(),
  },
  {
    path: resolve(repoRoot, 'finagent/assets/finance/skills/data-sources/references/data-api-interfaces.md'),
    contract: readMobileContract(),
  },
]

const renderedOutputs = outputs.map((output) => ({
  ...output,
  rendered: render(output.contract),
}))

if (args.check === 'true') {
  const problems = []
  for (const output of renderedOutputs) {
    if (!existsSync(output.path)) {
      problems.push(`missing generated skill reference: ${relativePath(output.path)}`)
      continue
    }
    const current = readFileSync(output.path, 'utf-8')
    if (current !== output.rendered) {
      problems.push(`stale generated skill reference: ${relativePath(output.path)}`)
    }
  }
  const report = {
    checked: renderedOutputs.length,
    problems,
    outputs: renderedOutputs.map((output) => relativePath(output.path)),
  }
  if (args.jsonOnly === 'true') {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`Finance data API skill reference check: ${report.checked} files, ${problems.length} problems`)
    for (const problem of problems) console.error(problem)
  }
  if (problems.length > 0 && args['fail-on-problem'] === 'true') process.exit(1)
} else {
  for (const output of renderedOutputs) {
    mkdirSync(dirname(output.path), { recursive: true })
    writeFileSync(output.path, output.rendered, 'utf-8')
  }
  console.log(`Finance data API skill reference: ${outputs.map((output) => `${output.contract.runtime}:${output.contract.interfaces.length}`).join(', ')} -> ${outputs.length} files`)
}

function readElectronContract() {
  const contract = JSON.parse(readFileSync(electronContractPath, 'utf-8'))
  const cacheCoverage = JSON.parse(readFileSync(electronCacheCoveragePath, 'utf-8'))
  return {
    runtime: 'finagent_workstation',
    version: contract.version,
    interfaces: contract.interfaces.map((item) => ({
      ...item,
      cache: cacheCoverage.interfaces?.[item.id] ?? { status: 'not-implemented', reader: null },
    })),
  }
}

function readMobileContract() {
  const text = readFileSync(mobileContractPath, 'utf-8')
  const start = text.indexOf('const _interfaces')
  const blocks = extractCalls(start >= 0 ? text.slice(start) : text, 'DataApiInterfaceDefinition')
  return {
    runtime: 'shared_mobile_finagent',
    version: readRequiredTopLevelStringConst(text, 'dataApiInterfaceContractVersion'),
    interfaces: blocks.map((block) => {
      const queryActions = readStringList(block, 'queryActions')
      return {
        id: readStringField(block, 'id'),
        canonicalSchema: readStringField(block, 'canonicalSchema'),
        queryActions,
        cache: queryActions.length > 0
          ? { status: 'readback-declared', reader: queryActions.join(',') }
          : { status: 'not-implemented', reader: null },
        capabilities: extractCalls(block, 'DataApiProviderCapability').map((capability) => ({
          id: readStringField(capability, 'id'),
          provider: readEnumField(capability, 'provider', 'FinanceProvider'),
          status: toWireStatus(readEnumField(capability, 'status', 'DataApiCapabilityStatus')),
          upstreamOrigin: readStringField(capability, 'upstreamOrigin'),
        })),
      }
    }),
  }
}

function readRequiredTopLevelStringConst(text, name) {
  const match = text.match(new RegExp(`const\\s+${name}\\s*=\\s*'([^']+)'\\s*;`))
  if (!match) {
    throw new Error(`missing required Dart string const: ${name}`)
  }
  return match[1]
}

function render(contract) {
  const lines = []
  lines.push('# Data API Interfaces')
  lines.push('')
  lines.push(`Generated from the code-owned ${contract.runtime} finance data API contract. Use this table to choose requirement-level workflows before raw provider diagnostics.`)
  lines.push('')
  lines.push(`Contract version: ${contract.version}`)
  lines.push('')
  lines.push('| Interface | Canonical schema | Query/readback | Cache lookup | Supported providers | Blocked/output-only providers |')
  lines.push('|---|---|---|---|---|---|')
  for (const item of contract.interfaces) {
    const cache = item.cache ?? { status: 'not-implemented', reader: null }
    const supported = item.capabilities
      .filter((capability) => capability.status === 'supported' || capability.status === 'global-only')
      .map(formatCapabilityCell)
      .join(', ') || '-'
    const blocked = item.capabilities
      .filter((capability) => capability.status !== 'supported' && capability.status !== 'global-only')
      .map(formatCapabilityCell)
      .join(', ') || '-'
    lines.push([
      `\`${item.id}\``,
      `\`${item.canonicalSchema}\``,
      item.queryActions.map((action) => `\`${action}\``).join(', ') || '-',
      `${cache.status}${cache.reader ? `<br>\`${cache.reader}\`` : ''}`,
      supported,
      blocked,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'))
  }
  lines.push('')
  lines.push('Provider parameters are routing constraints for these interfaces. They are not permission to bypass local cache/readback, canonical normalizers, persistence, or API health policy.')
  lines.push('')
  lines.push('Cache reuse rule: default `cache-first` reads canonical local rows before provider')
  lines.push('routing and reuses them only when the interface-specific source data timestamp,')
  lines.push('date window, or coverage rule satisfies the request. Local `fetched_at` records')
  lines.push('ingest time and must not be used as market freshness. `live-only` bypasses')
  lines.push('local rows, `cache-only` refuses provider calls after a miss, and')
  lines.push('`providerMode: strict` requires any cache hit to carry matching provider/source')
  lines.push('evidence before reuse; otherwise the cache is treated as a miss and only the')
  lines.push('requested provider route is eligible. Use `live-only` when explicit provider')
  lines.push('validation must force a live provider call.')
  return `${lines.join('\n')}\n`
}

function formatCapabilityCell(capability) {
  const origin = capability.upstreamOrigin ? `/origin:${capability.upstreamOrigin}` : ''
  return `${capability.provider}:${capability.status}${origin}`
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
  const direct = block.match(new RegExp(`${field}:\\s*'([^']*)'`))
  if (direct) return direct[1]
  const pieces = [...(block.match(new RegExp(`${field}:\\s*([\\s\\S]*?)(?:,\\n\\s*[a-zA-Z_]|,\\n\\s*\\)|\\n\\s*\\))`))?.[1] ?? '').matchAll(/'([^']*)'/g)].map((match) => match[1])
  return pieces.length > 0 ? pieces.join('') : null
}

function readStringList(block, field) {
  const match = block.match(new RegExp(`${field}:\\s*\\[([\\s\\S]*?)\\]`))
  if (!match) return []
  return [...match[1].matchAll(/'([^']*)'/g)].map((item) => item[1])
}

function relativePath(path) {
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path
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
      i += 1
    }
  }
  return parsed
}

function readEnumField(block, field, enumName) {
  const match = block.match(new RegExp(`${field}:\\s*${enumName}\\.([a-zA-Z0-9_]+)`))
  return match ? match[1] : null
}

function toWireStatus(status) {
  if (!status) return null
  return status.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)
}
