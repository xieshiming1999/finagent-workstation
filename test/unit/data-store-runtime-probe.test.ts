import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildRuntimeProbeGuidance, FinanceRuntimeProbeService } from "../../src/agent/data/runtime-probe-service";
import type { DataStore } from "../../src/agent/data/store/data-store";
import { runtimeProbe } from "../../src/agent/tools/data-store-tool-runtime-probe";

function fakeStore(): DataStore {
  return {
    isReady: true,
    getStats: () => ({ sizeBytes: 0, tables: [] }),
    getReusableDataSummary: () => [],
    query: () => [],
  } as unknown as DataStore;
}

describe("DataStore runtime_probe action", () => {
  it("returns parseable governed runtime probe status", async () => {
    const payload = JSON.parse(
      await runtimeProbe(fakeStore(), { action: "runtime_probe", probeAction: "status" }, "/tmp/finagent-workstation-runtime-probe-test"),
    );

    expect(payload.action).toBe("runtime_probe");
    expect(payload.probeAction).toBe("status");
    expect(payload.status).toMatchObject({
      running: false,
      selectedCount: 0,
    });
    expect(payload.status.availableModes).toContain("credential");
    const tencentPack = payload.status.providerProbePacks.find((pack: { provider: string }) => pack.provider === "tencent");
    expect(tencentPack).toBeTruthy();
    expect(tencentPack.finElectronStatus).toContain("13 governed Tencent provider capabilities");
    expect(tencentPack.finAgentStatus).toContain("stock.quote includes A-share and global-only Tencent HK/US quote capabilities");
    expect(tencentPack.boundedProbeIds).toContain("tencent.quote.convertible_bond_batch");
    expect(tencentPack.boundedProbeIds).toContain("tencent.kline.etf_none");
    const sinaPack = payload.status.providerProbePacks.find((pack: { provider: string }) => pack.provider === "sina");
    expect(sinaPack.finElectronStatus).toContain("fund dividend/factor");
    expect(sinaPack.finElectronStatus).toContain("direct Sina ETF daily K-line remains not-supported");
    expect(payload.status.guidance.progressiveDisclosurePath).toEqual([
      "interfaces",
      "interface_describe",
      "interface_availability",
      "data_health",
      "runtime_probe",
    ]);
    expect(payload.provenance).toMatchObject({
      interfaceId: "data.runtime_probe",
      provider: "local",
      readbackAction: "runtime_probe",
      cacheStatus: "runtime-evidence",
    });
    expect(payload.provenance.cacheDecision).toContain("reads durable operational evidence");
  });

  it("runs selected fixture probe ids without live provider calls", async () => {
    const oldFixture = process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE;
    const basePath = mkdtempSync(join(tmpdir(), "finagent-workstation-runtime-probe-fixture-"));
    process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE = "1";
    try {
      const payload = JSON.parse(
        await runtimeProbe(
          fakeStore(),
          {
            action: "runtime_probe",
            probeAction: "run",
            probeMode: "all",
            probeIds: ["fixture.positive_probe"],
          },
          basePath,
        ),
      );

      expect(payload.probeAction).toBe("run");
      expect(payload.provenance.cacheStatus).toBe("runtime-evidence");
      expect(payload.provenance.cacheDecision).toContain("generated durable operational evidence");
      expect(payload.status.selectedProbeIds).toEqual(["fixture.positive_probe"]);
      expect(payload.status.selectedCount).toBe(1);
      expect(payload.status.summary).toMatchObject({ total: 1, passed: 1, failed: 0 });
      expect(payload.status.outputPath).toContain("runtime-probes/matrix/latest.json");
      expect(payload.status.liveStatusPath).toContain("runtime-probes/live-status/latest.json");
      expect(existsSync(payload.status.outputPath)).toBe(true);
      expect(existsSync(payload.status.liveStatusPath)).toBe(true);
    } finally {
      if (oldFixture === undefined) delete process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE;
      else process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE = oldFixture;
      rmSync(basePath, { recursive: true, force: true });
    }
  });

  it("builds health-driven recommended and blocked runtime probe targets", () => {
    const guidance = buildRuntimeProbeGuidance({
      credentialActivationQueue: [
        {
          interfaceId: "wind.document",
          provider: "wind",
          status: "credential-gated",
          capabilityId: "wind.wind_document",
          probeId: "wind.document_probe",
          activationState: "configured-awaiting-validation",
          nextAction: "Run Wind credential validation.",
        },
        {
          interfaceId: "wind.analytics",
          provider: "wind",
          status: "credential-gated",
          capabilityId: "wind.analytics",
          probeId: "wind.analytics_probe",
          activationState: "credential-missing",
        },
      ],
      providerGapQueue: [
        {
          interfaceId: "stock.quote",
          provider: "eastmoney",
          status: "transport-unstable",
          capabilityId: "eastmoney.stock.quote",
          probeId: "eastmoney.quote_probe",
          gapClass: "serial-live-retry",
        },
      ],
      policyDisabledQueue: [],
      failureActionQueue: [
        {
          probeId: "tdx.runtime_probe",
          provider: "tdx",
          failureClass: "transport",
          affectedInterfaces: ["stock.daily_kline"],
        },
        {
          probeId: "tencent.unsupported_sort",
          provider: "tencent",
          failureClass: "provider_rejected_or_unsupported_route",
          validationState: "unsupported-by-provider",
          retryPolicy: "no retry until adapter or schema contract is fixed",
          affectedInterfaces: ["stock.identity_list"],
          exitCondition: "Leave blocked after tested unsupported route evidence unless the provider contract changes.",
        },
        {
          probeId: "tushare.permission_probe",
          provider: "tushare",
          failureClass: "credential-or-permission",
          retryPolicy: "no automatic retry until credential or permission changes",
          affectedInterfaces: ["index.constituents"],
        },
      ],
      rows: [],
      providerRows: [],
      datasetRows: [],
      summary: {},
      runtimeLiveStatusReport: null,
    } as any);

    expect(guidance.recommendedTargets.map((target) => target.probeId)).toEqual([
      "eastmoney.quote_probe",
      "tdx.runtime_probe",
      "wind.document_probe",
    ]);
    expect(guidance.blockedTargets.map((target) => target.probeId)).toContain("wind.analytics_probe");
    expect(guidance.blockedTargets.map((target) => target.probeId)).toContain("tencent.unsupported_sort");
    expect(guidance.blockedTargets.map((target) => target.probeId)).toContain("tushare.permission_probe");
    expect(guidance.recommendedTargets.map((target) => target.probeId)).not.toContain("tencent.unsupported_sort");
    expect(guidance.recommendedTargets.map((target) => target.probeId)).not.toContain("tushare.permission_probe");
    expect(guidance.recommendedTargets[0]).toHaveProperty("expectedExitCondition");
    expect(guidance.recommendedTargets[0]).toHaveProperty("normalWorkflowAllowedBeforeSuccess", false);
    expect(
      guidance.blockedTargets.find((target) => target.probeId === "tencent.unsupported_sort"),
    ).toMatchObject({
      sourceQueue: "failureActionQueue",
      riskPolicy: "Blocked from runtime_probe retry selection; resolve root cause before probing.",
      expectedExitCondition: "Leave blocked after tested unsupported route evidence unless the provider contract changes.",
    });
    expect(guidance.providerProbePacks.map((pack) => pack.provider)).toContain("sina");
  });

  it("runs all mode from recommended targets and leaves blocked targets unselected", async () => {
    const oldFixture = process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE;
    const basePath = mkdtempSync(join(tmpdir(), "finagent-workstation-runtime-probe-selection-"));
    process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE = "1";
    try {
      const service = new FinanceRuntimeProbeService(basePath, () => ({
        credentialActivationQueue: [
          {
            interfaceId: "wind.document",
            provider: "wind",
            status: "credential-gated",
            capabilityId: "wind.wind_document",
            probeId: "wind.document_probe",
            activationState: "configured-awaiting-validation",
          },
          {
            interfaceId: "wind.analytics",
            provider: "wind",
            status: "credential-gated",
            capabilityId: "wind.analytics",
            probeId: "wind.analytics_probe",
            activationState: "credential-missing",
          },
        ],
        providerGapQueue: [],
        policyDisabledQueue: [],
        failureActionQueue: [
          {
            probeId: "tdx.runtime_probe",
            provider: "tdx",
            failureClass: "transport",
            affectedInterfaces: ["stock.daily_kline"],
          },
          {
            probeId: "tencent.unsupported_sort",
            provider: "tencent",
            failureClass: "provider_rejected_or_unsupported_route",
            retryPolicy: "no retry until adapter or schema contract is fixed",
            affectedInterfaces: ["stock.identity_list"],
          },
        ],
        rows: [
          {
            interfaceId: "stock.quote",
            health: "warning",
            liveStatus: "failed",
            liveProbeIds: ["stock.quote.routing_probe"],
            supportedProviders: ["tdx"],
            gatedProviders: [],
            localRows: 0,
            capabilities: [
              {
                probeId: "stock.quote.routing_probe",
                capabilityId: "tdx.stock.quote",
              },
            ],
          },
        ],
        providerRows: [],
        datasetRows: [],
        summary: {},
        runtimeLiveStatusReport: null,
      } as any));

      const status = await service.run("all");

      expect(status.selectedProbeIds).toEqual([
        "stock.quote.routing_probe",
        "tdx.runtime_probe",
        "wind.document_probe",
      ]);
      expect(status.selectedProbeIds).not.toContain("wind.analytics_probe");
      expect(status.selectedProbeIds).not.toContain("tencent.unsupported_sort");
      expect(status.selectedTargets.map((target) => target.probeId)).toContain("stock.quote.routing_probe");
      expect(status.blockedTargets.map((target) => target.probeId)).toContain("wind.analytics_probe");
      expect(status.blockedTargets.map((target) => target.probeId)).toContain("tencent.unsupported_sort");
      expect(status.summary).toMatchObject({ total: 3, passed: 3, failed: 0 });
    } finally {
      if (oldFixture === undefined) delete process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE;
      else process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE = oldFixture;
      rmSync(basePath, { recursive: true, force: true });
    }
  });

  it("preserves blocked target context for explicit bounded probe runs", async () => {
    const oldFixture = process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE;
    const basePath = mkdtempSync(join(tmpdir(), "finagent-workstation-runtime-probe-explicit-blocked-"));
    process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE = "1";
    try {
      const service = new FinanceRuntimeProbeService(basePath, () => ({
        credentialActivationQueue: [],
        providerGapQueue: [],
        policyDisabledQueue: [],
        failureActionQueue: [
          {
            probeId: "tushare.permission_probe",
            provider: "tushare",
            failureClass: "credential-or-permission",
            retryPolicy: "no automatic retry until credential or permission changes",
            affectedInterfaces: ["index.constituents"],
            exitCondition: "Leave blocked only after token permission changes and focused probe passes.",
          },
        ],
        rows: [],
        providerRows: [],
        datasetRows: [],
        summary: {},
        runtimeLiveStatusReport: null,
      } as any));

      const status = await service.run("all", ["tushare.permission_probe"]);

      expect(status.selectedProbeIds).toEqual(["tushare.permission_probe"]);
      expect(status.selectedTargets).toHaveLength(1);
      expect(status.selectedTargets[0]).toMatchObject({
        probeId: "tushare.permission_probe",
        sourceQueue: "failureActionQueue",
        riskPolicy: "Blocked from runtime_probe retry selection; resolve root cause before probing.",
        expectedExitCondition: "Leave blocked only after token permission changes and focused probe passes.",
      });
      expect(status.blockedTargets.map((target) => target.probeId)).toContain("tushare.permission_probe");
      expect(status.summary).toMatchObject({ total: 1, passed: 1, failed: 0 });
    } finally {
      if (oldFixture === undefined) delete process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE;
      else process.env.FINAGENT_WORKSTATION_RUNTIME_PROBE_FIXTURE = oldFixture;
      rmSync(basePath, { recursive: true, force: true });
    }
  });
});
