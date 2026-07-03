import { toolError } from "../tool";
import type { DataStore } from "../data/store/data-store";
import { formatRows } from "./data-store-tool-utils";
import {
  latestRowValue,
  readbackProvenance,
  readbackProvenanceFromRows,
} from "./data-store-tool-query-common";
import {
  createAnalysisEvidencePackage,
  type AnalysisEvidencePackage,
} from "../../domain/market/analysis/analysis-evidence-contract";

export function queryKline(
  ds: DataStore,
  input: Record<string, unknown>,
  action: "query_kline" | "query_bond_kline" = "query_kline",
): string {
  const codes = codeListInput(input);
  if (codes.length > 0 && !input.code) {
    if (codes.length === 1) {
      return queryKline(ds, { ...input, code: codes[0], codes: undefined, symbols: undefined }, action);
    }
    const limit = Math.max(1, Math.min(Number(input.limit ?? 120), 240));
    const series = codes
      .slice(0, 8)
      .map((code) => JSON.parse(queryKline(ds, { ...input, code, limit, codes: undefined, symbols: undefined }, action)));
    return JSON.stringify({
      contract: "market-kline-collection-v1",
      action,
      series,
    }, null, 2);
  }
  const code = String(input.code ?? "");
  if (!code) return toolError("code required for query_kline");
  const providerConstraint = providerCacheConstraint(input);
  const queryOpts = {
    start: input.start as string | undefined,
    end: input.end as string | undefined,
    adjust: input.adjust as string | undefined,
    limit: input.limit as number | undefined,
  };
  const rows = queryKlineWithConstraint(ds, code, queryOpts, providerConstraint);
  const interfaceId = action === "query_bond_kline" || /^(11|12)\d{4}$/.test(code)
    ? "bond.convertible_daily_kline"
    : "stock.daily_kline";
  if (rows.length === 0) {
    if (providerConstraint.isStrict) {
      return JSON.stringify({
        contract: "market-kline-result-v1",
        action,
        code,
        provider: "local",
        providerFilter: providerConstraint.requestedProvider,
        providerMode: providerConstraint.providerMode,
        capabilityId: "local.cache",
        interfaceId,
        canonicalSchema: "kline_daily",
        canonicalTable: "kline_daily",
        cacheStatus: "local-miss",
        readbackAction: action,
        cacheDecision: `cacheFirst strict provider read rejected local cache rows that did not match ${providerConstraint.requestedProvider}; no kline_daily rows matched the requirement`,
        rows: [],
      });
    }
    const cov = ds.getCoverage(code, "kline_daily");
    if (!cov) {
      return JSON.stringify({
        contract: "market-kline-result-v1",
        action,
        code,
        interfaceId,
        canonicalSchema: "kline_daily",
        canonicalTable: "kline_daily",
        cacheStatus: "local-miss",
        rows: [],
      });
    }
    return JSON.stringify({
      contract: "market-kline-result-v1",
      action,
      code,
      interfaceId,
      canonicalSchema: "kline_daily",
      canonicalTable: "kline_daily",
      cacheStatus: "range-miss",
      coverage: cov,
      rows: [],
    });
  }
  const cov = ds.getCoverage(code, "kline_daily");
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  const provenance = readbackProvenance(
      interfaceId,
      "kline_daily",
      "kline_daily",
      action,
      latestRowValue(rowMaps, ["source"]) ?? "local",
      "local.cache",
      "local-hit",
      {
        asOf: latestRowValue(rowMaps, ["date"]),
        fetchedAt: cov?.last_updated ?? null,
        ...(providerConstraint.requestedProvider ? { providerFilter: providerConstraint.requestedProvider } : {}),
        ...(providerConstraint.providerMode ? { providerMode: providerConstraint.providerMode } : {}),
        ...(providerConstraint.effectiveSource ? { cacheSourceFilter: providerConstraint.effectiveSource } : {}),
        sourceProviders: [...new Set(rowMaps.map((row) => String(row.source ?? "").trim()).filter(Boolean))],
      },
    );
  return JSON.stringify({
    contract: "market-kline-result-v1",
    action,
    code,
    period: "daily",
    adjust: input.adjust ?? null,
    interfaceId,
    canonicalSchema: "kline_daily",
    canonicalTable: "kline_daily",
    cacheStatus: "local-hit",
    provenance,
    rows,
  }, null, 2);
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

function queryKlineWithConstraint(
  ds: DataStore,
  code: string,
  opts: { start?: string; end?: string; adjust?: string; limit?: number },
  constraint: ProviderCacheConstraint,
) {
  if (!constraint.isStrict) return ds.queryKline(code, opts);
  for (const source of constraint.sourceAliases) {
    const rows = ds.queryKline(code, { ...opts, source });
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

export function queryFundamental(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const code = String(input.code ?? "");
  if (!code) return toolError("code required for query_fundamental");
  const rows = ds.queryFundamental(code);
  if (rows.length === 0) {
    return `No fundamental data for ${code}. Use DataStore(action: "fetch", code: "${code}", type: "fundamental") to download.`;
  }
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  return formatRows(
    `${code} fundamentals`,
    rowMaps,
    (r) => formatFundamentalRow(r),
    readbackProvenanceFromRows(
      "stock.daily_valuation",
      "fundamental",
      "fundamental",
      "query_fundamental",
      rowMaps,
      {
        asOfKeys: ["report_date"],
        fetchedAtKeys: ["updated_at", "fetched_at"],
      },
    ),
  );
}

export function queryStockDailyValuation(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const code = String(input.code ?? "");
  if (!code) return queryStockDailyValuationSample(ds, input);
  const rows = ds.queryFundamental(code);
  if (rows.length === 0) {
    return `No governed stock.daily_valuation rows for ${code}. Use DataStore(action: "fetch", code: "${code}", type: "fundamental") to download.`;
  }
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  const provenance = readbackProvenanceFromRows(
    "stock.daily_valuation",
    "fundamental",
    "fundamental",
    "query_stock_daily_valuation",
    rowMaps,
    {
      asOfKeys: ["report_date"],
      fetchedAtKeys: ["updated_at", "fetched_at"],
    },
  );
  const output = formatRows(
    `${code} stock.daily_valuation`,
    rowMaps,
    (r) => formatFundamentalRow(r),
    provenance,
  );
  return withAnalysisEvidence(
    output,
    valuationEvidence(code, rowMaps, "query_stock_daily_valuation"),
  );
}

function queryStockDailyValuationSample(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = ds.queryFundamentalSample({
    limit: Number(input.limit ?? 50),
    peLte: numericInput(input.pe_lte ?? input.peLte ?? input.pe_max ?? input.max_pe ?? nestedFilter(input, 'pe_lte') ?? nestedFilter(input, 'pe_max') ?? nestedFilter(input, 'max_pe')),
    peGte: numericInput(input.pe_gte ?? input.peGte ?? input.pe_min ?? input.min_pe ?? nestedFilter(input, 'pe_gte') ?? nestedFilter(input, 'pe_min') ?? nestedFilter(input, 'min_pe')),
    roeGte: numericInput(input.roe_gte ?? input.roeGte ?? input.roe_min ?? input.min_roe ?? nestedFilter(input, 'roe_gte') ?? nestedFilter(input, 'roe_min') ?? nestedFilter(input, 'min_roe')),
    latestOnly: input.latestOnly !== false,
  });
  if (rows.length === 0) {
    const availableRows = ds.queryFundamentalSample({
      limit: 8,
      latestOnly: input.latestOnly !== false,
    });
    const availableRowMaps = availableRows as unknown as Array<Record<string, unknown>>;
    return JSON.stringify({
      action: "query_stock_daily_valuation",
      interfaceId: "stock.daily_valuation",
      canonicalSchema: "fundamental",
      canonicalTable: "fundamental",
      cacheStatus: "local-miss",
      request: {
        peLte: numericInput(input.pe_lte ?? input.peLte ?? input.pe_max ?? input.max_pe ?? nestedFilter(input, 'pe_lte') ?? nestedFilter(input, 'pe_max') ?? nestedFilter(input, 'max_pe')),
        peGte: numericInput(input.pe_gte ?? input.peGte ?? input.pe_min ?? input.min_pe ?? nestedFilter(input, 'pe_gte') ?? nestedFilter(input, 'pe_min') ?? nestedFilter(input, 'min_pe')),
        roeGte: numericInput(input.roe_gte ?? input.roeGte ?? input.roe_min ?? input.min_roe ?? nestedFilter(input, 'roe_gte') ?? nestedFilter(input, 'roe_min') ?? nestedFilter(input, 'min_roe')),
        latestOnly: input.latestOnly !== false,
      },
      rows: [],
      availableLocalSample: availableRowMaps.map((row) => ({
        code: row.code,
        reportDate: row.report_date,
        peTtm: row.pe_ttm,
        pb: row.pb,
        roe: row.roe,
        source: row.source,
        updatedAt: row.updated_at,
      })),
      analysisEvidence: valuationEvidence(
        "stock-daily-valuation-sample",
        [],
        "query_stock_daily_valuation",
        "local-miss",
      ),
      note: "No local stock.daily_valuation rows matched the requested bounded sample/filter. For first-answer stock selection, disclose this governed valuation coverage gap and stop; do not retry broad screen_stock, MarketData(scan), DataTask(screen_advanced), query_quote without codes, or DataStore(fetch,type:\"fundamental\") without concrete selected codes.",
    }, null, 2);
  }
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  const provenance = readbackProvenanceFromRows(
    "stock.daily_valuation",
    "fundamental",
    "fundamental",
    "query_stock_daily_valuation",
    rowMaps,
    {
      asOfKeys: ["report_date"],
      fetchedAtKeys: ["updated_at", "fetched_at"],
    },
  );
  const output = formatRows(
    `stock.daily_valuation sample`,
    rowMaps,
    (r) => `${r.code} ${formatFundamentalRow(r)}`,
    provenance,
  );
  return withAnalysisEvidence(
    output,
    valuationEvidence(
      "stock-daily-valuation-sample",
      rowMaps,
      "query_stock_daily_valuation",
    ),
  );
}

function withAnalysisEvidence(text: string, evidence: AnalysisEvidencePackage): string {
  return `${text}\nanalysisEvidence:${JSON.stringify(evidence)}`;
}

function valuationEvidence(
  subjectId: string,
  rows: Array<Record<string, unknown>>,
  readbackAction: string,
  cacheStatus = rows.length === 0 ? "local-miss" : "local-hit",
): AnalysisEvidencePackage {
  const sourceDataTime = latestRowValue(rows, ["report_date"]);
  const fetchedAt = latestRowValue(rows, ["updated_at", "fetched_at"]);
  const top = rows[0];
  return createAnalysisEvidencePackage({
    kind: "valuation_analysis",
    subject: {
      type: "stock",
      id: subjectId,
      name: subjectId === "stock-daily-valuation-sample"
        ? "Stock daily valuation sample"
        : subjectId,
    },
    observedFacts: [
      `rows=${rows.length}`,
      ...(sourceDataTime ? [`sourceDataTime=${sourceDataTime}`] : []),
      ...(top?.code ? [`topCode=${String(top.code)}`] : []),
      ...(top?.pe_ttm != null ? [`peTtm=${String(top.pe_ttm)}`] : []),
      ...(top?.pb != null ? [`pb=${String(top.pb)}`] : []),
      ...(top?.roe != null ? [`roe=${String(top.roe)}`] : []),
    ],
    interpretations: [
      rows.length === 0
        ? "stock.daily_valuation:missing"
        : "stock.daily_valuation:available",
      "valuation_context:readback_evidence",
    ],
    missingEvidence: [
      "industry_peer_valuation",
      "earnings_quality_confirmation",
      "cash_flow_confirmation",
      "strategy_validation",
    ],
    confidence: rows.length === 0 ? "low" : "medium",
    strategyReadiness: "analysis_only",
    sourceCoverage: {
      sources: ["local fundamental"],
      interfaceId: "stock.daily_valuation",
      capabilityId: "local.cache",
      canonicalSchema: "fundamental",
      canonicalTable: "fundamental",
      readbackAction,
      sourceDataTime: sourceDataTime ?? undefined,
      fetchedAt: fetchedAt ?? undefined,
      cacheStatus,
      coverageStatus: rows.length === 0 ? "none" : "sufficient_for_analysis",
    },
  });
}

function nestedFilter(input: Record<string, unknown>, key: string): unknown {
  const filters = input.filters
  if (filters && typeof filters === 'object' && (filters as Record<string, unknown>)[key] != null) {
    return (filters as Record<string, unknown>)[key]
  }
  const params = input.params
  return params && typeof params === 'object' ? (params as Record<string, unknown>)[key] : undefined
}

function numericInput(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function formatFundamentalRow(row: Record<string, unknown>): string {
  const raw = parseRawJson(row.raw_json);
  const reportLabel = firstString(row, raw, [
    "report_type",
    "report_date_name",
    "REPORT_TYPE",
    "REPORT_DATE_NAME",
    "SECURITY_TYPE_CODE",
  ]);
  const noticeDate = firstString(row, raw, ["notice_date", "NOTICE_DATE", "ann_date", "annDate"]);
  const bps = firstValue(row, raw, [
    "bps",
    "BPS",
    "每股净资产",
    "MGJZC",
    "NET_ASSET_PS",
    "basic_eps",
  ]);
  const eps = firstValue(row, raw, ["eps_basic", "EPS_BASIC", "BASIC_EPS", "每股收益", "EPSJB"]);
  const extras = [
    reportLabel ? `Report:${reportLabel}` : null,
    noticeDate ? `Notice:${noticeDate}` : null,
    bps != null ? `BPS:${bps}` : null,
    eps != null ? `EPS:${eps}` : null,
  ].filter(Boolean).join(" ");
  return `${row.report_date} PE:${row.pe_ttm ?? "-"} PB:${row.pb ?? "-"} ROE:${row.roe ?? "-"}% Rev:${row.revenue_yoy ?? "-"}% Profit:${row.profit_yoy ?? "-"}%${extras ? ` ${extras}` : ""}`;
}

function parseRawJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function firstString(
  row: Record<string, unknown>,
  raw: Record<string, unknown> | null,
  keys: string[],
): string | null {
  const value = firstValue(row, raw, keys);
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function firstValue(
  row: Record<string, unknown>,
  raw: Record<string, unknown> | null,
  keys: string[],
): unknown {
  for (const key of keys) {
    const value = row[key] ?? raw?.[key];
    if (value != null && value !== "") return value;
  }
  return null;
}

function queryWindFundamentalReadback(
  ds: DataStore,
  input: Record<string, unknown>,
  interfaceId:
    | "fund.financials"
    | "index.fundamentals"
    | "bond.issuer_financials",
  action:
    | "query_fund_financials"
    | "query_index_fundamentals"
    | "query_bond_issuer_financials",
): string {
  const code = String(input.code ?? "");
  if (!code) return toolError(`code required for ${action}`);
  const reportDate =
    typeof input.reportDate === "string"
      ? input.reportDate
      : typeof input.date === "string"
        ? input.date
        : undefined;
  let sql = "SELECT * FROM fundamental WHERE code = ? AND source = ?";
  const params: unknown[] = [code, "Wind"];
  if (reportDate) {
    sql += " AND report_date = ?";
    params.push(reportDate);
  }
  sql += " ORDER BY report_date DESC LIMIT ?";
  params.push(Number(input.limit ?? 20));
  const rows = ds.query<Record<string, unknown>>(sql, ...params);
  if (rows.length === 0) {
    return `No governed ${interfaceId} rows for ${code}. Check DataStore(action:"data_health", section:"gaps") or fetch the Wind route first.`;
  }
  return formatRows(
    `${code} ${interfaceId}`,
    rows,
    (r) =>
      `${r.report_date} [${r.source ?? "unknown"}] PE:${r.pe_ttm ?? "-"} PB:${r.pb ?? "-"} ROE:${r.roe ?? "-"}% Rev:${r.revenue_yoy ?? "-"}% Profit:${r.profit_yoy ?? "-"}%`,
    readbackProvenanceFromRows(
      interfaceId,
      "fundamental",
      "fundamental",
      action,
      rows,
      {
        asOfKeys: ["report_date"],
        fetchedAtKeys: ["fetched_at", "updated_at"],
      },
    ),
  );
}

export function queryFundFinancials(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  return queryWindFundamentalReadback(
    ds,
    input,
    "fund.financials",
    "query_fund_financials",
  );
}

export function queryIndexFundamentals(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  return queryWindFundamentalReadback(
    ds,
    input,
    "index.fundamentals",
    "query_index_fundamentals",
  );
}

export function queryBondIssuerFinancials(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  return queryWindFundamentalReadback(
    ds,
    input,
    "bond.issuer_financials",
    "query_bond_issuer_financials",
  );
}

export function queryMoneyFlow(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const code = String(input.code ?? "");
  if (!code) return toolError("code required");
  const rows = ds.queryMoneyFlow(code, Number(input.limit ?? 30));
  if (rows.length === 0) {
    return `No money flow data for ${code}. Use DataStore(action: "fetch", type: "money_flow", code: "${code}")`;
  }
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  return formatRows(
    `${code} money flow`,
    rowMaps,
    (r) =>
      `${r.date} Main:${r.main_net} Large:${r.large_net} Super:${r.super_large_net}`,
    readbackProvenanceFromRows(
      "stock.money_flow",
      "money_flow",
      "money_flow",
      "query_money_flow",
      rowMaps,
      {
        asOfKeys: ["date"],
        fetchedAtKeys: ["fetched_at", "updated_at"],
      },
    ),
  );
}
