export const financeDataContractStepIds = [
  'dataClass',
  'cachePolicy',
  'providerPolicy',
  'normalizer',
  'persistTarget',
  'readbackAction',
  'failureSink',
  'uiSurface',
] as const

export type FinanceDataContractStepId = typeof financeDataContractStepIds[number]

export interface FinanceDataContractStep {
  id: FinanceDataContractStepId
  order: number
}

export const financeDataContractSteps: readonly FinanceDataContractStep[] =
  financeDataContractStepIds.map((id, index) => ({
    id,
    order: index + 1,
  }))

export function financeDataContractStepOrder(): FinanceDataContractStepId[] {
  return [...financeDataContractStepIds]
}
