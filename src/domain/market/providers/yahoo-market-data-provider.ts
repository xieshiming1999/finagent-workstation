import * as dataManager from "../../../agent/data/data-manager";

export interface YahooMarketDataProvider {
  readPrice(symbol: string): Promise<Record<string, unknown> | null>;
  readHistory(
    symbol: string,
    range: string,
  ): Promise<Array<Record<string, unknown>>>;
  readEarnings(symbol: string): Promise<Record<string, unknown> | null>;
  readNews(symbol: string): Promise<Array<Record<string, unknown>>>;
  readOptionExpiries(symbol: string): Promise<Array<string>>;
  readOptionChain(
    symbol: string,
    expiry: string,
  ): Promise<Record<string, unknown> | null>;
  readActions(
    symbol: string,
  ): Promise<{
    dividends?: unknown[];
    splits?: unknown[];
    capitalGains?: unknown[];
  } | null>;
}

export class DefaultYahooMarketDataProvider implements YahooMarketDataProvider {
  readPrice(symbol: string): Promise<Record<string, unknown> | null> {
    return dataManager.getYahooPrice(symbol) as Promise<Record<
      string,
      unknown
    > | null>;
  }

  readHistory(
    symbol: string,
    range: string,
  ): Promise<Array<Record<string, unknown>>> {
    return dataManager.getYahooHistory(symbol, range) as Promise<
      Array<Record<string, unknown>>
    >;
  }

  readEarnings(symbol: string): Promise<Record<string, unknown> | null> {
    return dataManager.getYahooEarnings(symbol) as Promise<Record<
      string,
      unknown
    > | null>;
  }

  readNews(symbol: string): Promise<Array<Record<string, unknown>>> {
    return dataManager.getYahooNews(symbol) as Promise<
      Array<Record<string, unknown>>
    >;
  }

  readOptionExpiries(symbol: string): Promise<Array<string>> {
    return dataManager.getYahooOptions(symbol) as Promise<Array<string>>;
  }

  readOptionChain(
    symbol: string,
    expiry: string,
  ): Promise<Record<string, unknown> | null> {
    return dataManager.getYahooOptionChain(symbol, expiry) as Promise<Record<
      string,
      unknown
    > | null>;
  }

  readActions(
    symbol: string,
  ): Promise<{
    dividends?: unknown[];
    splits?: unknown[];
    capitalGains?: unknown[];
  } | null> {
    return dataManager.getYahooActions(symbol) as Promise<{
      dividends?: unknown[];
      splits?: unknown[];
      capitalGains?: unknown[];
    } | null>;
  }
}
