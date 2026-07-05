export const reusableFinanceSurfaceContract = ({
  dataClass,
  cachePolicy = 'cache-first',
  providerPolicy = 'policy-owned',
  uiSurface = 'none',
} = {}) => ({
  kind: 'reusable',
  dataClass,
  cachePolicy,
  providerPolicy,
  normalizer: 'code-owned',
  persistTarget: 'canonical',
  readbackAction: 'same-runtime',
  failureSink: 'api-health-no-persist',
  timestampPolicy: 'source-and-ingest-separated',
  uiSurface,
})

export const fetchOnlyFinanceSurfaceContract = ({
  dataClass,
  providerPolicy = 'explicit-fetch',
  failureSink = 'api-health-visible',
} = {}) => ({
  kind: 'fetch-only',
  dataClass,
  cachePolicy: 'none',
  providerPolicy,
  normalizer: 'none',
  persistTarget: 'none',
  readbackAction: 'none',
  failureSink,
  timestampPolicy: 'none',
  uiSurface: 'none',
})

export function validateFinanceSurfaceContract(item) {
  const contract = item.surfaceContract
  const problems = []
  if (!contract) return ['missing surfaceContract']

  const enums = {
    kind: ['reusable', 'fetch-only'],
    cachePolicy: ['cache-first', 'none'],
    providerPolicy: ['policy-owned', 'explicit-fetch'],
    normalizer: ['code-owned', 'none'],
    persistTarget: ['canonical', 'none'],
    readbackAction: ['same-runtime', 'none'],
    failureSink: ['api-health-no-persist', 'api-health-visible', 'none'],
    timestampPolicy: ['source-and-ingest-separated', 'none'],
    uiSurface: ['none', 'required'],
  }

  for (const key of ['kind', 'dataClass', 'cachePolicy', 'providerPolicy', 'normalizer', 'persistTarget', 'readbackAction', 'failureSink', 'timestampPolicy', 'uiSurface']) {
    if (!contract[key]) problems.push(`surfaceContract.${key} missing`)
  }
  for (const [key, allowed] of Object.entries(enums)) {
    if (contract[key] && !allowed.includes(contract[key])) {
      problems.push(`surfaceContract.${key} invalid: ${contract[key]}`)
    }
  }

  if (item.status === 'proven') {
    if (contract.kind !== 'reusable') problems.push('proven rows must be reusable')
    if (contract.cachePolicy === 'none') problems.push('reusable rows must declare a cache policy')
    if (contract.providerPolicy !== 'policy-owned') problems.push('reusable rows must use policy-owned provider routing')
    if (contract.normalizer !== 'code-owned') problems.push('reusable rows must use code-owned normalization')
    if (contract.persistTarget !== 'canonical') problems.push('reusable rows must persist canonical rows')
    if (contract.readbackAction !== 'same-runtime') problems.push('reusable rows must declare same-runtime readback')
    if (contract.failureSink !== 'api-health-no-persist') problems.push('reusable rows must log failures without reusable persistence')
    if (contract.timestampPolicy !== 'source-and-ingest-separated') problems.push('reusable rows must separate source and ingest timestamps')
  }

  if (item.status === 'fetch-only') {
    if (contract.kind !== 'fetch-only') problems.push('fetch-only rows must declare fetch-only surface kind')
    if (contract.persistTarget !== 'none') problems.push('fetch-only rows must not declare canonical persistence')
    if (contract.readbackAction !== 'none') problems.push('fetch-only rows must not declare reusable readback')
    if (contract.timestampPolicy !== 'none') problems.push('fetch-only rows must not declare reusable timestamp separation')
    if (!['api-health-visible', 'none'].includes(contract.failureSink)) problems.push('fetch-only rows must declare visible API health failures or explicit none')
  }

  if (item.ipc && contract.uiSurface !== 'required') {
    problems.push('IPC-backed rows must require UI cache readback')
  }

  if (!item.ipc && contract.uiSurface === 'required') {
    problems.push('UI cache readback cannot be required without an IPC/panel consumer')
  }

  return problems
}
