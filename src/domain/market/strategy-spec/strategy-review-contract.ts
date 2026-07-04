export interface StrategyReviewContract {
  contract: 'strategy-review-v1'
  reviewKind: string
  strategyId: string
  signal: string
  subjects: string[]
  evidence: Record<string, unknown>
  draft: Record<string, unknown>
  boundaries: string[]
  confirmation?: string
}

export function createStrategyReviewContract(input: Omit<StrategyReviewContract, 'contract'>): StrategyReviewContract {
  return {
    contract: 'strategy-review-v1',
    ...input,
  }
}
