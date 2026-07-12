import type { DataStore } from "../data/store/data-store";

import { MACRO_RESEARCH_SOURCES, type MacroResearchSource } from "./macro-research-source-catalog";

type MacroNumericSeriesCatalogRow = {
  id: string;
  provider: string;
  sourceName: string;
  seriesId: string;
  metricName: string;
  family: string;
  region: string;
  assets: string[];
  frequency: string;
  unit: string | null;
  credentialRequired: boolean;
  credentialKey: string | null;
  status: string;
  sourceUrl: string | null;
  nextAction: string;
};

const MACRO_NUMERIC_SERIES_CATALOG: MacroNumericSeriesCatalogRow[] = [
  {
    id: "fred.DGS10",
    provider: "fred",
    sourceName: "FRED",
    seriesId: "DGS10",
    metricName: "US 10Y Treasury yield",
    family: "rates_liquidity",
    region: "United States",
    assets: ["rates", "bonds", "equities", "USD"],
    frequency: "daily",
    unit: "percent",
    credentialRequired: true,
    credentialKey: "FRED_API_KEY",
    status: "credential-gated",
    sourceUrl: "https://api.stlouisfed.org/fred/series/observations",
    nextAction: "Configure FRED_API_KEY or use local readback if rows exist.",
  },
  {
    id: "bls.CUUR0000SA0",
    provider: "bls",
    sourceName: "BLS",
    seriesId: "CUUR0000SA0",
    metricName: "US CPI-U all items",
    family: "inflation",
    region: "United States",
    assets: ["rates", "bonds", "equities", "USD"],
    frequency: "monthly",
    unit: "index",
    credentialRequired: false,
    credentialKey: null,
    status: "supported",
    sourceUrl: "https://api.bls.gov/publicAPI/v2/timeseries/data/",
    nextAction: "Use macro factor refresh or local numeric readback.",
  },
  {
    id: "bea.NIPA.T10101",
    provider: "bea",
    sourceName: "BEA",
    seriesId: "NIPA:T10101",
    metricName: "US GDP and national income account headline table",
    family: "growth",
    region: "United States",
    assets: ["equities", "rates", "USD"],
    frequency: "quarterly",
    unit: "varies by line",
    credentialRequired: true,
    credentialKey: "BEA_API_KEY",
    status: "credential-gated",
    sourceUrl: "https://apps.bea.gov/api/data/",
    nextAction: "Configure BEA_API_KEY in settings or ~/.fin_electron/bea.txt.",
  },
  {
    id: "world_bank.NY.GDP.MKTP.CD",
    provider: "world_bank",
    sourceName: "World Bank",
    seriesId: "NY.GDP.MKTP.CD",
    metricName: "GDP current US dollars",
    family: "growth",
    region: "global",
    assets: ["equities", "country risk", "FX"],
    frequency: "annual",
    unit: "current US$",
    credentialRequired: false,
    credentialKey: null,
    status: "supported",
    sourceUrl: "https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD",
    nextAction: "Use macro factor refresh or local numeric readback.",
  },
  {
    id: "imf.NGDP_RPCH.USA",
    provider: "imf",
    sourceName: "IMF",
    seriesId: "NGDP_RPCH",
    metricName: "Real GDP growth forecast",
    family: "growth",
    region: "global",
    assets: ["equities", "country risk", "FX"],
    frequency: "annual",
    unit: "percent change",
    credentialRequired: false,
    credentialKey: null,
    status: "supported",
    sourceUrl: "https://www.imf.org/external/datamapper/api/v1/NGDP_RPCH",
    nextAction: "Use IMF DataMapper refresh or local numeric readback.",
  },
  {
    id: "oecd.DF_QNA_EXPENDITURE_GROWTH_OECD.B1GQ",
    provider: "oecd",
    sourceName: "OECD",
    seriesId: "DF_QNA_EXPENDITURE_GROWTH_OECD:B1GQ:OECD:GCM",
    metricName: "OECD quarterly real GDP growth",
    family: "growth",
    region: "global",
    assets: ["equities", "country risk", "FX", "rates"],
    frequency: "quarterly",
    unit: "percent",
    credentialRequired: false,
    credentialKey: null,
    status: "supported",
    sourceUrl:
      "https://sdmx.oecd.org/public/rest/v1/data/OECD.SDD.NAD,DSD_NAMAIN1@DF_QNA_EXPENDITURE_GROWTH_OECD",
    nextAction: "Use macro factor refresh or local numeric readback.",
  },
  {
    id: "eia.WCESTUS1",
    provider: "eia",
    sourceName: "EIA",
    seriesId: "WCESTUS1",
    metricName: "US commercial crude oil inventories",
    family: "commodities_energy",
    region: "United States",
    assets: ["oil", "energy equities", "inflation"],
    frequency: "weekly",
    unit: "thousand barrels",
    credentialRequired: true,
    credentialKey: "EIA_API_KEY",
    status: "credential-gated",
    sourceUrl: "https://api.eia.gov/v2/petroleum/stoc/wstk/data/",
    nextAction: "Configure EIA_API_KEY before live EIA v2 refresh.",
  },
  {
    id: "nbs_china.NBS_EASYQUERY_PENDING",
    provider: "nbs_china",
    sourceName: "NBS China",
    seriesId: "NBS_EASYQUERY_PENDING",
    metricName: "China official numeric series pending stable public contract",
    family: "china_statistics",
    region: "China",
    assets: ["A-shares", "China rates", "CNH", "commodities"],
    frequency: "varies",
    unit: null,
    credentialRequired: false,
    credentialKey: null,
    status: "security-control",
    sourceUrl: "https://data.stats.gov.cn/easyquery.htm",
    nextAction:
      "Use NBS official public pages or browser/manual evidence until a stable API contract is verified.",
  },
  {
    id: "wind.cached.economic_series",
    provider: "wind",
    sourceName: "Wind",
    seriesId: "wind_economic_series",
    metricName: "Wind economic series cache/readback",
    family: "professional_macro",
    region: "China/global",
    assets: ["equities", "rates", "funds", "commodities"],
    frequency: "varies",
    unit: "varies",
    credentialRequired: true,
    credentialKey: "WIND_API_KEY",
    status: "credential-gated",
    sourceUrl: null,
    nextAction: "Use cached Wind rows first; live refresh requires configured Wind access.",
  },
];

export function macroNumericSeriesCatalog(input: Record<string, unknown> = {}): string {
  const provider = clean(input.provider ?? input.source);
  const seriesId = clean(input.seriesId ?? input.target ?? input.query);
  const family = clean(input.family);
  const status = clean(input.status);
  const rows = MACRO_NUMERIC_SERIES_CATALOG.filter((row) => {
    if (provider && !matches(row.provider, provider) && !matches(row.sourceName, provider)) return false;
    if (seriesId && !matches(row.seriesId, seriesId) && !matches(row.metricName, seriesId)) return false;
    if (family && !matches(row.family, family)) return false;
    if (status && !matches(row.status, status)) return false;
    return true;
  }).slice(0, limitOf(input.limit, 80));
  return JSON.stringify(
    {
      action: "macro_numeric_series_catalog",
      count: rows.length,
      status: rows.length === 0 ? "missing" : "ok",
      missingReason:
        rows.length === 0
          ? "No official numeric macro series catalog rows matched the requested provider/series/family/status filters. Treat this as a catalog gap, not as evidence the macro topic is irrelevant."
          : null,
      provenance: {
        interfaceId: "macro.official_series",
        providerId: "local",
        provider: "local",
        capabilityId: "local.macro_numeric_series_catalog",
        providerMode: "catalog-readback",
        cacheStatus: "bundled-catalog",
        cacheDecision: "inspect official numeric macro series availability before refresh or readback",
        canonicalSchema: "market_moving_factor_v1",
        canonicalTable: "market_moving_factor",
        readbackAction: "query_macro_numeric_series",
        source: "bundled official numeric macro series catalog",
        fetchedAt: new Date().toISOString(),
      },
      guidance: {
        readbackRule:
          "Use query_macro_numeric_series for local rows. Use refresh only when the catalog status and credentials allow it.",
        separationRule:
          "Official numeric series are facts; research articles explain interpretation and expectations. Do not infer numeric observations from prose.",
      },
      rows,
    },
    null,
    2,
  );
}

export function macroResearchSources(input: Record<string, unknown> = {}): string {
  const provider = clean(input.provider ?? input.source);
  const categoryFilters = sourceCategoryFilters(input);
  const accessClass = clean(input.accessClass ?? input.access);
  const maxPriority = numberOf(input.priority);
  const rows = MACRO_RESEARCH_SOURCES.filter((row) => {
    if (provider && !matches(row.provider, provider) && !matches(row.providerName, provider)) return false;
    if (categoryFilters && !sourceMatchesCategory(row, categoryFilters)) return false;
    if (accessClass && !matches(row.accessClass, accessClass)) return false;
    if (maxPriority && row.priority > maxPriority) return false;
    return true;
  }).slice(0, limitOf(input.limit, 80));
  return JSON.stringify(
    {
      action: "macro_research_sources",
      count: rows.length,
      status: rows.length === 0 ? "missing" : "ok",
      missingReason:
        rows.length === 0
          ? "No macro research source catalog rows matched the requested provider/category/access filters. Treat this as a source-catalog gap, not as evidence that the source is irrelevant."
          : null,
      provenance: {
        interfaceId: "macro.research_source_catalog",
        providerId: "local",
        provider: "local",
        capabilityId: "local.macro_research_sources",
        providerMode: "catalog-readback",
        cacheStatus: "bundled-catalog",
        cacheDecision: "inspect source-specific access and category behavior before research retrieval",
        canonicalSchema: "macro_research_source_catalog_v1",
        canonicalTable: null,
        readbackAction: "macro_research_sources",
        source: "bundled macro research source catalog",
        fetchedAt: new Date().toISOString(),
      },
      guidance: {
        retrievalRule:
          "Use retrievalMethods and automationPolicy before fetching. Do not repeat blocked routes or treat anti-bot/login/security pages as retrieved evidence.",
        evidenceRule:
          "Report provider, category, source time when available, retrieved time, retrieval method, access condition, and limitation.",
      },
      rows,
    },
    null,
    2,
  );
}

const MACRO_RESEARCH_FAMILIES = [
  "macro_research_document",
  "macro_index_event",
  "macro_policy_event",
  "macro_official_series",
  "macro_commodity_event",
  "macro_source_retrieval_evidence",
];

export function macroResearchProvenance(
  ds: DataStore,
  input: Record<string, unknown> = {},
): string {
  const rows = buildMacroResearchEvidenceRows(input);
  const shouldPersist = input.persist !== false;
  if (shouldPersist && rows.length > 0) {
    ds.saveMarketMovingFactors(rows);
  }
  const readback = queryMacroResearchEvidenceRows(ds, input);
  return JSON.stringify(
    {
      action: "macro_research_provenance",
      status: "ok",
      generatedRows: rows.length,
      persisted: shouldPersist,
      count: readback.length,
      providerMatrix: buildMacroProviderMatrix(),
      provenance: macroResearchProvenanceMeta("macro_research_provenance"),
      guidance: {
        reuseRule:
          "Use query_macro_research_evidence before repeating source retrieval. Blocked/manual/licensed sources are retrieval evidence, not reusable research content.",
        promotionRule:
          "Only rows with stable source metadata and an allowed retrieval path are reusable macro research evidence.",
      },
      rows: readback,
    },
    null,
    2,
  );
}

export function queryMacroResearchEvidence(
  ds: DataStore,
  input: Record<string, unknown> = {},
): string {
  const rows = queryMacroResearchEvidenceRows(ds, input);
  return JSON.stringify(
    {
      action: "query_macro_research_evidence",
      status: rows.length === 0 ? "missing" : "ok",
      count: rows.length,
      missingReason:
        rows.length === 0
          ? "No macro research evidence rows matched the requested filters. Run macro_research_provenance first or narrow provider/category filters."
          : null,
      providerMatrix: buildMacroProviderMatrix(),
      provenance: macroResearchProvenanceMeta("query_macro_research_evidence"),
      rows,
    },
    null,
    2,
  );
}

export function queryMacroAttribution(
  ds: DataStore,
  input: Record<string, unknown> = {},
): string {
  const rows = macroAttributionRows(ds, input);
  const attributions = dedupeRows(rows)
    .slice(0, limitOf(input.limit, 20))
    .map((row) => macroAttributionRow(row));
  if (attributions.length === 0) {
    attributions.push(missingMacroAttribution(input));
  }
  return JSON.stringify(
    {
      action: "query_macro_attribution",
      status: rows.length === 0 ? "missing" : "ok",
      count: attributions.length,
      evidenceRows: rows.length,
      missingReason:
        rows.length === 0
          ? "No governed macro evidence matched the structured filters. Treat this as an attribution gap and inspect macro_research_sources or macro_numeric_series_catalog before external retrieval."
          : null,
      updateDecision: macroAttributionUpdateDecision(rows),
      provenance: {
        interfaceId: "macro.root_cause_attribution",
        providerId: "local",
        provider: "local",
        capabilityId: "local.query_macro_attribution",
        providerMode: "local-evidence-attribution",
        cacheStatus: "local-readback",
        cacheDecision:
          "build root-cause candidates from governed macro evidence before using macro context in analysis or strategy",
        canonicalSchema: "macro_attribution_v1",
        canonicalTable: null,
        evidenceSchema: "market_moving_factor_v1",
        evidenceTable: "market_moving_factor",
        readbackAction: "query_macro_attribution",
        source: "local market_moving_factor + macro research evidence",
        fetchedAt: new Date().toISOString(),
      },
      guidance: {
        analysisRule:
          "Use these rows as root-cause candidates with confidence and invalidation conditions; do not turn them into direct buy/sell signals.",
        strategyRule:
          "A strategy may use macro attribution as regime context, risk flag, sizing guard, or invalidation condition only after technical/fundamental/backtest evidence is separately validated.",
        updateRule:
          "If updateDecision.requiresUpdate is true, run the listed next actions before making a source-specific claim.",
      },
      attributions,
    },
    null,
    2,
  );
}

function queryMacroResearchEvidenceRows(
  ds: DataStore,
  input: Record<string, unknown>,
): Record<string, unknown>[] {
  const families = evidenceFamilies(input);
  const sourceFilter = sourceNameFilter(input);
  return ds.queryMarketMovingFactors({
    families,
    status: clean(input.status),
    source: sourceFilter,
    target: clean(input.target ?? input.query),
    assets: list(input.assets),
    regions: list(input.regions ?? input.market),
    sectors: list(input.sectors ?? input.industry),
    limit: limitOf(input.limit, 80),
  });
}

function macroAttributionRows(
  ds: DataStore,
  input: Record<string, unknown>,
): Record<string, unknown>[] {
  const families = macroAttributionFamilies(input);
  return ds.queryMarketMovingFactors({
    family: families ? undefined : clean(input.family),
    families,
    status: clean(input.status),
    source: sourceNameFilter(input),
    target: clean(input.target ?? input.symbol ?? input.code ?? input.query),
    assets: list(input.assets),
    regions: list(input.regions ?? input.market),
    sectors: list(input.sectors ?? input.industry),
    limit: limitOf(input.scanLimit ?? input.evidenceLimit, 80),
  });
}

function macroAttributionFamilies(input: Record<string, unknown>): string[] | undefined {
  const raw = list(input.families) ?? list(input.family);
  if (!raw) return undefined;
  const expanded = new Set<string>();
  for (const item of raw) {
    expanded.add(item);
    for (const family of EVIDENCE_FAMILY_ALIASES[normalizeKey(item)] ?? []) {
      expanded.add(family);
    }
  }
  return [...expanded];
}

function dedupeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const result: Record<string, unknown>[] = [];
  for (const row of rows) {
    const key = [
      row.factor_id,
      row.family,
      row.source_name,
      row.source_url,
      row.title,
    ].map((item) => String(item ?? "")).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

function macroAttributionRow(row: Record<string, unknown>): Record<string, unknown> {
  const retrieval = row.retrieval_test as Record<string, unknown> | undefined;
  const values = row.macro_values as Record<string, unknown> | undefined;
  const status = String(row.status ?? "");
  const family = String(row.family ?? "");
  const blocked = ["blocked", "unsupported", "licensed-needed"].includes(status) ||
    Boolean(row.failure_class);
  return {
    attributionId: row.factor_id ?? `${family}:${row.source_name ?? "macro"}`,
    category: blocked ? "data-quality" : macroAttributionCategory(family),
    claim: row.summary ?? row.title ?? "Macro evidence row requires review.",
    evidence: [
      {
        title: row.title ?? null,
        sourceName: row.source_name ?? null,
        sourceUrl: row.source_url ?? null,
        sourceType: row.source_type ?? null,
        evidenceTier: macroEvidenceTier(row),
        limitations: macroEvidenceLimitations(row),
        linkedMacroEvidenceIds: list(row.linked_macro_evidence_ids),
        sourceDataTime: row.source_published_at ?? row.event_at ?? values?.sourcePeriod ?? null,
        fetchedAt: row.fetched_at ?? values?.retrievedAt ?? null,
        status: row.status ?? null,
        family: row.family ?? null,
        affectedAssets: row.affected_assets ?? [],
        affectedRegions: row.affected_regions ?? [],
        transmissionChannels: row.transmission_channels ?? [],
        retrievalStatus: retrieval?.status ?? null,
        failureClass: row.failure_class ?? null,
      },
    ],
    confidence: blocked ? "low" : macroAttributionConfidence(row),
    timeWindow: row.source_published_at ?? row.event_at ?? values?.period ?? null,
    contradictions: [],
    missingEvidence: blocked
      ? [`Provider/source is ${status || row.failure_class}; use retrieval evidence as a limitation, not as content.`]
      : macroAttributionMissingEvidence(row),
    invalidationCondition: macroAttributionInvalidation(row),
    nextUpdateAction: macroAttributionNextAction(row),
    provenance: {
      interfaceId: "macro.root_cause_attribution",
      evidenceInterfaceId: retrieval?.interface_id ?? values?.interfaceId ?? null,
      provider: retrieval?.provider ?? row.source_name ?? null,
      capabilityId: retrieval?.capability_id ?? null,
      evidenceSchema: "market_moving_factor_v1",
      evidenceTable: "market_moving_factor",
      sourceStatus: status || null,
    },
  };
}

function macroEvidenceTier(row: Record<string, unknown>): string {
  const explicit = clean(row.evidence_tier);
  if (explicit) return explicit;
  const sourceType = String(row.source_type ?? "").toLowerCase();
  if (/official_api|official_series|official_document/.test(sourceType)) return "official_numeric_or_document";
  if (/research|content/.test(sourceType)) return "content_backed_research";
  if (sourceType.includes("news")) return "linked_news_evidence";
  if (/manual|licensed|fallback/.test(sourceType)) return "retrieval_or_manual_evidence";
  if (row.failure_class) return "missing_or_blocked";
  return "governed_macro_evidence";
}

function macroEvidenceLimitations(row: Record<string, unknown>): string[] {
  const explicit = list(row.limitations) ?? [];
  if (explicit.length > 0) return explicit;
  if (macroEvidenceTier(row) === "linked_news_evidence") {
    return [
      "Finance news is a current-event clue, not an official macro fact.",
      "Link to official data or content-backed research before making a root-cause conclusion.",
    ];
  }
  if (row.failure_class) return [`Evidence is limited by ${row.failure_class}.`];
  return [];
}

function missingMacroAttribution(input: Record<string, unknown>): Record<string, unknown> {
  return {
    attributionId: "macro:missing",
    category: "data-quality",
    claim: "No governed macro evidence matched the requested structured target.",
    evidence: [],
    confidence: "unknown",
    timeWindow: null,
    contradictions: [],
    missingEvidence: [
      "No market_moving_factor_v1 rows matched the provided target/assets/regions/sectors/family filters.",
    ],
    invalidationCondition:
      "Refresh or extract governed macro evidence, then re-run query_macro_attribution with the same structured filters.",
    nextUpdateAction:
      `Inspect macro_research_sources and macro_numeric_series_catalog for ${clean(input.target ?? input.query) ?? "the target"}, then refresh only allowed sources.`,
    provenance: {
      interfaceId: "macro.root_cause_attribution",
      evidenceSchema: "market_moving_factor_v1",
      evidenceTable: "market_moving_factor",
    },
  };
}

function macroAttributionCategory(family: string): string {
  if (family.includes("policy")) return "policy";
  if (family.includes("commodity") || family.includes("energy")) return "commodity";
  if (family.includes("index")) return "index-flow";
  if (family.includes("official") || family.includes("series") || family.includes("rates") ||
    family.includes("inflation") || family.includes("growth")) return "macro";
  if (family.includes("research") || family.includes("narrative") || family.includes("stress")) return "macro";
  return "macro";
}

function macroAttributionConfidence(row: Record<string, unknown>): string {
  const confidence = String(row.confidence ?? "");
  if (["high", "medium", "low"].includes(confidence)) return confidence;
  const retrieval = row.retrieval_test as Record<string, unknown> | undefined;
  const status = String(retrieval?.status ?? row.status ?? "");
  if (status.includes("ok") || status.includes("readable") || status === "active") return "high";
  if (status.includes("validated") || status.includes("usable") || status === "watch") return "medium";
  return "low";
}

function macroAttributionMissingEvidence(row: Record<string, unknown>): string[] {
  const missing: string[] = [];
  if (!row.source_published_at && !row.event_at) missing.push("source/event time is missing");
  if (!row.source_url) missing.push("source URL is missing");
  if (!row.evidence_items) missing.push("evidence items are missing");
  return missing;
}

function macroAttributionInvalidation(row: Record<string, unknown>): string {
  const family = String(row.family ?? "");
  if (family.includes("policy")) return "A newer official policy document or implementation notice changes the policy direction.";
  if (family.includes("commodity")) return "Updated inventory, supply, demand, or contract data contradicts this commodity pressure.";
  if (family.includes("index")) return "The index provider cancels, delays, or revises the classification/rebalance event.";
  if (family.includes("official") || family.includes("series") || family.includes("rates")) return "A newer official numeric release materially revises the series.";
  return "A newer source with better provenance contradicts the current macro evidence.";
}

function macroAttributionNextAction(row: Record<string, unknown>): string {
  const status = String(row.status ?? "");
  const retrieval = row.retrieval_test as Record<string, unknown> | undefined;
  const access = String(retrieval?.accessClass ?? row.failure_class ?? "");
  if (status === "blocked" || access.includes("anti-bot") || access.includes("manual")) {
    return "Use browser/manual source validation or an official data-delivery path; do not retry broad scraping.";
  }
  if (access.includes("licensed") || status === "licensed-needed") {
    return "Use cached readback first; live update requires the licensed provider credential/quota.";
  }
  if (status === "unsupported") {
    return "Keep the row as a limitation until a governed extraction or official API path is implemented.";
  }
  return "Use local readback; refresh only if source time is stale for the analysis horizon.";
}

function macroAttributionUpdateDecision(rows: Record<string, unknown>[]): Record<string, unknown> {
  const blocked = rows.filter((row) => {
    const status = String(row.status ?? "");
    return status === "blocked" || status === "unsupported" || Boolean(row.failure_class);
  });
  return {
    requiresUpdate: rows.length === 0 || blocked.length > 0,
    missingCount: rows.length === 0 ? 1 : 0,
    blockedCount: blocked.length,
    nextActions: rows.length === 0
      ? ["macro_research_sources", "macro_numeric_series_catalog"]
      : [...new Set(blocked.map((row) => macroAttributionNextAction(row)))],
  };
}

function sourceNameFilter(input: Record<string, unknown>): string | undefined {
  const raw = clean(input.source ?? input.provider);
  if (!raw) return undefined;
  const source = MACRO_RESEARCH_SOURCES.find((item) =>
    matches(item.provider, raw) || matches(item.providerName, raw)
  );
  return source?.providerName ?? raw;
}

function buildMacroResearchEvidenceRows(input: Record<string, unknown>): Record<string, unknown>[] {
  const now = new Date().toISOString();
  const provider = clean(input.provider ?? input.source);
  const categoryFilters = sourceCategoryFilters(input);
  const sources = MACRO_RESEARCH_SOURCES.filter((source) => {
    if (provider && !matches(source.provider, provider) && !matches(source.providerName, provider)) return false;
    if (categoryFilters && !sourceMatchesCategory(source, categoryFilters)) return false;
    return true;
  });
  return sources.flatMap((source) => macroRowsForSource(source, now));
}

function macroRowsForSource(source: MacroResearchSource, fetchedAt: string): Record<string, unknown>[] {
  const retrieval = retrievalEvidence(source, fetchedAt);
  const content = contentEvidence(source, fetchedAt);
  return content ? [content, retrieval] : [retrieval];
}

function contentEvidence(source: MacroResearchSource, fetchedAt: string): Record<string, unknown> | null {
  const family = contentFamily(source);
  if (!family) return null;
  const interfaceId = interfaceForFamily(family);
  const status = source.accessClass.includes("licensed") ? "licensed-needed" : "usable";
  return {
    factor_id: `macro:${family}:${source.provider}`,
    family,
    title: `${source.providerName} ${labelForFamily(family)}`,
    summary: `${source.providerName} is classified as ${source.evidenceValue}; usable fields include provider, category, source URL, source title, retrieval method, access class, limitation, and source/retrieved time where available.`,
    source_name: source.providerName,
    source_url: source.entryUrls[0] ?? "",
    source_type: source.evidenceValue,
    source_published_at: null,
    fetched_at: fetchedAt,
    affected_assets: affectedAssets(source),
    affected_regions: affectedRegions(source),
    affected_sectors: source.categories,
    transmission_channels: transmissionChannels(source),
    expected_direction: "context",
    severity: "medium",
    confidence: source.testedStatus.includes("readable") || source.testedStatus.includes("ok") ? "medium" : "low",
    status,
    failure_class: status === "usable" ? null : source.accessClass,
    evidence_items: source.entryUrls.map((url) => ({
      sourceUrl: url,
      sourceTitle: `${source.providerName} public source`,
      category: source.categories,
      retrievalMethod: source.retrievalMethods[0],
      accessClass: source.accessClass,
      limitation: source.limitation,
    })),
    macro_values: {
      interfaceId,
      sourceCategories: source.categories,
      extractableFields: extractableFieldsForFamily(family),
      sourcePeriod: null,
      retrievedAt: fetchedAt,
    },
    retrieval_test: {
      interface_id: interfaceId,
      capability_id: `${source.provider}.${interfaceId}`,
      provider: source.provider,
      providerName: source.providerName,
      status: source.testedStatus,
      accessClass: source.accessClass,
      retrievalMethods: source.retrievalMethods,
      automationPolicy: source.automationPolicy,
      limitation: source.limitation,
      canonical_schema: "market_moving_factor_v1",
      canonical_table: "market_moving_factor",
      readback_action: "query_macro_research_evidence",
      fetched_at: fetchedAt,
    },
    raw_json: { source, interfaceId, canonicalSchema: "market_moving_factor_v1" },
  };
}

function retrievalEvidence(source: MacroResearchSource, fetchedAt: string): Record<string, unknown> {
  const blocked = isBlockedSource(source);
  return {
    factor_id: `macro:source_retrieval:${source.provider}`,
    family: "macro_source_retrieval_evidence",
    title: `${source.providerName} retrieval policy`,
    summary: `${source.providerName} access is ${source.accessClass}; testedStatus=${source.testedStatus}; nextAction=${source.nextAction}`,
    source_name: source.providerName,
    source_url: source.entryUrls[0] ?? "",
    source_type: "source_retrieval_evidence",
    fetched_at: fetchedAt,
    affected_assets: affectedAssets(source),
    affected_regions: affectedRegions(source),
    affected_sectors: source.categories,
    transmission_channels: ["source access", "retrieval policy", source.evidenceValue],
    expected_direction: "context",
    severity: blocked ? "high" : "low",
    confidence: "high",
    status: blocked ? "blocked" : "validated",
    failure_class: blocked ? source.accessClass : null,
    evidence_items: source.entryUrls.map((url) => ({
      sourceUrl: url,
      sourceTitle: `${source.providerName} entry page`,
      retrievalMethod: source.retrievalMethods[0],
      accessClass: source.accessClass,
      testedStatus: source.testedStatus,
      limitation: source.limitation,
    })),
    macro_values: {
      interfaceId: "macro.source_retrieval_evidence",
      retrievedAt: fetchedAt,
      allowedRetrievalMethods: source.retrievalMethods,
      automationPolicy: source.automationPolicy,
    },
    retrieval_test: {
      interface_id: "macro.source_retrieval_evidence",
      capability_id: `${source.provider}.macro.source_retrieval_evidence`,
      provider: source.provider,
      providerName: source.providerName,
      status: source.testedStatus,
      accessClass: source.accessClass,
      retrievalMethods: source.retrievalMethods,
      automationPolicy: source.automationPolicy,
      limitation: source.limitation,
      canonical_schema: "market_moving_factor_v1",
      canonical_table: "market_moving_factor",
      readback_action: "query_macro_research_evidence",
      fetched_at: fetchedAt,
    },
    raw_json: { source, interfaceId: "macro.source_retrieval_evidence" },
  };
}

function buildMacroProviderMatrix(): Record<string, unknown>[] {
  return MACRO_RESEARCH_SOURCES.map((source) => ({
    provider: source.provider,
    providerName: source.providerName,
    researchDocument: providerStatusFor(source, "macro_research_document"),
    indexEvent: providerStatusFor(source, "macro_index_event"),
    policyEvent: providerStatusFor(source, "macro_policy_event"),
    officialSeries: providerStatusFor(source, "macro_official_series"),
    commodityEvent: providerStatusFor(source, "macro_commodity_event"),
    retrievalEvidence: isBlockedSource(source) ? source.accessClass : "supported",
    reason: source.limitation,
  }));
}

function providerStatusFor(source: MacroResearchSource, family: string): string {
  if (contentFamily(source) !== family) return "not-supported";
  if (source.accessClass.includes("anti-bot")) return "anti-bot";
  if (source.accessClass.includes("manual")) return "manual-browser";
  if (source.accessClass.includes("official-data-delivery")) return "official-data-delivery";
  if (source.accessClass.includes("licensed")) return "licensed-needed";
  if (source.accessClass.includes("official-api")) return "official-api";
  if (source.accessClass.includes("browser")) return "browser-supported";
  if (source.testedStatus.includes("ok") || source.testedStatus.includes("readable")) return "supported";
  return "output-only";
}

function contentFamily(source: MacroResearchSource): string | null {
  if (["research_narrative", "allocation_regime", "rates_credit_context"].includes(source.evidenceValue)) return "macro_research_document";
  if (source.evidenceValue === "official_index_event") return "macro_index_event";
  if (source.evidenceValue === "official_policy_event") return "macro_policy_event";
  if (source.evidenceValue === "official_macro_fact") return "macro_official_series";
  if (source.evidenceValue.includes("commodity") && !isBlockedSource(source)) return "macro_commodity_event";
  if (source.evidenceValue === "official_market_structure_context" && !isBlockedSource(source)) return "macro_commodity_event";
  return null;
}

function interfaceForFamily(family: string): string {
  switch (family) {
    case "macro_research_document":
      return "macro.research_document";
    case "macro_index_event":
      return "macro.index_event";
    case "macro_policy_event":
      return "macro.policy_event";
    case "macro_official_series":
      return "macro.official_series";
    case "macro_commodity_event":
      return "macro.commodity_event";
    default:
      return "macro.source_retrieval_evidence";
  }
}

function labelForFamily(family: string): string {
  return interfaceForFamily(family).replace("macro.", "").replace("_", " ");
}

function isBlockedSource(source: MacroResearchSource): boolean {
  return source.accessClass.includes("anti-bot") ||
    source.accessClass.includes("manual") ||
    source.accessClass.includes("security") ||
    source.accessClass.includes("licensed") ||
    source.automationPolicy.includes("do-not-scrape");
}

function affectedAssets(source: MacroResearchSource): string[] {
  const text = `${source.categories.join(" ")} ${source.evidenceValue} ${source.entryUrls.join(" ")}`.toLowerCase();
  const assets = new Set<string>();
  if (text.includes("copper")) assets.add("Copper");
  if (text.includes("commodity") || text.includes("copper") || text.includes("metals")) assets.add("commodities");
  if (text.includes("oil") || text.includes("energy")) assets.add("energy");
  if (text.includes("rates") || text.includes("bonds") || text.includes("credit")) assets.add("bond funds");
  if (text.includes("index") || text.includes("classification")) assets.add("passive index flows");
  if (assets.size === 0) assets.add("global macro");
  return [...assets];
}

function affectedRegions(source: MacroResearchSource): string[] {
  if (source.provider === "bea" || source.provider === "fred" || source.provider === "bls") return ["United States"];
  if (source.provider === "oecd" || source.provider === "imf") return ["global"];
  return ["global"];
}

function transmissionChannels(source: MacroResearchSource): string[] {
  const channels = ["macro research evidence", source.evidenceValue];
  if (source.evidenceValue === "official_index_event") channels.push("passive benchmark flow");
  if (source.evidenceValue.includes("commodity")) channels.push("supply demand inventory");
  if (source.categories.some((item) => item.includes("rates") || item.includes("credit"))) channels.push("rates liquidity");
  return channels;
}

function extractableFieldsForFamily(family: string): string[] {
  switch (family) {
    case "macro_research_document":
      return ["title", "provider", "canonicalUrl", "publishDate", "category", "summary", "keyClaims", "mentionedAssets", "limitation"];
    case "macro_index_event":
      return ["eventTitle", "provider", "eventType", "affectedMarket", "announcementDate", "effectiveDate", "officialDocumentUrl", "status"];
    case "macro_policy_event":
      return ["eventTitle", "provider", "policyArea", "affectedMarket", "announcementDate", "effectiveDate", "officialDocumentUrl", "status"];
    case "macro_official_series":
      return ["seriesId", "metricName", "value", "observationDate", "releaseDate", "frequency", "unit", "geography"];
    case "macro_commodity_event":
      return ["commodity", "measure", "reportPeriod", "releaseDate", "region", "unit", "sourceDocumentUrl"];
    default:
      return ["provider", "sourceUrl", "retrievalMethod", "accessClass", "testedStatus", "limitation"];
  }
}

function macroResearchProvenanceMeta(readbackAction: string): Record<string, unknown> {
  return {
    interfaceId: "macro.research_provenance",
    providerId: "local",
    provider: "local",
    capabilityId: `local.${readbackAction}`,
    providerMode: "catalog-normalized-readback",
    cacheStatus: "local-readback",
    cacheDecision: "normalize catalog source behavior into market_moving_factor_v1 rows before reuse",
    canonicalSchema: "market_moving_factor_v1",
    canonicalTable: "market_moving_factor",
    readbackAction,
    source: "bundled macro research source catalog + retrieval evidence",
    fetchedAt: new Date().toISOString(),
  };
}

export function queryMacroFactors(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const families = macroFactorFamilies(input);
  const rows = ds.queryMarketMovingFactors({
    family: families ? undefined : clean(input.family),
    families,
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

export function queryMacroNumericSeries(
  ds: DataStore,
  input: Record<string, unknown> = {},
): string {
  const rows = ds.queryMarketMovingFactors({
    families: ["macro_calendar", "macro_series", "rates_liquidity", "macro_official_series"],
    status: clean(input.status),
    source: numericSourceFilter(input),
    target: clean(input.target ?? input.seriesId ?? input.metric ?? input.query),
    assets: list(input.assets),
    regions: list(input.regions ?? input.market),
    sectors: list(input.sectors ?? input.industry),
    limit: limitOf(input.limit, 40),
  }).filter((row) => isNumericMacroRow(row));
  const series = rows.map((row) => numericSeriesRow(row));
  const gap = series.length === 0 ? macroNumericReadbackGap(input) : null;
  return JSON.stringify(
    {
      action: "query_macro_numeric_series",
      count: series.length,
      status: series.length === 0 ? "missing" : "ok",
      missingReason:
        series.length === 0
          ? gap?.reason ?? "No official numeric macro series rows matched the requested filters. Run the macro factor refresh for configured providers or inspect macro_research_sources for credential/access limits."
          : null,
      failureClass: gap?.failureClass ?? null,
      missingEvidence: gap ? [gap] : [],
      provenance: {
        interfaceId: "macro.official_series",
        providerId: "local",
        provider: "local",
        capabilityId: "local.query_macro_numeric_series",
        providerMode: "official-series-readback",
        cacheStatus: series.length === 0 ? "local-miss" : "local-readback",
        cacheDecision:
          "read official numeric macro series separately from research narratives and policy/index events",
        canonicalSchema: "market_moving_factor_v1",
        canonicalTable: "market_moving_factor",
        readbackAction: "query_macro_numeric_series",
        source: "local official macro series rows",
        fetchedAt: new Date().toISOString(),
      },
      series,
    },
    null,
    2,
  );
}

function numericSourceFilter(input: Record<string, unknown>): string | undefined {
  const raw = clean(input.source ?? input.provider);
  if (!raw) return undefined;
  const known: Record<string, string> = {
    fred: "FRED",
    bls: "BLS",
    bea: "BEA",
    eia: "EIA",
    wind: "Wind",
    imf: "IMF",
    world_bank: "World Bank",
    worldbank: "World Bank",
    oecd: "OECD",
    nbs: "NBS China",
    nbs_china: "NBS China",
    stats_china: "NBS China",
  };
  const knownValue = known[raw.toLowerCase()];
  if (knownValue) return knownValue;
  const source = MACRO_RESEARCH_SOURCES.find((item) =>
    matches(item.provider, raw) || matches(item.providerName, raw)
  );
  if (source) return source.providerName;
  return raw;
}

function isNumericMacroRow(row: Record<string, unknown>): boolean {
  const values = row.macro_values as Record<string, unknown> | undefined;
  const retrieval = row.retrieval_test as Record<string, unknown> | undefined;
  const sourceType = String(row.source_type ?? "");
  const family = String(row.family ?? "");
  const actual = values?.actual;
  const text = values?.text;
  const provider = String(retrieval?.provider ?? row.source_name ?? "").toLowerCase();
  return sourceType === "official_api" ||
    family === "macro_official_series" ||
    family === "macro_series" ||
    (["fred", "bls", "bea", "eia", "oecd", "imf", "world bank", "wind", "nbs china"].some((item) => provider.includes(item)) &&
      (actual !== undefined || text !== undefined));
}

function numericSeriesRow(row: Record<string, unknown>): Record<string, unknown> {
  const values = row.macro_values as Record<string, unknown> | undefined;
  const retrieval = row.retrieval_test as Record<string, unknown> | undefined;
  const raw = row.raw_json as Record<string, unknown> | undefined;
  const frequency = String(raw?.Frequency ?? raw?.frequency ?? row.frequency ?? "");
  const sourceDataTime = values?.period ?? row.source_published_at ?? row.event_at ?? null;
  return {
    seriesId: seriesIdForRow(row, values, raw),
    metricName: row.title ?? raw?.metric_name ?? raw?.LineDescription ?? null,
    provider: retrieval?.provider ?? row.source_name ?? null,
    sourceName: row.source_name ?? null,
    value: values?.actual ?? values?.text ?? null,
    unit: values?.unit ?? raw?.CL_UNIT ?? raw?.unit ?? null,
    frequency: frequency || null,
    sourceDataTime,
    releaseDate: row.source_published_at ?? row.event_at ?? null,
    fetchedAt: row.fetched_at ?? values?.retrievedAt ?? null,
    status: row.status ?? null,
    failureClass: row.failure_class ?? null,
    freshnessStatus: macroNumericFreshnessStatus(sourceDataTime, frequency),
    sourceUrl: row.source_url ?? null,
    family: row.family ?? null,
    provenance: {
      interfaceId: "macro.official_series",
      provider: retrieval?.provider ?? row.source_name ?? null,
      capabilityId: retrieval?.capability_id ?? null,
      canonicalSchema: "market_moving_factor_v1",
      canonicalTable: "market_moving_factor",
    sourceType: row.source_type ?? null,
    evidenceTier: macroEvidenceTier(row),
    limitations: macroEvidenceLimitations(row),
    linkedMacroEvidenceIds: list(row.linked_macro_evidence_ids),
    retrievalStatus: retrieval?.status ?? null,
    },
  };
}

function macroNumericReadbackGap(input: Record<string, unknown>): Record<string, unknown> {
  const provider = clean(input.provider ?? input.source);
  const seriesId = clean(input.seriesId ?? input.target ?? input.metric ?? input.query);
  const catalogRows = MACRO_NUMERIC_SERIES_CATALOG.filter((row) => {
    if (provider && !matches(row.provider, provider) && !matches(row.sourceName, provider)) return false;
    if (seriesId && !matches(row.seriesId, seriesId) && !matches(row.metricName, seriesId)) return false;
    return true;
  });
  const row = catalogRows[0];
  if (!row) {
    return {
      failureClass: "catalog-gap",
      reason: "No official numeric macro series catalog row matched the requested provider/series filters.",
      nextAction: "Inspect macro_numeric_series_catalog or add a governed official-series descriptor before relying on this macro number.",
    };
  }
  if (row.status === "security-control") {
    return {
      failureClass: "source-access-controlled",
      provider: row.provider,
      seriesId: row.seriesId,
      reason: `${row.sourceName} ${row.seriesId} is known but access-controlled or browser/manual-source only.`,
      nextAction: row.nextAction,
      credentialKey: row.credentialKey,
    };
  }
  if (row.credentialRequired) {
    return {
      failureClass: "credential-or-quota-required",
      provider: row.provider,
      seriesId: row.seriesId,
      reason: `${row.sourceName} ${row.seriesId} has no local official numeric readback row and requires ${row.credentialKey ?? "provider credential"} for live refresh.`,
      nextAction: row.nextAction,
      credentialKey: row.credentialKey,
    };
  }
  return {
    failureClass: "missing-local-readback",
    provider: row.provider,
    seriesId: row.seriesId,
    reason: `${row.sourceName} ${row.seriesId} is supported, but no governed local numeric row matched the filters.`,
    nextAction: row.nextAction,
  };
}

function macroNumericFreshnessStatus(value: unknown, frequency: string): string {
  const text = clean(value);
  if (!text) return "unknown";
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return "unknown";
  const ageDays = (Date.now() - date.getTime()) / 86_400_000;
  const freq = frequency.toLowerCase();
  const staleAfterDays = freq.includes("daily")
    ? 7
    : freq.includes("weekly")
      ? 21
      : freq.includes("monthly")
        ? 70
        : freq.includes("quarter")
          ? 150
          : freq.includes("annual")
            ? 460
            : 90;
  return ageDays > staleAfterDays ? "stale" : "current";
}

function seriesIdForRow(
  row: Record<string, unknown>,
  values: Record<string, unknown> | undefined,
  raw: Record<string, unknown> | undefined,
): string {
  const retrieval = row.retrieval_test as Record<string, unknown> | undefined;
  const capability = String(retrieval?.capability_id ?? "");
  if (capability.includes("fred")) return "DGS10";
  if (capability.includes("bls")) return "CUUR0000SA0";
  if (capability.includes("bea")) return "NIPA:T10101";
  if (capability.includes("world_bank")) return "NY.GDP.MKTP.CD";
  if (capability.includes("imf")) return "NGDP_RPCH";
  if (capability.includes("oecd")) return "DF_QNA_EXPENDITURE_GROWTH_OECD:B1GQ:OECD:GCM";
  if (capability.includes("eia")) return "WCESTUS1";
  if (capability.includes("nbs china") || capability.includes("nbs_china")) return "NBS_EASYQUERY_PENDING";
  return String(raw?.series_key ?? raw?.metric_code ?? values?.seriesId ?? row.factor_id ?? "macro.series");
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : undefined;
}

const SOURCE_CATEGORY_ALIASES: Record<string, string[]> = {
  commodity_research: [
    "commodities",
    "energy_supply",
    "energy_demand",
    "inventory",
    "oil_gas",
    "warehouse_stocks",
    "metals",
    "commodity_contract_context",
    "pricing_stress",
  ],
  commodity: ["commodities", "metals", "inventory", "oil_gas", "commodity_contract_context"],
  commodities: ["commodities", "metals", "inventory", "oil_gas", "commodity_contract_context"],
  metals: ["metals", "warehouse_stocks", "pricing_stress"],
  copper: ["commodities", "metals", "warehouse_stocks", "commodity_contract_context", "pricing_stress"],
  rates_liquidity: ["rates", "bonds", "credit", "duration", "liquidity", "monetary_policy", "open_market_operations"],
  policy_regulation: ["china_regulation", "capital_market_policy", "listed_company_policy", "fund_policy", "monetary_policy", "listing_rules", "market_structure_event"],
  index_classification: ["market_classification", "equity_country_classification", "country_classification", "index_review", "rebalance_event"],
  cross_asset_stress: ["asset_allocation", "regime_view", "market_outlook", "fx_liquidity", "external_balance"],
  narrative_attention: ["macro_outlook", "global_outlook", "macro_strategy", "weekly_commentary", "market_outlook"],
};

const EVIDENCE_FAMILY_ALIASES: Record<string, string[]> = {
  commodity_research: ["macro_commodity_event", "macro_research_document", "macro_source_retrieval_evidence"],
  commodity: ["macro_commodity_event", "macro_research_document", "macro_source_retrieval_evidence"],
  commodities: ["macro_commodity_event", "macro_research_document", "macro_source_retrieval_evidence"],
  metals: ["macro_commodity_event", "macro_research_document", "macro_source_retrieval_evidence"],
  copper: ["macro_commodity_event", "macro_research_document", "macro_source_retrieval_evidence"],
  rates_liquidity: ["macro_official_series", "macro_research_document", "macro_source_retrieval_evidence"],
  policy_regulation: ["macro_policy_event", "macro_source_retrieval_evidence"],
  index_classification: ["macro_index_event", "macro_source_retrieval_evidence"],
  cross_asset_stress: ["macro_research_document", "macro_official_series", "macro_source_retrieval_evidence"],
  narrative_attention: ["macro_research_document", "macro_source_retrieval_evidence"],
};

function sourceCategoryFilters(input: Record<string, unknown>): string[] | undefined {
  const raw = list(input.categories) ?? list(input.category ?? input.family);
  if (!raw) return undefined;
  const expanded = new Set<string>();
  for (const item of raw) {
    expanded.add(item);
    for (const alias of SOURCE_CATEGORY_ALIASES[normalizeKey(item)] ?? []) {
      expanded.add(alias);
    }
  }
  return [...expanded];
}

function evidenceFamilies(input: Record<string, unknown>): string[] {
  const raw = list(input.families) ?? list(input.family);
  if (!raw) return MACRO_RESEARCH_FAMILIES;
  const expanded = new Set<string>();
  for (const item of raw) {
    if (MACRO_RESEARCH_FAMILIES.includes(item)) {
      expanded.add(item);
      continue;
    }
    for (const family of EVIDENCE_FAMILY_ALIASES[normalizeKey(item)] ?? []) {
      expanded.add(family);
    }
  }
  return expanded.size > 0 ? [...expanded] : raw;
}

function macroFactorFamilies(input: Record<string, unknown>): string[] | undefined {
  const raw = list(input.families) ?? list(input.family);
  if (!raw) return undefined;
  const expanded = new Set<string>();
  for (const item of raw) {
    expanded.add(item);
    for (const family of EVIDENCE_FAMILY_ALIASES[normalizeKey(item)] ?? []) {
      expanded.add(family);
    }
  }
  return [...expanded];
}

function sourceMatchesCategory(source: MacroResearchSource, filters: string[]): boolean {
  const family = contentFamily(source);
  return filters.some((filter) =>
    source.categories.some((item) => matches(item, filter)) ||
    matches(source.evidenceValue, filter) ||
    (family != null && matches(family, filter))
  );
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

function numberOf(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function matches(value: string, filter: string): boolean {
  return value.toLowerCase().includes(filter.toLowerCase());
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}
