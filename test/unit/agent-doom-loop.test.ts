import { describe, expect, it } from "vitest";
import { detectDoomLoop } from "../../src/agent/agent-helpers";

describe("agent doom-loop detection", () => {
  it("does not warn when repeated Read calls have distinct long paths", () => {
    const longPrefix = "~/.finagent-workstation/projects/by-cwd~/Documents/workspace/standalone/finagent-workstation/bundle/assets/skills/tradingview/references/";
    const calls = [
      `${longPrefix}advanced-chart.md`,
      `${longPrefix}dynamic-digits.md`,
      `${longPrefix}finagent-workstation-bridge.md`,
      `${longPrefix}widgets.md`,
      `${longPrefix}scanner.md`,
      `${longPrefix}layout.md`,
    ].map((path) => `Read:${JSON.stringify({ file_path: path })}`);

    expect(detectDoomLoop(calls, 0)).toEqual({
      result: false,
      newWarningCount: 0,
    });
  });

  it("still warns on identical repeated calls", () => {
    const call = `Read:${JSON.stringify({ file_path: "memory/pages/a.html" })}`;
    expect(detectDoomLoop([call, call, call, call, call, call], 0)).toEqual({
      result: "warn",
      newWarningCount: 1,
    });
  });
});
