import type { DataStore } from "../data/store/data-store";
import { toolError } from "../tool";
import {
  type DataApiProviderCapability,
  type DataApiProvider,
  eligibleCapabilitiesForInterface,
  getDataApiInterface,
  normalizeDataApiProvider,
  registeredCapabilitiesForInterface,
} from "../data/data-api-interface-contract";
import {
  buildDataInterfaceHealth,
  type DataInterfaceHealth,
  type DataInterfaceHealthCapability,
  type DataInterfaceHealthRow,
  runtimeEligibleCapabilitiesForInterface,
  runtimeRouteDecisionForCapability,
} from "../data/data-interface-health";

export function interfaceCatalog(
  ds: DataStore,
  input: Record<string, unknown>,
  runtimeBasePath?: string,
): string {
  const healthView = buildDataInterfaceHealth(ds, undefined, { runtimeBasePath });
  const limit = clampLimit(input.limit, 30);
  const category = normalizeText(input.category);
  const health = normalizeText(input.health);
  const provider = normalizeDataApiProvider(input.provider);
  const rows = healthView.rows
    .filter((row) => matchesCatalogFilters(row, { category, health, provider }))
    .slice()
    .sort(compareCatalogRows);

  return JSON.stringify(
    {
      action: "interfaces",
      interfaceId: "data.interface_catalog",
      summary: {
        interfaces: rows.length,
        categories: new Set(rows.map((row) => row.category ?? "other")).size,
        ready: rows.filter((row) => row.health === "ready").length,
        attention: rows.filter((row) => row.health === "attention").length,
        gaps: rows.filter((row) => row.health === "gap").length,
      },
      filters: {
        category,
        health,
        provider,
        limit,
      },
      provenance: localProvenance(
        "data.interface_catalog",
        "local.data.interface_catalog",
        "data_interface_catalog",
        "finance_data_interface_catalog",
        "interfaces",
      ),
      interfaces: rows.slice(0, limit).map((row) => catalogRow(row)),
      tip: "Use interface_describe for the full contract, then interface_availability before provider retries or diagnostics.",
    },
    null,
    2,
  );
}

export function interfaceDescribe(
  ds: DataStore,
  input: Record<string, unknown>,
  runtimeBasePath?: string,
): string {
  const interfaceId = requireInterfaceId(input);
  const healthView = buildDataInterfaceHealth(ds, undefined, { runtimeBasePath });
  const row = findInterfaceRow(healthView, interfaceId);
  const definition = getDataApiInterface(interfaceId);
  if (!definition) {
    const customStrategy = customStrategyInterfaceDescribe(interfaceId);
    if (customStrategy) return JSON.stringify(customStrategy, null, 2);
    toolError(`Unknown interfaceId: ${interfaceId}`);
  }
  return JSON.stringify(
    {
      action: "interface_describe",
      interfaceId,
      provenance: localProvenance(
        interfaceId,
        "local.data.interface_describe",
        "data_interface_contract",
        "finance_data_interface_contract",
        "interface_describe",
      ),
      contract: {
        id: definition.id,
        label: definition.label,
        chinesePurpose: row.chinesePurpose,
        category: row.category,
        canonicalSchema: definition.canonicalSchema,
        canonicalTables: definition.dataStoreTables,
        queryActions: definition.queryActions,
        params: definition.params,
        freshnessPolicy: definition.freshnessPolicy,
      },
      health: row,
      tip: "Use interface_availability with the same interfaceId to decide whether the query path is already reusable or a provider refresh is needed.",
    },
    null,
    2,
  );
}

function customStrategyInterfaceDescribe(interfaceId: string): Record<string, unknown> | null {
  const actions = new Set([
    "custom_strategy_help",
    "custom_strategy_validate",
    "custom_strategy_backtest",
    "custom_strategy_observe",
    "custom_strategy_fund_backtest",
    "custom_strategy_rank",
    "custom_strategy_save",
    "custom_strategy_list",
    "custom_strategy_compare",
    "custom_strategy_run",
  ]);
  if (!actions.has(interfaceId)) return null;
  return {
    action: "interface_describe",
    interfaceId,
    category: "strategy",
    providerMode: "local-engine",
    cacheStatus: "not-market-data",
    canonicalSchema: "strategy_spec",
    supportedActions: Array.from(actions),
    description:
      "Custom strategy actions are MarketData strategy-engine actions, not finance data provider interfaces.",
    workflow:
      "Use custom_strategy_help, then custom_strategy_validate. If validation status is rejected, report unsupported parts and stop; do not backtest, save, or create proxy rules unless the user explicitly asks for a separate proxy redesign.",
  };
}

export function interfaceAvailability(
  ds: DataStore,
  input: Record<string, unknown>,
  runtimeBasePath?: string,
): string {
  const healthView = buildDataInterfaceHealth(ds, undefined, { runtimeBasePath });
  const interfaceId = String(input.interfaceId ?? "").trim();
  if (!interfaceId) {
    return interfaceAvailabilitySummary(healthView, input);
  }
  const row = findInterfaceRow(healthView, interfaceId);
  const definition = getDataApiInterface(interfaceId);
  if (!definition) toolError(`Unknown interfaceId: ${interfaceId}`);
  const provider = normalizeDataApiProvider(input.provider);
  const providerMode = normalizeProviderMode(input.providerMode);
  const registered = registeredCapabilitiesForInterface(interfaceId, {
    provider: provider ?? undefined,
    providerMode,
  });
  const contractEligible = eligibleCapabilitiesForInterface(interfaceId, {
    provider: provider ?? undefined,
    providerMode,
  });
  const runtimeEligible = runtimeEligibleCapabilitiesForInterface(
    healthView,
    interfaceId,
    contractEligible,
    {
      allowDegraded: false,
      providerMode,
    },
  );
  const cacheStatus =
    row.tables.length === 0
      ? "none"
      : row.localRows > 0
        ? "local-hit"
        : "local-miss";

  return JSON.stringify(
    {
      action: "interface_availability",
      interfaceId,
      request: {
        provider,
        providerMode,
      },
      provenance: localProvenance(
        interfaceId,
        "local.data.interface_availability",
        "data_interface_availability",
        "finance_data_interface_availability",
        "interface_availability",
        cacheStatus,
      ),
      availability: {
        label: definition.label,
        chinesePurpose: row.chinesePurpose,
        category: row.category,
        health: row.health,
        localRows: row.localRows,
        latestSourceTime: row.latestSourceTime,
        latest: row.latest,
        queryActions: definition.queryActions,
        freshnessPolicy: definition.freshnessPolicy,
        supportedProviders: row.supportedProviders,
        gatedProviders: row.gatedProviders,
        outputOnlyProviders: row.outputOnlyProviders,
        unstableProviders: row.unstableProviders,
        disabledProviders: row.disabledProviders,
        recentFailures: row.recentFailures,
        lastFailureClass: row.lastFailureClass,
        nextAction: row.nextAction,
        routeReadiness:
          runtimeEligible.length > 0
            ? runtimeEligible[0]?.decision.routeState === "validated"
              ? "allowed"
              : "degraded"
            : row.localRows > 0
              ? "cached-only"
              : "blocked",
      },
      registeredCapabilities: registered.map(summarizeCapability),
      eligibleCapabilities: runtimeEligible.map(({ capability, decision }) => ({
        ...summarizeCapability(capability),
        routeState: decision.routeState,
        routeReason: decision.reason,
        evidenceStatus: decision.evidenceStatus,
        liveValidationState: decision.liveValidationState,
        liveFailureClass: decision.liveFailureClass,
        temporaryBlockUntil: decision.temporaryBlockUntil,
        routeBlockScope: decision.routeBlockScope,
      })),
      blockedCapabilities: registered
        .map((capability) => ({
          capability,
          decision: runtimeRouteDecisionForCapability(healthView, interfaceId, capability, {
            allowDegraded: false,
            providerMode,
          }),
        }))
        .filter(({ decision }) => !decision.eligible)
        .map(({ capability, decision }) => ({
          ...summarizeCapability(capability),
          routeState: decision.routeState,
          routeReason: decision.reason,
          evidenceStatus: decision.evidenceStatus,
          liveValidationState: decision.liveValidationState,
          liveFailureClass: decision.liveFailureClass,
          temporaryBlockUntil: decision.temporaryBlockUntil,
          routeBlockScope: decision.routeBlockScope,
        })),
      tip:
        row.localRows > 0
          ? "Use queryActions/readback first; runtime routing will avoid blocked or unvalidated provider paths unless you explicitly move into diagnostic workflow."
          : "No reusable local rows were found; use the governed fetch action only when interface availability shows a runtime-eligible provider path.",
    },
    null,
    2,
  );
}

function interfaceAvailabilitySummary(
  healthView: DataInterfaceHealth,
  input: Record<string, unknown>,
): string {
  const limit = clampLimit(input.limit, 30);
  const category = normalizeText(input.category);
  const health = normalizeText(input.health);
  const provider = normalizeDataApiProvider(input.provider);
  const providerMode = normalizeProviderMode(input.providerMode);
  const rows = healthView.rows
    .filter((row) => matchesCatalogFilters(row, { category, health, provider }))
    .slice()
    .sort(compareCatalogRows);
  const availabilityRows = rows.slice(0, limit).map((row) =>
    availabilitySummaryRow(healthView, row, providerMode),
  );

  return JSON.stringify(
    {
      action: "interface_availability",
      interfaceId: "data.interface_availability_summary",
      request: {
        provider,
        providerMode,
        category,
        health,
        limit,
      },
      provenance: localProvenance(
        "data.interface_availability_summary",
        "local.data.interface_availability_summary",
        "data_interface_availability",
        "finance_data_interface_availability",
        "interface_availability",
      ),
      summary: {
        interfaces: rows.length,
        returned: availabilityRows.length,
        ready: rows.filter((row) => row.health === "ready").length,
        attention: rows.filter((row) => row.health === "attention").length,
        gaps: rows.filter((row) => row.health === "gap").length,
        cachedOnly: availabilityRows.filter((row) => row.routeReadiness === "cached-only")
          .length,
        allowed: availabilityRows.filter((row) => row.routeReadiness === "allowed")
          .length,
        blocked: availabilityRows.filter((row) => row.routeReadiness === "blocked")
          .length,
      },
      interfaces: availabilityRows,
      tip:
        "This is a bounded availability summary. For provider routing on a specific dataset, call interface_availability again with interfaceId.",
    },
    null,
    2,
  );
}

function availabilitySummaryRow(
  healthView: DataInterfaceHealth,
  row: DataInterfaceHealthRow,
  providerMode: "auto" | "preferred" | "strict",
): Record<string, unknown> {
  const registered = registeredCapabilitiesForInterface(row.interfaceId, {
    providerMode,
  });
  const contractEligible = eligibleCapabilitiesForInterface(row.interfaceId, {
    providerMode,
  });
  const runtimeEligible = runtimeEligibleCapabilitiesForInterface(
    healthView,
    row.interfaceId,
    contractEligible,
    {
      allowDegraded: false,
      providerMode,
    },
  );
  const routeReadiness =
    runtimeEligible.length > 0
      ? runtimeEligible[0]?.decision.routeState === "validated"
        ? "allowed"
        : "degraded"
      : row.localRows > 0
        ? "cached-only"
        : "blocked";

  return {
    interfaceId: row.interfaceId,
    label: row.label,
    chinesePurpose: row.chinesePurpose,
    category: row.category,
    health: row.health,
    localRows: row.localRows,
    latestSourceTime: row.latestSourceTime,
    queryActions: row.queryActions,
    supportedProviders: row.supportedProviders,
    gatedProviders: row.gatedProviders,
    unstableProviders: row.unstableProviders,
    disabledProviders: row.disabledProviders,
    registeredCapabilities: registered.length,
    eligibleCapabilities: runtimeEligible.length,
    routeReadiness,
    lastFailureClass: row.lastFailureClass,
    nextAction: row.nextAction,
  };
}

function requireInterfaceId(input: Record<string, unknown>): string {
  const interfaceId = String(input.interfaceId ?? "").trim();
  if (!interfaceId) toolError("interfaceId is required");
  return interfaceId;
}

function findInterfaceRow(
  healthView: DataInterfaceHealth,
  interfaceId: string,
): DataInterfaceHealthRow {
  const row = healthView.rows.find((item) => item.interfaceId === interfaceId);
  if (!row) toolError(`Unknown interfaceId: ${interfaceId}`);
  return row;
}

function catalogRow(row: DataInterfaceHealthRow): Record<string, unknown> {
  return {
    interfaceId: row.interfaceId,
    label: row.label,
    chinesePurpose: row.chinesePurpose,
    category: row.category,
    canonicalSchema: row.canonicalSchema,
    canonicalTables: row.tables,
    queryActions: row.queryActions,
    supportedProviders: row.supportedProviders,
    gatedProviders: row.gatedProviders,
    outputOnlyProviders: row.outputOnlyProviders,
    health: row.health,
    localRows: row.localRows,
    latestSourceTime: row.latestSourceTime,
    nextAction: row.nextAction,
  };
}

function matchesCatalogFilters(
  row: DataInterfaceHealthRow,
  opts: {
    category: string | null;
    health: string | null;
    provider: DataApiProvider | null;
  },
): boolean {
  if (opts.category && (row.category ?? "").toLowerCase() !== opts.category)
    return false;
  if (opts.health && row.health !== opts.health) return false;
  if (
    opts.provider &&
    !row.capabilities.some(
      (capability) => capability.provider === opts.provider,
    )
  )
    return false;
  return true;
}

function compareCatalogRows(
  a: DataInterfaceHealthRow,
  b: DataInterfaceHealthRow,
): number {
  const healthScore = compareHealth(a.health, b.health);
  if (healthScore !== 0) return healthScore;
  const categoryScore = (a.category ?? "").localeCompare(b.category ?? "");
  if (categoryScore !== 0) return categoryScore;
  return a.interfaceId.localeCompare(b.interfaceId);
}

function compareHealth(
  a: DataInterfaceHealthRow["health"],
  b: DataInterfaceHealthRow["health"],
): number {
  const score = { gap: 0, attention: 1, ready: 2 };
  return score[a] - score[b];
}

function summarizeCapability(
  capability: DataInterfaceHealthCapability | DataApiProviderCapability,
): Record<string, unknown> {
  return {
    capabilityId: "capabilityId" in capability ? capability.capabilityId : capability.id,
    provider: capability.provider,
    status: capability.status,
    priority: capability.priority,
    canonicalTable: capability.canonicalTable,
    normalizer: capability.normalizer,
    adapter: capability.adapter,
    probeId: capability.probeId,
    reason: capability.reason,
    nextAction: "nextAction" in capability ? capability.nextAction : undefined,
  };
}

function normalizeProviderMode(
  value: unknown,
): "auto" | "preferred" | "strict" {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (text === "preferred" || text === "strict") return text;
  return "auto";
}

function normalizeText(value: unknown): string | null {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  return text || null;
}

function clampLimit(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(Math.trunc(numeric), 200));
}

function localProvenance(
  interfaceId: string,
  capabilityId: string,
  canonicalSchema: string,
  canonicalTable: string,
  readbackAction: string,
  cacheStatus = "local-evidence",
): Record<string, unknown> {
  return {
    interfaceId,
    provider: "local",
    providerId: "local",
    capabilityId,
    cacheStatus,
    cacheMode: "cache-first",
    cachePolicyMode: "cacheFirst",
    canonicalSchema,
    canonicalTable,
    readbackAction,
  };
}
