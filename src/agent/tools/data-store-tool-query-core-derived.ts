import type { DataStore } from "../data/store/data-store";
import { formatRows } from "./data-store-tool-utils";
import {
  latestRowValue,
  readbackProvenanceFromRows,
} from "./data-store-tool-query-common";
import {
  createAnalysisEvidencePackage,
  type AnalysisEvidencePackage,
} from "../../domain/market/analysis/analysis-evidence-contract";

export function queryFinanceNews(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const keyword =
    typeof input.query === "string"
      ? input.query
      : typeof input.keyword === "string"
        ? input.keyword
        : undefined;
  let rows = ds.queryFinanceNews({
    keyword,
    source: typeof input.source === "string" ? input.source : undefined,
    limit: Number(input.limit ?? 50),
  });
  const queryMiss = rows.length === 0 && !!keyword?.trim();
  if (queryMiss) {
    rows = ds.queryFinanceNews({
      source: typeof input.source === "string" ? input.source : undefined,
      limit: Number(input.limit ?? 50),
    });
  }
  if (rows.length === 0) {
    return "No finance_news rows. Refresh the News panel or use the news.finance_feed route first.";
  }
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  const provenance = readbackProvenanceFromRows(
    "news.finance_feed",
    "finance_news",
    "finance_news",
    "query_finance_news",
    rowMaps,
    {
      asOfKeys: ["published_at"],
      fetchedAtKeys: ["fetched_at", "updated_at"],
    },
  );
  const output = formatRows(
    "finance_news",
    rowMaps,
    (r) =>
      `${r.published_at ?? "-"} [${r.source}] ${r.title ?? "-"} ${r.publisher ?? "-"} ${r.url ?? ""}`.trim(),
    provenance,
  );
  const missNote = queryMiss
    ? `\nqueryMiss:${keyword} returned no target-specific rows; using latest governed finance_news rows as broad macro/news context.`
    : "";
  return withAnalysisEvidence(`${output}${missNote}`, financeNewsEvidence(input, rowMaps));
}

function withAnalysisEvidence(text: string, evidence: AnalysisEvidencePackage): string {
  return `${text}\nanalysisEvidence:${JSON.stringify(evidence)}`;
}

function financeNewsEvidence(
  input: Record<string, unknown>,
  rows: Array<Record<string, unknown>>,
): AnalysisEvidencePackage {
  const keyword =
    typeof input.query === "string"
      ? input.query
      : typeof input.keyword === "string"
        ? input.keyword
        : "";
  const sourceDataTime = latestRowValue(rows, ["published_at"]);
  const fetchedAt = latestRowValue(rows, ["fetched_at", "updated_at"]);
  const sources = Array.from(
    new Set(
      rows
        .map((row) => row.source)
        .filter((value) => value != null && String(value).trim() !== "")
        .map((value) => String(value)),
    ),
  );
  return createAnalysisEvidencePackage({
    kind: "news_analysis",
    subject: {
      type: "news",
      id: keyword.trim() || "finance-news",
      name: keyword.trim() || "Finance news",
    },
    observedFacts: [
      `rows=${rows.length}`,
      ...(keyword.trim() ? [`keyword=${keyword.trim()}`] : []),
      ...(sourceDataTime ? [`sourceDataTime=${sourceDataTime}`] : []),
      ...(rows[0]?.title ? [`topTitle=${String(rows[0].title)}`] : []),
    ],
    interpretations: [
      rows.length === 0 ? "finance_news:missing" : "finance_news:available",
      "news_context:readback_evidence",
    ],
    missingEvidence: [
      "sentiment_scoring",
      "price_confirmation",
      "fundamental_confirmation",
      "strategy_validation",
    ],
    confidence: rows.length === 0 ? "low" : "medium",
    strategyReadiness: "analysis_only",
    sourceCoverage: {
      sources: sources.length > 0 ? sources : ["local finance_news"],
      interfaceId: "news.finance_feed",
      capabilityId: "local.cache",
      canonicalSchema: "finance_news",
      canonicalTable: "finance_news",
      readbackAction: "query_finance_news",
      sourceDataTime: sourceDataTime ?? undefined,
      fetchedAt: fetchedAt ?? undefined,
      cacheStatus: rows.length === 0 ? "local-miss" : "local-hit",
      coverageStatus: rows.length === 0 ? "none" : "sufficient_for_analysis",
    },
  });
}

export function queryMarketScreening(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = ds.queryMarketScreeningSnapshots({
    provider: typeof input.provider === "string" ? input.provider : undefined,
    symbol:
      typeof input.symbol === "string"
        ? input.symbol
        : typeof input.code === "string"
          ? input.code
          : undefined,
    sourceAction:
      typeof input.actionName === "string"
        ? input.actionName
        : typeof input.sourceAction === "string"
          ? input.sourceAction
          : undefined,
    since: typeof input.since === "string" ? input.since : undefined,
    limit: Number(input.limit ?? 50),
  });
  if (rows.length === 0) {
    return 'No governed market.screening rows. Use MarketData(action:"scan") for TradingView, DataStore(action:"screen_stock"/"screen_fund") for AkShare sidecar screening, or a configured Wind screening workflow before readback.';
  }
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  return formatRows(
    "market_screening_snapshot",
    rowMaps,
    (r) =>
      `${r.screened_at} [${r.provider}/${r.source_action}] #${r.rank ?? "-"} ${r.symbol} ${r.name ?? ""} score:${r.score ?? "-"} market:${r.market ?? "-"}`.trim(),
    readbackProvenanceFromRows(
      "market.screening",
      "screening_result",
      "market_screening_snapshot",
      "query_market_screening",
      rowMaps,
      {
        asOfKeys: ["screened_at"],
        fetchedAtKeys: ["fetched_at", "updated_at"],
      },
    ),
  );
}

export function queryMarginTrading(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = ds.queryMarginTradingRows({
    code: typeof input.code === "string" ? input.code : undefined,
    tradeDate: typeof input.date === "string" ? input.date : undefined,
    provider: typeof input.provider === "string" ? input.provider : undefined,
    limit: Number(input.limit ?? 100),
  });
  if (rows.length === 0) {
    return 'No margin_trading rows. Use DataStore(action:"margin_trading", code:"600519") for governed AkShare margin ingestion, or check data_health for provider status.';
  }
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  return formatRows(
    "margin_trading",
    rowMaps,
    (r) =>
      `${r.trade_date} ${r.code} ${r.name ?? ""} [${r.provider}] financingBuy:${r.financing_buy ?? "-"} financingBal:${r.financing_balance ?? "-"} shortSellVol:${r.margin_sell_volume ?? "-"} shortBal:${r.margin_balance ?? "-"} total:${r.total_balance ?? "-"} fetched:${r.fetched_at ?? "-"}`.trim(),
    readbackProvenanceFromRows(
      "market.margin_trading",
      "margin_trading",
      "margin_trading",
      "query_margin_trading",
      rowMaps,
      {
        asOfKeys: ["trade_date"],
        fetchedAtKeys: ["fetched_at"],
      },
    ),
  );
}

export function queryTechnicalIndicator(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = ds.queryTechnicalIndicatorSeries({
    symbol:
      typeof input.symbol === "string"
        ? input.symbol
        : typeof input.code === "string"
          ? input.code
          : undefined,
    indicator:
      typeof input.indicator === "string"
        ? input.indicator
        : typeof input.func === "string"
          ? input.func
          : undefined,
    fieldName:
      typeof input.fieldName === "string" ? input.fieldName : undefined,
    since: typeof input.since === "string" ? input.since : undefined,
    limit: Number(input.limit ?? 80),
  });
  if (rows.length === 0) {
    return 'No technical_indicator_series rows. Check DataStore(action:"data_health", section:"gaps") before provider work; use DataStore(action:"technical_indicator", func:"rsi", code:"600519") only for explicit indicator ingestion/validation.';
  }
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  return formatRows(
    "technical_indicator_series",
    rowMaps,
    (r) =>
      `${r.source_date} [${r.provider}/${r.indicator}] ${r.symbol} ${r.field_name}:${r.value ?? "-"} fetched:${r.fetched_at ?? "-"}`.trim(),
    readbackProvenanceFromRows(
      "technical.indicator_series",
      "technical_indicator_series",
      "technical_indicator_series",
      "query_technical_indicator",
      rowMaps,
      {
        asOfKeys: ["source_date"],
        fetchedAtKeys: ["fetched_at"],
      },
    ),
  );
}

export function queryAlphaFactors(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = ds.queryAlphaFactorRows({
    symbol:
      typeof input.symbol === "string"
        ? input.symbol
        : typeof input.code === "string"
          ? input.code
          : undefined,
    factorName:
      typeof input.factorName === "string"
        ? input.factorName
        : typeof input.factor === "string"
          ? input.factor
          : undefined,
    since: typeof input.since === "string" ? input.since : undefined,
    provider: typeof input.provider === "string" ? input.provider : undefined,
    limit: Number(input.limit ?? 120),
  });
  if (rows.length === 0) {
    return 'No alpha_factor rows. Use DataStore(action:"alpha_factors", code:"600519") for governed alpha-factor ingestion, or DataProcess(action:"factors") on mobile.';
  }
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  return formatRows(
    "alpha_factor",
    rowMaps,
    (r) =>
      `${r.source_date} [${r.provider}/${r.source_action}] ${r.symbol} ${r.factor_name}:${r.value ?? "-"} bars:${r.bars ?? "-"} fetched:${r.fetched_at ?? "-"}`.trim(),
    readbackProvenanceFromRows(
      "stock.alpha_factors",
      "alpha_factor",
      "alpha_factor",
      "query_alpha_factors",
      rowMaps,
      {
        asOfKeys: ["source_date"],
        fetchedAtKeys: ["fetched_at"],
      },
    ),
  );
}
