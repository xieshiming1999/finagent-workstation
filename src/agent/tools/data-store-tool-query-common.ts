import type { ReadbackProvenance } from "./data-store-tool-utils";

export function readbackProvenance(
  interfaceId: string,
  canonicalSchema: string,
  canonicalTable: string,
  readbackAction: string,
  provider = "local",
  capabilityId = "local.cache",
  cacheStatus = "local-hit",
  extra: Partial<ReadbackProvenance> = {},
) {
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

export function latestRowValue(
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

export function readbackProvenanceFromRows(
  interfaceId: string,
  canonicalSchema: string,
  canonicalTable: string,
  readbackAction: string,
  rows: Array<Record<string, unknown>>,
  options: {
    providerKeys?: string[];
    asOfKeys?: string[];
    fetchedAtKeys?: string[];
    providerFallback?: string;
    capabilityId?: string;
    cacheStatus?: string;
  } = {},
) {
  const provider =
    latestRowValue(rows, options.providerKeys ?? ["provider", "source"]) ??
    options.providerFallback ??
    "local";
  return readbackProvenance(
    interfaceId,
    canonicalSchema,
    canonicalTable,
    readbackAction,
    provider,
    options.capabilityId ?? "local.cache",
    options.cacheStatus ?? (rows.length === 0 ? "local-miss" : "local-hit"),
    {
      asOf: latestRowValue(
        rows,
        options.asOfKeys ?? [
          "source_date",
          "trade_date",
          "date",
          "event_date",
          "published_at",
          "report_date",
          "metric_date",
          "as_of_date",
          "timestamp",
        ],
      ),
      fetchedAt: latestRowValue(
        rows,
        options.fetchedAtKeys ?? ["fetched_at", "updated_at"],
      ),
    },
  );
}
