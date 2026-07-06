import { describe, expect, it } from "vitest";
import { MarketDataTool } from "../../src/agent/tools/market-data";

function fakeContext() {
  return {
    basePath: "/tmp/finagent-workstation-market-data-sources",
    workDir: "/tmp",
    memoryDir: "/tmp/memory",
    bundleDir: "/tmp/bundle",
    projectLocalDir: "/tmp/.finagent-workstation",
    pluginSkillPaths: [],
    skipPermissions: true,
    approvedTools: new Set<string>(),
    planMode: false,
    readFileTimestamps: new Map<string, number>(),
    taskRegistry: {} as any,
    teamRegistry: {} as any,
  };
}

describe("MarketData sources action", () => {
  it("returns governed provider source status provenance", async () => {
    const tool = new MarketDataTool();
    const payload = JSON.parse(
      await tool.call("sources", { action: "sources" }, fakeContext()),
    );

    expect(payload).toMatchObject({
      action: "sources",
      interfaceId: "provider.source_status",
      provider: "local",
      capabilityId: "local.provider.source_status",
      cacheStatus: "local-evidence",
      cacheDecision: expect.stringContaining("does not refresh provider data"),
      canonicalSchema: "provider_source_status",
      canonicalTable: "provider_source_status",
      readbackAction: "sources",
    });
    expect(payload.availableSources).toContain("eastmoneyDirect");
    expect(payload.provider_policy.quote).toBeInstanceOf(Array);
  });
});
