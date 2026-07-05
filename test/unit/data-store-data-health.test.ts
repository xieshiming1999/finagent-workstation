import { describe, expect, it } from "vitest";
import { dataHealth } from "../../src/agent/tools/data-store-tool-health";
import type { DataStore } from "../../src/agent/data/store/data-store";

function fakeStore(): DataStore {
  return {
    isReady: true,
    getStats: () => ({
      sizeBytes: 2048,
      tables: [
        { name: "tick_chart_intraday", count: 3 },
        { name: "market_screening_snapshot", count: 5 },
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
        name: "market_screening_snapshot",
        count: 5,
        latest: "2026-06-18T10:00:00.000Z",
        sources: "tradingview",
      },
    ],
    query: <T = unknown>(sql: string): T[] => {
      if (sql.includes("GROUP BY provider_key")) {
        return [
          {
            provider_key: "eastmoney",
            count: 1,
            last_at: "2026-06-18T10:06:00.000Z",
            last_error: "The operation was aborted due to timeout",
          },
        ] as T[];
      }
      if (sql.includes("FROM api_call_log")) {
        return [
          {
            interface_id: "market.hot_rank",
            count: 1,
            last_at: "2026-06-18T10:06:00.000Z",
            last_error: "The operation was aborted due to timeout",
          },
        ] as T[];
      }
      return [];
    },
  } as unknown as DataStore;
}

describe("DataStore data_health action", () => {
  it("returns parseable agent-facing health and provenance", () => {
    const payload = JSON.parse(
      dataHealth(fakeStore(), {
        action: "data_health",
        section: "all",
        limit: 100,
      }),
    );

    expect(payload).toMatchObject({
      action: "data_health",
      section: "all",
      summary: {
        interfaces: expect.any(Number),
        recentFailures: 1,
        providerGapRows: expect.any(Number),
        providerGapLiveObserved: expect.any(Number),
        providerGapClassCounts: expect.objectContaining({
          "credential-or-quota-required": expect.any(Number),
        }),
        credentialActivationRows: expect.any(Number),
        credentialActivationClassCounts: expect.objectContaining({
          "credential-or-quota-required": expect.any(Number),
        }),
      },
      provenance: {
        interfaceId: "data.health",
        providerId: "local",
        provider: "local",
        capabilityId: "local.data_health",
        providerMode: "local-evidence",
        cacheStatus: "local-evidence",
        cacheDecision: expect.stringContaining("operational evidence"),
        canonicalSchema: "data_health_report",
        canonicalTable: "finance_data_health_report",
        readbackAction: "data_health",
        failureClass: null,
      },
    });
    expect(
      payload.interfaces.find(
        (row: { interfaceId: string }) => row.interfaceId === "market.hot_rank",
      ),
    ).toMatchObject({
      interfaceId: "market.hot_rank",
      readbackAction: "query_hot_rank",
      readbackActions: expect.arrayContaining(["query_hot_rank"]),
      recentFailures: 1,
      lastFailureClass: null,
      nextAction:
        "Triage recent provider failure before relying on fallback data.",
    });
    expect(
      payload.providers.find(
        (row: { provider: string }) => row.provider === "eastmoney",
      ),
    ).toMatchObject({
      recentFailures: 1,
      lastFailureClass: null,
    });
    expect(payload.providerGapQueue).toEqual(payload.providerGaps);
    expect(payload.failureActionQueue).toEqual(payload.failureActions);
    expect(payload.providerGapQueue.length).toBeGreaterThan(0);
    expect(payload.summary.credentialValidatedRows).toBeGreaterThanOrEqual(0);
    expect(
      payload.providerGapQueue.every(
        (row: {
          id?: string;
          interfaceId?: string;
          provider?: string;
          gapClass?: string;
          actionPriority?: number;
        }) =>
          row.id === `gap:${row.interfaceId}:${row.provider}` &&
          row.gapClass &&
          typeof row.actionPriority === "number",
      ),
    ).toBe(true);
    expect(
      payload.providerGapQueue.some(
        (row: { gapClass?: string }) => row.gapClass === "serial-live-retry",
      ),
    ).toBe(false);
    expect(
      payload.providerGapQueue.some(
        (row: { gapClass?: string }) =>
          row.gapClass === "credential-or-quota-required",
      ),
    ).toBe(true);
    if (payload.credentialActivationQueue.length > 0) {
      expect(payload.credentialActivationQueue[0]).toMatchObject({
        gapClass: "credential-or-quota-required",
        actionPriority: 2,
      });
    }
    expect(
      payload.failureActionQueue.find(
        (row: { family: string }) => row.family === "market.hot_rank",
      ),
    ).toMatchObject({
      id: "failure:market.hot_rank",
      probeId: "market.hot_rank",
      status: "recent-failure",
      failureClass: null,
      canonicalSchema: "hot_rank",
      canonicalTable: "hot_rank",
      readbackAction: "query_hot_rank",
      affectedCapabilities: expect.arrayContaining([
        expect.objectContaining({
          interfaceId: "market.hot_rank",
          capabilityId: "eastmoney.market.hot_rank",
          canonicalSchema: "hot_rank",
          canonicalTable: "hot_rank",
          readbackAction: "query_hot_rank",
        }),
      ]),
    });
    expect(
      payload.failureActionQueue.find(
        (row: { provider?: string; family?: string }) =>
          row.provider === "eastmoney" && row.family === "provider",
      ),
    ).toMatchObject({
      id: "failure:provider:eastmoney",
      probeId: "provider:eastmoney",
      affectedInterfaces: expect.arrayContaining([
        "market.hot_rank",
        "stock.quote",
      ]),
      affectedCapabilities: expect.arrayContaining([
        expect.objectContaining({
          interfaceId: "stock.quote",
          capabilityId: "eastmoney.stock.quote",
          canonicalSchema: "quote_snapshot",
          canonicalTable: "quote_snapshot",
          readbackAction: "query_quote",
        }),
      ]),
    });
    expect(
      payload.failureActionQueue.every((row: { id?: string }) =>
        row.id?.startsWith("failure:"),
      ),
    ).toBe(true);
    expect(
      payload.failureActionQueue.every(
        (row: { affectedInterfaces?: string[] }) =>
          row.affectedInterfaces?.length,
      ),
    ).toBe(true);
  });

  it("defaults to a bounded summary view", () => {
    const payload = JSON.parse(
      dataHealth(fakeStore(), { action: "data_health", limit: 3 }),
    );

    expect(payload.section).toBe("summary");
    expect(payload.interfaces).toBeUndefined();
    expect(payload.attentionInterfaces.length).toBeLessThanOrEqual(3);
    expect(payload.providerAttention.length).toBeLessThanOrEqual(3);
    expect(payload.providerGapQueue).toEqual(payload.providerGaps);
    expect(payload.failureActionQueue).toEqual(payload.failureActions);
    expect(payload.providerGapQueue.length).toBeLessThanOrEqual(3);
    expect(payload.failureActionQueue.length).toBeLessThanOrEqual(3);
  });

  it("supports focused gap and failure sections", () => {
    const gaps = JSON.parse(
      dataHealth(fakeStore(), {
        action: "data_health",
        section: "gaps",
        limit: 5,
      }),
    );
    const failures = JSON.parse(
      dataHealth(fakeStore(), {
        action: "data_health",
        section: "failures",
        limit: 5,
      }),
    );

    expect(gaps.section).toBe("gaps");
    expect(gaps.providerGapQueue).toEqual(gaps.providerGaps);
    expect(gaps.providerGapQueue.length).toBeGreaterThan(0);
    expect(gaps.summary.credentialValidatedRows).toBeGreaterThanOrEqual(0);
    if (gaps.credentialActivationQueue.length > 0) {
      expect(gaps.credentialActivationQueue[0].actionPriority).toBe(2);
    }
    expect(gaps.interfaces).toBeUndefined();
    expect(failures.section).toBe("failures");
    expect(failures.failureActionQueue).toEqual(failures.failureActions);
    expect(failures.failureActionQueue.length).toBeGreaterThan(0);
    expect(
      failures.failureActionQueue.every(
        (row: {
          failureClass?: string | null;
          presenceReason?: string;
          exitCondition?: string;
          retryPolicy?: string;
          nextAction?: string;
        }) =>
          Object.hasOwn(row, "failureClass") &&
          row.presenceReason &&
          row.exitCondition &&
          row.retryPolicy &&
          row.nextAction,
      ),
    ).toBe(true);
    expect(failures.providers).toBeUndefined();
  });
});
