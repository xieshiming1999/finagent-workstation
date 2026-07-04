import { rateLimitedFetch } from '../../../agent/data/queue/rate-limiter'
import { fetchEtfQuotes, fetchTencentListedFundQuotes, type EtfQuoteFetchResult } from '../../../agent/data/fetchers/fetcher-etf'
import { fetchFundList, type FundInfo } from '../../../agent/data/fetchers/fetcher-fund-list'
import { fetchFundMoneyYield, type FundMoneyYieldRow } from '../../../agent/data/fetchers/fetcher-fund-money-yield'
import { fetchFundNav, type FundNavRow } from '../../../agent/data/fetchers/fetcher-fund-nav'
import type { FetchResult } from '../../../agent/data/fetchers/base-fetcher'
import type { FinanceProvider } from '../../../agent/data/provider-policy'
import { runDataApiInterfaceRoute } from '../../../agent/data/data-api-interface-router'
import { readEtfQuoteRows } from '../../../agent/data/data-api-interface-cache'
import {
  cacheModeFromFetchOptions,
  providerConstraintFromFetchOptions,
  type DataApiFetchOptions,
} from '../../../agent/data/fetchers/fetcher-interface-utils'

export class FundMarketDataFetchService {
  readFundList(providers: FinanceProvider[] = [], opts: DataApiFetchOptions = {}): Promise<FetchResult<FundInfo>> {
    return rateLimitedFetch('eastmoney', () => fetchFundList({ providers, ...opts }))
  }

  readFundNav(code: string, startDate?: string, providers: FinanceProvider[] = [], opts: DataApiFetchOptions = {}): Promise<FetchResult<FundNavRow>> {
    return rateLimitedFetch('eastmoney', () => fetchFundNav(code, startDate, { providers, ...opts }))
  }

  readFundMoneyYield(code: string, startDate?: string, providers: FinanceProvider[] = [], opts: DataApiFetchOptions = {}): Promise<FetchResult<FundMoneyYieldRow>> {
    return rateLimitedFetch('eastmoney', () => fetchFundMoneyYield(code, startDate, { providers, ...opts }))
  }

  readEtfQuotes(limit: number, providers: FinanceProvider[] = [], opts: DataApiFetchOptions = {}): Promise<EtfQuoteFetchResult> {
    return runEtfQuoteRoute(limit, { providers, ...opts })
  }

  readListedFundQuotes(limit: number, providers: FinanceProvider[] = [], opts: DataApiFetchOptions = {}): Promise<EtfQuoteFetchResult> {
    return runListedFundQuoteRoute(limit, { providers, ...opts })
  }
}

async function runEtfQuoteRoute(
  limit: number,
  opts: DataApiFetchOptions = {},
): Promise<EtfQuoteFetchResult> {
  const result = await runDataApiInterfaceRoute(
    'fund.etf_quote',
    (capability) => {
      if (capability.provider !== 'eastmoney' && capability.provider !== 'akshare' && capability.provider !== 'sina' && capability.provider !== 'tencent') return null
      const source = capability.provider
      return {
        capability,
        source,
        run: () => rateLimitedFetch(source, () => fetchEtfQuotes(limit, source)),
      }
    },
    {
      label: 'ETF quotes',
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => readEtfQuoteRows({ limit }),
      ...providerConstraintFromFetchOptions(opts),
    },
  )
  return {
    ...result.data,
    provenance: {
      interfaceId: result.interfaceId,
      capabilityId: result.capabilityId,
      provider: result.provider,
      source: result.source,
      canonicalSchema: 'quote_snapshot',
      canonicalTable: 'quote_snapshot',
      cacheStatus: result.cacheStatus,
      cacheMode: result.cacheMode,
      cacheDecision: result.cacheDecision,
      fetchedAt: new Date().toISOString(),
    },
  }
}

async function runListedFundQuoteRoute(
  limit: number,
  opts: DataApiFetchOptions = {},
): Promise<EtfQuoteFetchResult> {
  const result = await runDataApiInterfaceRoute(
    'fund.listed_fund_quote',
    (capability) => {
      if (capability.provider !== 'tencent') return null
      return {
        capability,
        source: 'tencent',
        run: () => rateLimitedFetch('tencent', () => fetchTencentListedFundQuotes(limit)),
      }
    },
    {
      label: 'listed fund quotes',
      cacheMode: cacheModeFromFetchOptions(opts),
      readCache: () => readEtfQuoteRows({ limit, stockType: 'listed_fund', label: 'listed fund' }),
      ...providerConstraintFromFetchOptions(opts),
    },
  )
  return {
    ...result.data,
    provenance: {
      interfaceId: result.interfaceId,
      capabilityId: result.capabilityId,
      provider: result.provider,
      source: result.source,
      canonicalSchema: 'quote_snapshot',
      canonicalTable: 'quote_snapshot',
      cacheStatus: result.cacheStatus,
      cacheMode: result.cacheMode,
      cacheDecision: result.cacheDecision,
      fetchedAt: new Date().toISOString(),
    },
  }
}
