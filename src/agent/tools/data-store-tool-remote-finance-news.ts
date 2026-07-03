import { toolError, type ToolContext } from '../tool'
import { FinanceNewsDataApiService } from '../../domain/market/services/finance-news-data-api-service'
import { DefaultBridgeFinanceProvider } from '../../domain/market/providers/bridge-finance-provider'

const newsService = new FinanceNewsDataApiService(new DefaultBridgeFinanceProvider())

export async function financeNews(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  try {
    const result = await newsService.readNewsFeed(ctx, input)
    return JSON.stringify(
      {
        ok: true,
        action: 'finance_news',
        query:
          typeof input.query === 'string'
            ? input.query
            : typeof input.keyword === 'string'
              ? input.keyword
              : undefined,
        interfaceId: result.provenance.interfaceId,
        capabilityId: result.provenance.capabilityId,
        provider: result.provenance.provider,
        source: result.source,
        canonicalSchema: result.provenance.canonicalSchema,
        canonicalTable: result.provenance.canonicalTable,
        cacheStatus: result.cacheStatus,
        cacheMode: result.provenance.cacheMode,
        cacheDecision: result.provenance.cacheDecision,
        providerMode: result.provenance.providerMode,
        requestedProvider: result.provenance.requestedProvider,
        allowFallback: result.provenance.allowFallback,
        count: result.data.length,
        data: result.data,
        provenance: result.provenance,
      },
      null,
      2,
    )
  } catch (error) {
    return toolError(
      `finance_news failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
