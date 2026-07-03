import { DataStore } from "../data/store/data-store";
import { toolError } from "../tool";
import {
  type ReadbackProvenance,
  readbackTitle,
} from "./data-store-tool-utils";

export function queryOptionDailyKline(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const code = String(input.code ?? input.symbol ?? "");
  if (!code) return toolError("code required for query_option_daily_kline");
  const rows = ds.queryKline(code, {
    start: input.start as string | undefined,
    end: input.end as string | undefined,
    adjust: "none",
    limit: input.limit as number | undefined,
  });
  if (rows.length === 0) {
    const cov = ds.getCoverage(code, "kline_daily");
    if (!cov)
      return `No governed option.daily_kline data for ${code}. Use DataStore(action:"option_daily_kline", code:"${code}", range:"6mo") to download.`;
    return `No governed option.daily_kline data in the requested range. Local data covers ${cov.earliest_date} to ${cov.latest_date} (${cov.row_count} bars).`;
  }
  const cov = ds.getCoverage(code, "kline_daily");
  const header = `${readbackTitle(
    `${code} option daily kline`,
    readbackProvenance(
      "option.daily_kline",
      "kline_daily",
      "kline_daily",
      "query_option_daily_kline",
      latestRowValue(rows as unknown as Array<Record<string, unknown>>, [
        "source",
      ]) ?? "local",
      "local.cache",
      "local-hit",
      {
        asOf: latestRowValue(
          rows as unknown as Array<Record<string, unknown>>,
          ["date"],
        ),
        fetchedAt: cov?.last_updated ?? null,
      },
    ),
  )}: ${rows.length} bars (${rows[0].date} ~ ${rows[rows.length - 1].date})\n`;
  if (rows.length <= 30)
    return (
      header +
      rows
        .map(
          (r) =>
            `${r.date} O:${r.open} H:${r.high} L:${r.low} C:${r.close} V:${r.volume ?? "-"} Chg:${r.change_pct ?? "-"}%`,
        )
        .join("\n")
    );
  const first5 = rows
    .slice(0, 5)
    .map(
      (r) => `${r.date} O:${r.open} C:${r.close} Chg:${r.change_pct ?? "-"}%`,
    );
  const last5 = rows
    .slice(-5)
    .map(
      (r) => `${r.date} O:${r.open} C:${r.close} Chg:${r.change_pct ?? "-"}%`,
    );
  return `${header}${first5.join("\n")}\n... (${rows.length - 10} more rows) ...\n${last5.join("\n")}`;
}

function latestRowValue(
  rows: Array<Record<string, unknown>>,
  keys: string[],
): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    for (const key of keys) {
      const raw = row[key];
      if (raw == null) continue;
      const value = String(raw);
      if (!value) continue;
      if (!latest || value > latest) latest = value;
    }
  }
  return latest;
}

function readbackProvenance(
  interfaceId: string,
  canonicalSchema: string,
  canonicalTable: string,
  readbackAction: string,
  provider = "local",
  capabilityId = "local.cache",
  cacheStatus = "local-hit",
  extra: Partial<ReadbackProvenance> = {},
): ReadbackProvenance {
  return {
    interfaceId,
    provider,
    capabilityId,
    canonicalSchema,
    canonicalTable,
    cacheStatus,
    readbackAction,
    ...extra,
  };
}
