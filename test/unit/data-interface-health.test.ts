import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildDataInterfaceHealth,
  type FinanceDataHealthEvidence,
  runtimeEligibleCapabilitiesForInterface,
  runtimeRouteDecisionForCapability,
} from "../../src/agent/data/data-interface-health";
import type { DataStore } from "../../src/agent/data/store/data-store";

function fakeStore(): DataStore {
  return {
    isReady: true,
    getStats: () => ({
      sizeBytes: 1024,
      tables: [
        { name: "tick_chart_intraday", count: 3 },
        { name: "yfinance_option_contracts", count: 2 },
      ],
    }),
    getReusableDataSummary: () => [
      {
        name: "tick_chart_intraday",
        count: 3,
        latest: "2026-06-18T09:30:00.000Z",
        sources: "tdx",
      },
      {
        name: "yfinance_option_contracts",
        count: 2,
        latest: "2026-06-18",
        sources: "yahoo",
      },
    ],
    query: <T = unknown>(sql: string): T[] => {
      if (sql.includes("GROUP BY provider_key")) {
        return [
          {
            provider_key: "yfinance",
            count: 1,
            last_at: "2026-06-18T10:05:00.000Z",
            last_error: "Yahoo timeout",
            last_failure_class: "timeout",
          },
        ] as T[];
      }
      if (sql.includes("FROM api_call_log")) {
        return [
          {
            interface_id: "stock.tick_chart_intraday",
            count: 2,
            last_at: "2026-06-18T10:00:00.000Z",
            last_error: "provider timeout",
            last_failure_class: "timeout",
          },
        ] as T[];
      }
      return [];
    },
  } as unknown as DataStore;
}

describe("data interface health", () => {
  it("combines interface contract, cache coverage, local data, and recent failures", () => {
    const health = buildDataInterfaceHealth(fakeStore(), null);

    expect(health.summary.interfaces).toBeGreaterThanOrEqual(45);
    expect(health.summary.providers).toContain("tdx");
    expect(health.summary.recentFailures).toBe(2);
    expect(health.summary.providerGapRows).toBe(health.providerGapQueue.length);
    expect(health.summary.providerGapClassCounts).toMatchObject({
      "credential-or-quota-required": expect.any(Number),
    });
    expect(health.summary.policyDisabledRows).toBe(
      health.policyDisabledQueue.length,
    );
    expect(health.summary.policyDisabledClassCounts).toMatchObject({
      "policy-disabled": expect.any(Number),
    });
    expect(
      health.providerRows.find((row) => row.provider === "yahoo"),
    ).toMatchObject({
      supported: expect.any(Number),
      recentFailures: 1,
      lastFailure: "Yahoo timeout",
      health: "attention",
    });
    expect(
      health.failureActionQueue.find(
        (row) => row.provider === "yahoo" && row.family === "provider",
      ),
    ).toMatchObject({
      id: "failure:provider:yahoo",
      probeId: "provider:yahoo",
      status: "recent-failure",
      affectedInterfaces: expect.arrayContaining([
        "global.options_chain",
        "global.finance_news",
      ]),
      affectedCapabilities: expect.arrayContaining([
        expect.objectContaining({
          interfaceId: "global.finance_news",
          capabilityId: "yahoo.global.finance_news",
          canonicalSchema: "yfinance_news",
          canonicalTable: "yfinance_news",
          readbackAction: "query_global_finance_news",
        }),
      ]),
      cacheDecision: expect.stringContaining("cache"),
    });
    expect(
      health.failureActionQueue.find(
        (row) => row.family === "stock.tick_chart_intraday",
      ),
    ).toMatchObject({
      id: "failure:stock.tick_chart_intraday",
      probeId: "stock.tick_chart_intraday",
      canonicalSchema: "tick_chart_intraday",
      canonicalTable: "tick_chart_intraday",
      readbackAction: "query_tick_chart",
      cacheDecision: expect.stringContaining("query_tick_chart"),
      affectedCapabilities: expect.arrayContaining([
        expect.objectContaining({
          interfaceId: "stock.tick_chart_intraday",
          capabilityId: "tdx.stock.tick_chart_intraday",
          canonicalSchema: "tick_chart_intraday",
          canonicalTable: "tick_chart_intraday",
          readbackAction: "query_tick_chart",
        }),
      ]),
    });
    expect(
      health.providerGapQueue.every(
        (row) => row.id === `gap:${row.interfaceId}:${row.provider}`,
      ),
    ).toBe(true);
    expect(
      health.providerGapQueue.every(
        (row) => row.gapClass && typeof row.actionPriority === "number",
      ),
    ).toBe(true);
    expect(
      health.providerGapQueue.every(
        (row) =>
          typeof row.cacheDecision === "string" &&
          row.cacheDecision.length > 0,
      ),
    ).toBe(true);
    expect(
      health.providerGapQueue.every(
        (row) => row.gapClass !== "policy-disabled",
      ),
    ).toBe(true);
    expect(
      health.policyDisabledQueue.every(
        (row) =>
          row.status === "disabled" && row.gapClass === "policy-disabled",
      ),
    ).toBe(true);
    expect(
      health.providerGapQueue.some(
        (row) =>
          row.interfaceId === "stock.tick_chart_intraday" &&
          row.provider === "wind",
      ),
    ).toBe(false);
    expect(
      health.providerGapQueue.find(
        (row) =>
          row.interfaceId === "market.unusual_activity" &&
          row.provider === "akshare",
      ),
    ).toBeUndefined();
    expect(
      health.rows.find((row) => row.interfaceId === "market.unusual_activity")
        ?.providerStatuses.akshare,
    ).toBe("not-supported");

    const tick = health.rows.find(
      (row) => row.interfaceId === "stock.tick_chart_intraday",
    )!;
    expect(tick).toMatchObject({
      canonicalSchema: "tick_chart_intraday",
      cacheStatus: "implemented",
      localRows: 3,
      latest: "2026-06-18T09:30:00.000Z",
      latestSourceTime: "2026-06-18T09:30:00.000Z",
      sources: "tdx",
      recentFailures: 2,
      lastFailure: "provider timeout",
      lastFailureClass: "timeout",
      nextAction:
        "Inspect recent API failures; retry with serial probe and provider-specific timeout.",
      health: "attention",
    });
    expect(tick.supportedProviders).toContain("tdx");
    expect(
      tick.capabilities.find((capability) => capability.provider === "tdx"),
    ).toMatchObject({
      provider: "tdx",
      capabilityId: expect.any(String),
      status: "supported",
      canonicalTable: "tick_chart_intraday",
      normalizer: expect.any(String),
    });
    expect(
      tick.capabilities.find((capability) => capability.provider === "wind"),
    ).toMatchObject({
      provider: "wind",
      status: "not-supported",
      reason: expect.any(String),
      nextAction:
        "Leave explicit not-supported unless provider protocol can supply an equivalent dataset.",
    });
    expect(
      tick.implicitNotSupportedProviderDetails.find(
        (capability) => capability.provider === "yahoo",
      ),
    ).toMatchObject({
      provider: "yahoo",
      status: "not-supported",
      capabilityId: null,
      reason: expect.stringContaining(
        "No yahoo provider capability is registered for stock.tick_chart_intraday",
      ),
    });

    const options = health.rows.find(
      (row) => row.interfaceId === "global.options_chain",
    )!;
    expect(options.supportedProviders).toContain("yahoo");
    expect(options.localRows).toBe(2);
    expect(options.sources).toBe("yahoo");

    const news = health.rows.find(
      (row) => row.interfaceId === "global.finance_news",
    )!;
    expect(news.supportedProviders).toContain("yahoo");
    expect(news.cacheStatus).toBe("implemented");
    expect(
      news.capabilities.find((capability) => capability.provider === "wind"),
    ).toMatchObject({
      provider: "wind",
      status: "not-supported",
    });

    const windDocs = health.rows.find(
      (row) => row.interfaceId === "wind.financial_document",
    )!;
    expect(windDocs.gatedProviders).toContain("wind");
    expect(windDocs.cacheReader).toBe("readWindDocumentRows");
    expect(windDocs.nextAction).toContain("configured credentials");
  });

  it("returns contract-only health when DataStore is not ready", () => {
    const health = buildDataInterfaceHealth(null, null);

    expect(health.summary.interfaces).toBeGreaterThanOrEqual(45);
    expect(health.summary.recentFailures).toBe(0);
    expect(
      health.rows.find((row) => row.interfaceId === "stock.quote")?.localRows,
    ).toBe(0);
    expect(
      health.providerRows.find((row) => row.provider === "wind")?.nextAction,
    ).toContain("credentials");
  });

  it("merges durable live-probe and dataset evidence into runtime health", () => {
    const evidence: FinanceDataHealthEvidence = {
      generatedAt: "2026-06-18T10:00:00.000Z",
      summary: {
        liveStatusRows: 91,
        liveStatusPassed: 59,
        liveStatusFailedOrBlocked: 32,
        liveProbeBacklogRows: 0,
        datasets: 42,
        providerGapLiveObserved: 1,
        providerGapLiveFailedOrBlocked: 0,
        credentialActivationRows: 1,
        policyDisabledRows: 1,
        credentialActivationLiveObserved: 1,
        credentialActivationClassCounts: {
          "credential-or-quota-required": 1,
        },
        policyDisabledClassCounts: {
          "policy-disabled": 1,
        },
      },
      interfaceHealth: [
        {
          interfaceId: "market.screening",
          category: "market_structure",
          chinesePurpose: "市场筛选快照",
          liveProbeIds: ["electron_tradingview_scan"],
          liveProbeBacklog: 0,
          passedLiveRows: 1,
          failures: 0,
          healthState: "observed",
        },
      ],
      providerHealth: [
        {
          provider: "tradingview",
          liveProbeCount: 1,
          liveFailures: 0,
          liveFailureClasses: {},
        },
      ],
      liveProviderHealth: [
        {
          provider: "tradingview",
          passed: 1,
          liveProbeCount: 1,
          failures: 0,
          failureClasses: {},
        },
      ],
      datasetHealth: [
        {
          canonicalSchema: "screening_result",
          dataStoreTables: ["market_screening_snapshot"],
          interfaces: ["market.screening"],
          queryActions: ["query_market_screening"],
          freshnessPolicies: ["screening-cache-first-by-request"],
          cacheStatuses: ["implemented"],
          detailedRows: 3,
          liveProbeBacklog: 0,
          failures: 0,
          healthState: "observed",
        },
      ],
      providerGapQueue: [
        {
          interfaceId: "stock.tick_chart_intraday",
          provider: "wind",
          status: "output-only",
          capabilityId: "wind.stock.tick_chart_intraday",
          canonicalSchema: "tick_chart_intraday",
          routeWiringStatus: "missing-canonical-shape",
          nextAction: "Add Wind tick-chart normalizer/readback.",
          liveStatus: "passed",
          liveValidationState: "valid-schema-observed",
        },
      ],
      credentialActivationQueue: [
        {
          interfaceId: "fund.company_info",
          provider: "wind",
          status: "credential-gated",
          capabilityId: "wind.fund.company_info",
          canonicalSchema: "stock_company_info",
          normalizer: "windCompanyInfoRows",
          canonicalTable: "stock_company_info",
          gapClass: "credential-or-quota-required",
          actionPriority: 2,
          liveStatus: "passed",
          liveValidationState: "valid-schema-observed",
          nextAction:
            "Credentialed provider observed; keep gate for unconfigured runtimes.",
        },
      ],
      policyDisabledQueue: [
        {
          interfaceId: "fund.nav_history",
          provider: "tushare",
          status: "disabled",
          capabilityId: "tushare.fund.nav_history.disabled",
          canonicalSchema: "fund_nav",
          gapClass: "policy-disabled",
          actionPriority: 5,
          reason: "fund_nav permission 40203 and app-disabled.",
          nextAction:
            "Do not call tushare/fund.nav_history; keep disabled unless account permissions and runtime guardrails change.",
        },
      ],
      failureActionQueue: [
        {
          probeId: "electron_yahoo_news",
          provider: "yahoo",
          family: "news",
          status: "ERR",
          validationState: "failed",
          failureClass: "transport_or_provider_unstable",
          affectedInterfaces: ["global.finance_news"],
          affectedRows: ["api-call-401"],
          nextAction: "Retry serially after provider recovery.",
          error: "fetch failed",
        },
      ],
    };
    const health = buildDataInterfaceHealth(fakeStore(), evidence);

    expect(health.summary).toMatchObject({
      interfaces: expect.any(Number),
      liveStatusRows: 91,
      liveStatusPassed: 59,
      liveStatusFailedOrBlocked: 32,
      liveProbeBacklogRows: 0,
      datasets: 42,
      evidenceGeneratedAt: "2026-06-18T10:00:00.000Z",
      providerGapRows: expect.any(Number),
      providerGapLiveObserved: 1,
      providerGapLiveFailedOrBlocked: 0,
      credentialActivationRows: 0,
      policyDisabledRows: 1,
      credentialActivationLiveObserved: 1,
    });
    expect(health.datasetRows).toHaveLength(1);
    expect(
      health.providerGapQueue.find(
        (row) =>
          row.interfaceId === "stock.tick_chart_intraday" &&
          row.provider === "wind",
      ),
    ).toMatchObject({
      ...evidence.providerGapQueue![0],
      id: "gap:stock.tick_chart_intraday:wind",
      gapClass: "route-implementation-required",
      actionPriority: 1,
      liveStatus: "passed",
      liveValidationState: "valid-schema-observed",
    });
    expect(health.credentialActivationQueue).not.toContainEqual(
      expect.objectContaining({
        interfaceId: "fund.company_info",
        provider: "wind",
      }),
    );
    expect(health.summary.credentialValidatedRows).toBeGreaterThanOrEqual(1);
    expect(
      evidence.credentialActivationQueue?.find(
        (row) =>
          row.interfaceId === "fund.company_info" && row.provider === "wind",
      ),
    ).toMatchObject({
      status: "credential-gated",
      liveStatus: "passed",
      normalizer: "windCompanyInfoRows",
      canonicalTable: "stock_company_info",
    });
    expect(
      health.policyDisabledQueue.find(
        (row) =>
          row.interfaceId === "fund.nav_history" && row.provider === "tushare",
      ),
    ).toMatchObject({
      id: "gap:fund.nav_history:tushare",
      status: "disabled",
      gapClass: "policy-disabled",
      actionPriority: 5,
    });
    expect(
      health.failureActionQueue.find(
        (row) => row.probeId === "electron_yahoo_news",
      ),
    ).toMatchObject({
      provider: "yahoo",
      family: "news",
      status: "ERR",
      validationState: "failed",
      failureClass: "transport_or_provider_unstable",
      affectedInterfaces: ["global.finance_news"],
      affectedRows: ["api-call-401"],
      error: "fetch failed",
      canonicalSchema: "yfinance_news",
      canonicalTable: "yfinance_news",
      readbackAction: "query_global_finance_news",
      affectedCapabilities: expect.arrayContaining([
        expect.objectContaining({
          interfaceId: "global.finance_news",
          capabilityId: "yahoo.global.finance_news",
          canonicalSchema: "yfinance_news",
          canonicalTable: "yfinance_news",
          readbackAction: "query_global_finance_news",
        }),
      ]),
    });
    expect(
      health.rows.find((row) => row.interfaceId === "market.screening"),
    ).toMatchObject({
      category: "market_structure",
      chinesePurpose: "市场筛选快照",
      liveProbeIds: ["electron_tradingview_scan"],
      passedLiveRows: 1,
      liveStatus: "observed",
    });
    expect(
      health.rows.find((row) => row.interfaceId === "fund.company_info"),
    ).toMatchObject({
      nextAction: expect.stringContaining("use cache/readback first"),
    });
    expect(
      health.providerRows.find((row) => row.provider === "tradingview"),
    ).toMatchObject({
      liveProbeCount: 1,
      livePassed: 1,
      liveFailures: 0,
    });
  });

  it("overlays runtime live-status artifacts into health evidence", () => {
    const runtimeBasePath = mkdtempSync(join(tmpdir(), "finagent-workstation-runtime-probe-"));
    const liveStatusDir = join(runtimeBasePath, "data", "runtime-probes", "live-status");
    mkdirSync(liveStatusDir, { recursive: true });
    writeFileSync(
      join(liveStatusDir, "latest.json"),
      JSON.stringify({
        generatedAt: "2026-06-22T08:00:00.000Z",
        summary: {
          total: 2,
          passed: 1,
          failed: 1,
          blocked: 0,
          skipped: 0,
          credentialGated: 0,
          quotaGated: 0,
          unsupported: 0,
          invalidParameters: 0,
          transportOrProviderUnstable: 1,
          runtimeBlocked: 0,
        },
        passedApis: [
          {
            id: "electron_tradingview_scan",
            provider: "tradingview",
            family: "scan",
            status: "passed",
            validationState: "valid-schema-observed",
          },
        ],
        failures: [
          {
            id: "electron_yahoo_news",
            provider: "yahoo",
            family: "news",
            status: "failed",
            validationState: "transport-or-provider-unstable",
            failureClass: "transport",
            error: "socket hang up",
          },
        ],
      }, null, 2),
      "utf-8",
    );
    const evidence: FinanceDataHealthEvidence = {
      generatedAt: "2026-06-18T10:00:00.000Z",
      summary: {
        liveStatusRows: 0,
        liveStatusPassed: 0,
        liveStatusFailedOrBlocked: 0,
      },
      interfaceHealth: [
        {
          interfaceId: "market.screening",
          category: "market_structure",
          chinesePurpose: "市场筛选快照",
          liveProbeIds: ["electron_tradingview_scan"],
          liveProbeBacklog: 0,
          passedLiveRows: 0,
          failures: 0,
          healthState: "registered",
        },
      ],
      providerGapQueue: [],
      credentialActivationQueue: [],
      policyDisabledQueue: [],
      failureActionQueue: [],
    };

    const health = buildDataInterfaceHealth(fakeStore(), evidence, {
      runtimeBasePath,
    });

    expect(health.summary).toMatchObject({
      liveStatusRows: 2,
      liveStatusPassed: 1,
      liveStatusFailedOrBlocked: 1,
      evidenceGeneratedAt: "2026-06-22T08:00:00.000Z",
    });
    expect(
      health.rows.find((row) => row.interfaceId === "market.screening"),
    ).toMatchObject({
      passedLiveRows: 1,
      liveStatus: "observed",
    });
    expect(
      health.failureActionQueue.find((row) => row.probeId === "electron_yahoo_news"),
    ).toMatchObject({
      provider: "yahoo",
      family: "news",
      validationState: "transport-or-provider-unstable",
      failureClass: "transport",
      error: "socket hang up",
    });
    expect(
      health.providerRows.find((row) => row.provider === "tradingview"),
    ).toMatchObject({
      liveProbeCount: 1,
      livePassed: 1,
    });
  });

  it("uses runtime live evidence to gate provider routing candidates", () => {
    const runtimeBasePath = mkdtempSync(join(tmpdir(), "runtime-route-health-"));
    mkdirSync(join(runtimeBasePath, "data", "runtime-probes", "live-status"), {
      recursive: true,
    });
    writeFileSync(
      join(runtimeBasePath, "data", "runtime-probes", "live-status", "latest.json"),
      JSON.stringify(
        {
          generatedAt: "2026-06-22T11:30:00.000Z",
          summary: { total: 2, passed: 1, failed: 1, blocked: 0 },
          passedApis: [
            {
              id: "electron_eastmoney_kline",
              provider: "eastmoney",
              status: "passed",
              validationState: "valid-schema-observed",
            },
          ],
          failures: [
            {
              id: "electron_tdx_kline",
              provider: "tdx",
              status: "failed",
              validationState: "runtime-blocked",
              failureClass: "runtime-blocked",
              error: "sidecar not available",
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const health = buildDataInterfaceHealth(fakeStore(), null, {
      runtimeBasePath,
    });
    const row = health.rows.find((item) => item.interfaceId === "stock.daily_kline")!;
    const candidates = row.capabilities.filter(
      (capability) =>
        capability.provider === "tdx" || capability.provider === "eastmoney",
    );

    const runtimeEligible = runtimeEligibleCapabilitiesForInterface(
      health,
      "stock.daily_kline",
      candidates.map((capability) => ({
        id: capability.capabilityId,
        provider: capability.provider,
        status: capability.status,
        adapter: capability.adapter ?? undefined,
        normalizer: capability.normalizer ?? undefined,
        canonicalTable: capability.canonicalTable ?? undefined,
        probeId: capability.probeId ?? undefined,
        priority: capability.priority ?? undefined,
        reason: capability.reason ?? undefined,
      })),
      {},
    );

    expect(runtimeEligible).toHaveLength(1);
    expect(runtimeEligible[0]).toMatchObject({
      capability: expect.objectContaining({
        provider: "eastmoney",
        probeId: "electron_eastmoney_kline",
      }),
      decision: expect.objectContaining({
        routeState: "validated",
        eligible: true,
      }),
    });
  });

  it("treats transient runtime failures as expiring temporary provider blocks", () => {
    const runtimeBasePath = mkdtempSync(join(tmpdir(), "runtime-route-ttl-"));
    mkdirSync(join(runtimeBasePath, "data", "runtime-probes", "live-status"), {
      recursive: true,
    });
    const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    writeFileSync(
      join(runtimeBasePath, "data", "runtime-probes", "live-status", "latest.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          summary: { total: 3, passed: 1, failed: 2, blocked: 0 },
          passedApis: [
            {
              id: "electron_sina_quote",
              provider: "sina",
              status: "passed",
              validationState: "valid-schema-observed",
            },
          ],
          failures: [
            {
              id: "electron_tdx_quote",
              provider: "tdx",
              status: "failed",
              validationState: "runtime-blocked",
              failureClass: "transport",
              temporaryBlockUntil: future,
              routeBlockScope: "capability",
            },
            {
              id: "electron_eastmoney_quote",
              provider: "eastmoney",
              status: "failed",
              validationState: "runtime-blocked",
              failureClass: "transport",
              temporaryBlockUntil: past,
              routeBlockScope: "capability",
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const health = buildDataInterfaceHealth(fakeStore(), null, { runtimeBasePath });
    const capabilities = health.rows.find((item) => item.interfaceId === "stock.quote")!.capabilities
      .filter((capability) => ["tdx", "eastmoney", "sina"].includes(capability.provider))
      .map((capability) => ({
        id: capability.capabilityId,
        provider: capability.provider,
        status: capability.status,
        adapter: capability.adapter ?? undefined,
        normalizer: capability.normalizer ?? undefined,
        canonicalTable: capability.canonicalTable ?? undefined,
        probeId: capability.probeId ?? undefined,
        priority: capability.priority ?? undefined,
        reason: capability.reason ?? undefined,
      }));

    const tdxDecision = runtimeRouteDecisionForCapability(
      health,
      "stock.quote",
      capabilities.find((capability) => capability.provider === "tdx")!,
    );
    const eastmoneyDecision = runtimeRouteDecisionForCapability(
      health,
      "stock.quote",
      capabilities.find((capability) => capability.provider === "eastmoney")!,
    );
    const routed = runtimeEligibleCapabilitiesForInterface(health, "stock.quote", capabilities, {});

    expect(tdxDecision).toMatchObject({
      eligible: false,
      routeState: "temporarily-blocked",
      temporaryBlockUntil: future,
      routeBlockScope: "capability",
    });
    expect(eastmoneyDecision).toMatchObject({
      eligible: true,
      routeState: "allowed-unvalidated",
      temporaryBlockUntil: past,
    });
    expect(routed.map((item) => item.capability.provider).slice(0, 2)).toEqual(["sina", "eastmoney"]);
  });
});
