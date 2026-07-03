import type { DataStore } from "../data/store/data-store";

export function stats(ds: DataStore): string {
  const s = ds.getStats();
  const reusable = ds.getReusableDataSummary();
  const totalRows = s.tables.reduce(
    (sum, table) => sum + Number(table.count ?? 0),
    0,
  );
  return JSON.stringify(
    {
      action: "stats",
      interfaceId: "data.store_stats",
      provider: "local",
      providerId: "local",
      capabilityId: "local.data.store_stats",
      cacheStatus: "local-evidence",
      cacheDecision:
        "stats reads local DataStore table metadata and reusable summaries; it is operational catalog evidence and does not refresh provider data",
      cacheMode: "cache-first",
      cachePolicyMode: "cacheFirst",
      canonicalSchema: "data_store_stats",
      canonicalTable: "data_store_stats",
      readbackAction: "stats",
      sizeBytes: s.sizeBytes,
      totalRows,
      tableCount: s.tables.length,
      tables: s.tables,
      reusable,
    },
    null,
    2,
  );
}
