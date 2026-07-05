import { describe, expect, it } from "vitest";
import { DataStoreTool } from "../../src/agent/tools/data-store-tool";
import type { ToolContext } from "../../src/agent/tool";
import { TaskRegistry } from "../../src/agent/background-task";
import { TeamRegistry } from "../../src/agent/team-context";

function fakeContext(): ToolContext {
  const taskRegistry = new TaskRegistry();
  taskRegistry.configure("/tmp/finagent-workstation-test/memory");
  const teamRegistry = new TeamRegistry();
  teamRegistry.configure("/tmp/finagent-workstation-test/memory");
  return {
    basePath: "/tmp/finagent-workstation-test",
    workDir: process.cwd(),
    memoryDir: "/tmp/finagent-workstation-test/memory",
    bundleDir: "/tmp/finagent-workstation-test/bundle",
    projectLocalDir: "/tmp/finagent-workstation-test/project",
    pluginSkillPaths: [],
    skipPermissions: true,
    approvedTools: new Set<string>(),
    planMode: false,
    readFileTimestamps: new Map<string, number>(),
    taskRegistry,
    teamRegistry,
  };
}

describe("DataStore interface discovery actions", () => {
  it("advertises progressive-disclosure actions in the schema", () => {
    const tool = new DataStoreTool();
    const actions = (tool.inputSchema.properties.action.enum ?? []) as string[];
    expect(actions).toEqual(
      expect.arrayContaining([
        "interfaces",
        "interface_describe",
        "interface_availability",
      ]),
    );
  });

  it("returns catalog, contract, and availability payloads", async () => {
    const tool = new DataStoreTool();
    const ctx = fakeContext();

    const catalog = JSON.parse(
      await tool.call(
        "tool-1",
        {
          action: "interfaces",
          category: "stock",
          provider: "tdx",
          limit: 10,
        },
        ctx,
      ),
    );
    expect(catalog.action).toBe("interfaces");
    expect(catalog.interfaceId).toBe("data.interface_catalog");
    expect(catalog.summary.interfaces).toBeGreaterThan(0);
    expect(
      catalog.interfaces.some(
        (row: { interfaceId: string }) => row.interfaceId === "stock.quote",
      ),
    ).toBe(true);

    const describe = JSON.parse(
      await tool.call(
        "tool-2",
        {
          action: "interface_describe",
          interfaceId: "stock.quote",
        },
        ctx,
      ),
    );
    expect(describe.action).toBe("interface_describe");
    expect(describe.contract).toMatchObject({
      id: "stock.quote",
      canonicalSchema: "quote_snapshot",
    });

    const availability = JSON.parse(
      await tool.call(
        "tool-3",
        {
          action: "interface_availability",
          interfaceId: "stock.quote",
          provider: "tdx",
          providerMode: "strict",
        },
        ctx,
      ),
    );
    expect(availability.action).toBe("interface_availability");
    expect(availability.request).toMatchObject({
      provider: "tdx",
      providerMode: "strict",
    });
    expect(availability.eligibleCapabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "tdx",
        }),
      ]),
    );
  });

  it("returns a bounded availability summary when interfaceId is omitted", async () => {
    const tool = new DataStoreTool();
    const ctx = fakeContext();

    const availability = JSON.parse(
      await tool.call(
        "tool-summary",
        {
          action: "interface_availability",
          category: "stock",
          limit: 5,
        },
        ctx,
      ),
    );

    expect(availability.action).toBe("interface_availability");
    expect(availability.interfaceId).toBe("data.interface_availability_summary");
    expect(availability.summary.returned).toBeGreaterThan(0);
    expect(availability.interfaces.length).toBeLessThanOrEqual(5);
    expect(availability.interfaces[0]).toEqual(
      expect.objectContaining({
        interfaceId: expect.any(String),
        routeReadiness: expect.any(String),
      }),
    );
  });
});
