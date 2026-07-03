import { toolError } from "../tool";
import type { DataStore } from "../data/store/data-store";
import {
  formatRows,
  queryByOptionalCodeDate,
} from "./data-store-tool-utils";
import {
  readbackProvenanceFromRows,
} from "./data-store-tool-query-common";
import {
  createAnalysisEvidencePackage,
  type AnalysisEvidencePackage,
} from "../../domain/market/analysis/analysis-evidence-contract";

export function querySector(
  ds: DataStore,
  input: Record<string, unknown>,
  action = "query_sector",
): string {
  const type = String(input.type ?? "industry");
  const rows = ds.querySectorRanking(
    input.date as string | undefined,
    type,
    Number(input.limit ?? 30),
  );
  if (rows.length === 0)
    return 'No sector data. Use DataStore(action: "fetch", type: "sector")';
  const rowMaps = filterSectorRankingRows(
    rows as unknown as Array<Record<string, unknown>>,
  );
  if (rowMaps.length === 0) {
    const examples = rows
      .slice(0, 5)
      .map((row) => String((row as Record<string, unknown>).name ?? ""))
      .filter(Boolean)
      .join(", ");
    return [
      "No reliable sector ranking rows.",
      `Cached sector_ranking rows look like non-sector instruments${examples ? `: ${examples}` : ""}.`,
      'Refresh the governed sector source with DataStore(action: "fetch", type: "sector") before using this readback.',
    ].join("\n");
  }
  const filteredCount = rows.length - rowMaps.length;
  const provenance = readbackProvenanceFromRows(
    "market.sector_ranking",
    "sector_rank",
    "sector_ranking",
    action,
    rowMaps,
    {
      asOfKeys: ["date"],
      fetchedAtKeys: ["fetched_at", "updated_at"],
    },
  );
  let output = formatRows(
    "Sector ranking",
    rowMaps,
    (r) =>
      `#${r.rank} ${r.name} ${r.change_pct}% up:${r.up_count} down:${r.down_count}`,
    provenance,
  );
  if (filteredCount > 0) output += `\nfiltered_non_sector_rows:${filteredCount}`;
  return withAnalysisEvidence(output, sectorRankingEvidence(action, type, rowMaps, provenance));
}

export function queryBoardRanking(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const type = String(input.boardType ?? input.type ?? "industry");
  const rows = ds.querySectorRanking(
    input.date as string | undefined,
    type,
    Number(input.limit ?? 30),
  );
  if (rows.length === 0)
    return 'No board-ranking data. Use DataStore(action: "fetch", type: "sector")';
  const rowMaps = filterSectorRankingRows(
    rows as unknown as Array<Record<string, unknown>>,
  );
  if (rowMaps.length === 0) {
    const examples = rows
      .slice(0, 5)
      .map((row) => String((row as Record<string, unknown>).name ?? ""))
      .filter(Boolean)
      .join(", ");
    return [
      "No reliable board ranking rows.",
      `Cached sector_ranking rows look like non-board instruments${examples ? `: ${examples}` : ""}.`,
      'Refresh the governed sector source with DataStore(action: "fetch", type: "sector") before using this readback.',
    ].join("\n");
  }
  const filteredCount = rows.length - rowMaps.length;
  const provenance = readbackProvenanceFromRows(
    "market.board_ranking",
    "sector_rank",
    "sector_ranking",
    "query_board_ranking",
    rowMaps,
    {
      asOfKeys: ["date"],
      fetchedAtKeys: ["fetched_at", "updated_at"],
    },
  );
  let output = formatRows(
    "Board ranking",
    rowMaps,
    (r) =>
      `#${r.rank} ${r.name} ${r.change_pct}% up:${r.up_count} down:${r.down_count}`,
    provenance,
  );
  if (filteredCount > 0) output += `\nfiltered_non_board_rows:${filteredCount}`;
  return withAnalysisEvidence(output, sectorRankingEvidence("query_board_ranking", type, rowMaps, provenance));
}

function filterSectorRankingRows(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rows.filter(isLikelySectorRankingRow);
}

function isLikelySectorRankingRow(row: Record<string, unknown>): boolean {
  const code = String(row.code ?? "").trim();
  const name = String(row.name ?? "").trim();
  if (!code && !name) return false;
  if (/^BK\d{4,}$/i.test(code)) return true;
  if (/^(gn|hy|dy|area|sw|thshy|thsgn|em)[_-]/i.test(code)) return true;
  if (/(行业|板块|概念|指数|主题|地域|地区|产业链|赛道)$/.test(name)) {
    return true;
  }
  if (/认购|认沽|期权|购\d|沽\d|上证50[购沽]|沪深300[购沽]|中证500[购沽]/.test(name)) {
    return false;
  }
  if (/^(N|C|U)[\u4e00-\u9fa5A-Za-z]/.test(name)) return false;
  if (/^\d{6}$/.test(code)) return false;
  if (/^(sh|sz|bj)\d{6}$/i.test(code)) return false;
  return true;
}

function queryIndustryLike(
  ds: DataStore,
  input: Record<string, unknown>,
  emptyMessage: string,
  title: string,
  action:
    | "query_industry_map"
    | "query_sector_constituents"
    | "query_board_members",
): string {
  const code = String(input.code ?? input.sectorCode ?? input.boardCode ?? "");
  const industry = String(
    input.industry ?? input.sectorName ?? input.boardName ?? "",
  );
  const limit = Number(input.limit ?? 50);
  let sql = "SELECT * FROM industry_map WHERE 1=1";
  const params: unknown[] = [];
  if (code) {
    sql += " AND code = ?";
    params.push(code);
  }
  if (industry) {
    sql +=
      " AND (industry_l1 LIKE ? OR industry_l2 LIKE ? OR industry_l3 LIKE ?)";
    params.push(`%${industry}%`, `%${industry}%`, `%${industry}%`);
  }
  sql += " ORDER BY updated_at DESC, code LIMIT ?";
  params.push(limit);
  const rows = ds.query<Record<string, unknown>>(sql, ...params);
  if (rows.length === 0) return emptyMessage;
  return formatRows(
    title,
    rows,
    (r) =>
      `${r.code} L1:${r.industry_l1 ?? "-"} L2:${r.industry_l2 ?? "-"} L3:${r.industry_l3 ?? "-"}`,
    readbackProvenanceFromRows(
      action === "query_board_members"
        ? "market.board_members"
        : "market.sector_constituents",
      "industry_map",
      "industry_map",
      action,
      rows,
      {
        fetchedAtKeys: ["updated_at", "fetched_at"],
      },
    ),
  );
}

export function queryIndustryMap(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  return queryIndustryLike(
    ds,
    input,
    'No industry map rows. Use DataStore(action: "fetch", type: "industry") or persist sector constituents first.',
    "Industry map",
    "query_industry_map",
  );
}

export function querySectorConstituents(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  return queryIndustryLike(
    ds,
    input,
    'No sector-constituent rows. Use DataStore(action: "fetch", type: "industry") or persist sector constituents first.',
    "Sector constituents",
    "query_sector_constituents",
  );
}

export function queryBoardMembers(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  return queryIndustryLike(
    ds,
    input,
    'No board-member rows. Use DataStore(action: "fetch", type: "industry") or persist board members first.',
    "Board members",
    "query_board_members",
  );
}

export function queryNorthbound(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const kind = String(input.kind ?? "holding");
  if (kind === "flow") {
    const rows = ds.queryNorthboundFlow(
      input.date as string | undefined,
      Number(input.limit ?? 20),
    );
    if (rows.length === 0) return "No northbound flow rows.";
    const rowMaps = rows as unknown as Array<Record<string, unknown>>;
    return formatRows(
      "Northbound flow",
      rowMaps,
      (r) =>
        `${r.trade_date} ${r.mutual_type ?? "northbound"} buy:${r.buy_amount ?? "-"} sell:${r.sell_amount ?? "-"} net:${r.net_buy ?? "-"} hold:${r.hold_market_cap ?? "-"}`,
      readbackProvenanceFromRows(
        "market.northbound_flow",
        "northbound_flow",
        "northbound_flow",
        "query_northbound_flow",
        rowMaps,
        {
          asOfKeys: ["trade_date"],
          fetchedAtKeys: ["fetched_at", "updated_at"],
        },
      ),
    );
  }
  const rows = ds.queryNorthboundHolding(
    input.code ? String(input.code) : undefined,
    input.date as string | undefined,
    Number(input.limit ?? 20),
  );
  if (rows.length === 0)
    return 'No northbound holding rows. Use MarketData(action:"northbound") first.';
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  return formatRows(
    "Northbound holdings",
    rowMaps,
    (r) =>
      `${r.trade_date} ${r.code} ${r.name ?? ""} holdMCap:${r.hold_market_cap ?? "-"} holdRatio:${r.hold_ratio ?? "-"}%`,
    readbackProvenanceFromRows(
      "market.northbound_holding",
      "northbound_holding",
      "northbound_holding",
      "query_northbound_holding",
      rowMaps,
      {
        asOfKeys: ["trade_date"],
        fetchedAtKeys: ["fetched_at", "updated_at"],
      },
    ),
  );
}

export function queryLimitPool(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = ds.queryLimitPool(
    input.date as string | undefined,
    input.type as string | undefined,
  );
  if (rows.length === 0)
    return 'No limit data. Use DataStore(action: "fetch", type: "limit_pool")';
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  return formatRows(
    "Limit pool",
    rowMaps,
    (r) =>
      `${r.date} ${r.code} ${r.name} ${r.limit_type} ${r.change_pct}% ${r.limit_reason ?? ""}`,
    readbackProvenanceFromRows(
      "market.limit_pool",
      "limit_pool",
      "limit_pool",
      "query_limit_pool",
      rowMaps,
      {
        asOfKeys: ["date"],
        fetchedAtKeys: ["fetched_at", "updated_at"],
      },
    ),
  );
}

export function queryUnusual(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = ds.queryUnusualActivity(
    input.code ? String(input.code) : undefined,
    input.date as string | undefined,
    Number(input.limit ?? 50),
  );
  if (rows.length === 0)
    return 'No unusual activity rows. Use MarketData(action:"unusual") first.';
  return formatRows(
    "Unusual activity",
    rows,
    (r) =>
      `${r.event_date} ${r.event_time} ${r.code} ${r.name ?? ""} ${r.event_type} ${r.info ?? ""}`,
    readbackProvenanceFromRows(
      "market.unusual_activity",
      "unusual_activity",
      "unusual_activity",
      "query_unusual",
      rows,
      {
        asOfKeys: ["event_date"],
        fetchedAtKeys: ["fetched_at", "updated_at"],
      },
    ),
  );
}

export function queryFlowRank(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = ds.queryFlowRank(
    input.period ? String(input.period) : undefined,
    input.code ? String(input.code) : undefined,
    input.date as string | undefined,
    Number(input.limit ?? 50),
  );
  if (rows.length === 0)
    return 'No flow rank rows. Use MarketData(action:"flow_rank") first.';
  const provenance = readbackProvenanceFromRows(
    "market.flow_rank",
    "flow_rank",
    "flow_rank",
    "query_flow_rank",
    rows,
    {
      asOfKeys: ["trade_date"],
      fetchedAtKeys: ["fetched_at", "updated_at"],
    },
  );
  const output = formatRows(
    "Flow rank",
    rows,
    (r) =>
      `${r.trade_date} ${r.period} ${r.code} ${r.name ?? ""} main:${r.main_net ?? "-"} mainPct:${r.main_pct ?? "-"} super:${r.super_large_net ?? "-"} large:${r.large_net ?? "-"} medium:${r.medium_net ?? "-"}`,
    provenance,
  );
  return withAnalysisEvidence(output, flowRankEvidence(input, rows, provenance));
}

function withAnalysisEvidence(text: string, evidence: AnalysisEvidencePackage): string {
  return `${text}\nanalysisEvidence:${JSON.stringify(evidence)}`;
}

function sectorRankingEvidence(
  action: string,
  sectorType: string,
  rows: Array<Record<string, unknown>>,
  provenance: ReturnType<typeof readbackProvenanceFromRows>,
): AnalysisEvidencePackage {
  const top = rows[0];
  return createAnalysisEvidencePackage({
    kind: "sector_analysis",
    subject: { type: "sector", id: sectorType, name: action === "query_board_ranking" ? "Board ranking" : "Sector ranking" },
    observedFacts: [
      `rows=${rows.length}`,
      `sectorType=${sectorType}`,
      provenance.asOf ? `sourceDataTime=${provenance.asOf}` : "",
      top ? `top=${String(top.name ?? top.code ?? "-")}` : "",
      top?.change_pct != null ? `topChangePct=${String(top.change_pct)}` : "",
    ].filter(Boolean),
    interpretations: [
      rows.length === 0 ? "sector_rank:missing" : "sector_rank:available",
      "sector_rotation:readback_evidence",
    ],
    missingEvidence: [
      "sector_constituents",
      "money_flow_confirmation",
      "news_context",
      "strategy_validation",
    ],
    confidence: rows.length === 0 ? "low" : "medium",
    strategyReadiness: "analysis_only",
    sourceCoverage: {
      sources: [provenance.provider ?? "local"],
      interfaceId: provenance.interfaceId,
      capabilityId: provenance.capabilityId,
      canonicalSchema: provenance.canonicalSchema,
      canonicalTable: provenance.canonicalTable,
      readbackAction: provenance.readbackAction,
      sourceDataTime: provenance.asOf ?? undefined,
      fetchedAt: provenance.fetchedAt ?? undefined,
      cacheStatus: provenance.cacheStatus,
      coverageStatus: rows.length === 0 ? "none" : "sufficient_for_analysis",
    },
  });
}

function flowRankEvidence(
  input: Record<string, unknown>,
  rows: Array<Record<string, unknown>>,
  provenance: ReturnType<typeof readbackProvenanceFromRows>,
): AnalysisEvidencePackage {
  const top = rows[0];
  const code = input.code ? String(input.code) : "market-flow-rank";
  return createAnalysisEvidencePackage({
    kind: "flow_analysis",
    subject: { type: "flow", id: code, name: code },
    observedFacts: [
      `rows=${rows.length}`,
      provenance.asOf ? `sourceDataTime=${provenance.asOf}` : "",
      top ? `top=${String(top.name ?? top.code ?? "-")}` : "",
      top?.main_net != null ? `topMainNet=${String(top.main_net)}` : "",
    ].filter(Boolean),
    interpretations: [
      rows.length === 0 ? "flow_rank:missing" : "flow_rank:available",
      "capital_flow:readback_evidence",
    ],
    missingEvidence: [
      "sector_rotation_context",
      "price_confirmation",
      "news_context",
      "strategy_validation",
    ],
    confidence: rows.length === 0 ? "low" : "medium",
    strategyReadiness: "analysis_only",
    sourceCoverage: {
      sources: [provenance.provider ?? "local"],
      interfaceId: provenance.interfaceId,
      capabilityId: provenance.capabilityId,
      canonicalSchema: provenance.canonicalSchema,
      canonicalTable: provenance.canonicalTable,
      readbackAction: provenance.readbackAction,
      sourceDataTime: provenance.asOf ?? undefined,
      fetchedAt: provenance.fetchedAt ?? undefined,
      cacheStatus: provenance.cacheStatus,
      coverageStatus: rows.length === 0 ? "none" : "sufficient_for_analysis",
    },
  });
}

export function queryChip(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const code = String(input.code ?? "");
  if (!code) return toolError("code required for query_chip");
  const rows = ds.queryChipDistribution(
    code,
    input.date as string | undefined,
    Number(input.limit ?? 20),
  );
  if (rows.length === 0) {
    return `No chip distribution rows for ${code}. Use MarketData(action:"chip", code:"${code}") first.`;
  }
  return formatRows(
    `${code} chip distribution`,
    rows,
    (r) =>
      `${r.trade_date} avg:${r.avg_cost ?? "-"} profit:${r.profit_ratio ?? "-"} conc70:${r.concentration70 ?? "-"} conc90:${r.concentration90 ?? "-"} price:${r.current_price ?? "-"}`,
    readbackProvenanceFromRows(
      "stock.chip_distribution",
      "chip_distribution",
      "chip_distribution",
      "query_chip",
      rows,
      {
        asOfKeys: ["trade_date"],
        fetchedAtKeys: ["fetched_at", "updated_at"],
      },
    ),
  );
}
