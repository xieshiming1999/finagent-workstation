import type { DataStore } from "../data/store/data-store";
import { formatRows } from "./data-store-tool-utils";
import { readbackProvenance } from "./data-store-tool-query-common";

export function queryWindDocument(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  let sql = "SELECT * FROM wind_document WHERE 1=1";
  const params: unknown[] = [];
  const tool = input.tool ? String(input.tool) : "";
  const code = String(input.code ?? "");
  if (tool) {
    sql += " AND tool = ?";
    params.push(tool);
  }
  if (code) {
    sql += " AND entity_code = ?";
    params.push(code);
  }
  sql += " ORDER BY published_at DESC, updated_at DESC LIMIT ?";
  params.push(Number(input.limit ?? 50));
  const rows = ds.query<Record<string, unknown>>(sql, ...params);
  if (rows.length === 0)
    return "No Wind document rows. Persist financial_docs results first.";
  return formatRows(
    "Wind documents",
    rows,
    (r) =>
      `${r.published_at ?? "-"} ${r.entity_code ?? "-"} ${r.title ?? "-"} ${r.publisher ?? "-"} ${r.url ?? ""}`.trim(),
    readbackProvenance(
      "wind.financial_document",
      "wind_document",
      "wind_document",
      "query_wind_document",
    ),
  );
}

export function queryWindEconomic(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  let sql = "SELECT * FROM wind_economic_series WHERE 1=1";
  const params: unknown[] = [];
  const metricQuery = input.metricQuery ? String(input.metricQuery) : "";
  if (metricQuery) {
    sql += " AND metric_query = ?";
    params.push(metricQuery);
  }
  sql += " ORDER BY date DESC, metric_name LIMIT ?";
  params.push(Number(input.limit ?? 100));
  const rows = ds.query<Record<string, unknown>>(sql, ...params);
  if (rows.length === 0)
    return "No Wind economic series rows. Persist economic_data results first.";
  return formatRows(
    "Wind economic series",
    rows,
    (r) =>
      `${r.date} ${r.metric_name} value:${r.value_num ?? r.value_text ?? "-"} unit:${r.unit ?? "-"} freq:${r.frequency ?? "-"}`,
    readbackProvenance(
      "wind.economic_series",
      "wind_economic_series",
      "wind_economic_series",
      "query_wind_economic",
    ),
  );
}

export function queryWindAnalytics(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  let sql = "SELECT * FROM wind_analytics_result WHERE 1=1";
  const params: unknown[] = [];
  const question = input.question ? String(input.question) : "";
  if (question) {
    sql += " AND question = ?";
    params.push(question);
  }
  sql += " ORDER BY value_date DESC, updated_at DESC LIMIT ?";
  params.push(Number(input.limit ?? 100));
  const rows = ds.query<Record<string, unknown>>(sql, ...params);
  if (rows.length === 0)
    return "No Wind analytics rows. Persist analytics_data results first.";
  return formatRows(
    "Wind analytics",
    rows,
    (r) =>
      `${r.value_date ?? "-"} ${r.entity_code ?? "-"} ${r.title ?? "-"} value:${r.value_num ?? r.value_text ?? "-"} ${r.unit ?? ""}`.trim(),
    readbackProvenance(
      "wind.analytics_result",
      "wind_analytics_result",
      "wind_analytics_result",
      "query_wind_analytics",
    ),
  );
}
