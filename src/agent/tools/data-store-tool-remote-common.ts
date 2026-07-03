import { getIngestionRegistrySummary, type IngestionProvider } from '../data/ingestion/registry'

export function routePolicyFields(routed: {
  providerMode: string
  requestedProvider?: string
  allowFallback: boolean
}): {
  providerMode: string
  requestedProvider?: string
  allowFallback: boolean
} {
  return {
    providerMode: routed.providerMode,
    ...(routed.requestedProvider ? { requestedProvider: routed.requestedProvider } : {}),
    allowFallback: routed.allowFallback,
  }
}

export async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return { error: await res.text() }
  }
}

export function isKnownProviderSchema(provider: IngestionProvider, endpoint: string): boolean {
  return getIngestionRegistrySummary()
    .find((item) => item.provider === provider)
    ?.endpoints.includes(endpoint) === true
}

export function unknownSchemaMessage(provider: string, endpoint: string): string {
  return `SCHEMA_UNKNOWN: ${provider}/${endpoint} is not registered as a supported normal workflow schema. Use DataStore(action:"provider_diagnostic", provider:"${provider}", func:"${endpoint}") for bounded inspection, or add a normalizer/interface before using it as structured app data.`
}
