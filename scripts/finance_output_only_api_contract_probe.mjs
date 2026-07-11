#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { readFileSync } from 'node:fs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const args = parseArgs(process.argv.slice(2))
const jsonOut = resolve(repoRoot, args.json ?? 'reports/integrations/finance_output_only_api_contract_probe_2026_06_18.json')
const mdOut = resolve(repoRoot, args.md ?? 'reports/integrations/finance_output_only_api_contract_probe_2026_06_18.md')

const api = loadOutputOnlyModule()
const generatedAt = new Date().toISOString()
const cases = buildCases()
const results = cases.map(runCase)
const problems = results.flatMap((result) => result.problems.map((problem) => `${result.id}: ${problem}`))

const report = {
  generatedAt,
  kind: 'fixture-backed-output-only-contract-probe',
  summary: {
    cases: results.length,
    passed: results.filter((item) => item.status === 'pass').length,
    failed: results.filter((item) => item.status === 'fail').length,
    problems: problems.length,
    interfaces: api.OUTPUT_ONLY_INTERFACES.length,
    knowledgeRecords: api.OUTPUT_ONLY_KNOWLEDGE_RECORDS.length,
  },
  cases: results,
  problems,
}

if (args['no-write'] !== 'true') {
  mkdirSync(dirname(jsonOut), { recursive: true })
  mkdirSync(dirname(mdOut), { recursive: true })
  writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
  writeFileSync(mdOut, renderMarkdown(report), 'utf-8')
}

console.log(`Finance output-only API contract probe: ${report.summary.passed}/${report.summary.cases} cases passed, ${report.summary.problems} problems`)
if (args['no-write'] !== 'true') {
  console.log(`JSON: ${jsonOut}`)
  console.log(`Markdown: ${mdOut}`)
}
if (problems.length > 0 && args['fail-on-problem'] === 'true') {
  for (const problem of problems) console.error(problem)
  process.exit(1)
}

function buildCases() {
  return [
    {
      id: 'provider.discovery.success',
      interfaceId: 'provider.discovery',
      expectedSchemaId: 'provider_discovery_result',
      expectedStatus: 'success',
      execute: () => api.normalizeProviderDiscovery({
        provider: 'akshare',
        query: 'fund',
        raw: { total: 1, functions: [{ name: 'fund_open_fund_info_em', description: 'fund info', category: 'fund', parameters: ['symbol'] }] },
        capabilityId: 'akshare.provider.discovery',
        sourceAction: 'provider_discovery',
      }),
    },
    {
      id: 'provider.discovery.empty',
      interfaceId: 'provider.discovery',
      expectedSchemaId: 'provider_discovery_result',
      expectedStatus: 'empty',
      execute: () => api.normalizeProviderDiscovery({
        provider: 'akshare',
        query: 'no_such_endpoint',
        raw: { total: 0, functions: [] },
        capabilityId: 'akshare.provider.discovery',
        sourceAction: 'provider_discovery',
      }),
    },
    {
      id: 'provider.diagnostic.success',
      interfaceId: 'provider.diagnostic',
      expectedSchemaId: 'provider_diagnostic_result',
      expectedStatus: 'success',
      execute: () => api.normalizeProviderDiagnostic({
        provider: 'akshare',
        endpointOrAction: 'stock_zt_pool_em',
        requestShape: { func: 'stock_zt_pool_em', params: { date: '20260618' } },
        raw: { data: [{ code: '600519', name: '贵州茅台' }], columns: ['code', 'name'] },
        capabilityId: 'akshare.provider.diagnostic',
        sourceAction: 'provider_diagnostic',
      }),
    },
    {
      id: 'provider.diagnostic.invalid-parameters',
      interfaceId: 'provider.diagnostic',
      expectedSchemaId: 'provider_diagnostic_result',
      expectedStatus: 'error',
      expectedFailureClass: 'invalid_parameters',
      execute: () => api.normalizeProviderDiagnostic({
        provider: 'akshare',
        endpointOrAction: 'stock_zt_pool_em',
        requestShape: { func: 'stock_zt_pool_em', params: { date: 'bad' } },
        raw: { error: 'invalid parameter: date' },
        capabilityId: 'akshare.provider.diagnostic',
        sourceAction: 'provider_diagnostic',
        statusCode: 400,
      }),
    },
    {
      id: 'provider.status.success',
      interfaceId: 'provider.status',
      expectedSchemaId: 'provider_status_result',
      expectedStatus: 'success',
      execute: () => api.normalizeProviderStatus({
        raw: { provider: 'sidecar', providers: { pythonSidecar: { online: true, version: 'fixture' } } },
      }),
    },
    {
      id: 'akshare.sina.reference_dataset.success',
      interfaceId: 'provider.reference_dataset',
      expectedSchemaId: 'provider_reference_dataset_result',
      expectedStatus: 'success',
      execute: () => api.normalizeAkshareSinaReferenceDataset({
        functionName: 'stock_financial_report_sina',
        params: { stock: '600519', symbol: '资产负债表' },
        raw: { data: [{ 报告日: '2025-12-31', 资产总计: 100 }] },
      }),
    },
    {
      id: 'sina.intraday_ohlcv_bars.success',
      interfaceId: 'market.intraday_ohlcv_bars',
      expectedSchemaId: 'intraday_ohlcv_bar_result',
      expectedStatus: 'success',
      execute: () => api.normalizeSinaIntradayOhlcvBars({
        symbol: 'sh600519',
        raw: [{ day: '2026-06-23 09:35:00', open: '1280', high: '1282', low: '1279', close: '1281', volume: '1000' }],
      }),
    },
    {
      id: 'sina.stock_transaction_count.success',
      interfaceId: 'stock.transaction_count',
      expectedSchemaId: 'stock_transaction_count_result',
      expectedStatus: 'success',
      execute: () => api.normalizeSinaStockTransactionCount({
        symbol: 'sh600519',
        date: '2026-06-23',
        pageSize: 60,
        raw: { count: 121 },
      }),
    },
    {
      id: 'sina.fund_dividend_factor.success',
      interfaceId: 'fund.dividend_factor',
      expectedSchemaId: 'fund_dividend_factor_result',
      expectedStatus: 'success',
      execute: () => api.normalizeSinaFundDividendFactor({
        symbol: '159998',
        raw: { data: [{ fsrq: '2026-06-20', fh: '0.012', ljjz: '1.023' }] },
      }),
    },
    {
      id: 'sina.fund_etf_daily_ohlcv_bars.success',
      interfaceId: 'fund.etf_daily_ohlcv_bars',
      expectedSchemaId: 'fund_etf_daily_ohlcv_bar_result',
      expectedStatus: 'success',
      execute: () => api.normalizeSinaFundEtfDailyOhlcvBars({
        symbol: 'sh510050',
        raw: { data: [{ date: '2026-06-23', open: 1.01, high: 1.02, low: 1.0, close: 1.015, volume: 1000, amount: 1015 }] },
      }),
    },
    {
      id: 'router.unknown-provider-negative',
      interfaceId: 'provider.discovery',
      expectedError: true,
      execute: () => api.selectOutputOnlyCapability('provider.discovery', 'not_a_provider'),
    },
  ]
}

function runCase(testCase) {
  const problems = []
  let result = null
  try {
    result = testCase.execute()
  } catch (error) {
    if (!testCase.expectedError) {
      problems.push(`unexpected error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (testCase.expectedError) {
    if (result != null) problems.push('expected error but call returned a result')
  } else if (result) {
    if (result.interfaceId !== testCase.interfaceId) problems.push(`interfaceId ${result.interfaceId} != ${testCase.interfaceId}`)
    if (result.schemaId !== testCase.expectedSchemaId) problems.push(`schemaId ${result.schemaId} != ${testCase.expectedSchemaId}`)
    if (result.status !== testCase.expectedStatus) problems.push(`status ${result.status} != ${testCase.expectedStatus}`)
    if (testCase.expectedFailureClass && result.failureClass !== testCase.expectedFailureClass) problems.push(`failureClass ${result.failureClass} != ${testCase.expectedFailureClass}`)
    if (!result.provenance || result.provenance.persistencePolicy !== 'output-only') problems.push('missing output-only provenance')
    if (result.provenance && result.provenance.cacheStatus !== 'not-cacheable') problems.push(`cacheStatus ${result.provenance.cacheStatus} != not-cacheable`)
    if (!Array.isArray(result.warnings)) problems.push('warnings is not an array')
  } else {
    problems.push('missing result')
  }

  return {
    id: testCase.id,
    interfaceId: testCase.interfaceId,
    status: problems.length === 0 ? 'pass' : 'fail',
    failureClass: result?.failureClass ?? null,
    resultStatus: result?.status ?? null,
    schemaId: result?.schemaId ?? testCase.expectedSchemaId ?? null,
    sampleColumns: sampleColumns(result),
    rowCount: rowCount(result),
    problems,
  }
}

function loadOutputOnlyModule() {
  const sourcePath = resolve(repoRoot, 'src/agent/data/output-only-interfaces.ts')
  const source = readFileSync(sourcePath, 'utf-8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  const fn = new Function('exports', 'module', 'require', js)
  fn(module.exports, module, () => {
    throw new Error('output-only contract probe should not require dependencies')
  })
  return module.exports
}

function sampleColumns(result) {
  const data = result?.data
  if (!data || typeof data !== 'object') return []
  if (Array.isArray(data.sampleColumns)) return data.sampleColumns.map(String)
  if (Array.isArray(data.rows) && data.rows[0] && typeof data.rows[0] === 'object') return Object.keys(data.rows[0])
  if (Array.isArray(data.items) && data.items[0] && typeof data.items[0] === 'object') return Object.keys(data.items[0])
  return Object.keys(data).slice(0, 20)
}

function rowCount(result) {
  const data = result?.data
  if (!data || typeof data !== 'object') return 0
  if (Array.isArray(data.rows)) return data.rows.length
  if (Array.isArray(data.items)) return data.items.length
  if (typeof data.rowCount === 'number') return data.rowCount
  return 1
}

function renderMarkdown(report) {
  const lines = []
  lines.push('# Finance Output-Only API Contract Probe')
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push('')
  lines.push('Fixture-backed schema probe for normalized non-persisted finance API interfaces.')
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(`- cases: ${report.summary.cases}`)
  lines.push(`- passed: ${report.summary.passed}`)
  lines.push(`- failed: ${report.summary.failed}`)
  lines.push(`- problems: ${report.summary.problems}`)
  lines.push(`- interfaces: ${report.summary.interfaces}`)
  lines.push(`- knowledge records: ${report.summary.knowledgeRecords}`)
  lines.push('')
  lines.push('## Cases')
  lines.push('')
  lines.push('| Case | Interface | Status | Result status | Failure class | Schema | Evidence |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const item of report.cases) {
    const evidence = item.problems.length
      ? item.problems.join('<br>')
      : `rows=${item.rowCount}; columns=${item.sampleColumns.join(', ') || '-'}`
    lines.push(`| \`${item.id}\` | \`${item.interfaceId}\` | ${item.status} | ${item.resultStatus ?? '-'} | ${item.failureClass ?? '-'} | \`${item.schemaId ?? '-'}\` | ${escapePipe(evidence)} |`)
  }
  lines.push('')
  lines.push('## Problems')
  lines.push('')
  if (report.problems.length === 0) lines.push('- none')
  else for (const problem of report.problems) lines.push(`- ${problem}`)
  lines.push('')
  return `${lines.join('\n')}\n`
}

function escapePipe(value) {
  return String(value).replaceAll('|', '\\|')
}

function parseArgs(values) {
  const parsed = {}
  for (let i = 0; i < values.length; i++) {
    const item = values[i]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const next = values[i + 1]
    if (!next || next.startsWith('--')) parsed[key] = 'true'
    else {
      parsed[key] = next
      i++
    }
  }
  return parsed
}
