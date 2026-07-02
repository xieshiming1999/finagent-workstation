import { providerOrder, type FinanceDataTask, type FinanceProvider, type ProviderGates } from './provider-policy'

export interface ProviderRoute<T> {
  provider: FinanceProvider
  source?: string
  run: () => Promise<T>
}

export interface ProviderRouteResult<T> {
  data: T
  provider: FinanceProvider
  source: string
}

export async function runProviderRoute<T>(
  task: FinanceDataTask,
  makeRoute: (provider: FinanceProvider) => ProviderRoute<T> | null,
  opts: { gates?: ProviderGates; label?: string; preferredProviders?: FinanceProvider[] } = {},
): Promise<ProviderRouteResult<T>> {
  const providers = providerOrder(task, opts.gates ?? {}, opts.preferredProviders ?? [])
  const errors: string[] = []

  for (const provider of providers) {
    const route = makeRoute(provider)
    if (!route) continue
    const source = route.source ?? route.provider
    try {
      const data = await route.run()
      return { data, provider: route.provider, source }
    } catch (e) {
      errors.push(`${source}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const detail = errors.length > 0 ? errors.join('; ') : 'no compatible providers available'
  throw new Error(`All ${opts.label ?? task} sources failed: ${detail}`)
}
