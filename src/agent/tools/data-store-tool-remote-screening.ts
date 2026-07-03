import { toolError } from '../tool'
import { normalizeScreeningSnapshot } from '../data/normalizers/screening-normalizer'
import { DataStore } from '../data/store/data-store'
import { dataStoreRemoteCopy } from '../runtime-copy'

export async function screenStock(dsOrInput: DataStore | Record<string, unknown>, maybeInput?: Record<string, unknown>): Promise<string> {
  const ds = dsOrInput instanceof DataStore ? dsOrInput : null
  const rawInput: Record<string, unknown> = ds ? (maybeInput ?? {}) : dsOrInput as Record<string, unknown>
  const nestedParams = rawInput.params && typeof rawInput.params === 'object'
    ? rawInput.params as Record<string, unknown>
    : {}
  const input = { ...nestedParams, ...rawInput }
  const startedAt = Date.now()
  const gates = normalizeStockScreenGates(input.gates ?? input.conditions ?? input.filters ?? input)
  const body: Record<string, unknown> = {
    universe: (input.universe as Record<string, unknown>) ?? { exclude_st: true },
    gates,
    scoring: input.scoring ?? undefined,
    sort_by: input.sort_by,
    sort_desc: input.sort_desc ?? true,
    limit: input.limit ?? 30,
    include_fair_value: input.include_fair_value ?? false,
  }

  try {
    const res = await fetch('http://127.0.0.1:19800/screener/stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      const bodyText = await res.text()
      saveScreeningApiFailure(ds, 'screen_stock', 'screener/stock', startedAt, bodyText, res.status)
      return toolError(dataStoreRemoteCopy.stockScreenerError(bodyText.slice(0, 500)))
    }
    const json = await res.json() as Record<string, unknown>
    if (json.error) {
      saveScreeningApiFailure(ds, 'screen_stock', 'screener/stock', startedAt, String(json.error))
      return toolError(dataStoreRemoteCopy.stockScreenerError(String(json.error)))
    }
    const normalized = normalizeScreeningSnapshot({
      provider: 'akshare',
      capabilityId: 'akshare.market.screening',
      sourceAction: 'screen_stock',
      universe: [body.universe],
      filters: { gates: body.gates, include_fair_value: body.include_fair_value },
      sort: { sort_by: body.sort_by, sort_desc: body.sort_desc },
      rows: Array.isArray(json.stocks) ? json.stocks : [],
    })
    ds?.saveMarketScreeningSnapshots(normalized.persistenceRows)
    const stocks = Array.isArray(json.stocks) ? json.stocks as Array<Record<string, unknown>> : []
    const lines = [dataStoreRemoteCopy.stockScreenerSummary(Number(json.total_universe ?? 0), Number(json.passed_gates ?? 0), Number(json.returned ?? 0)), '']
    const gateDiagnostics = Array.isArray(json.gate_diagnostics) ? json.gate_diagnostics as Array<Record<string, unknown>> : []
    if (gateDiagnostics.length > 0) {
      lines.push('Gate coverage:')
      for (const gate of gateDiagnostics) {
        lines.push(`- ${gate.factor ?? '-'} ${gate.op ?? ''} ${gate.value ?? ''}: available ${gate.available_rows ?? 0}/${gate.total_rows ?? 0}, missing ${gate.missing_rows ?? 0}, status ${gate.status ?? '-'}`)
      }
      lines.push('')
    }
    for (const s of stocks) {
      const score = s.composite_score != null ? ` score:${s.composite_score}` : ''
      const factors = s.factors && typeof s.factors === 'object'
        ? Object.entries(s.factors as Record<string, unknown>).filter(([, v]) => v != null).map(([k, v]) => `${k}:${v}`).join(' ')
        : ''
      lines.push(`${s.code} ${s.name} ¥${s.price ?? '-'}${score} ${factors}`)
    }
    return lines.join('\n')
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.startsWith('Screener error:')) throw e
    saveScreeningApiFailure(ds, 'screen_stock', 'screener/stock', startedAt, message)
    return toolError(dataStoreRemoteCopy.stockScreenerError(message))
  }
}

export async function screenFund(dsOrInput: DataStore | Record<string, unknown>, maybeInput?: Record<string, unknown>): Promise<string> {
  const ds = dsOrInput instanceof DataStore ? dsOrInput : null
  const input: Record<string, unknown> = ds ? (maybeInput ?? {}) : dsOrInput as Record<string, unknown>
  const startedAt = Date.now()
  const body: Record<string, unknown> = {
    mode: input.mode ?? '4433',
    fund_type: input.fund_type,
    min_aum: input.min_aum,
    sort_by: input.sort_by,
    limit: input.limit ?? 30,
    gates: input.gates,
    min_experience: input.min_experience,
  }

  try {
    const res = await fetch('http://127.0.0.1:19800/screener/fund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      const bodyText = await res.text()
      saveScreeningApiFailure(ds, 'screen_fund', 'screener/fund', startedAt, bodyText, res.status)
      return toolError(dataStoreRemoteCopy.fundScreenFailed(bodyText.slice(0, 500)))
    }
    const json = await res.json() as Record<string, unknown>
    if (json.error) {
      saveScreeningApiFailure(ds, 'screen_fund', 'screener/fund', startedAt, String(json.error))
      return toolError(dataStoreRemoteCopy.fundScreenerError(String(json.error)))
    }
    if (Array.isArray(json.managers)) {
      return JSON.stringify({
        action: 'screen_fund_managers',
        interfaceId: 'fund.manager_screening',
        provider: String(json.data_source ?? 'akshare'),
        capabilityId: 'akshare.fund.manager_screening',
        mode: String(json.mode ?? body.mode),
        total: Number(json.total ?? 0),
        returned: Number(json.returned ?? 0),
        data: json.managers,
      }, null, 2)
    }
    const normalized = normalizeScreeningSnapshot({
      provider: 'akshare',
      capabilityId: 'akshare.market.screening',
      sourceAction: 'screen_fund',
      universe: [body.fund_type ?? 'fund'],
      filters: { mode: body.mode, min_aum: body.min_aum, gates: body.gates, min_experience: body.min_experience },
      sort: { sort_by: body.sort_by },
      rows: Array.isArray(json.funds) ? json.funds : [],
    })
    ds?.saveMarketScreeningSnapshots(normalized.persistenceRows)
    const funds = Array.isArray(json.funds) ? json.funds as Array<Record<string, unknown>> : []
    const coverage = json.coverage && typeof json.coverage === 'object' ? json.coverage as Record<string, unknown> : {}
    const diagnostics = Array.isArray(json.diagnostics) ? json.diagnostics as Array<Record<string, unknown>> : []
    return JSON.stringify({
      action: 'screen_fund',
      interfaceId: 'fund.candidate_research',
      provider: String(json.data_source ?? 'akshare'),
      capabilityId: 'akshare.fund.screening',
      canonicalSchema: 'fund_performance_metrics',
      canonicalTable: 'fund_performance_metrics',
      mode: String(json.mode ?? body.mode),
      totalUniverse: Number(json.total_universe ?? 0),
      passed: Number(json.passed ?? 0),
      returned: Number(json.returned ?? funds.length),
      coverage,
      diagnostics,
      candidates: funds,
      screening: normalized.data,
    }, null, 2)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (message.startsWith('Fund screen failed:') || message.startsWith('Fund screener error:')) throw e
    saveScreeningApiFailure(ds, 'screen_fund', 'screener/fund', startedAt, message)
    return toolError(dataStoreRemoteCopy.fundScreenFailed(message))
  }
}

function normalizeStockScreenGates(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
      .map((gate) => ({
        ...gate,
        factor: gate.factor ?? gate.field,
      }))
      .filter((gate) => typeof gate.factor === 'string' && gate.factor.length > 0)
  }
  if (!raw || typeof raw !== 'object') return []
  const filters = raw as Record<string, unknown>
  const gates: Array<Record<string, unknown>> = []
  const push = (factor: string, op: string, value: unknown) => {
    if (value != null && value !== '') gates.push({ factor, op, value })
  }
  push('pe_ttm', '<=', filters.pe_lte ?? filters.pe_max ?? filters.max_pe)
  push('pe_ttm', '>=', filters.pe_gte ?? filters.pe_min ?? filters.min_pe)
  push('pb', '<=', filters.pb_lte ?? filters.pb_max ?? filters.max_pb)
  push('pb', '>=', filters.pb_gte ?? filters.pb_min ?? filters.min_pb)
  push('roe', '>=', filters.roe_gte ?? filters.roe_min ?? filters.min_roe)
  push('roe', '<=', filters.roe_lte ?? filters.roe_max ?? filters.max_roe)
  push('market_cap', '>=', filters.market_cap_gte ?? filters.market_cap_min ?? filters.min_market_cap)
  push('market_cap', '<=', filters.market_cap_lte ?? filters.market_cap_max ?? filters.max_market_cap)
  push('turnover_rate', '>=', filters.turnover_rate_gte ?? filters.turnover_rate_min ?? filters.min_turnover_rate)
  return gates
}

function saveScreeningApiFailure(
  ds: DataStore | null,
  action: 'screen_stock' | 'screen_fund',
  endpoint: 'screener/stock' | 'screener/fund',
  startedAt: number,
  error: string,
  status = 0,
): void {
  ds?.saveApiCall({
    source: 'akshare',
    tool: 'DataStore',
    action,
    endpoint,
    status,
    success: false,
    duration_ms: Date.now() - startedAt,
    error: error.slice(0, 500),
  })
}
