import type { Tool, ToolContext } from '../tool'

type Runbook = {
  workflow: string
  purpose: string
  requiredEvidence: string[]
  allowedTools: string[]
  artifactTypes: string[]
  outputRequirements?: string[]
  approvalBoundary: string
  failureHandling: string[]
  firstPassPlan?: string[]
  escalationBoundary?: string
  verifier: string
}

const RUNBOOKS: Record<string, Runbook> = {
  market_overview: {
    workflow: 'market_overview',
    purpose: 'Understand current market condition before stock/fund decisions.',
    requiredEvidence: ['quote/index', 'sector', 'flow_rank', 'limit_pool', 'news_or_macro'],
    allowedTools: ['MarketData', 'DataStore', 'Research', 'WorkflowEvidence', 'CapabilityStatus'],
    artifactTypes: ['analysis', 'dashboard', 'data_evidence'],
    approvalBoundary: 'No trade or simulated trade action.',
    failureHandling: ['Use cache when provider is unhealthy.', 'Disclose stale or missing evidence.'],
    firstPassPlan: [
      'Use a bounded market evidence set: coverage, index quote, sector ranking, flow rank or northbound flow, and news or macro evidence.',
      'For core market indexes, use governed index quote/readback evidence such as MarketData(action:"query_index_quote", symbols:["000001","399001","399006"]) or DataStore(action:"query_index_quote", symbols:[...]) where supported. Do not use stock technical tools on index codes; report index K-line/technical coverage as missing unless a governed index K-line or index indicator contract is available.',
      'For macro context, use one query_macro_factors readback and one query_macro_attribution readback with a structured target such as A-shares.',
      'Do not add source extraction, provider-page browsing, numeric catalog sweeps, or watchlist expansion to the first answer unless the user explicitly asks for those workflows.',
    ],
    escalationBoundary: 'Use macro_research_sources/macro_research_extract only for explicit source refresh, source validation, or report extraction tasks.',
    verifier: 'WorkflowVerifier(action:"check", workflow:"market_overview") when available; otherwise CapabilityStatus(action:"evaluate").',
  },
  stock_research: {
    workflow: 'stock_research',
    purpose: 'Analyze one stock with market, technical, fundamental, flow, risk, and macro context.',
    requiredEvidence: ['quote', 'kline', 'fundamental_or_missing_reason', 'money_flow', 'risk', 'macro_if_relevant'],
    allowedTools: ['MarketData', 'DataProcess', 'Research', 'Dashboard', 'WorkflowEvidence', 'CapabilityStatus'],
    artifactTypes: ['analysis', 'dashboard', 'data_evidence'],
    approvalBoundary: 'No order placement. Use trade-preparation workflow before any simulated trade.',
    failureHandling: ['Do not invent missing PE/PB/fundamental data.', 'Name provider/cache/source-time gaps.'],
    verifier: 'WorkflowVerifier(action:"check", workflow:"stock_research") when available; otherwise CapabilityStatus(action:"evaluate").',
  },
  stock_selection: {
    workflow: 'stock_selection',
    purpose: 'Create a bounded stock observation shortlist with explicit evidence, missing-evidence disclosure, and no watchlist mutation unless the user asks for it.',
    requiredEvidence: ['market_context', 'screening_or_candidate_source', 'sector_or_theme', 'quote_or_snapshot', 'risk_or_missing_reason', 'data_provenance'],
    allowedTools: ['MarketData', 'DataStore', 'DataProcess', 'Research', 'WorkflowEvidence', 'CapabilityStatus'],
    artifactTypes: ['analysis', 'data_evidence'],
    approvalBoundary: 'No watchlist mutation, monitor creation, or order placement unless the user explicitly requests that next step.',
    failureHandling: [
      'Keep the first candidate set bounded.',
      'Name stale, missing, or provider-limited evidence instead of broad retry loops.',
      'If the user later asks to add candidates to a watchlist, switch to a watchlist/monitor workflow and preserve the candidate evidence.',
    ],
    firstPassPlan: [
      'Use a governed market or sector context plus one bounded screening/candidate source.',
      'For each candidate, cite the specific evidence class used and the evidence class still missing.',
      'Do not create or update watchlist state in the selection answer unless the user explicitly asked for persistence.',
    ],
    verifier: 'WorkflowVerifier(action:"check", workflow:"stock_selection") when available; otherwise CapabilityStatus(action:"evaluate").',
  },
  watchlist_handoff: {
    workflow: 'watchlist_handoff',
    purpose: 'Persist selected stock/fund observation candidates into watchlist state with structured conditions and readback evidence.',
    requiredEvidence: ['candidate_evidence', 'watchlist_add_result', 'watchlist_readback', 'no_trade_boundary'],
    allowedTools: ['Runbook', 'DataStore', 'DataProcess', 'Watchlist', 'WorkflowEvidence', 'CapabilityStatus'],
    artifactTypes: ['data_evidence'],
    approvalBoundary: 'Observation-state mutation only. No order, simulated trade, cash transfer, or broker side effect.',
    failureHandling: [
      'Add only candidates with enough evidence to justify observation.',
      'Use Watchlist(action:"list") after mutation to verify persisted symbol/name/status/conditions.',
      'If conditions cannot be represented structurally, keep unsupported parts visible in the final answer.',
    ],
    firstPassPlan: [
      'Start from existing candidate evidence or a bounded stock_selection pass.',
      'Use Watchlist(action:"add") for observation rows only.',
      'Read back the created items before finalizing.',
    ],
    verifier: 'WorkflowVerifier(action:"check", workflow:"watchlist_handoff") before claiming watchlist persistence.',
  },
  fund_selection: {
    workflow: 'fund_selection',
    purpose: 'Select or compare funds using fund class, NAV/yield, holdings, performance, risk, and suitability evidence.',
    requiredEvidence: ['fund_list', 'fund_nav_or_money_yield', 'fund_performance', 'fund_holding_or_missing_reason', 'risk'],
    allowedTools: ['MarketData', 'DataProcess', 'Research', 'WorkflowEvidence', 'CapabilityStatus'],
    artifactTypes: ['analysis', 'data_evidence'],
    approvalBoundary: 'No purchase instruction or simulated trade without explicit trade-preparation workflow.',
    failureHandling: ['Do not use ordinary NAV for known money funds.', 'Separate selection evidence from buy advice.'],
    verifier: 'WorkflowVerifier(action:"check", workflow:"fund_selection") when available; otherwise CapabilityStatus(action:"evaluate").',
  },
  strategy_backtest: {
    workflow: 'strategy_backtest',
    purpose: 'Convert a strategy idea into StrategySpec, validate, backtest, report, and optionally monitor.',
    requiredEvidence: ['StrategySpec', 'validation_report', 'backtest_data_coverage', 'fees_slippage_assumptions', 'report'],
    allowedTools: ['DataProcess', 'MarketData', 'Watchlist', 'WorkflowEvidence', 'CapabilityStatus'],
    artifactTypes: ['strategy', 'backtest', 'report'],
    approvalBoundary: 'Backtest and monitor only. Simulated trade requires separate approval boundary.',
    failureHandling: ['Reject unsupported indicators/operators with repairPlan.', 'Do not run free-form strategy strings.'],
    verifier: 'WorkflowVerifier(action:"check", workflow:"strategy_backtest") when available; otherwise CapabilityStatus(action:"evaluate").',
  },
  strategy_rerun: {
    workflow: 'strategy_rerun',
    purpose: 'Reuse a saved StrategySpec identity on another symbol, validate compatibility, rerun backtest, and compare evidence.',
    requiredEvidence: ['saved_strategy_identity', 'StrategySpec', 'validation_report', 'backtest_data_coverage', 'comparison_report'],
    allowedTools: ['Runbook', 'MarketData', 'DataProcess', 'ArtifactRegistry', 'WorkflowEvidence', 'CapabilityStatus'],
    artifactTypes: ['strategy', 'backtest', 'report'],
    approvalBoundary: 'Read-only strategy reuse/backtest. No watchlist mutation or simulated trade unless the user explicitly asks for a later workflow.',
    failureHandling: [
      'Do not recreate a strategy from prose when a saved id/spec is required.',
      'If no saved strategy exists, create a clearly labelled candidate StrategySpec and stop before pretending it was saved.',
      'Report unsupported indicators, data coverage gaps, fees/slippage assumptions, and benchmark limits.',
    ],
    verifier: 'WorkflowVerifier(action:"check", workflow:"strategy_rerun") before final strategy-rerun claims.',
  },
  trade_preparation: {
    workflow: 'trade_preparation',
    purpose: 'Prepare a simulated trade with sizing, risk, stop, evidence, and explicit user approval.',
    requiredEvidence: ['analysis', 'risk_sizing', 'cash_or_portfolio_state', 'approval_state', 'trade_boundary'],
    allowedTools: ['Portfolio', 'XueqiuTrade', 'AskUserQuestion', 'WorkflowEvidence', 'CapabilityStatus'],
    artifactTypes: ['trade_preparation', 'data_evidence'],
    approvalBoundary: 'Must stop for explicit user approval before any simulated order side effect.',
    failureHandling: ['If approval is missing, stop and ask.', 'If account/portfolio state is unavailable, do not place an order.'],
    verifier: 'WorkflowVerifier(action:"check", workflow:"trade_preparation") when available; otherwise CapabilityStatus(action:"evaluate").',
  },
  trade_review: {
    workflow: 'trade_review',
    purpose: 'Review simulated portfolio holdings and transaction history without adding orders or transfers.',
    requiredEvidence: ['portfolio_list', 'positions_or_missing_reason', 'transactions_or_missing_reason', 'cash_or_performance', 'no_side_effect_boundary'],
    allowedTools: ['Runbook', 'Portfolio', 'XueqiuTrade', 'DataStore', 'WorkflowEvidence', 'CapabilityStatus'],
    artifactTypes: ['analysis', 'data_evidence'],
    approvalBoundary: 'Read-only simulated-account review. Do not add buy/sell/transfer actions.',
    failureHandling: [
      'If cookie, portfolio id, or account state is missing, report the recoverable credential/config gap.',
      'If transaction or position endpoints are empty, distinguish empty account state from provider failure.',
      'Do not evaluate trading quality without the holdings/cash/transaction evidence used.',
    ],
    verifier: 'WorkflowVerifier(action:"check", workflow:"trade_review") before final simulated-account review claims.',
  },
  macro_factor_lookup: {
    workflow: 'macro_factor_lookup',
    purpose: 'Ingest and use macro, policy, research, or official series evidence as analysis context for stock, fund, market, and strategy workflows.',
    requiredEvidence: [
      'source-evidence-record-v1',
      'macro-evidence-record-v1',
      'title/date/hash/source provenance',
      'keyClaims',
      'affectedAssets',
      'confidenceEffect',
      'missingEvidence_or_none',
    ],
    allowedTools: [
      'Runbook',
      'ProviderRouter',
      'SourceReader',
      'ArtifactRegistry',
      'WorkflowVerifier',
      'DataStore',
      'Research',
    ],
    artifactTypes: ['macro_evidence', 'research', 'data_evidence', 'report', 'dashboard'],
    outputRequirements: [
      'For an ordinary chat answer, disclose macro source, source time, fetched-at, freshness/missing-evidence state, affected assets, confidence effect, and no-direct-trade boundary in text.',
      'When the user asks for a reviewable report, dashboard, artifact, or panel output, create or register a durable report/dashboard artifact through ArtifactRegistry before finalizing.',
      'The report/dashboard artifact must carry structured macro evidence fields in metadata/provenance/freshness: topic, sourceDataTime or sourceTime, fetchedAt, freshnessStatus, affectedAssets, missingEvidence, confidenceEffect, and failureClass when present.',
    ],
    approvalBoundary: 'Macro evidence is context, hypothesis, and invalidation input. It is not a direct buy/sell rule.',
    failureHandling: [
      'Use SourceReader(action:"read") or a governed macro/data readback before citing a source.',
      'Use SourceReader(action:"macroEvidence") with explicit structured fields; do not infer them from prompt text in app code.',
      'If source access, freshness, or affected-asset mapping is missing, record missingEvidence and lower confidence.',
    ],
    firstPassPlan: [
      'Start with governed local readback: query_macro_factors and query_macro_attribution for the structured target.',
      'Use macro_research_sources to choose a source only when the user asks to refresh, validate, or inspect source availability.',
      'Use SourceReader or macro_research_extract only after a source is selected and the task needs actual source content.',
    ],
    escalationBoundary: 'Missing local macro evidence should be reported as missing evidence; it is not a reason to crawl multiple providers in a first-pass answer.',
    verifier: 'WorkflowVerifier(action:"check", workflow:"macro_factor_lookup") before using macro evidence in final analysis.',
  },
}

export class RunbookTool implements Tool {
  name = 'Runbook'
  description = 'Return structured workflow guidance before acting on broad finance tasks.'
  isReadOnly = true
  canParallel = true
  inputSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['help', 'list', 'get'],
        description: 'help, list available runbooks, or get one runbook',
      },
      workflow: {
        type: 'string',
        enum: Object.keys(RUNBOOKS),
        description: 'Workflow id for action=get',
      },
    },
  }

  async call(_id: string, input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    const action = String(input.action ?? 'list')
    if (action === 'help') return JSON.stringify(help())
    if (action === 'list') {
      return JSON.stringify({
        contract: 'runbook-list-v1',
        workflows: Object.keys(RUNBOOKS),
        guidance: 'Call Runbook(action:"get", workflow:<id>) before broad workflow execution.',
      })
    }
    if (action !== 'get') {
      throw new Error(`Invalid Runbook action "${action}". Use action="help" for supported actions.`)
    }
    const workflow = String(input.workflow ?? '').trim()
    const runbook = RUNBOOKS[workflow]
    if (!runbook) {
      throw new Error(`Unknown Runbook workflow "${workflow}". Use Runbook(action:"list") to inspect available workflows.`)
    }
    return JSON.stringify({
      contract: 'runbook-detail-v1',
      ...runbook,
    })
  }
}

function help(): Record<string, unknown> {
  return {
    contract: 'runbook-help-v1',
    actions: ['list', 'get'],
    workflows: Object.keys(RUNBOOKS),
    guidance: [
      'Runbook provides workflow rules as structured data, not prompt-text parsing.',
      'Use requiredEvidence and approvalBoundary before choosing tools or finalizing.',
      'If a required evidence class is missing, disclose it or use a verifier/recovery path.',
    ],
  }
}
