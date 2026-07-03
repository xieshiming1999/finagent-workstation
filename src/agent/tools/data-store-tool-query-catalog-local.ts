import { toolError } from "../tool";
import type { DataStore } from "../data/store/data-store";
import { formatRows } from "./data-store-tool-utils";
import { readbackProvenance } from "./data-store-tool-query-common";

export function stockList(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const codes = String(input.code ?? input.codes ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean)
    .slice(0, 50);
  const stocks = codes.length > 0
    ? ds.query<Record<string, unknown>>(
        `SELECT * FROM stock_list WHERE code IN (${codes.map(() => "?").join(",")}) ORDER BY code`,
        ...codes,
      )
    : ds.queryStockList({
        market: input.market as string | undefined,
        industry: input.industry as string | undefined,
        type: input.type as string | undefined,
      }) as unknown as Array<Record<string, unknown>>;
  if (stocks.length === 0) {
    return codes.length > 0
      ? `No stock identity rows for ${codes.join(",")}. Use DataStore(action:"fetch", type:"stock_list") to refresh the local identity list.`
      : 'Stock list is empty. Use DataStore(action: "fetch", type: "stock_list") to download.';
  }
  return (
    formatRows(
      "Stock list",
      stocks.slice(0, stocks.length <= 20 ? 20 : 10),
      (s) => `${s.code} ${s.name} [${s.market}] ${s.industry ?? ""}`.trim(),
      readbackProvenance(
        "stock.identity_list",
        "stock_list",
        "stock_list",
        "stock_list",
      ),
    ) + (stocks.length > 20 ? `\n... and ${stocks.length - 10} more` : "")
  );
}

export function queryStockList(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const keyword = String(input.keyword ?? input.query ?? "").trim();
  const limit = Math.max(1, Math.min(Number(input.limit ?? 20), 100));
  const rows = keyword
    ? ds.searchStock(keyword).slice(0, limit)
    : ds.queryStockList({
        market: input.market as string | undefined,
        industry: input.industry as string | undefined,
        type: input.type as string | undefined,
      }).slice(0, limit);
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  return JSON.stringify(
    {
      action: "query_stock_list",
      keyword: keyword || null,
      count: rowMaps.length,
      data: rowMaps,
      provenance: readbackProvenance(
        "stock.identity_list",
        "stock_list",
        "stock_list",
        "query_stock_list",
      ),
    },
    null,
    2,
  );
}

export function fundList(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const funds = ds.query<any>(
    "SELECT * FROM fund_list ORDER BY total_size DESC LIMIT ?",
    Number(input.limit ?? 20),
  );
  if (funds.length === 0) {
    return 'Fund list is empty. Use DataStore(action: "fetch", type: "fund_list") to download.';
  }
  return formatRows(
    "Funds",
    funds as Array<Record<string, unknown>>,
    (f) =>
      `${f.code} ${f.name} [${f.fund_type ?? ""}] NAV:${f.nav ?? "-"} 1Y:${f.return_1y ?? "-"}%`,
    readbackProvenance(
      "fund.identity_list",
      "fund_list",
      "fund_list",
      "fund_list",
    ),
  );
}

export function search(ds: DataStore, input: Record<string, unknown>): string {
  const query = String(input.query ?? "");
  if (!query) return toolError("query required for search");
  const results = ds.searchStock(query);
  if (results.length === 0) return `No stocks found matching "${query}".`;
  return formatRows(
    `Stock search "${query}"`,
    results as unknown as Array<Record<string, unknown>>,
    (s) => `${s.code} ${s.name} [${s.market}] ${s.industry ?? ""}`.trim(),
    readbackProvenance(
      "stock.identity_list",
      "stock_list",
      "stock_list",
      "search",
    ),
  );
}
