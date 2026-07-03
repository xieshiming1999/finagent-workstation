import { tushareCall } from '../../../agent/data/tushare-fetcher'

export interface TushareMarketDataProvider {
  readRows(
    token: string,
    apiName: string,
    params: Record<string, unknown>,
    fields?: string,
  ): Promise<Array<Record<string, unknown>>>
}

export class DefaultTushareMarketDataProvider implements TushareMarketDataProvider {
  readRows(
    token: string,
    apiName: string,
    params: Record<string, unknown>,
    fields?: string,
  ): Promise<Array<Record<string, unknown>>> {
    return tushareCall(token, apiName, params, fields)
  }
}
