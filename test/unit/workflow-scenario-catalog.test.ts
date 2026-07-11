import { readFileSync } from "fs";
import { existsSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

interface ScenarioRow {
  id: string;
  runtime: string;
  liveProviderPolicy: string;
}

const catalogPath = resolve(
  process.cwd(),
  "..",
  "docs/design/evaluation/finance_agent_workflow_scenarios_2026_06_25.md",
);

describe("finance workflow scenario catalog", () => {
  it("keeps the P0 dashboard real-agent scenario bounded and route-limited", () => {
    const scenarioCatalog = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          "..",
          "docs/design/evaluation/finance_agent_p0_real_agent_scenarios_2026_06_26.json",
        ),
        "utf-8",
      ),
    ) as {
      scenarios: Array<{
        id: string;
        turns: Array<{
          id: string;
          prompt: string;
          expectFinalContains?: string[];
          disallowTools?: string[];
          maxToolCalls?: number;
          maxDataToolCalls?: number;
          timeoutMs?: number;
          expectNoToolErrors?: boolean;
        }>;
      }>;
    };
    const dashboard = scenarioCatalog.scenarios.find(
      (scenario) => scenario.id === "p0-dashboard-multiturn-real-agent",
    );
    expect(dashboard).toBeTruthy();

    const createTurn = dashboard!.turns.find(
      (turn) => turn.id === "create-dashboard",
    );
    const refreshTurn = dashboard!.turns.find(
      (turn) => turn.id === "refresh-and-explain-failures",
    );
    expect(createTurn).toBeTruthy();
    expect(refreshTurn).toBeTruthy();

    expect(createTurn!.maxToolCalls).toBeLessThanOrEqual(14);
    expect(createTurn!.maxDataToolCalls).toBeLessThanOrEqual(8);
    expect(createTurn!.timeoutMs).toBeLessThanOrEqual(180_000);
    expect(createTurn!.expectNoToolErrors).toBe(true);
    expect(createTurn!.disallowTools).toEqual(
      expect.arrayContaining(["Read", "Glob", "Grep", "Bash", "Write", "UIControl"]),
    );
    expect(createTurn!.expectFinalContains).toEqual(
      expect.arrayContaining(["茅台", "看板", "PE", "PB"]),
    );
    expect(createTurn!.prompt).toContain('Dashboard(template:"report")');
    expect(createTurn!.prompt).toContain("不要先写自定义 HTML");
    expect(createTurn!.prompt).toContain("不要用 Read/Glob/Grep/Bash");
    expect(createTurn!.prompt).toContain("不要使用 Write/UIControl");
    expect(createTurn!.prompt).toContain("生成后的 dashboard HTML");
    expect(createTurn!.prompt).toContain("WebView screenshot 或 get_info");
    expect(createTurn!.prompt).toContain("立即用一句话总结");
    expect(createTurn!.prompt).toContain("不要调用 query_technical_indicator");
    expect(createTurn!.prompt).toContain("只允许调用一次 Dashboard");
    expect(createTurn!.prompt).toContain("只允许调用一次 WebView");
    expect(createTurn!.prompt).toContain("必须明确估值状态");
    expect(createTurn!.prompt).toContain("写出 PE/PB、来源和数据/获取时间");
    expect(createTurn!.prompt).toContain("只有 Dashboard 模板失败时");
    expect(createTurn!.prompt).toContain("不要改用自定义 HTML");
    expect(createTurn!.prompt).toContain("/api/finance/quote");
    expect(createTurn!.prompt).toContain("/api/finance/kline");
    expect(createTurn!.prompt).toContain("/api/finance/technical");
    expect(createTurn!.prompt).toContain("/api/finance/news");
    expect(createTurn!.prompt).toContain(
      "估值数据缺失：基本面接口中 PE、PB 字段显示为 “-”，本次未获取到有效估值指标。",
    );
    expect(createTurn!.prompt).toMatch(/看板风险提示和聊天总结必须明确估值状态/);
    expect(createTurn!.prompt).toMatch(/如果 PE\/PB 缺失[\s\S]*必须包含原句/);

    expect(refreshTurn!.maxToolCalls).toBeLessThanOrEqual(14);
    expect(refreshTurn!.maxDataToolCalls).toBeLessThanOrEqual(9);
    expect(refreshTurn!.timeoutMs).toBeLessThanOrEqual(180_000);
    expect(refreshTurn!.expectNoToolErrors).toBe(true);
    expect(refreshTurn!.disallowTools).toEqual(
      expect.arrayContaining([
        "Read",
        "Glob",
        "Grep",
        "Bash",
        "Edit",
        "FileWrite",
        "Write",
        "UIControl",
      ]),
    );
    expect(refreshTurn!.expectFinalContains).toEqual(
      expect.arrayContaining(["刷新", "API", "PE", "PB"]),
    );
    expect(refreshTurn!.prompt).toContain("不要重写整个看板");
    expect(refreshTurn!.prompt).toContain("不要使用 Edit/FileWrite/Write");
    expect(refreshTurn!.prompt).toContain("不要使用 UIControl");
    expect(refreshTurn!.prompt).toContain("不要用 Read/Glob/Grep/Bash");
    expect(refreshTurn!.prompt).toContain('Dashboard(template:"report")');
    expect(refreshTurn!.prompt).toContain("不要扩大成全市场扫描");
    expect(refreshTurn!.prompt).toContain("如果四类 readback 已有数据，不要 forceLive fetch");
    expect(refreshTurn!.prompt).toContain("不要调用 query_technical_indicator");
    expect(refreshTurn!.prompt).toContain("重新调用一次 Dashboard");
    expect(refreshTurn!.prompt).toContain("只调用一次 WebView refresh");
    expect(refreshTurn!.prompt).toContain("刷新结论必须明确估值状态");
    expect(refreshTurn!.prompt).toContain("写出 PE/PB、来源和数据/获取时间");
    expect(refreshTurn!.prompt).toContain(
      "估值数据缺失：基本面接口中 PE、PB 字段显示为 “-”，本次未获取到有效估值指标。",
    );
    expect(refreshTurn!.prompt).toMatch(/刷新结论必须明确估值状态/);
    expect(refreshTurn!.prompt).toMatch(/如果 PE\/PB 缺失[\s\S]*必须包含原句/);
  });

  it("keeps DSH-002 and DSH-003 real-agent dashboard scenarios bounded", () => {
    const scenarioCatalog = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          "..",
          "docs/design/evaluation/finance_agent_p0_real_agent_scenarios_2026_06_26.json",
        ),
        "utf-8",
      ),
    ) as {
      scenarios: Array<{
        id: string;
        turns: Array<{
          id: string;
          prompt: string;
          expectFinalContains?: string[];
          disallowTools?: string[];
          maxToolCalls?: number;
          maxDataToolCalls?: number;
          timeoutMs?: number;
          expectNoToolErrors?: boolean;
        }>;
      }>;
    };

    for (const id of [
      "p0-market-overview-dashboard-real-agent",
      "p0-stock-selection-watch-dashboard-real-agent",
    ]) {
      const scenario = scenarioCatalog.scenarios.find((row) => row.id === id);
      expect(scenario).toBeTruthy();
      expect(scenario!.turns).toHaveLength(1);
      const turn = scenario!.turns[0]!;
      expect(turn.maxToolCalls).toBeLessThanOrEqual(14);
      expect(turn.maxDataToolCalls).toBeLessThanOrEqual(8);
      expect(turn.timeoutMs).toBeLessThanOrEqual(180_000);
      expect(turn.expectNoToolErrors).toBe(true);
      expect(turn.disallowTools).toEqual(
        expect.arrayContaining(["Read", "Glob", "Grep", "Bash", "Write", "UIControl"]),
      );
      expect(turn.prompt).toContain('Dashboard(template:"report")');
      expect(turn.prompt).toContain("不要先写自定义 HTML");
      expect(turn.prompt).toContain("不要用 Read/Glob/Grep/Bash");
      expect(turn.prompt).toContain("不要使用 Write/UIControl");
      expect(turn.prompt).toContain("只允许调用一次 Dashboard");
      expect(turn.prompt).toContain("只允许调用一次 WebView");
      expect(turn.prompt).toContain("立即用一句话总结");
      expect(turn.prompt).toContain("来源");
      expect(turn.prompt).toContain("数据时间");
      expect(turn.prompt).toContain("获取时间");
    }
    const marketOverview = scenarioCatalog.scenarios.find(
      (row) => row.id === "p0-market-overview-dashboard-real-agent",
    )!.turns[0]!;
    expect(marketOverview.prompt).toContain('DataStore(action:"query_index_quote", code:"000001")');
    expect(marketOverview.prompt).toContain("不要调用缺少 code/symbol 的 query_quote");
    expect(marketOverview.prompt).toContain("不要再把期权/新股行当板块结论");
  });

  it("keeps no-live FinAgent Workstation and FinAgent scenarios paired by workflow suffix", () => {
    const markdown = readFileSync(catalogPath, "utf-8");
    const exceptions = parseExceptionIds(markdown);
    const rows = parseScenarioRows(markdown).filter(
      (row) => !exceptions.has(row.id),
    );
    const electron = rows.filter(
      (row) =>
        (row.runtime === "FinAgent Workstation" || row.runtime === "Fin Electron") &&
        row.liveProviderPolicy === "none",
    );
    const mobile = rows.filter(
      (row) =>
        row.runtime === "FinAgent/shared-mobile" &&
        row.liveProviderPolicy === "none",
    );

    expect(electron.length).toBeGreaterThan(0);
    expect(mobile.length).toBeGreaterThan(0);
    expect(exceptions).not.toContain("electron-data-feed-status-smoke");

    const electronSuffixes = electron
      .map((row) => suffix(row.id, "electron-"))
      .sort();
    const mobileSuffixes = mobile
      .map((row) => suffix(row.id, "mobile-"))
      .sort();
    expect(electronSuffixes).toEqual(mobileSuffixes);
  });

  it("keeps no-live scenario catalog entries backed by executable workflow tests", () => {
    const markdown = readFileSync(catalogPath, "utf-8");
    const exceptions = parseExceptionIds(markdown);
    const rows = parseScenarioRows(markdown).filter(
      (row) => !exceptions.has(row.id),
    );
    const executableWorkflowTests = [
      readFileSync(
        resolve(process.cwd(), "test/unit/workflow-automation-control.test.ts"),
        "utf-8",
      ),
      readExistingTest("test/integration/finance-user-workflow-p0.test.ts"),
      readExistingTest("test/integration/finance-workflow-capability.test.ts"),
      readFileSync(
        resolve(
          process.cwd(),
          "..",
          "app/test/agent/workflow_automation_control_test.dart",
        ),
        "utf-8",
      ),
      readFileSync(
        resolve(
          process.cwd(),
          "..",
          "finagent/test/workflow_automation_runtime_test.dart",
        ),
        "utf-8",
      ),
      readFileSync(
        resolve(
          process.cwd(),
          "..",
          "finagent/test/workflow_automation_app_started_test.dart",
        ),
        "utf-8",
      ),
      readExistingTest("test/e2e/app.test.ts"),
    ].join("\n");
    const missingExecutableEvidence = rows
      .map((row) => row.id)
      .filter((id) => !executableWorkflowTests.includes(id));

    expect(missingExecutableEvidence).toEqual([]);
  });

  it("keeps executable electron/mobile workflow scenarios cataloged", () => {
    const markdown = readFileSync(catalogPath, "utf-8");
    const catalogIds = new Set([
      ...parseScenarioRows(markdown).map((row) => row.id),
      ...parseExceptionIds(markdown),
    ]);
    const executableWorkflowTests = [
      readFileSync(
        resolve(process.cwd(), "test/unit/workflow-automation-control.test.ts"),
        "utf-8",
      ),
      readExistingTest("test/integration/finance-user-workflow-p0.test.ts"),
      readExistingTest("test/integration/finance-workflow-capability.test.ts"),
      readFileSync(
        resolve(
          process.cwd(),
          "..",
          "app/test/agent/workflow_automation_control_test.dart",
        ),
        "utf-8",
      ),
      readFileSync(
        resolve(
          process.cwd(),
          "..",
          "finagent/test/workflow_automation_runtime_test.dart",
        ),
        "utf-8",
      ),
      readFileSync(
        resolve(
          process.cwd(),
          "..",
          "finagent/test/workflow_automation_app_started_test.dart",
        ),
        "utf-8",
      ),
      readExistingTest("test/e2e/app.test.ts"),
    ].join("\n");
    const executableScenarioIds = Array.from(
      executableWorkflowTests.matchAll(
        /id:\s*["']((?:electron|mobile)-[^"']+)["']/g,
      ),
    )
      .map((match) => match[1])
      .filter((id) => id.endsWith("-smoke"))
      .sort();
    const uncataloged = executableScenarioIds.filter(
      (id) => !catalogIds.has(id),
    );

    expect(uncataloged).toEqual([]);
  });

  it("documents and exercises UI artifact evidence expectations", () => {
    const markdown = readFileSync(catalogPath, "utf-8");
    const electronE2e = [
      readExistingTest("test/e2e/app.test.ts"),
      readExistingTest("test/integration/finance-user-workflow-p0.test.ts"),
      readExistingTest("test/integration/finance-workflow-capability.test.ts"),
    ].join("\n");

    expect(markdown).toContain("expectedUiArtifactKinds");
    expect(markdown).toContain("main-window-screenshot");
    expect(electronE2e).toContain("ArtifactRegistry");
    expect(electronE2e).toContain("dashboard");
    expect(electronE2e).toContain("dashboards");
  });
});

function parseScenarioRows(markdown: string): ScenarioRow[] {
  const table = section(
    markdown,
    "## Current No-Live Scenario Set",
    "## Runtime-Specific Scenario Exceptions",
  );
  return table
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("| `"))
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 6)
    .map((cells) => ({
      id: cells[1].replace(/^`|`$/g, ""),
      runtime: cells[2],
      liveProviderPolicy: cells[5].replace(/^`|`$/g, ""),
    }));
}

function parseExceptionIds(markdown: string): Set<string> {
  const table = section(
    markdown,
    "## Runtime-Specific Scenario Exceptions",
    "## Expansion Rules",
  );
  return new Set(
    table
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("| `"))
      .map((line) => line.split("|").map((cell) => cell.trim()))
      .filter((cells) => cells.length >= 5)
      .map((cells) => cells[1].replace(/^`|`$/g, "")),
  );
}

function section(markdown: string, start: string, end: string): string {
  const startIndex = markdown.indexOf(start);
  if (startIndex < 0) throw new Error(`Missing section ${start}`);
  const endIndex = markdown.indexOf(end, startIndex + start.length);
  if (endIndex < 0) throw new Error(`Missing section ${end}`);
  return markdown.slice(startIndex, endIndex);
}

function suffix(id: string, prefix: string): string {
  if (!id.startsWith(prefix))
    throw new Error(`Scenario id ${id} does not start with ${prefix}`);
  return id.slice(prefix.length);
}

function readExistingTest(relativePath: string): string {
  const path = resolve(process.cwd(), relativePath);
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}
