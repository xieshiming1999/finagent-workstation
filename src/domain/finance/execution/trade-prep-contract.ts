export interface TradePrepContract {
  contract: 'trade-prep-v1'
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

export function createTradePrepContract(input: Omit<TradePrepContract, 'contract'>): TradePrepContract {
  return {
    contract: 'trade-prep-v1',
    ...input,
  }
}
