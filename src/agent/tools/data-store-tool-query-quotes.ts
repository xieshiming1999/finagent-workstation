import { toolError } from "../tool";
import type { DataStore } from "../data/store/data-store";
import { formatRows } from "./data-store-tool-utils";
import {
  latestRowValue,
  readbackProvenance,
} from "./data-store-tool-query-common";

export function queryQuote(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const codes = codeListInput(input);
  if (codes.length > 1 && !input.code) {
    return codes
      .slice(0, Math.max(1, Math.min(Number(input.limit ?? codes.length), 20)))
      .map((code) => queryQuoteReadback(ds, { ...input, code, limit: 1, codes: undefined, symbols: undefined }, "query_quote"))
      .join("\n\n");
  }
  return queryQuoteReadback(ds, input, "query_quote");
}

export function queryIndexQuote(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  return queryQuoteReadbackMany(ds, input, "query_index_quote");
}

export function queryEtfQuote(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  return queryQuoteReadbackMany(ds, input, "query_etf_quote");
}

export function queryListedFundQuote(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  return queryQuoteReadbackMany(ds, input, "query_listed_fund_quote");
}

export function queryBondQuote(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  return queryQuoteReadbackMany(ds, input, "query_bond_quote");
}

function queryQuoteReadbackMany(
  ds: DataStore,
  input: Record<string, unknown>,
  action: "query_quote" | "query_index_quote" | "query_etf_quote" | "query_listed_fund_quote" | "query_bond_quote",
): string {
  const codes = codeListInput(input);
  if (codes.length > 0 && !input.code) {
    return codes
      .slice(0, Math.max(1, Math.min(Number(input.limit ?? codes.length), 20)))
      .map((code) => queryQuoteReadback(ds, { ...input, code, limit: 1, codes: undefined, symbols: undefined }, action))
      .join("\n\n");
  }
  return queryQuoteReadback(ds, input, action);
}

function queryQuoteReadback(
  ds: DataStore,
  input: Record<string, unknown>,
  action: "query_quote" | "query_index_quote" | "query_etf_quote" | "query_listed_fund_quote" | "query_bond_quote",
): string {
  const code = String(input.code ?? "");
  if (!code) return toolError(`code or codes required for ${action}`);
  const providerConstraint = providerCacheConstraint(input);
  const rows = queryQuoteSnapshotsWithConstraint(
    ds,
    code,
    Number(input.limit ?? 20),
    providerConstraint,
  );
  if (rows.length === 0) {
    if (providerConstraint.isStrict) {
      return JSON.stringify({
        action,
        code,
        provider: "local",
        providerFilter: providerConstraint.requestedProvider,
        providerMode: providerConstraint.providerMode,
        capabilityId: "local.cache",
        interfaceId: resolveQuoteTarget(ds, code, [], action).interfaceId,
        canonicalSchema: "quote_snapshot",
        canonicalTable: "quote_snapshot",
        cacheStatus: "local-miss",
        readbackAction: action,
        cacheDecision: `cacheFirst strict provider read rejected local cache rows that did not match ${providerConstraint.requestedProvider}; no quote_snapshot rows matched the requirement`,
        data: [],
      });
    }
    return `No quote snapshots for ${code}. Use MarketData(action: "quote", code: "${code}") to fetch and persist one.`;
  }
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  const target = resolveQuoteTarget(ds, code, rowMaps, action);
  return formatRows(
    `${code} quote snapshots`,
    rowMaps,
    (r) =>
      `${r.timestamp} [${r.source}] fetched:${r.fetched_at ?? "-"} ${r.name ?? r.code} price:${r.price ?? "-"} change:${r.change_pct ?? "-"}% volume:${r.volume ?? "-"} amount:${r.amount ?? "-"}`,
    readbackProvenance(
      target.interfaceId,
      "quote_snapshot",
      "quote_snapshot",
      action,
      latestRowValue(rowMaps, ["source"]) ?? "local",
      "local.cache",
      "local-hit",
      {
        asOf: latestRowValue(rowMaps, ["timestamp"]),
        fetchedAt: latestRowValue(rowMaps, ["fetched_at"]),
        ...(providerConstraint.requestedProvider ? { providerFilter: providerConstraint.requestedProvider } : {}),
        ...(providerConstraint.providerMode ? { providerMode: providerConstraint.providerMode } : {}),
        ...(providerConstraint.effectiveSource ? { cacheSourceFilter: providerConstraint.effectiveSource } : {}),
        sourceProviders: [...new Set(rowMaps.map((row) => String(row.source ?? "").trim()).filter(Boolean))],
      },
    ),
  );
}

function codeListInput(input: Record<string, unknown>): string[] {
  const value = input.codes ?? input.symbols;
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function queryQuoteSnapshotsWithConstraint(
  ds: DataStore,
  code: string,
  limit: number,
  constraint: ProviderCacheConstraint,
) {
  if (!constraint.isStrict) return ds.queryQuoteSnapshots(code, limit);
  for (const source of constraint.sourceAliases) {
    const rows = ds.queryQuoteSnapshots(code, limit, source);
    if (rows.length > 0) {
      constraint.effectiveSource = source;
      return rows;
    }
  }
  return [];
}

function providerCacheConstraint(input: Record<string, unknown>): ProviderCacheConstraint {
  const requestedProvider = String(input.provider ?? input.source ?? "").trim();
  const providerMode = String(input.providerMode ?? "").trim();
  const isStrict = Boolean(requestedProvider && providerMode.toLowerCase() === "strict");
  return {
    requestedProvider: requestedProvider || undefined,
    providerMode: providerMode || undefined,
    sourceAliases: isStrict ? providerSourceAliases(requestedProvider) : [],
    isStrict,
  };
}

function providerSourceAliases(provider: string): string[] {
  switch (provider.trim().toLowerCase()) {
    case "tdx":
    case "gotdx":
    case "tongdaxin":
    case "通达信":
      return ["tdx", "gotdx", "通达信", "通达信:index_quote"];
    case "eastmoney":
    case "em":
    case "东方财富":
      return ["eastmoney", "东方财富"];
    case "akshare":
      return ["akshare", "AkShare"];
    case "tushare":
      return ["tushare", "Tushare"];
    case "wind":
      return ["wind", "Wind"];
    case "yahoo":
    case "yfinance":
      return ["yahoo", "yfinance"];
    case "sina":
    case "新浪":
      return ["sina", "新浪"];
    case "tencent":
    case "qq":
    case "腾讯":
      return ["tencent", "腾讯"];
    default:
      return [provider];
  }
}

type ProviderCacheConstraint = {
  requestedProvider?: string
  providerMode?: string
  sourceAliases: string[]
  isStrict: boolean
  effectiveSource?: string
}

function resolveQuoteTarget(
  ds: DataStore,
  code: string,
  rows: Array<Record<string, unknown>>,
  action: "query_quote" | "query_index_quote" | "query_etf_quote" | "query_listed_fund_quote" | "query_bond_quote",
): { interfaceId: "stock.quote" | "index.quote" | "fund.etf_quote" | "fund.listed_fund_quote" | "bond.convertible_quote" } {
  if (action === "query_index_quote") return { interfaceId: "index.quote" };
  if (action === "query_etf_quote") return { interfaceId: "fund.etf_quote" };
  if (action === "query_listed_fund_quote")
    return { interfaceId: "fund.listed_fund_quote" };
  if (action === "query_bond_quote") return { interfaceId: "bond.convertible_quote" };
  const identity = ds.queryStockIdentity(code);
  const stockType = String(identity?.stock_type ?? "").toLowerCase();
  const market = String(identity?.market ?? "").toUpperCase();
  const source = String(latestRowValue(rows, ["source"]) ?? "").toLowerCase();
  const name = String(latestRowValue(rows, ["name"]) ?? identity?.name ?? "");
  if (stockType === "etf" || market === "ETF")
    return { interfaceId: "fund.etf_quote" };
  if (stockType === "listed_fund" || market === "LISTED_FUND")
    return { interfaceId: "fund.listed_fund_quote" };
  if (
    stockType === "convertible_bond" ||
    market === "CONVERTIBLE_BOND" ||
    /^(11|12)\d{4}$/.test(code)
  ) {
    return { interfaceId: "bond.convertible_quote" };
  }
  if (
    stockType === "index" ||
    source.includes("index_quote") ||
    name.includes("指数")
  ) {
    return { interfaceId: "index.quote" };
  }
  return { interfaceId: "stock.quote" };
}
