import type { Tool, ToolContext } from '../tool'

type Runbook = {
  workflow: string
  purpose: string
  requiredEvidence: string[]
  allowedTools: string[]
  artifactTypes: string[]
  approvalBoundary: string
  failureHandling: string[]
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
    artifactTypes: ['macro_evidence', 'research', 'data_evidence'],
    approvalBoundary: 'Macro evidence is context, hypothesis, and invalidation input. It is not a direct buy/sell rule.',
    failureHandling: [
      'Use SourceReader(action:"read") or a governed macro/data readback before citing a source.',
      'Use SourceReader(action:"macroEvidence") with explicit structured fields; do not infer them from prompt text in app code.',
      'If source access, freshness, or affected-asset mapping is missing, record missingEvidence and lower confidence.',
    ],
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
