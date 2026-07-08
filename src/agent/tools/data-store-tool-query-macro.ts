import type { DataStore } from "../data/store/data-store";

export function queryMacroFactors(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = ds.queryMarketMovingFactors({
    family: clean(input.family),
    families: list(input.families),
    status: clean(input.status),
    source: clean(input.source),
    target: clean(input.target ?? input.symbol ?? input.code ?? input.query),
    assets: list(input.assets),
    regions: list(input.regions ?? input.market),
    sectors: list(input.sectors ?? input.industry),
    limit: limitOf(input.limit, 20),
  });
  return JSON.stringify(
    {
      action: "query_macro_factors",
      count: rows.length,
      status: rows.length === 0 ? "missing" : "ok",
      missingReason:
        rows.length === 0
          ? "No market_moving_factor rows matched the requested structured target/family/status filters. Treat this as an explicit macro-evidence gap, not as proof that macro factors are irrelevant."
          : null,
      provenance: {
        interfaceId: "macro.factor_radar",
        providerId: "local",
        provider: "local",
        capabilityId: "local.query_macro_factors",
        providerMode: "local-evidence",
        cacheStatus: "local-readback",
        cacheDecision:
          "read governed market_moving_factor rows before using macro context in analysis",
        canonicalSchema: "market_moving_factor_v1",
        canonicalTable: "market_moving_factor",
        readbackAction: "query_macro_factors",
        source: "local market_moving_factor",
        fetchedAt: new Date().toISOString(),
      },
      rows,
    },
    null,
    2,
  );
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : undefined;
}

function list(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => clean(item))
      .filter((item): item is string => Boolean(item));
    return items.length > 0 ? items : undefined;
  }
  const text = clean(value);
  if (!text) return undefined;
  const items = text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function limitOf(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.floor(n), 80));
}
