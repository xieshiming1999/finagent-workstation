export type OutputOnlyProvider = 'akshare' | 'yfinance' | 'ta' | 'tdx' | 'tradingview' | 'sidecar' | 'tushare' | 'sina' | 'tencent'

export type OutputOnlyInterfaceId =
  | 'provider.discovery'
  | 'provider.diagnostic'
  | 'provider.status'
  | 'provider.reference_dataset'
  | 'market.intraday_ohlcv_bars'
  | 'market.classification_members'
  | 'stock.transaction_count'
  | 'stock.esg_rating_collection'
  | 'fund.etf_daily_ohlcv_bars'
  | 'fund.dividend_factor'

export interface OutputOnlyCapability {
  id: string
  interfaceId: OutputOnlyInterfaceId
  provider: OutputOnlyProvider
  status: 'supported' | 'diagnostic-only' | 'credential-gated' | 'not-supported'
  priority: number
  schemaId: string
  adapter: string
  normalizer: string
  persistencePolicy: 'output-only'
  reason?: string
}

export interface OutputOnlyInterface {
  id: OutputOnlyInterfaceId
  label: string
  schemaId: string
  schemaVersion: string
  persistencePolicy: 'output-only'
  unknownSchemaPolicy: 'reject-normal-workflow'
  capabilities: OutputOnlyCapability[]
}

export interface FinanceApiKnowledgeRecord {
  apiId: string
  interfaceId: OutputOnlyInterfaceId
  capabilityId: string
  runtime: 'finagent_workstation'
  provider: OutputOnlyProvider
  endpointOrAction: string
  class: 'normalized-output-only-interface' | 'raw-diagnostic-provider-surface'
  schemaId: string
  schemaVersion: string
  persistencePolicy: 'output-only'
  cachePolicy: 'no-canonical-cache'
  marketScope: string[]
  parameterContract: {
    required: string[]
    optional: string[]
    defaults: Record<string, unknown>
    enums: Record<string, string[]>
    invalidCombinations: string[]
  }
  responseContract: {
    topLevelFields: string[]
    rowFields: string[]
    nestedFields: string[]
    types: Record<string, string>
    nullableFields: string[]
    units: Record<string, string>
    timestampFields: string[]
    semanticNotes: string[]
    emptyResultMeaning: string
    ordering: string
    pagination: string
  }
  availability: {
    status: 'known' | 'credential-gated' | 'diagnostic-only'
    lastProbeAt: string | null
    providerVersion: string | null
    sidecarVersion: string | null
    failureClass: string | null
    statusCode: number | null
    errorPattern: string | null
    minimalSuccessCase: string
    negativeCaseBehavior: string
  }
  usagePolicy: {
    normalWorkflowAllowed: boolean
    diagnosticOnly: boolean
    quotaSensitive: boolean
    requiresCredential: boolean
    recommendedFallbacks: string[]
    safetyLevel: 'normal' | 'diagnostic'
    retryPolicy: string
  }
  evidence: {
    probeId: string | null
    sampleRowCount: number | null
    sampleColumns: string[]
    sampleParameterSets: Array<Record<string, unknown>>
    boundedRawPreviewPath: string | null
  }
}

export interface OutputOnlyProvenance {
  interfaceId: OutputOnlyInterfaceId
  capabilityId: string
  provider: OutputOnlyProvider
  schemaId: string
  schemaVersion: string
  persistencePolicy: 'output-only'
  cacheStatus: 'not-cacheable'
  cacheDecision: string
  sourceAction: string
  fetchedAt: string
}

export interface NormalizedOutputOnlyResult {
  ok: boolean
  action: string
  interfaceId: OutputOnlyInterfaceId
  schemaId: string
  schemaVersion: string
  status: 'success' | 'empty' | 'error'
  failureClass: string
  provider: OutputOnlyProvider
  warnings: string[]
  data: Record<string, unknown>
  provenance: OutputOnlyProvenance
  persistencePolicy?: string
  cacheStatus?: string
}

export interface NormalizedTechnicalIndicatorResult {
  ok: boolean
  action: 'technical_indicator'
  interfaceId: 'technical.indicator_series'
  capabilityId: string
  schemaId: 'technical_indicator_series'
  schemaVersion: string
  status: 'success' | 'empty' | 'error'
  failureClass: string
  provider: 'ta'
  warnings: string[]
  data: Record<string, unknown>
  provenance: {
    interfaceId: 'technical.indicator_series'
    capabilityId: string
    provider: 'ta'
    schemaId: 'technical_indicator_series'
    schemaVersion: string
    persistencePolicy: 'canonical'
    cacheStatus: 'provider-hit'
    sourceAction: string
    fetchedAt: string
  }
}

export const OUTPUT_ONLY_INTERFACES: OutputOnlyInterface[] = [
  {
    id: 'provider.discovery',
    label: 'Provider discovery',
    schemaId: 'provider_discovery_result',
    schemaVersion: '2026-06-18',
    persistencePolicy: 'output-only',
    unknownSchemaPolicy: 'reject-normal-workflow',
    capabilities: [
      outputCapability('akshare.provider.discovery', 'provider.discovery', 'akshare', 'supported', 1, 'akshare_search', 'normalizeProviderDiscovery'),
      outputCapability('yfinance.provider.discovery', 'provider.discovery', 'yfinance', 'supported', 2, 'yfinance_search', 'normalizeProviderDiscovery'),
      outputCapability('ta.provider.discovery', 'provider.discovery', 'ta', 'supported', 3, 'ta_search', 'normalizeProviderDiscovery'),
    ],
  },
  {
    id: 'provider.diagnostic',
    label: 'Provider diagnostic',
    schemaId: 'provider_diagnostic_result',
    schemaVersion: '2026-06-18',
    persistencePolicy: 'output-only',
    unknownSchemaPolicy: 'reject-normal-workflow',
    capabilities: [
      outputCapability('akshare.provider.diagnostic', 'provider.diagnostic', 'akshare', 'diagnostic-only', 1, 'akshare/{func_name}', 'normalizeProviderDiagnostic'),
      outputCapability('yfinance.provider.diagnostic', 'provider.diagnostic', 'yfinance', 'diagnostic-only', 2, 'yfinance/{action}', 'normalizeProviderDiagnostic'),
      outputCapability('tdx.provider.diagnostic', 'provider.diagnostic', 'tdx', 'diagnostic-only', 3, 'gotdx/{tdx_action}', 'normalizeProviderDiagnostic'),
      outputCapability('ta.provider.diagnostic', 'provider.diagnostic', 'ta', 'diagnostic-only', 4, 'ta/{indicator}', 'normalizeProviderDiagnostic'),
      outputCapability('tushare.provider.diagnostic', 'provider.diagnostic', 'tushare', 'credential-gated', 5, 'tushare/{api_name}', 'normalizeProviderDiagnostic', 'Requires TUSHARE_TOKEN.'),
      outputCapability('sina.provider.diagnostic', 'provider.diagnostic', 'sina', 'diagnostic-only', 6, 'Sina finance allowed diagnostic URL or quote/kline shorthand', 'normalizeProviderDiagnostic'),
      outputCapability('tencent.provider.diagnostic', 'provider.diagnostic', 'tencent', 'diagnostic-only', 7, 'Tencent finance allowed diagnostic URL or quote/kline shorthand', 'normalizeProviderDiagnostic'),
    ],
  },
  {
    id: 'provider.status',
    label: 'Provider status',
    schemaId: 'provider_status_result',
    schemaVersion: '2026-06-18',
    persistencePolicy: 'output-only',
    unknownSchemaPolicy: 'reject-normal-workflow',
    capabilities: [
      outputCapability('sidecar.provider.status', 'provider.status', 'sidecar', 'supported', 1, 'sidecar health/rate-limit/gotdx health', 'normalizeProviderStatus'),
    ],
  },
  {
    id: 'provider.reference_dataset',
    label: 'Provider reference dataset',
    schemaId: 'provider_reference_dataset_result',
    schemaVersion: '2026-06-23',
    persistencePolicy: 'output-only',
    unknownSchemaPolicy: 'reject-normal-workflow',
    capabilities: [
      outputCapability('akshare.sina.reference_dataset', 'provider.reference_dataset', 'akshare', 'supported', 1, 'akshare *_sina reference functions', 'normalizeAkshareSinaReferenceDataset', 'AkShare/Sina reference functions have bounded live schema evidence but are not canonical reusable tables until a requirement-level interface, normalizer, storage, and readback are added.'),
    ],
  },
  {
    id: 'market.intraday_ohlcv_bars',
    label: 'Provider intraday OHLCV bars',
    schemaId: 'intraday_ohlcv_bar_result',
    schemaVersion: '2026-06-23',
    persistencePolicy: 'output-only',
    unknownSchemaPolicy: 'reject-normal-workflow',
    capabilities: [
      outputCapability('sina.market.intraday_ohlcv_bars', 'market.intraday_ohlcv_bars', 'sina', 'supported', 1, 'CN_MarketData.getKLineData scale=5', 'normalizeSinaIntradayOhlcvBars'),
    ],
  },
  {
    id: 'stock.transaction_count',
    label: 'Stock transaction count',
    schemaId: 'stock_transaction_count_result',
    schemaVersion: '2026-06-23',
    persistencePolicy: 'output-only',
    unknownSchemaPolicy: 'reject-normal-workflow',
    capabilities: [
      outputCapability('sina.stock.transaction_count', 'stock.transaction_count', 'sina', 'supported', 1, 'CN_Bill.GetBillListCount', 'normalizeSinaStockTransactionCount'),
    ],
  },
  {
    id: 'market.classification_members',
    label: 'Market classification member batch',
    schemaId: 'market_classification_member_batch_result',
    schemaVersion: '2026-06-23',
    persistencePolicy: 'output-only',
    unknownSchemaPolicy: 'reject-normal-workflow',
    capabilities: [
      outputCapability('sina.market.classification_members', 'market.classification_members', 'sina', 'supported', 1, 'Market_Center.getHQNodes + Market_Center.getHQNodeData bounded pages', 'normalizeSinaClassificationMemberBatch'),
    ],
  },
  {
    id: 'stock.esg_rating_collection',
    label: 'Stock ESG rating collection batch',
    schemaId: 'stock_esg_rating_collection_result',
    schemaVersion: '2026-06-23',
    persistencePolicy: 'output-only',
    unknownSchemaPolicy: 'reject-normal-workflow',
    capabilities: [
      outputCapability('sina.stock.esg_rating_collection', 'stock.esg_rating_collection', 'sina', 'supported', 1, 'EsgService.getEsgStocks bounded pages', 'normalizeSinaEsgRatingCollection'),
    ],
  },
  {
    id: 'fund.dividend_factor',
    label: 'Fund dividend and factor rows',
    schemaId: 'fund_dividend_factor_result',
    schemaVersion: '2026-06-23',
    persistencePolicy: 'output-only',
    unknownSchemaPolicy: 'reject-normal-workflow',
    capabilities: [
      outputCapability('sina.fund.dividend_factor', 'fund.dividend_factor', 'sina', 'supported', 1, 'FundPage fundEtfFactorInfoService tab=fundFactor', 'normalizeSinaFundDividendFactor'),
    ],
  },
  {
    id: 'fund.etf_daily_ohlcv_bars',
    label: 'ETF daily OHLCV bars',
    schemaId: 'fund_etf_daily_ohlcv_bar_result',
    schemaVersion: '2026-06-23',
    persistencePolicy: 'output-only',
    unknownSchemaPolicy: 'reject-normal-workflow',
    capabilities: [
      outputCapability('sina.fund.etf_daily_ohlcv_bars', 'fund.etf_daily_ohlcv_bars', 'sina', 'diagnostic-only', 1, 'realstock/company/{symbol}/hisdata_klc2/klc_kl.js', 'normalizeSinaFundEtfDailyOhlcvBars', 'Direct Sina returns encrypted KLC_K2 JavaScript payload; use only after an explicit decoder path provides rows.'),
      outputCapability('akshare.sina.fund.etf_daily_ohlcv_bars', 'fund.etf_daily_ohlcv_bars', 'akshare', 'diagnostic-only', 2, 'fund_etf_hist_sina', 'normalizeSinaFundEtfDailyOhlcvBars', 'AkShare/Sina ETF OHLCV is reusable through the governed fund.etf_daily_ohlcv_bars Data API interface; keep this output-only path for bounded diagnostics only.'),
      outputCapability('tencent.fund.etf_daily_ohlcv_bars', 'fund.etf_daily_ohlcv_bars', 'tencent', 'diagnostic-only', 3, 'newfqkline ETF day/qfq/hfq', 'normalizeTencentFundEtfDailyOhlcvBars', 'Tencent ETF daily K-line is reusable through the governed fund.etf_daily_ohlcv_bars Data API interface; keep this output-only path for bounded diagnostics only.'),
    ],
  },
]

export const OUTPUT_ONLY_KNOWLEDGE_RECORDS: FinanceApiKnowledgeRecord[] = [
  knowledgeRecord('akshare.discovery', 'provider.discovery', 'akshare.provider.discovery', 'akshare', 'akshare_search', 'provider_discovery_result', ['query', 'func'], ['items'], 'Search AkShare callable functions by keyword.'),
  knowledgeRecord('yfinance.discovery', 'provider.discovery', 'yfinance.provider.discovery', 'yfinance', 'yfinance_search', 'provider_discovery_result', ['query', 'func'], ['items'], 'Search yfinance sidecar actions by keyword.'),
  knowledgeRecord('ta.discovery', 'provider.discovery', 'ta.provider.discovery', 'ta', 'ta_search', 'provider_discovery_result', ['query', 'func'], ['items'], 'Search technical indicators by keyword.'),
  knowledgeRecord('sidecar.status', 'provider.status', 'sidecar.provider.status', 'sidecar', 'sidecar_status', 'provider_status_result', [], ['providers'], 'Check Python sidecar, rate limiters, and gotdx sidecar status.'),
  knowledgeRecord('akshare.provider_diagnostic', 'provider.diagnostic', 'akshare.provider.diagnostic', 'akshare', 'akshare/{func_name}', 'provider_diagnostic_result', ['func'], ['sampleRows', 'sampleColumns'], 'Bounded diagnostic call for generic AkShare provider functions.'),
  knowledgeRecord('yfinance.provider_diagnostic', 'provider.diagnostic', 'yfinance.provider.diagnostic', 'yfinance', 'yfinance/{action}', 'provider_diagnostic_result', ['func', 'symbol'], ['sampleRows', 'sampleColumns'], 'Bounded diagnostic call for generic yfinance sidecar actions.'),
  knowledgeRecord('tdx.provider_diagnostic', 'provider.diagnostic', 'tdx.provider.diagnostic', 'tdx', 'gotdx/{tdx_action}', 'provider_diagnostic_result', ['tdx_action'], ['sampleRows', 'sampleColumns'], 'Bounded diagnostic call for gotdx provider actions.'),
  knowledgeRecord('ta.provider_diagnostic', 'provider.diagnostic', 'ta.provider.diagnostic', 'ta', 'ta/{indicator}', 'provider_diagnostic_result', ['func', 'symbol'], ['sampleRows', 'sampleColumns'], 'Bounded diagnostic call for technical-indicator provider actions.'),
  knowledgeRecord('tushare.provider_diagnostic', 'provider.diagnostic', 'tushare.provider.diagnostic', 'tushare', 'tushare/{api_name}', 'provider_diagnostic_result', ['api_name'], ['sampleRows', 'sampleColumns'], 'Bounded credential-gated diagnostic call for Tushare APIs.'),
  knowledgeRecord('sina.provider_diagnostic', 'provider.diagnostic', 'sina.provider.diagnostic', 'sina', 'Sina finance allowed URL or quote/kline shorthand', 'provider_diagnostic_result', ['endpoint'], ['sampleRows', 'sampleColumns'], 'Bounded diagnostic call for Sina quote/kline shorthand or allowlisted Sina finance URLs.'),
  knowledgeRecord('tencent.provider_diagnostic', 'provider.diagnostic', 'tencent.provider.diagnostic', 'tencent', 'Tencent finance allowed URL or quote/kline shorthand', 'provider_diagnostic_result', ['endpoint'], ['sampleRows', 'sampleColumns'], 'Bounded diagnostic call for Tencent quote/kline shorthand or allowlisted Tencent finance URLs.'),
  knowledgeRecord('akshare.sina.reference_dataset', 'provider.reference_dataset', 'akshare.sina.reference_dataset', 'akshare', 'akshare/*_sina', 'provider_reference_dataset_result', ['functionName'], ['functionName', 'rowCount', 'sampleColumns', 'sampleRows'], 'AkShare/Sina reference datasets are known-schema output-only evidence, not canonical reusable storage.'),
  knowledgeRecord('sina.intraday_ohlcv_bars', 'market.intraday_ohlcv_bars', 'sina.market.intraday_ohlcv_bars', 'sina', 'CN_MarketData.getKLineData?scale=5', 'intraday_ohlcv_bar_result', ['symbol'], ['time', 'open', 'high', 'low', 'close', 'volume'], 'Sina 5-minute OHLCV bars are known schema but not equivalent to canonical tick-chart rows.'),
  knowledgeRecord('sina.stock_transaction_count', 'stock.transaction_count', 'sina.stock.transaction_count', 'sina', 'CN_Bill.GetBillListCount', 'stock_transaction_count_result', ['symbol'], ['symbol', 'date', 'count', 'pageSize', 'estimatedPages'], 'Sina transaction count is a bounded pagination helper for stock.transactions, not canonical transaction data.'),
  knowledgeRecord('sina.classification_members', 'market.classification_members', 'sina.market.classification_members', 'sina', 'Market_Center.getHQNodes + Market_Center.getHQNodeData', 'market_classification_member_batch_result', [], ['nodeCode', 'nodeName', 'symbol', 'name', 'trade', 'changePercent'], 'Sina classification member expansion is a deliberate bounded batch workflow with checkpoint and page-failure classification.'),
  knowledgeRecord('sina.esg_rating_collection', 'stock.esg_rating_collection', 'sina.stock.esg_rating_collection', 'sina', 'EsgService.getEsgStocks', 'stock_esg_rating_collection_result', [], ['symbol', 'market', 'agency', 'agencyName', 'esgScore', 'esgDate'], 'Sina ESG rating collection is a deliberate bounded batch workflow with checkpoint and page-failure classification.'),
  knowledgeRecord('sina.fund_dividend_factor', 'fund.dividend_factor', 'sina.fund.dividend_factor', 'sina', 'FundPage fundEtfFactorInfoService', 'fund_dividend_factor_result', ['symbol'], ['date', 'dividend', 'factor'], 'Normal workflow uses governed fund.dividend_factor and query_fund_dividend_factor; keep this envelope only for bounded diagnostics.'),
  knowledgeRecord('sina.fund_etf_daily_ohlcv_bars', 'fund.etf_daily_ohlcv_bars', 'akshare.sina.fund.etf_daily_ohlcv_bars', 'akshare', 'fund_etf_hist_sina', 'fund_etf_daily_ohlcv_bar_result', ['symbol'], ['date', 'open', 'high', 'low', 'close', 'volume', 'amount'], 'Decoded ETF daily exchange OHLCV rows are reusable through the governed fund.etf_daily_ohlcv_bars Data API interface; use this output-only envelope only for bounded diagnostics.'),
]

export function getOutputOnlyInterface(id: OutputOnlyInterfaceId): OutputOnlyInterface {
  const item = OUTPUT_ONLY_INTERFACES.find((entry) => entry.id === id)
  if (!item) throw new Error(`Unknown output-only interface: ${id}`)
  return item
}

export function selectOutputOnlyCapability(interfaceId: OutputOnlyInterfaceId, provider?: string): OutputOnlyCapability {
  const iface = getOutputOnlyInterface(interfaceId)
  const normalizedProvider = normalizeOutputProvider(provider)
  if (provider != null && String(provider).trim() && !normalizedProvider) {
    throw new Error(`Unknown output-only provider constraint: ${provider}`)
  }
  const candidates = iface.capabilities
    .filter((capability) => !normalizedProvider || capability.provider === normalizedProvider)
    .filter((capability) => capability.status !== 'not-supported')
    .sort((a, b) => a.priority - b.priority)
  if (candidates.length === 0) {
    throw new Error(`No output-only capability for ${interfaceId}${provider ? ` provider=${provider}` : ''}`)
  }
  return candidates[0]
}

export function normalizeProviderDiscovery(args: {
  provider: OutputOnlyProvider
  query: string
  raw: unknown
  capabilityId: string
  sourceAction: string
}): NormalizedOutputOnlyResult {
  const raw = asRecord(args.raw)
  const list = Array.isArray(raw.functions)
    ? raw.functions
    : Array.isArray(raw.actions)
      ? raw.actions
      : Array.isArray(raw.indicators)
        ? raw.indicators
        : []
  const items = list.slice(0, 100).map((item) => {
    if (typeof item === 'string') {
      return { id: item, name: item, description: null, category: null, parameters: [], supportStatus: 'known' }
    }
    const row = asRecord(item)
    return {
      id: String(row.name ?? row.id ?? row.func ?? ''),
      name: String(row.name ?? row.id ?? row.func ?? ''),
      description: row.description ?? null,
      category: row.category ?? null,
      parameters: Array.isArray(row.parameters) ? row.parameters : [],
      supportStatus: 'known',
    }
  }).filter((item) => item.id)
  return outputResult({
    ok: true,
    action: 'provider_discovery',
    interfaceId: 'provider.discovery',
    capabilityId: args.capabilityId,
    provider: args.provider,
    schemaId: 'provider_discovery_result',
    status: items.length ? 'success' : 'empty',
    failureClass: 'success',
    sourceAction: args.sourceAction,
    data: {
      provider: args.provider,
      action: args.sourceAction,
      query: args.query,
      total: Number(raw.total ?? items.length),
      items,
    },
  })
}

export function normalizeProviderDiagnostic(args: {
  provider: OutputOnlyProvider
  endpointOrAction: string
  requestShape: Record<string, unknown>
  raw: unknown
  capabilityId: string
  sourceAction: string
  error?: string
  statusCode?: number
}): NormalizedOutputOnlyResult {
  const rows = extractRows(args.raw)
  const sampleRows = rows.slice(0, 5).map((row) => isRecord(row) ? row : { value: row })
  const sampleColumns = sampleRows[0] ? Object.keys(sampleRows[0]) : sampleColumnsFromRaw(args.raw)
  const error = args.error ?? errorFromRaw(args.raw)
  return outputResult({
    ok: !error,
    action: 'provider_diagnostic',
    interfaceId: 'provider.diagnostic',
    capabilityId: args.capabilityId,
    provider: args.provider,
    schemaId: 'provider_diagnostic_result',
    status: error ? 'error' : rows.length ? 'success' : 'empty',
    failureClass: error ? classifyFailure(error, args.statusCode) : 'success',
    sourceAction: args.sourceAction,
    warnings: ['Diagnostic output is bounded and not canonical reusable data.'],
    data: {
      provider: args.provider,
      endpointOrAction: args.endpointOrAction,
      requestShape: args.requestShape,
      responseKind: responseKind(args.raw),
      rowCount: rows.length,
      sampleColumns,
      sampleRows,
      rawPreview: boundedPreview(args.raw),
      statusCode: args.statusCode ?? null,
      error: error ?? null,
    },
  })
}

export function normalizeAkshareSinaReferenceDataset(args: {
  functionName: string
  params: Record<string, unknown>
  raw: unknown
  capabilityId?: string
  sourceAction?: string
  error?: string
  statusCode?: number
}): NormalizedOutputOnlyResult {
  const rows = extractRows(args.raw)
  const sampleRows = rows.slice(0, 10).map((row) => isRecord(row) ? row : { value: row })
  const sampleColumns = sampleRows[0] ? Object.keys(sampleRows[0]) : sampleColumnsFromRaw(args.raw)
  const error = args.error ?? errorFromRaw(args.raw)
  return outputResult({
    ok: !error,
    action: 'provider_reference_dataset',
    interfaceId: 'provider.reference_dataset',
    capabilityId: args.capabilityId ?? 'akshare.sina.reference_dataset',
    provider: 'akshare',
    schemaId: 'provider_reference_dataset_result',
    status: error ? 'error' : rows.length ? 'success' : 'empty',
    failureClass: error ? classifyFailure(error, args.statusCode) : 'success',
    sourceAction: args.sourceAction ?? args.functionName,
    warnings: [
      'AkShare/Sina reference output is bounded and not canonical reusable data.',
      'Promote only after a requirement-level interface, normalizer, storage, readback, and tests exist.',
    ],
    data: {
      provider: 'akshare',
      upstreamOrigin: 'sina',
      functionName: args.functionName,
      params: args.params,
      rowCount: rows.length,
      sampleColumns,
      sampleRows,
      rawPreview: boundedPreview(args.raw),
      statusCode: args.statusCode ?? null,
      error: error ?? null,
    },
  })
}

export function normalizeTechnicalIndicator(args: {
  indicator: string
  symbol: string
  params: Record<string, unknown>
  raw: unknown
  capabilityId: string
  sourceAction: string
  error?: string
}): NormalizedTechnicalIndicatorResult {
  const raw = asRecord(args.raw)
  const rows = extractRows(args.raw)
  const data = raw.data ?? rows
  const series = Array.isArray(data)
    ? data.slice(-100).map((value, index) => isRecord(value)
      ? { timestamp: value.timestamp ?? value.date ?? null, values: value }
      : { timestamp: null, values: { index, value } })
    : []
  const error = args.error ?? errorFromRaw(args.raw)
  const schemaVersion = '2026-06-18'
  const fetchedAt = new Date().toISOString()
  return {
    ok: !error,
    action: 'technical_indicator',
    interfaceId: 'technical.indicator_series',
    capabilityId: args.capabilityId,
    provider: 'ta',
    schemaId: 'technical_indicator_series',
    schemaVersion,
    status: error ? 'error' : series.length ? 'success' : 'empty',
    failureClass: error ? classifyFailure(error) : 'success',
    warnings: [],
    data: {
      provider: 'ta',
      indicator: args.indicator,
      name: raw.name ?? args.indicator,
      symbol: args.symbol,
      interval: args.params.interval ?? args.params.timeframe ?? null,
      parameters: args.params,
      series,
      signals: [],
      sampleColumns: sampleColumnsFromRaw(args.raw),
      rawPreview: boundedPreview(args.raw),
    },
    provenance: {
      interfaceId: 'technical.indicator_series',
      capabilityId: args.capabilityId,
      provider: 'ta',
      schemaId: 'technical_indicator_series',
      schemaVersion,
      persistencePolicy: 'canonical',
      cacheStatus: 'provider-hit',
      sourceAction: args.sourceAction,
      fetchedAt,
    },
  }
}

export function normalizeProviderStatus(args: {
  raw: Record<string, unknown>
  capabilityId?: string
}): NormalizedOutputOnlyResult {
  return outputResult({
    ok: true,
    action: 'provider_status',
    interfaceId: 'provider.status',
    capabilityId: args.capabilityId ?? 'sidecar.provider.status',
    provider: 'sidecar',
    schemaId: 'provider_status_result',
    status: 'success',
    failureClass: 'success',
    sourceAction: 'provider_status',
    data: args.raw,
  })
}

export function normalizeSinaIntradayOhlcvBars(args: {
  symbol: string
  raw: unknown
  capabilityId?: string
  sourceAction?: string
}): NormalizedOutputOnlyResult {
  const rows = extractRows(args.raw)
  const bars = rows.slice(0, 240).map((item) => {
    const row = isRecord(item) ? item : {}
    return {
      time: row.day ?? row.time ?? row.date ?? null,
      open: numberOrNull(row.open),
      high: numberOrNull(row.high),
      low: numberOrNull(row.low),
      close: numberOrNull(row.close),
      volume: numberOrNull(row.volume),
    }
  }).filter((row) => row.time != null)
  return outputResult({
    ok: true,
    action: 'sina_intraday_ohlcv_bars',
    interfaceId: 'market.intraday_ohlcv_bars',
    capabilityId: args.capabilityId ?? 'sina.market.intraday_ohlcv_bars',
    provider: 'sina',
    schemaId: 'intraday_ohlcv_bar_result',
    status: bars.length ? 'success' : 'empty',
    failureClass: 'success',
    sourceAction: args.sourceAction ?? 'sina_intraday_ohlcv_bars',
    warnings: ['Output-only: Sina 5-minute OHLCV bars are not canonical tick_chart_intraday rows.'],
    data: {
      provider: 'sina',
      symbol: args.symbol,
      rowCount: bars.length,
      bars,
    },
  })
}

export function normalizeSinaStockTransactionCount(args: {
  symbol: string
  raw: unknown
  date?: string
  pageSize?: number
  capabilityId?: string
  sourceAction?: string
}): NormalizedOutputOnlyResult {
  const raw = asRecord(args.raw)
  const count = numberOrNull(raw.count ?? raw.total ?? raw.result ?? raw.value ?? args.raw)
  const pageSize = Number.isFinite(args.pageSize) && args.pageSize && args.pageSize > 0 ? Math.floor(args.pageSize) : 60
  const estimatedPages = count == null ? null : Math.ceil(count / pageSize)
  return outputResult({
    ok: count != null,
    action: 'sina_stock_transaction_count',
    interfaceId: 'stock.transaction_count',
    capabilityId: args.capabilityId ?? 'sina.stock.transaction_count',
    provider: 'sina',
    schemaId: 'stock_transaction_count_result',
    status: count == null ? 'empty' : 'success',
    failureClass: 'success',
    sourceAction: args.sourceAction ?? 'sina_stock_transaction_count',
    warnings: ['Output-only: transaction count is a pagination helper for stock.transactions and is not canonical transaction data.'],
    data: {
      provider: 'sina',
      symbol: args.symbol,
      date: args.date ?? null,
      count,
      pageSize,
      estimatedPages,
    },
  })
}

export function normalizeSinaClassificationMemberBatch(args: {
  raw: unknown
  params?: Record<string, unknown>
  capabilityId?: string
  sourceAction?: string
}): NormalizedOutputOnlyResult {
  const raw = asRecord(args.raw)
  const rows = extractRows(raw.rows ?? raw.members ?? raw)
  const members = rows.slice(0, 2000).map((item) => {
    const row = isRecord(item) ? item : {}
    return {
      nodeCode: row.nodeCode ?? row.node_code ?? null,
      nodeName: row.nodeName ?? row.node_name ?? null,
      symbol: row.symbol ?? row.code ?? null,
      name: row.name ?? null,
      trade: numberOrNull(row.trade ?? row.price),
      changePercent: numberOrNull(row.changePercent ?? row.changepercent ?? row.change_pct),
      raw: row.raw ?? row,
    }
  }).filter((row) => row.nodeCode != null || row.symbol != null)
  const failedPages = Array.isArray(raw.failedPages) ? raw.failedPages : []
  const completed = raw.completed === true
  return outputResult({
    ok: failedPages.length === 0,
    action: 'sina_classification_members_batch',
    interfaceId: 'market.classification_members',
    capabilityId: args.capabilityId ?? 'sina.market.classification_members',
    provider: 'sina',
    schemaId: 'market_classification_member_batch_result',
    status: failedPages.length ? 'error' : members.length ? 'success' : 'empty',
    failureClass: failedPages.length ? 'partial_provider_failure' : 'success',
    sourceAction: args.sourceAction ?? 'sina_classification_members_batch',
    warnings: [
      'Output-only: classification expansion is a bounded batch workflow and is not canonical sector/constituent storage.',
      completed ? 'Batch completed within supplied bounds.' : 'Batch stopped at a checkpoint; resume with checkpoint.nextNodeIndex and checkpoint.nextPage.',
    ],
    data: {
      provider: 'sina',
      params: args.params ?? raw.params ?? {},
      nodeCount: Number(raw.nodeCount ?? 0),
      fetchedPages: Number(raw.fetchedPages ?? 0),
      rowCount: members.length,
      completed,
      checkpoint: raw.checkpoint ?? null,
      failedPages,
      rows: members,
    },
  })
}

export function normalizeSinaEsgRatingCollection(args: {
  raw: unknown
  params?: Record<string, unknown>
  capabilityId?: string
  sourceAction?: string
}): NormalizedOutputOnlyResult {
  const raw = asRecord(args.raw)
  const rows = extractRows(raw.rows ?? raw.ratings ?? raw)
  const ratings = rows.slice(0, 5000).map((item) => {
    const row = isRecord(item) ? item : {}
    return {
      symbol: row.symbol ?? null,
      market: row.market ?? null,
      agency: row.agency ?? null,
      agencyName: row.agencyName ?? row.agency_name ?? null,
      esgScore: numberOrNull(row.esgScore ?? row.esg_score),
      esgDate: row.esgDate ?? row.esg_dt ?? null,
      remark: row.remark ?? null,
      raw: row.raw ?? row,
    }
  }).filter((row) => row.symbol != null || row.agency != null)
  const failedPages = Array.isArray(raw.failedPages) ? raw.failedPages : []
  const completed = raw.completed === true
  return outputResult({
    ok: failedPages.length === 0,
    action: 'sina_esg_rating_collection',
    interfaceId: 'stock.esg_rating_collection',
    capabilityId: args.capabilityId ?? 'sina.stock.esg_rating_collection',
    provider: 'sina',
    schemaId: 'stock_esg_rating_collection_result',
    status: failedPages.length ? 'error' : ratings.length ? 'success' : 'empty',
    failureClass: failedPages.length ? 'partial_provider_failure' : 'success',
    sourceAction: args.sourceAction ?? 'sina_esg_rating_collection',
    warnings: [
      'Output-only: ESG ratings are known schema but are not canonical reusable storage.',
      completed ? 'Batch completed within supplied bounds.' : 'Batch stopped at a checkpoint; resume with checkpoint.nextPage.',
    ],
    data: {
      provider: 'sina',
      params: args.params ?? raw.params ?? {},
      totalStocks: raw.totalStocks ?? null,
      fetchedPages: Number(raw.fetchedPages ?? 0),
      rowCount: ratings.length,
      completed,
      checkpoint: raw.checkpoint ?? null,
      failedPages,
      rows: ratings,
    },
  })
}

export function normalizeSinaFundDividendFactor(args: {
  symbol: string
  raw: unknown
  capabilityId?: string
  sourceAction?: string
}): NormalizedOutputOnlyResult {
  const rows = extractRows(args.raw)
  const items = rows.slice(0, 240).map((item) => {
    const row = isRecord(item) ? item : {}
    return {
      date: row.fsrq ?? row.date ?? row.nav_date ?? row.d ?? null,
      dividend: numberOrNull(row.fh ?? row.dividend ?? row.unitDividend ?? row.u),
      factor: numberOrNull(row.ljjz ?? row.factor ?? row.accumulatedFactor ?? row.s ?? row.f),
      raw: row,
    }
  }).filter((row) => row.date != null || row.dividend != null || row.factor != null)
  return outputResult({
    ok: true,
    action: 'sina_fund_dividend_factor',
    interfaceId: 'fund.dividend_factor',
    capabilityId: args.capabilityId ?? 'sina.fund.dividend_factor',
    provider: 'sina',
    schemaId: 'fund_dividend_factor_result',
    status: items.length ? 'success' : 'empty',
    failureClass: 'success',
    sourceAction: args.sourceAction ?? 'sina_fund_dividend_factor',
    warnings: ['Output-only: no canonical fund dividend/corporate-action table is registered for this Sina schema.'],
    data: {
      provider: 'sina',
      symbol: args.symbol,
      rowCount: items.length,
      rows: items,
    },
  })
}

export function normalizeSinaFundEtfDailyOhlcvBars(args: {
  symbol: string
  raw: unknown
  provider?: OutputOnlyProvider
  capabilityId?: string
  sourceAction?: string
}): NormalizedOutputOnlyResult {
  const provider = args.provider ?? 'akshare'
  const rows = extractRows(args.raw)
  const bars = rows.slice(0, 500).map((item) => {
    const row = isRecord(item) ? item : {}
    return {
      date: row.date ?? row['日期'] ?? null,
      open: numberOrNull(row.open ?? row['开盘']),
      high: numberOrNull(row.high ?? row['最高']),
      low: numberOrNull(row.low ?? row['最低']),
      close: numberOrNull(row.close ?? row['收盘']),
      volume: numberOrNull(row.volume ?? row['成交量']),
      amount: numberOrNull(row.amount ?? row['成交额']),
      raw: row,
    }
  }).filter((row) => row.date != null)
  return outputResult({
    ok: true,
    action: 'sina_fund_etf_daily_ohlcv_bars',
    interfaceId: 'fund.etf_daily_ohlcv_bars',
    capabilityId: args.capabilityId ?? (provider === 'sina' ? 'sina.fund.etf_daily_ohlcv_bars' : 'akshare.sina.fund.etf_daily_ohlcv_bars'),
    provider,
    schemaId: 'fund_etf_daily_ohlcv_bar_result',
    status: bars.length ? 'success' : 'empty',
    failureClass: 'success',
    sourceAction: args.sourceAction ?? 'sina_fund_etf_daily_ohlcv_bars',
    warnings: [
      'Diagnostic-only: use the governed fund.etf_daily_ohlcv_bars Data API interface for reusable ETF exchange OHLCV rows.',
      'Do not treat this output-only envelope as canonical cache/readback data.',
    ],
    data: {
      provider,
      upstreamOrigin: 'sina',
      symbol: args.symbol,
      rowCount: bars.length,
      bars,
    },
  })
}

export function normalizeTencentFundEtfDailyOhlcvBars(args: {
  symbol: string
  raw: unknown
  provider?: OutputOnlyProvider
  capabilityId?: string
  sourceAction?: string
}): NormalizedOutputOnlyResult {
  return normalizeSinaFundEtfDailyOhlcvBars({
    ...args,
    provider: 'tencent',
    capabilityId: args.capabilityId ?? 'tencent.fund.etf_daily_ohlcv_bars',
    sourceAction: args.sourceAction ?? 'tencent_fund_etf_daily_ohlcv_bars',
  })
}

export function normalizeOutputProvider(value: unknown): OutputOnlyProvider | null {
  const provider = String(value ?? '').toLowerCase()
  if (!provider) return null
  if (provider === 'yahoo') return 'yfinance'
  if (['akshare', 'yfinance', 'ta', 'tdx', 'tradingview', 'sidecar', 'tushare', 'sina', 'tencent'].includes(provider)) return provider as OutputOnlyProvider
  return null
}

function outputCapability(
  id: string,
  interfaceId: OutputOnlyInterfaceId,
  provider: OutputOnlyProvider,
  status: OutputOnlyCapability['status'],
  priority: number,
  adapter: string,
  normalizer: string,
  reason?: string,
): OutputOnlyCapability {
  return {
    id,
    interfaceId,
    provider,
    status,
    priority,
    schemaId: getSchemaId(interfaceId),
    adapter,
    normalizer,
    persistencePolicy: 'output-only',
    reason,
  }
}

function knowledgeRecord(
  apiId: string,
  interfaceId: OutputOnlyInterfaceId,
  capabilityId: string,
  provider: OutputOnlyProvider,
  endpointOrAction: string,
  schemaId: string,
  required: string[],
  rowFields: string[],
  semanticNote: string,
): FinanceApiKnowledgeRecord {
  return {
    apiId,
    interfaceId,
    capabilityId,
    runtime: 'finagent_workstation',
    provider,
    endpointOrAction,
    class: interfaceId === 'provider.diagnostic' ? 'raw-diagnostic-provider-surface' : 'normalized-output-only-interface',
    schemaId,
    schemaVersion: '2026-06-18',
    persistencePolicy: 'output-only',
    cachePolicy: 'no-canonical-cache',
    marketScope: ['provider-specific'],
    parameterContract: {
      required,
      optional: ['provider', 'limit', 'params'],
      defaults: {},
      enums: {},
      invalidCombinations: ['persist:true is not allowed for output-only interfaces'],
    },
    responseContract: {
      topLevelFields: ['ok', 'action', 'interfaceId', 'schemaId', 'schemaVersion', 'status', 'failureClass', 'provider', 'warnings', 'data', 'provenance'],
      rowFields,
      nestedFields: ['provenance', 'data'],
      types: { ok: 'boolean', status: 'string', failureClass: 'string', warnings: 'string[]', data: 'object' },
      nullableFields: ['availability.providerVersion', 'availability.sidecarVersion'],
      units: {},
      timestampFields: ['provenance.fetchedAt'],
      semanticNotes: [semanticNote],
      emptyResultMeaning: 'Valid call with no matching rows unless failureClass is not success.',
      ordering: 'Provider-defined unless the interface declares a sort field.',
      pagination: 'Bounded preview; use provider-specific parameters for pagination diagnostics.',
    },
    availability: {
      status: interfaceId === 'provider.diagnostic' ? 'diagnostic-only' : 'known',
      lastProbeAt: '2026-06-18T00:00:00.000Z',
      providerVersion: 'fixture-backed-contract',
      sidecarVersion: provider === 'sidecar' ? 'fixture-backed-contract' : null,
      failureClass: null,
      statusCode: null,
      errorPattern: null,
      minimalSuccessCase: required.length ? `${required.join(', ')} provided` : 'no required parameters',
      negativeCaseBehavior: 'Returns typed error or diagnostic failureClass, not raw provider output.',
    },
    usagePolicy: {
      normalWorkflowAllowed: interfaceId !== 'provider.diagnostic',
      diagnosticOnly: interfaceId === 'provider.diagnostic',
      quotaSensitive: false,
      requiresCredential: provider === 'tushare',
      recommendedFallbacks: [],
      safetyLevel: interfaceId === 'provider.diagnostic' ? 'diagnostic' : 'normal',
      retryPolicy: 'Do not retry schema/parameter failures without changing inputs.',
    },
    evidence: {
      probeId: `finance_output_only_api_contract_probe:${apiId}`,
      sampleRowCount: 1,
      sampleColumns: rowFields,
      sampleParameterSets: required.length ? [Object.fromEntries(required.map((key) => [key, `<${key}>`]))] : [{}],
      boundedRawPreviewPath: 'reports/integrations/finance_output_only_api_contract_probe_2026_06_18.json',
    },
  }
}

function outputResult(args: {
  ok: boolean
  action: string
  interfaceId: OutputOnlyInterfaceId
  capabilityId: string
  provider: OutputOnlyProvider
  schemaId: string
  status: NormalizedOutputOnlyResult['status']
  failureClass: string
  sourceAction: string
  data: Record<string, unknown>
  warnings?: string[]
}): NormalizedOutputOnlyResult {
  const iface = getOutputOnlyInterface(args.interfaceId)
  return {
    ok: args.ok,
    action: args.action,
    interfaceId: args.interfaceId,
    schemaId: args.schemaId,
    schemaVersion: iface.schemaVersion,
    status: args.status,
    failureClass: args.failureClass,
    provider: args.provider,
    warnings: args.warnings ?? [],
    data: args.data,
    provenance: {
      interfaceId: args.interfaceId,
      capabilityId: args.capabilityId,
      provider: args.provider,
      schemaId: args.schemaId,
      schemaVersion: iface.schemaVersion,
      persistencePolicy: 'output-only',
      cacheStatus: 'not-cacheable',
      cacheDecision:
        'output-only surface is normalized for bounded inspection but is not eligible for canonical persistence, cache reuse, or normal provider routing',
      sourceAction: args.sourceAction,
      fetchedAt: new Date().toISOString(),
    },
  }
}

function getSchemaId(interfaceId: OutputOnlyInterfaceId): string {
  return ({
    'provider.discovery': 'provider_discovery_result',
    'provider.diagnostic': 'provider_diagnostic_result',
    'provider.status': 'provider_status_result',
    'provider.reference_dataset': 'provider_reference_dataset_result',
    'market.intraday_ohlcv_bars': 'intraday_ohlcv_bar_result',
    'market.classification_members': 'market_classification_member_batch_result',
    'stock.transaction_count': 'stock_transaction_count_result',
    'stock.esg_rating_collection': 'stock_esg_rating_collection_result',
    'fund.dividend_factor': 'fund_dividend_factor_result',
    'fund.etf_daily_ohlcv_bars': 'fund_etf_daily_ohlcv_bar_result',
  } as Record<OutputOnlyInterfaceId, string>)[interfaceId]
}

function extractRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  const record = asRecord(raw)
  if (Array.isArray(record.data)) return record.data
  if (Array.isArray(record.rows)) return record.rows
  if (Array.isArray(record.items)) return record.items
  return []
}

function sampleColumnsFromRaw(raw: unknown): string[] {
  const record = asRecord(raw)
  if (Array.isArray(record.columns)) return record.columns.map(String)
  const rows = extractRows(raw)
  const first = rows.find(isRecord)
  return first ? Object.keys(first) : Object.keys(record).slice(0, 20)
}

function responseKind(raw: unknown): string {
  if (Array.isArray(raw)) return 'array'
  if (raw === null) return 'null'
  return typeof raw
}

function boundedPreview(raw: unknown): unknown {
  const text = JSON.stringify(raw)
  if (!text) return raw
  return text.length <= 2000 ? raw : `${text.slice(0, 2000)}...`
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function errorFromRaw(raw: unknown): string | undefined {
  const record = asRecord(raw)
  const error = record.error ?? record.message
  return error == null ? undefined : String(error)
}

function classifyFailure(error: string, statusCode?: number): string {
  const text = error.toLowerCase()
  if (statusCode === 401 || statusCode === 403 || text.includes('credential') || text.includes('token') || text.includes('permission')) return 'credential_gated'
  if (statusCode === 429 || text.includes('quota') || text.includes('rate limit')) return 'quota_gated'
  if (statusCode === 404 || text.includes('unsupported') || text.includes('not found')) return 'unsupported'
  if (text.includes('parameter') || text.includes('invalid')) return 'invalid_parameters'
  if (text.includes('schema')) return 'schema_mismatch'
  if (text.includes('fetch failed') || text.includes('timeout') || text.includes('socket')) return 'transport_unstable'
  return 'provider_unavailable'
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
