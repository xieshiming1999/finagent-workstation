import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getIngestionRegistrySummary } from '../../src/agent/data/ingestion/registry'
import { matrixDefinitions } from '../../scripts/finance_api_datastore_matrix_manifest.mjs'

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  return typeof value === 'string' ? [value] : []
}

describe('ingestion registry contract', () => {
  const disabledTushareApis = [
    'fina_indicator',
    'income',
    'balancesheet',
    'cashflow',
    'moneyflow',
    'fund_basic',
    'fund_nav',
  ]

  it('keeps registered ingestion endpoints declared in the provider matrix', () => {
    const registeredEndpoints = new Set(
      getIngestionRegistrySummary().flatMap((provider) => provider.endpoints),
    )
    const manifestEndpoints = new Set(
      matrixDefinitions.flatMap((definition) => asArray(definition.ingestion)),
    )

    const missing = [...manifestEndpoints].filter((endpoint) => !registeredEndpoints.has(endpoint))
    expect(missing).toEqual([])
  })

  it('keeps every registered reusable table backed by readback and failure evidence', () => {
    const registeredTables = new Set(
      getIngestionRegistrySummary().flatMap((provider) => provider.tables),
    )
    const matrixRows = matrixDefinitions.filter((definition) => definition.status === 'proven')
    const reusableTables = new Set(matrixRows.flatMap((definition) => asArray(definition.tables)))

    const missingTables = [...registeredTables].filter((table) => !reusableTables.has(table))
    expect(missingTables).toEqual([])

    for (const table of registeredTables) {
      const rows = matrixRows.filter((definition) => asArray(definition.tables).includes(table))
      expect(rows.length, `${table} has a proven matrix row`).toBeGreaterThan(0)
      expect(
        rows.some((definition) => asArray(definition.query).length > 0),
        `${table} declares same-runtime query/readback action`,
      ).toBe(true)
      expect(
        rows.some((definition) => asArray(definition.evidence?.persist).length > 0),
        `${table} declares normalizer/persistence evidence`,
      ).toBe(true)
      expect(
        rows.some((definition) => asArray(definition.evidence?.readbackTest).length > 0),
        `${table} declares readback regression evidence`,
      ).toBe(true)
      expect(
        rows.some((definition) => asArray(definition.evidence?.failureNoPersistTest).length > 0),
        `${table} declares failure non-persistence evidence`,
      ).toBe(true)
    }
  })

  it('does not expose disabled Tushare APIs as provider capabilities', () => {
    const tushare = getIngestionRegistrySummary().find((provider) => provider.provider === 'tushare')
    expect(tushare).toBeTruthy()
    for (const api of disabledTushareApis) {
      expect(tushare?.endpoints).not.toContain(api)
    }

    const tushareMatrixRows = matrixDefinitions.filter((definition) => definition.provider === 'Tushare')
    for (const row of tushareMatrixRows) {
      const exposed = [
        ...asArray(row.api),
        ...asArray(row.ingestion),
        ...asArray(row.query),
      ].join(' ')
      for (const api of disabledTushareApis) {
        expect(exposed).not.toContain(api)
      }
    }

    const probeMatrix = readFileSync(join(process.cwd(), 'scripts', 'finance_live_probe_matrix.mjs'), 'utf-8')
    for (const api of disabledTushareApis) {
      expect(probeMatrix).not.toContain(`tushareBody('${api}'`)
      expect(probeMatrix).not.toContain(`tushare:${api}`)
    }

    const skillFiles = [
      'assets/skills/tushare/skill.md',
      '../finagent/assets/finance/skills/tushare/skill.md',
      '../finagent/assets/finance/skills/fund-screening/skill.md',
      '../finagent/assets/finance/skills/fund/skill.md',
      'assets/skills/fund-screening/skill.md',
    ]
    for (const relativePath of skillFiles) {
      const text = readFileSync(join(process.cwd(), relativePath), 'utf-8')
      for (const api of disabledTushareApis) {
        expect(text).not.toContain(`api_name: "${api}"`)
        expect(text).not.toContain(`api_name:"${api}"`)
      }
    }
  })
})
