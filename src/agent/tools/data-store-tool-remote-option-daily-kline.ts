import type { ToolContext } from "../tool";
import { toolError } from "../tool";
import type { DataStore } from "../data/store/data-store";
import { YahooMarketDataActionService } from "../../domain/market/services/yahoo-market-data-action-service";

export async function optionDailyKline(
  ds: DataStore,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  void ds;
  const symbol = String(input.symbol ?? input.code ?? "");
  if (!symbol) {
    return toolError(
      'symbol/code required for option_daily_kline. Example: DataStore(action:"option_daily_kline", code:"AAPL260619C00100000", range:"6mo")',
    );
  }
  const service = new YahooMarketDataActionService();
  return service.readAction(
    "option_daily_kline",
    input,
    ctx,
    symbol,
    Math.max(1, Math.min(Number(input.limit ?? 60), 200)),
  );
}
