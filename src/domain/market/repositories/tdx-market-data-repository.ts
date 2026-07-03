import type { ToolContext } from '../../../agent/tool'
import { ingestEndpointResult } from '../../../agent/data/ingestion/registry'
import { getLocalStore } from '../../../agent/tools/market-data-utils'

export class TdxMarketDataRepository {
  ingest(
    ctx: ToolContext,
    input: {
      provider: 'tdx'
      endpoint: string
      payload: unknown
      params?: Record<string, unknown>
      code?: string
      source: string
    },
  ): void {
    try {
      ingestEndpointResult(getLocalStore(ctx), input)
    } catch {}
  }

  normalizeBlockRows(
    filename: string,
    rows: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> {
    return rows.map((row) => ({
      ...row,
      BlockCode: String(
        row.BlockCode ??
            row.blockCode ??
            `${filename}:${String(row.BlockName ?? row.blockName ?? '')}`,
      ),
      BlockName: String(row.BlockName ?? row.blockName ?? ''),
      Type: String(row.Type ?? row.type ?? row.BlockType ?? row.blockType ?? ''),
      Code: String(row.Code ?? row.code ?? ''),
    })).filter((row) => row.Code)
  }
}
