import { toolError } from "../tool";
import type { DataStore } from "../data/store/data-store";
import {
  formatRows,
  queryByCodeDate,
  queryByOptionalCodeDate,
} from "./data-store-tool-utils";
import { readbackProvenance } from "./data-store-tool-query-common";

export function queryTickChart(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const code = String(input.code ?? "");
  if (!code) return toolError("code required for query_tick_chart");
  const rows = queryByCodeDate(
    ds,
    "tick_chart_intraday",
    code,
    input.date as string | undefined,
    Number(input.limit ?? 60),
    "trade_date DESC, time ASC",
  );
  if (rows.length === 0) {
    return `No tick chart rows for ${code}. Check DataStore(action:"data_health", section:"gaps") for interface/provider status; use DataStore(action:"tdx", tdx_action:"tick_chart", code:"${code}") only as explicit TDX provider validation or constrained ingestion.`;
  }
  return formatRows(
    `${code} tick chart`,
    rows,
    (r) =>
      `${r.trade_date} ${r.time} price:${r.price ?? "-"} avg:${r.avg_price ?? "-"} vol:${r.volume ?? "-"} amount:${r.amount ?? "-"}`,
    readbackProvenance(
      "stock.tick_chart_intraday",
      "tick_chart_intraday",
      "tick_chart_intraday",
      "query_tick_chart",
    ),
  );
}

export function queryTransactions(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const code = String(input.code ?? "");
  if (!code) return toolError("code required for query_transactions");
  const rows = queryByCodeDate(
    ds,
    "transactions",
    code,
    input.date as string | undefined,
    Number(input.limit ?? 60),
    "trade_date DESC, time DESC",
  );
  if (rows.length === 0) {
    return `No transaction rows for ${code}. Check DataStore(action:"data_health", section:"gaps") for interface/provider status; use DataStore(action:"tdx", tdx_action:"transactions", code:"${code}") only as explicit TDX provider validation or constrained ingestion.`;
  }
  return formatRows(
    `${code} transactions`,
    rows,
    (r) =>
      `${r.trade_date} ${r.time} price:${r.price ?? "-"} vol:${r.volume ?? "-"} dir:${r.direction ?? "-"} amount:${r.amount ?? "-"}`,
    readbackProvenance(
      "stock.transactions",
      "transactions",
      "transactions",
      "query_transactions",
    ),
  );
}

export function queryVolumeProfile(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const code = String(input.code ?? "");
  if (!code) return toolError("code required for query_volume_profile");
  const rows = queryByCodeDate(
    ds,
    "volume_profile",
    code,
    input.date as string | undefined,
    Number(input.limit ?? 60),
    "trade_date DESC, price ASC",
  );
  if (rows.length === 0) {
    return `No volume profile rows for ${code}. Check DataStore(action:"data_health", section:"gaps") for interface/provider status; use DataStore(action:"tdx", tdx_action:"volume_profile", code:"${code}") only as explicit TDX provider validation or constrained ingestion.`;
  }
  return formatRows(
    `${code} volume profile`,
    rows,
    (r) =>
      `${r.trade_date} price:${r.price ?? "-"} vol:${r.volume ?? "-"} pct:${r.pct ?? "-"}`,
    readbackProvenance(
      "stock.volume_profile",
      "volume_profile",
      "volume_profile",
      "query_volume_profile",
    ),
  );
}

export function queryXdxr(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const code = String(input.code ?? "");
  if (!code) return toolError("code required for query_xdxr");
  const rows = ds.queryXdxrEvents(code, Number(input.limit ?? 50));
  if (rows.length === 0) {
    return `No XDXR rows for ${code}. Check DataStore(action:"data_health", section:"gaps") for interface/provider status; use MarketData(action:"tdx_xdxr", code:"${code}") when available, or DataStore(action:"tdx", tdx_action:"xdxr", code:"${code}") only as explicit TDX provider validation.`;
  }
  return formatRows(
    `${code} XDXR events`,
    rows as unknown as Array<Record<string, unknown>>,
    (r) =>
      `${r.event_date} cat:${r.category} ${r.category_name ?? "-"} a:${r.a ?? "-"} b:${r.b ?? "-"} c:${r.c ?? "-"} d:${r.d ?? "-"}`,
    readbackProvenance(
      "stock.xdxr_events",
      "xdxr_event",
      "xdxr_event",
      "query_xdxr",
    ),
  );
}

export function queryAuction(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const code = String(input.code ?? "");
  if (!code) return toolError("code required for query_auction");
  const rows = ds.queryAuctionSnapshots(
    code,
    input.date as string | undefined,
    Number(input.limit ?? 100),
  );
  if (rows.length === 0) {
    return `No auction rows for ${code}. Check DataStore(action:"data_health", section:"gaps") for interface/provider status; use DataStore(action:"tdx", tdx_action:"auction", code:"${code}") only as explicit TDX provider validation or constrained ingestion.`;
  }
  return formatRows(
    `${code} auction snapshots`,
    rows as unknown as Array<Record<string, unknown>>,
    (r) =>
      `${r.trade_date} ${r.time} price:${r.price ?? "-"} volume:${r.volume ?? "-"} seq:${r.sequence}`,
    readbackProvenance(
      "stock.auction_snapshot",
      "auction_snapshot",
      "auction_snapshot",
      "query_auction",
    ),
  );
}

export function queryMomentum(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const code = String(input.code ?? "");
  if (!code) return toolError("code required for query_momentum");
  const rows = ds.queryIndexMomentum(
    code,
    input.date as string | undefined,
    Number(input.limit ?? 200),
  );
  if (rows.length === 0) {
    return `No momentum rows for ${code}. Use DataStore(action:"tdx", tdx_action:"index_momentum", code:"${code}") only as a guarded diagnostic after checking TDX sidecar health; use index quote/K-line routes for normal UI data.`;
  }
  return formatRows(
    `${code} index momentum`,
    rows as unknown as Array<Record<string, unknown>>,
    (r) => `${r.trade_date} seq:${r.sequence} value:${r.value ?? "-"}`,
    readbackProvenance(
      "index.momentum",
      "tdx_index_momentum",
      "tdx_index_momentum",
      "query_momentum",
    ),
  );
}

export function queryTopBoard(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = ds.queryTopBoard({
    code: input.code ? String(input.code) : undefined,
    category: input.category ? String(input.category) : undefined,
    side: input.side ? String(input.side) : undefined,
    boardDate: input.date ? String(input.date) : undefined,
    limit: Number(input.limit ?? 100),
  });
  if (rows.length === 0) {
    return 'No top board rows. Check DataStore(action:"data_health", section:"gaps") for interface/provider status; use DataStore(action:"tdx", tdx_action:"top_board") only as explicit TDX provider validation or constrained ingestion.';
  }
  return formatRows(
    "TDX top board",
    rows as unknown as Array<Record<string, unknown>>,
    (r) =>
      `${r.board_date} ${r.category} ${r.side} #${r.rank} ${r.code} price:${r.price ?? "-"} value:${r.value ?? "-"} market:${r.market ?? "-"}`,
    readbackProvenance(
      "market.tdx_top_board",
      "tdx_top_board",
      "tdx_top_board",
      "query_top_board",
    ),
  );
}

export function queryTdxBlockMember(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const code = String(input.code ?? "");
  const blockCode = String(input.block_code ?? input.block ?? "");
  const limit = Number(input.limit ?? 100);
  let sql = "SELECT * FROM tdx_block_member WHERE 1=1";
  const params: unknown[] = [];
  if (code) {
    sql += " AND code = ?";
    params.push(code);
  }
  if (blockCode) {
    sql += " AND block_code = ?";
    params.push(blockCode);
  }
  sql += " ORDER BY updated_at DESC, block_code, code LIMIT ?";
  params.push(limit);
  const rows = ds.query<Record<string, unknown>>(sql, ...params);
  if (rows.length === 0) {
    return 'No TDX block member rows. Check DataStore(action:"data_health", section:"gaps") for interface/provider status; use DataStore(action:"tdx", tdx_action:"block") only as explicit TDX provider validation or constrained ingestion.';
  }
  return formatRows(
    "TDX block members",
    rows,
    (r) =>
      `${r.block_code} ${r.block_name ?? "-"} -> ${r.code} ${r.name ?? ""} [${r.block_type ?? "-"}]`,
    readbackProvenance(
      "market.tdx_block_member",
      "tdx_block_member",
      "tdx_block_member",
      "query_tdx_block_member",
    ),
  );
}

export function queryHotRank(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = queryByOptionalCodeDate(
    ds,
    "hot_rank",
    input,
    "date DESC, rank ASC",
    Number(input.limit ?? 50),
  );
  if (rows.length === 0) {
    return 'No hot rank rows. Use MarketData(action:"hot_rank") first so the data API interface can select an eligible provider and persist canonical rows.';
  }
  return formatRows(
    "Hot rank",
    rows,
    (r) =>
      `${r.date} #${r.rank ?? "-"} ${r.code} ${r.name ?? ""} heat:${r.heat ?? "-"} change:${r.rank_change ?? "-"}`,
    readbackProvenance(
      "market.hot_rank",
      "hot_rank",
      "hot_rank",
      "query_hot_rank",
    ),
  );
}

export function queryDragonTiger(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = queryByOptionalCodeDate(
    ds,
    "dragon_tiger",
    input,
    "date DESC, code",
    Number(input.limit ?? 50),
  );
  if (rows.length === 0) {
    return 'No dragon tiger rows. Use MarketData(action:"dragon_tiger") first so the data API interface can select an eligible provider and persist canonical rows.';
  }
  return formatRows(
    "Dragon tiger",
    rows,
    (r) =>
      `${r.date} ${r.code} ${r.name ?? ""} ${r.reason} net:${r.net_amt ?? "-"} buy:${r.buy_amt ?? "-"} sell:${r.sell_amt ?? "-"}`,
    readbackProvenance(
      "market.dragon_tiger",
      "dragon_tiger",
      "dragon_tiger",
      "query_dragon_tiger",
    ),
  );
}

export function queryExCategories(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = ds.queryExCategories(Number(input.limit ?? 100));
  if (rows.length === 0) {
    return 'No ExTDX category rows. Check DataStore(action:"data_health", section:"gaps") for interface/provider status; use MarketData(action:"ex_categories") when available, or DataStore(action:"tdx", tdx_action:"ex/categories") only as explicit TDX provider validation.';
  }
  return formatRows(
    "ExTDX categories",
    rows as unknown as Array<Record<string, unknown>>,
    (r) => `${r.category} ${r.name} ${r.abbr ?? ""}`.trim(),
    readbackProvenance(
      "provider.table_metadata",
      "provider_table_metadata",
      "ex_category",
      "query_ex_categories",
    ),
  );
}

export function queryTdxCount(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = ds.queryTdxSecurityCounts({
    scope: input.scope ? String(input.scope) : undefined,
    market: input.market ? String(input.market) : undefined,
    limit: Number(input.limit ?? 20),
  });
  if (rows.length === 0) {
    return 'No TDX count rows. Check DataStore(action:"data_health", section:"gaps") for interface/provider status; use DataStore(action:"tdx", tdx_action:"count") or ex/count only as explicit TDX provider validation.';
  }
  return formatRows(
    "TDX security counts",
    rows as unknown as Array<Record<string, unknown>>,
    (r) => `${r.fetched_at} ${r.scope} market:${r.market} count:${r.count}`,
    readbackProvenance(
      "provider.coverage",
      "provider_coverage",
      "tdx_security_count",
      "query_tdx_count",
    ),
  );
}

export function queryTdxSampling(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = ds.queryTdxChartSampling({
    scope: input.scope ? String(input.scope) : undefined,
    code: input.code ? String(input.code) : undefined,
    market: input.market ? String(input.market) : undefined,
    category: input.category ? String(input.category) : undefined,
    limit: Number(input.limit ?? 120),
  });
  if (rows.length === 0) {
    return 'No TDX chart sampling rows. Check DataStore(action:"data_health", section:"gaps") for interface/provider status; use DataStore(action:"tdx", tdx_action:"chart_sampling", code:"000001") or ex/chart_sampling only as explicit TDX provider validation.';
  }
  return formatRows(
    "TDX chart sampling",
    rows as unknown as Array<Record<string, unknown>>,
    (r) =>
      `${r.fetched_at} ${r.scope} ${r.code} seq:${r.sequence} price:${r.price ?? "-"} preClose:${r.pre_close ?? "-"} change:${r.change ?? "-"}`,
    readbackProvenance(
      "provider.coverage",
      "provider_coverage",
      "tdx_chart_sampling",
      "query_tdx_sampling",
    ),
  );
}

export function queryExTable(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = ds.queryExTableEntries({
    code: input.code ? String(input.code) : undefined,
    category: input.category ? String(input.category) : undefined,
    limit: Number(input.limit ?? 100),
  });
  if (rows.length === 0) {
    return 'No ExTDX table rows. Check DataStore(action:"data_health", section:"gaps") for interface/provider status; use DataStore(action:"tdx", tdx_action:"ex/table") only as explicit TDX provider validation or constrained ingestion.';
  }
  return formatRows(
    "ExTDX table",
    rows as unknown as Array<Record<string, unknown>>,
    (r) =>
      `${r.entry_key} category:${r.category ?? "-"} code:${r.code} name:${r.name ?? "-"}`,
    readbackProvenance(
      "provider.table_metadata",
      "provider_table_metadata",
      "ex_table_entry",
      "query_ex_table",
    ),
  );
}
