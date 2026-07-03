import { toolError } from "../tool";
import type { DataStore } from "../data/store/data-store";
import { formatRows, readbackTitle } from "./data-store-tool-utils";
import {
  latestRowValue,
} from "./data-store-tool-query-common";
import {
  missingYfinanceRowsMessage,
  normalizeYfinanceDataset,
  resolveYfinanceReadbackSpec,
  unsupportedYfinanceDatasetMessage,
  yfinanceQuerySpecs,
  yfinanceReadbackProvenance,
} from "./data-store-tool-query-yahoo-support";
import {
  createAnalysisEvidencePackage,
  type AnalysisEvidencePackage,
} from "../../domain/market/analysis/analysis-evidence-contract";

export function queryYfinance(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const symbol = String(input.symbol ?? input.code ?? "");
  if (!symbol) {
    return toolError(
      'symbol/code required for query_yfinance. Example: DataStore(action:"query_yfinance", dataset:"profile", symbol:"AAPL")',
    );
  }
  const requestedDataset = String(input.dataset ?? input.type ?? "profile");
  const dataset = normalizeYfinanceDataset(requestedDataset);
  const readbackAction = String(
    input._queryAction ?? input.action ?? "query_yfinance",
  );
  const limit = Number(input.limit ?? 50);
  const specs = yfinanceQuerySpecs();
  const spec = resolveYfinanceReadbackSpec(dataset, readbackAction, specs);
  if (!spec) {
    return toolError(unsupportedYfinanceDatasetMessage(requestedDataset));
  }
  const params: unknown[] = [symbol];
  let sql = `SELECT * FROM ${spec.table} WHERE symbol = ?`;
  if (spec.where) sql += ` AND ${spec.where}`;
  sql += ` ORDER BY ${spec.order} LIMIT ?`;
  params.push(limit);
  const rows = ds.query<Record<string, unknown>>(sql, ...params);
  const provenance = yfinanceReadbackProvenance(
    spec.interfaceId,
    spec.canonicalSchema,
    spec.table,
    readbackAction,
    rows.length === 0 ? "local-miss" : "local-hit",
    rows,
  );
  if (rows.length === 0) {
    const title = readbackTitle(
      `yfinance ${requestedDataset} ${symbol}`,
      provenance,
    );
    return `${title} (0):\n${missingYfinanceRowsMessage(requestedDataset, symbol)}`;
  }
  const output = formatRows(
    `yfinance ${requestedDataset} ${symbol}`,
    rows,
    spec.formatter,
    provenance,
  );
  if (dataset !== "news") return output;
  return `${output}\nanalysisEvidence:${JSON.stringify(
    globalFinanceNewsEvidence(symbol, rows, readbackAction),
  )}`;
}

function globalFinanceNewsEvidence(
  symbol: string,
  rows: Array<Record<string, unknown>>,
  readbackAction: string,
): AnalysisEvidencePackage {
  const normalizedSymbol = symbol.toUpperCase();
  const sourceDataTime = latestRowValue(rows, ["published_at"]);
  const fetchedAt = latestRowValue(rows, ["updated_at", "fetched_at"]);
  return createAnalysisEvidencePackage({
    kind: "news_analysis",
    subject: {
      type: "news",
      id: normalizedSymbol,
      name: `${normalizedSymbol} global finance news`,
    },
    observedFacts: [
      `rows=${rows.length}`,
      `symbol=${normalizedSymbol}`,
      ...(sourceDataTime ? [`sourceDataTime=${sourceDataTime}`] : []),
      ...(rows[0]?.title ? [`topTitle=${String(rows[0].title)}`] : []),
    ],
    interpretations: [
      rows.length === 0
        ? "global_finance_news:missing"
        : "global_finance_news:available",
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
      sources: ["local yfinance_news"],
      interfaceId: "global.finance_news",
      capabilityId: "yfinance.global.finance_news",
      canonicalSchema: "yfinance_news",
      canonicalTable: "yfinance_news",
      readbackAction,
      sourceDataTime: sourceDataTime ?? undefined,
      fetchedAt: fetchedAt ?? undefined,
      cacheStatus: rows.length === 0 ? "local-miss" : "local-hit",
      coverageStatus: rows.length === 0 ? "none" : "sufficient_for_analysis",
    },
  });
}
