import type { ChatMessage } from '../../store/useAgentStore'

export interface AnalysisEvidenceView {
  kind: string
  subjectLabel: string
  observedFacts: string[]
  interpretations: string[]
  missingEvidence: string[]
  confidence: string
  strategyReadiness: string
  sources: string[]
  interfaceId?: string
  capabilityId?: string
  canonicalSchema?: string
  canonicalTable?: string
  readbackAction?: string
  sourceDataTime?: string
  fetchedAt?: string
  cacheStatus?: string
  coverageStatus?: string
}

export interface StrategyReviewView {
  reviewKind: string
  strategyId: string
  signal: string
  subjects: string[]
  boundaries: string[]
  confirmation?: string
}

export interface TradePrepView {
  prepKind: string
  strategyId: string
  signal: string
  symbol: string
  sizing: Record<string, unknown>
  evidence: Record<string, unknown>
  previews: Record<string, unknown>
  boundaries: string[]
  confirmation?: string
}

export function detectContentType(message: ChatMessage): 'quote' | 'kline' | 'signal' | 'backtest' | 'sector' | 'analysis-evidence' | 'strategy-review' | 'trade-prep' | null {
  if (message.role !== 'tool-result' || !message.content) return null
  const c = message.content

  if (parseAnalysisEvidence(c)) return 'analysis-evidence'
  if (parseStrategyReview(c)) return 'strategy-review'
  if (parseTradePrep(c)) return 'trade-prep'
  if (c.includes('Price:') && c.includes('ChangePct') && c.includes('Open:')) return 'quote'
  if (c.includes('K-line') && c.includes('Date\tOpen\tClose')) return 'kline'
  if (c.includes('Signal Analysis') && c.includes('Overall:')) return 'signal'
  if (c.includes('Strategy:') && c.includes('Total Return:') && c.includes('Sharpe Ratio:')) return 'backtest'
  if (c.includes('sectors') && c.includes('Code\tName\tChangePct')) return 'sector'

  return null
}

export function stripFinanceContractLines(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('analysisEvidence:') && !line.startsWith('strategyReview:') && !line.startsWith('tradePrep:'))
    .join('\n')
    .trim()
}

export function parseAnalysisEvidence(content: string): AnalysisEvidenceView | null {
  const root = parseJsonObject(content) ?? parsePrefixedJson(content, 'analysisEvidence:')
  if (!root) return null
  const evidence = asRecord(root.analysisEvidence) ?? asRecord(root)
  if (!evidence || evidence.contract !== 'analysis-evidence-v1') return null
  const subject = asRecord(evidence.subject)
  const sourceCoverage = asRecord(evidence.sourceCoverage)
  const subjectId = stringValue(subject?.id)
  const subjectName = stringValue(subject?.name)
  const subjectType = stringValue(subject?.type)
  return {
    kind: stringValue(evidence.kind) || 'analysis',
    subjectLabel: subjectName && subjectId && subjectName !== subjectId
      ? `${subjectName} (${subjectId})`
      : subjectId || subjectName || subjectType || '-',
    observedFacts: stringArray(evidence.observedFacts).slice(0, 6),
    interpretations: stringArray(evidence.interpretations).slice(0, 6),
    missingEvidence: stringArray(evidence.missingEvidence).slice(0, 6),
    confidence: stringValue(evidence.confidence) || '-',
    strategyReadiness: stringValue(evidence.strategyReadiness) || 'analysis_only',
    sources: stringArray(sourceCoverage?.sources),
    interfaceId: stringValue(sourceCoverage?.interfaceId),
    capabilityId: stringValue(sourceCoverage?.capabilityId),
    canonicalSchema: stringValue(sourceCoverage?.canonicalSchema),
    canonicalTable: stringValue(sourceCoverage?.canonicalTable),
    readbackAction: stringValue(sourceCoverage?.readbackAction),
    sourceDataTime: stringValue(sourceCoverage?.sourceDataTime),
    fetchedAt: stringValue(sourceCoverage?.fetchedAt),
    cacheStatus: stringValue(sourceCoverage?.cacheStatus),
    coverageStatus: stringValue(sourceCoverage?.coverageStatus),
  }
}

export function parseStrategyReview(content: string): StrategyReviewView | null {
  const review = parseJsonObject(content) ?? parsePrefixedJson(content, 'strategyReview:')
  if (!review || review.contract !== 'strategy-review-v1') return null
  return {
    reviewKind: stringValue(review.reviewKind) || 'strategy_review',
    strategyId: stringValue(review.strategyId) || '-',
    signal: stringValue(review.signal) || '-',
    subjects: stringArray(review.subjects),
    boundaries: stringArray(review.boundaries),
    confirmation: stringValue(review.confirmation) || undefined,
  }
}

export function parseTradePrep(content: string): TradePrepView | null {
  const prep = parseJsonObject(content) ?? parsePrefixedJson(content, 'tradePrep:')
  if (!prep || prep.contract !== 'trade-prep-v1') return null
  return {
    prepKind: stringValue(prep.prepKind) || 'trade_prep',
    strategyId: stringValue(prep.strategyId) || '-',
    signal: stringValue(prep.signal) || '-',
    symbol: stringValue(prep.symbol) || '-',
    sizing: asRecord(prep.sizing) ?? {},
    evidence: asRecord(prep.evidence) ?? {},
    previews: asRecord(prep.previews) ?? {},
    boundaries: stringArray(prep.boundaries),
    confirmation: stringValue(prep.confirmation) || undefined,
  }
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content)
    return asRecord(parsed)
  } catch {
    return null
  }
}

function parsePrefixedJson(content: string, prefix: string): Record<string, unknown> | null {
  const line = content.split(/\r?\n/).find((item) => item.startsWith(prefix))
  if (!line) return null
  return parseJsonObject(line.slice(prefix.length))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : []
}

function stringValue(value: unknown): string {
  return value == null ? '' : String(value)
}

export function parseQuote(content: string): { name: string; code: string; price: number; changePct: number; change: number; open: number; high: number; low: number; prevClose: number; pe: string; pb: string; volume: string } | null {
  const lines = content.split('\n')
  if (lines.length < 3) return null

  const nameMatch = lines[0]?.match(/^(.+)\s+\((\d+)\)/)
  const priceMatch = lines[1]?.match(/Price:\s+([\d.]+)\s+[▲▼]\s+([\d.-]+)%\s+\(([\d.+-]+)\)/)
  const ohlcMatch = lines[2]?.match(/Open:\s+([\d.]+)\s+High:\s+([\d.]+)\s+Low:\s+([\d.]+)\s+PrevClose:\s+([\d.]+)/)
  const volMatch = lines[3]?.match(/Volume:\s+(.+?)\s+Amount:\s+(.+)/)
  const peMatch = lines[4]?.match(/PE:\s+([\d.-]+)\s+PB:\s+([\d.-]+)/)

  if (!nameMatch || !priceMatch) return null

  return {
    name: nameMatch[1].trim(),
    code: nameMatch[2],
    price: parseFloat(priceMatch[1]),
    changePct: parseFloat(priceMatch[2]),
    change: parseFloat(priceMatch[3]),
    open: ohlcMatch ? parseFloat(ohlcMatch[1]) : 0,
    high: ohlcMatch ? parseFloat(ohlcMatch[2]) : 0,
    low: ohlcMatch ? parseFloat(ohlcMatch[3]) : 0,
    prevClose: ohlcMatch ? parseFloat(ohlcMatch[4]) : 0,
    pe: peMatch?.[1] ?? '-',
    pb: peMatch?.[2] ?? '-',
    volume: volMatch?.[1] ?? '-',
  }
}

export function parseSignals(content: string): Array<{ indicator: string; signal: string; strength: string; reason: string }> {
  const signals: Array<{ indicator: string; signal: string; strength: string; reason: string }> = []
  for (const line of content.split('\n')) {
    const match = line.match(/^[▲▼—]\s+(\w+):\s+(BUY|SELL|HOLD)\s+\((\d+)%\)\s+—\s+(.+)/)
    if (match) {
      signals.push({ indicator: match[1], signal: match[2], strength: match[3], reason: match[4] })
    }
  }
  return signals
}

export function parseBacktest(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const match = line.match(/^(.+?):\s+(.+)$/)
    if (match) result[match[1].trim()] = match[2].trim()
  }
  return result
}
