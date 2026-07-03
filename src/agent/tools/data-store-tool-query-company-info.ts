import { toolError } from "../tool";
import type { DataStore } from "../data/store/data-store";
import { formatRows } from "./data-store-tool-utils";
import { latestRowValue, readbackProvenance } from "./data-store-tool-query-common";
import {
  createAnalysisEvidencePackage,
  type AnalysisEvidencePackage,
} from "../../domain/market/analysis/analysis-evidence-contract";

function queryGovernedCompanyInfo(
  ds: DataStore,
  input: Record<string, unknown>,
  opts: {
    interfaceId:
      | "fund.company_info"
      | "fund.investor_holders"
      | "index.profile"
      | "bond.profile"
      | "bond.market_data"
      | "stock.risk_metrics";
    action:
      | "query_fund_company_info"
      | "query_fund_investor_holders"
      | "query_index_profile"
      | "query_bond_profile"
      | "query_bond_market_data"
      | "query_stock_risk_metrics";
    defaultInfoType: string;
  },
): string {
  const code = String(input.code ?? "");
  if (!code) return toolError(`code required for ${opts.action}`);
  const infoType = String(
    input.type ?? input.info_type ?? opts.defaultInfoType,
  );
  let sql = "SELECT * FROM stock_company_info WHERE code = ? AND source = ?";
  const params: unknown[] = [code, "Wind"];
  if (infoType) {
    sql += " AND (info_type = ? OR info_type LIKE ?)";
    params.push(infoType, `${infoType}:%`);
  }
  sql += " ORDER BY updated_at DESC, info_type, title LIMIT ?";
  params.push(Number(input.limit ?? 20));
  const rows = ds.query<Record<string, unknown>>(sql, ...params);
  if (rows.length === 0) {
    return `No governed ${opts.interfaceId} rows for ${code}. Check DataStore(action:"data_health", section:"gaps") or fetch the Wind route first.`;
  }
  const output = formatRows(
    `${code} ${opts.interfaceId}`,
    rows,
    (r) =>
      `${r.info_type} ${r.title}: ${String(r.content ?? "").slice(0, 160)}`,
    readbackProvenance(
      opts.interfaceId,
      "stock_company_info",
      "stock_company_info",
      opts.action,
    ),
  );
  if (opts.interfaceId !== "stock.risk_metrics") return output;
  return `${output}\nanalysisEvidence:${JSON.stringify(
    stockRiskMetricsEvidence(code, rows, opts.action),
  )}`;
}

function stockRiskMetricsEvidence(
  code: string,
  rows: Array<Record<string, unknown>>,
  readbackAction: string,
): AnalysisEvidencePackage {
  const sourceDataTime = latestRowValue(rows, ["updated_at"]);
  const top = rows[0];
  return createAnalysisEvidencePackage({
    kind: "risk_analysis",
    subject: {
      type: "stock",
      id: code,
      name: code,
    },
    observedFacts: [
      `rows=${rows.length}`,
      ...(sourceDataTime ? [`sourceDataTime=${sourceDataTime}`] : []),
      ...(top?.title ? [`topTitle=${String(top.title)}`] : []),
      ...(top?.content ? [`topContent=${String(top.content)}`] : []),
    ],
    interpretations: [
      rows.length === 0
        ? "stock.risk_metrics:missing"
        : "stock.risk_metrics:available",
      "risk_context:readback_evidence",
    ],
    missingEvidence: [
      "technical_risk_confirmation",
      "position_size_context",
      "liquidity_confirmation",
      "strategy_validation",
    ],
    confidence: rows.length === 0 ? "low" : "medium",
    strategyReadiness: "analysis_only",
    sourceCoverage: {
      sources: ["local stock_company_info"],
      interfaceId: "stock.risk_metrics",
      capabilityId: "local.cache",
      canonicalSchema: "stock_company_info",
      canonicalTable: "stock_company_info",
      readbackAction,
      sourceDataTime: sourceDataTime ?? undefined,
      fetchedAt: sourceDataTime ?? undefined,
      cacheStatus: rows.length === 0 ? "local-miss" : "local-hit",
      coverageStatus: rows.length === 0 ? "none" : "sufficient_for_analysis",
    },
  });
}

export function queryCompanyInfo(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const code = String(input.code ?? "");
  if (!code) return toolError("code required for query_company_info");
  const infoType = String(input.type ?? input.info_type ?? "");
  const limit = Number(input.limit ?? 20);
  let sql = "SELECT * FROM stock_company_info WHERE code = ?";
  const params: unknown[] = [code];
  if (infoType) {
    sql += " AND (info_type = ? OR info_type LIKE ?)";
    params.push(infoType, `${infoType}:%`);
  }
  sql += " ORDER BY updated_at DESC, info_type, title LIMIT ?";
  params.push(limit);
  const rows = ds.query<Record<string, unknown>>(sql, ...params);
  if (rows.length === 0) {
    return `No company info rows for ${code}. Check DataStore(action:"data_health", section:"gaps") for interface/provider status; use DataStore(action:"tdx", tdx_action:"company_info", code:"${code}") only as explicit TDX provider validation or constrained ingestion.`;
  }
  return formatRows(
    `${code} company info`,
    rows,
    (r) =>
      `${r.info_type} ${r.title}: ${String(r.content ?? "").slice(0, 160)}`,
    readbackProvenance(
      "stock.company_info",
      "stock_company_info",
      "stock_company_info",
      "query_company_info",
    ),
  );
}

export function queryStockCompanyInfo(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const codes = String(input.code ?? input.codes ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (codes.length === 0) return toolError("code required for query_stock_company_info");
  const infoType = String(input.type ?? input.info_type ?? "");
  const limit = Number(input.limit ?? 20);
  const placeholders = codes.map(() => "?").join(",");
  let sql = `SELECT * FROM stock_company_info WHERE code IN (${placeholders})`;
  const params: unknown[] = [...codes];
  if (infoType) {
    sql += " AND (info_type = ? OR info_type LIKE ?)";
    params.push(infoType, `${infoType}:%`);
  }
  sql += " ORDER BY code, updated_at DESC, info_type, title LIMIT ?";
  params.push(Math.max(limit, codes.length * 3));
  const rows = ds.query<Record<string, unknown>>(sql, ...params);
  if (rows.length === 0) {
    return `No governed stock.company_info rows for ${codes.join(",")}. Check DataStore(action:"data_health", section:"gaps") for interface/provider status; use DataStore(action:"tdx", tdx_action:"company_info", code:"<code>") only as explicit TDX provider validation or constrained ingestion.`;
  }
  return formatRows(
    `${codes.join(",")} stock.company_info`,
    rows,
    (r) =>
      `${r.code} ${r.info_type} ${r.title}: ${String(r.content ?? "").slice(0, 160)}`,
    readbackProvenance(
      "stock.company_info",
      "stock_company_info",
      "stock_company_info",
      "query_stock_company_info",
    ),
  );
}

export function queryFundCompanyInfo(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  return queryGovernedCompanyInfo(ds, input, {
    interfaceId: "fund.company_info",
    action: "query_fund_company_info",
    defaultInfoType: "get_fund_company_info",
  });
}

export function queryFundInvestorHolders(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  return queryGovernedCompanyInfo(ds, input, {
    interfaceId: "fund.investor_holders",
    action: "query_fund_investor_holders",
    defaultInfoType: "get_fund_holders",
  });
}

export function queryIndexProfile(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  return queryGovernedCompanyInfo(ds, input, {
    interfaceId: "index.profile",
    action: "query_index_profile",
    defaultInfoType: "get_index_basicinfo",
  });
}

export function queryBondProfile(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  return queryGovernedCompanyInfo(ds, input, {
    interfaceId: "bond.profile",
    action: "query_bond_profile",
    defaultInfoType: "get_bond_basicinfo",
  });
}

export function queryBondMarketData(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  return queryGovernedCompanyInfo(ds, input, {
    interfaceId: "bond.market_data",
    action: "query_bond_market_data",
    defaultInfoType: "get_bond_market_data",
  });
}

export function queryStockRiskMetrics(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  return queryGovernedCompanyInfo(ds, input, {
    interfaceId: "stock.risk_metrics",
    action: "query_stock_risk_metrics",
    defaultInfoType: "get_risk_metrics",
  });
}

export function queryStockShareholders(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = ds.queryStockShareholders({
    code: typeof input.code === "string" ? input.code : undefined,
    holderName:
      typeof input.holderName === "string"
        ? input.holderName
        : typeof input.name === "string"
          ? input.name
          : typeof input.query === "string"
            ? input.query
            : undefined,
    reportDate:
      typeof input.reportDate === "string"
        ? input.reportDate
        : typeof input.date === "string"
          ? input.date
          : undefined,
    source: typeof input.source === "string" ? input.source : undefined,
    limit: Number(input.limit ?? 100),
  });
  if (rows.length === 0) {
    return 'No stock_shareholder rows. Use DataStore(action:"akshare", func:"holders", params:{code:"600519"}) only for explicit AkShare shareholder ingestion after checking data_health.';
  }
  return formatRows(
    "Stock shareholders",
    rows as unknown as Array<Record<string, unknown>>,
    (r) =>
      `${r.report_date} ${r.code} #${r.rank ?? "-"} ${r.holder_name} ${r.holder_type} shares:${r.hold_shares ?? "-"} pct:${r.hold_pct ?? "-"} announced:${r.announcement_date ?? "-"} [${r.source}]`,
    readbackProvenance(
      "stock.shareholders",
      "stock_shareholder",
      "stock_shareholder",
      "query_stock_shareholders",
    ),
  );
}
