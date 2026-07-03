export type AnalysisEvidenceKind =
  | 'market_analysis'
  | 'stock_analysis'
  | 'fund_analysis'
  | 'sector_analysis'
  | 'flow_analysis'
  | 'valuation_analysis'
  | 'risk_analysis'
  | 'news_analysis'
  | 'dashboard_analysis'
  | 'candidate_research'

export type AnalysisSubjectType =
  | 'market'
  | 'stock'
  | 'fund'
  | 'etf'
  | 'sector'
  | 'index'
  | 'flow'
  | 'news'
  | 'dashboard'
  | 'candidate_set'
  | 'fund_nav_mover'

export type AnalysisStrategyReadiness =
  | 'analysis_only'
  | 'candidate'
  | 'strategy_ready'

export type AnalysisConfidence = 'low' | 'medium' | 'high'

export type AnalysisCoverageStatus =
  | 'none'
  | 'partial'
  | 'sufficient_for_analysis'
  | 'sufficient_for_technical'

export interface AnalysisSubject {
  type: AnalysisSubjectType
  id: string
  name?: string
}

export interface AnalysisSourceCoverage {
  sources: string[]
  interfaceId?: string
  capabilityId?: string
  canonicalSchema?: string
  canonicalTable?: string
  readbackAction?: string
  sourceDataTime?: string
  fetchedAt?: string
  cacheStatus?: string
  coverageStatus: AnalysisCoverageStatus
}

export interface AnalysisEvidencePackage {
  contract: 'analysis-evidence-v1'
  kind: AnalysisEvidenceKind
  subject: AnalysisSubject
  observedFacts: string[]
  interpretations: string[]
  missingEvidence: string[]
  confidence: AnalysisConfidence
  strategyReadiness: AnalysisStrategyReadiness
  sourceCoverage: AnalysisSourceCoverage
}

export interface AnalysisActionTarget {
  action: 'analyze' | 'compare' | 'dashboard'
  kind: AnalysisEvidenceKind
  subject: AnalysisSubject
  sourceSurface: string
}

export function createAnalysisEvidencePackage(
  input: Omit<AnalysisEvidencePackage, 'contract'>,
): AnalysisEvidencePackage {
  validateAnalysisEvidenceInput(input)
  return {
    contract: 'analysis-evidence-v1',
    ...input,
  }
}

export const analysisEvidenceKinds: readonly AnalysisEvidenceKind[] = [
  'market_analysis',
  'stock_analysis',
  'fund_analysis',
  'sector_analysis',
  'flow_analysis',
  'valuation_analysis',
  'risk_analysis',
  'news_analysis',
  'dashboard_analysis',
  'candidate_research',
]

export const analysisSubjectTypes: readonly AnalysisSubjectType[] = [
  'market',
  'stock',
  'fund',
  'etf',
  'sector',
  'index',
  'flow',
  'news',
  'dashboard',
  'candidate_set',
  'fund_nav_mover',
]

export const analysisConfidenceValues: readonly AnalysisConfidence[] = [
  'low',
  'medium',
  'high',
]

export const analysisStrategyReadinessValues: readonly AnalysisStrategyReadiness[] = [
  'analysis_only',
  'candidate',
  'strategy_ready',
]

export const analysisCoverageStatuses: readonly AnalysisCoverageStatus[] = [
  'none',
  'partial',
  'sufficient_for_analysis',
  'sufficient_for_technical',
]

function validateAnalysisEvidenceInput(input: Omit<AnalysisEvidencePackage, 'contract'>): void {
  assertKnown('analysis evidence kind', input.kind, analysisEvidenceKinds)
  assertKnown('analysis subject type', input.subject.type, analysisSubjectTypes)
  assertKnown('analysis confidence', input.confidence, analysisConfidenceValues)
  assertKnown('analysis strategy readiness', input.strategyReadiness, analysisStrategyReadinessValues)
  assertKnown('analysis coverage status', input.sourceCoverage.coverageStatus, analysisCoverageStatuses)
}

function assertKnown<T extends string>(label: string, value: string, allowed: readonly T[]): void {
  if (!allowed.includes(value as T)) {
    throw new Error(`Unknown ${label}: ${value}. Allowed: ${allowed.join(', ')}`)
  }
}

export function buildAnalysisActionPrompt(target: AnalysisActionTarget): string {
  const label = target.subject.name && target.subject.name !== target.subject.id
    ? `${target.subject.name} (${target.subject.id})`
    : target.subject.id
  const surface = analysisSurfaceLabel(target)
  const contract = 'analysis-evidence-v1'
  if (target.action === 'analyze') {
    return `Analyze ${label} from ${target.sourceSurface} as ${surface}. Use local reusable data first, then fetch only missing evidence required for analysis. Return an ${contract} style answer: observed facts, interpretation, missing evidence, confidence, source coverage, and whether this remains analysis-only or is strategy-ready.`
  }
  if (target.action === 'compare') {
    return `Compare ${label} with current peers from ${target.sourceSurface}. Use local reusable data first, fetch only missing peer/benchmark evidence, and return an ${contract} style comparison with ranking, missing evidence, confidence, and source coverage.`
  }
  return `Create or update a compact dashboard for ${label} from ${target.sourceSurface}. Display ${contract} fields: observed facts, interpretation, missing evidence, confidence, source coverage, and do not present analysis as a validated strategy unless a StrategySpec is created separately.`
}

function analysisSurfaceLabel(target: AnalysisActionTarget): string {
  if (target.kind === 'fund_analysis') {
    if (target.subject.type === 'etf') return 'ETF analysis evidence'
    if (target.subject.type === 'fund_nav_mover') return 'fund NAV mover analysis evidence'
    return 'fund analysis evidence'
  }
  if (target.kind === 'stock_analysis') return 'stock analysis evidence'
  if (target.kind === 'market_analysis') return 'market analysis evidence'
  return 'candidate research evidence'
}
