import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { financeOutputStandardPromptGuidance } from "../../src/agent/finance-output-standard";

const repoRoot = resolve(__dirname, "../..");

const skillPaths = [
  "assets/skills/data-management/skill.md",
  "assets/skills/data-sources/skill.md",
];

const financeOutputSkillPaths = [
  "assets/skills/analysis-standards/skill.md",
  "assets/skills/stock-picking/skill.md",
  "assets/skills/fund-screening/skill.md",
  "assets/skills/report-analysis/skill.md",
];

describe("finance bundled skill contracts", () => {
  it.each(skillPaths)(
    "%s documents the reusable finance surface boundary",
    (relativePath) => {
      const text = readFileSync(resolve(repoRoot, relativePath), "utf-8");

      expect(text).toContain(
        "local cache/query -> provider route -> code normalizer -> canonical persist -> same-runtime readback",
      );
      expect(text).toMatch(/provider adapter/i);
      expect(text).toMatch(/normalizer/i);
      expect(text).toMatch(/canonical/);
      expect(text).toMatch(/readback/i);
    },
  );

  it("documents Data Manager source priority for queue-backed fetches", () => {
    const text = readFileSync(
      resolve(repoRoot, "assets/skills/data-management/skill.md"),
      "utf-8",
    );

    expect(text).toMatch(/source_priority/);
    expect(text).toMatch(/queue-backed fetches/i);
    expect(text).toMatch(/local cache checks/i);
    expect(text).toMatch(/code-owned provider policy/i);
  });

  it("documents fetch queue provenance and shared configured-feed execution", () => {
    const text = readFileSync(
      resolve(repoRoot, "assets/skills/data-management/skill.md"),
      "utf-8",
    );

    expect(text).toContain("provider.fetch_task_queue");
    expect(text).toContain("local.provider.fetch_task_queue");
    expect(text).toContain("fetch_task_queue");
    expect(text).toContain("fetch_tasks");
    expect(text).toContain("fetch_status");
    expect(text).toContain("actionableFailures");
    expect(text).toContain("nonActionableEvidence");
    expect(text).toContain("nextAction");
    expect(text).toMatch(
      /Manual Data Manager \*\*Run\*\* and scheduled Data Feed execution use the same configured-feed enqueue path/,
    );
    expect(text).toMatch(
      /Failed fetch tasks stay in task\/API-health logs, not reusable data tables/,
    );
  });

  it.each([
    "assets/skills/data-management/skill.md",
    "assets/skills/data-sources/skill.md",
  ])("%s documents raw payload readback as diagnostic-only provenance", (relativePath) => {
    const text = readFileSync(resolve(repoRoot, relativePath), "utf-8");

    expect(text).toContain("query_raw_payload");
    expect(text).toContain("provider.raw_payload_audit");
    expect(text).toContain("normalWorkflowAllowed:false");
  });

  it.each(skillPaths)(
    "%s documents strict-provider cache evidence rules",
    (relativePath) => {
      const text = readFileSync(resolve(repoRoot, relativePath), "utf-8");

      expect(text).toMatch(
        /provider\/source|source\/provider|provider\/source/i,
      );
      expect(text).toMatch(/cache hit|cache-hit|cache-first|cache/i);
      expect(text).toMatch(/strict/i);
      expect(
        text,
        `${relativePath} should not describe strict provider as only after cache miss`,
      ).not.toMatch(/strict[\s\S]{0,120}(after cache miss|only constrains)/i);
    },
  );

  it.each(skillPaths)(
    "%s documents provider order remains subject to health gates",
    (relativePath) => {
      const text = readFileSync(resolve(repoRoot, relativePath), "utf-8");

      expect(text).toMatch(/ProviderPolicy|provider policy/i);
      expect(text).toMatch(/runtime\/API[- ]health|API Health|data_health/i);
      expect(text).toMatch(/temporarily blocked|临时阻断/i);
      expect(text).toMatch(/preferred provider|source_priority|scoped preferred provider order|偏好顺序/i);
    },
  );

  it.each([
    "assets/skills/data-sources/skill.md",
  ])("%s documents split credential health queues", (relativePath) => {
    const text = readFileSync(resolve(repoRoot, relativePath), "utf-8");

    expect(text).toContain("credentialActivationQueue");
    expect(text).toContain("credentialValidatedQueue");
    expect(text).toContain("failureActionQueue");
  });

  it.each([
    "assets/skills/data-sources/skill.md",
  ])(
    "%s documents Finance Doctor as local readiness evidence",
    (relativePath) => {
      const text = readFileSync(resolve(repoRoot, relativePath), "utf-8");

      expect(text).toMatch(/finance_doctor/);
      expect(text).toMatch(/runtime/i);
      expect(text).toMatch(/session|会话/i);
      expect(text).toMatch(/readiness/i);
      expect(text).toMatch(/data\.health/);
      expect(text).toMatch(/not\s+a\s+provider refresh|不是 provider refresh/i);
      expect(text).toMatch(/interface_availability/);
    },
  );

  it.each(skillPaths)(
    "%s documents runtime probe retry boundaries",
    (relativePath) => {
      const text = readFileSync(resolve(repoRoot, relativePath), "utf-8");

      expect(text).toMatch(/runtime_probe/);
      expect(text).toMatch(/recommendedTargets/);
      expect(text).toMatch(/blockedTargets/);
      expect(text).toMatch(/providerProbePacks/);
      expect(text).toMatch(/transport/i);
      expect(text).toMatch(/timeout/i);
      expect(text).toMatch(/provider-error/i);
      expect(text).toMatch(/runtime-unavailable/i);
      expect(text).toMatch(/credential/i);
      expect(text).toMatch(/quota/i);
      expect(text).toMatch(/unsupported-route/i);
      expect(text).toMatch(/schema-contract/i);
      expect(text).toMatch(/do-not-retry/i);
      expect(text).toMatch(/probeIds/);
    },
  );

  it("has a code-owned finance output standard for answer evidence types and provenance", () => {
    expect(financeOutputStandardPromptGuidance).toContain("Fact");
    expect(financeOutputStandardPromptGuidance).toContain("Calculation");
    expect(financeOutputStandardPromptGuidance).toContain("Inference");
    expect(financeOutputStandardPromptGuidance).toContain("Recommendation");
    expect(financeOutputStandardPromptGuidance).toContain("Assumption");
    expect(financeOutputStandardPromptGuidance).toContain("Unverified item");
    expect(financeOutputStandardPromptGuidance).toMatch(/source\/as-of time/i);
    expect(financeOutputStandardPromptGuidance).toMatch(
      /fetch or ingest time/i,
    );
    expect(financeOutputStandardPromptGuidance).toMatch(/fields used/i);
    expect(financeOutputStandardPromptGuidance).toMatch(
      /method or tool action/i,
    );
    expect(financeOutputStandardPromptGuidance).toMatch(/quality\/confidence/i);
    expect(financeOutputStandardPromptGuidance).toMatch(/readback status/i);
  });

  it.each(financeOutputSkillPaths)(
    "%s documents the finance output standard",
    (relativePath) => {
      const text = readFileSync(resolve(repoRoot, relativePath), "utf-8");

      for (const term of [
        "fact",
        "calculation",
        "inference",
        "recommendation",
        "assumption",
        "unverified item",
      ]) {
        expect(text.toLowerCase(), `${relativePath} missing ${term}`).toContain(
          term,
        );
      }
      expect(text).toMatch(/source\/as-of time/i);
      expect(text).toMatch(/fetch\/ingest time/i);
      expect(text).toMatch(/fields used/i);
      expect(text).toMatch(/method\/tool action/i);
      expect(text).toMatch(/readback status/i);
    },
  );

  it.each([
    "assets/skills/stock-picking/skill.md",
  ])(
    "%s documents interface-first stock-picking provenance gates",
    (relativePath) => {
      const text = readFileSync(resolve(repoRoot, relativePath), "utf-8");

      expect(text).toMatch(/Provenance gate/i);
      expect(text).toMatch(/interface_describe/);
      expect(text).toMatch(/interface_availability/);
      expect(text).toMatch(/data_health/);
      expect(text).toMatch(/query_quote/);
      expect(text).toMatch(/query_kline/);
      expect(text).toMatch(/query_hot_rank/);
      expect(text).toMatch(/query_money_flow/);
      expect(text).toMatch(/valuation data coverage gap|valuation coverage gap/i);
      expect(text).toMatch(/full-market PE\/ROE refresh|all-market PE\/ROE refresh|full-market PE\/PB\/ROE screen/i);
      expect(text).toMatch(
        /gated, disabled, unsupported, or\s+temporarily blocked/i,
      );
      expect(text).toMatch(/re-fetch blindly/);
    },
  );

  it.each([
    "assets/skills/stock/skill.md",
    "assets/skills/stock-picking/skill.md",
  ])("%s requires the canonical PE/PB missing valuation sentence", (relativePath) => {
    const text = readFileSync(resolve(repoRoot, relativePath), "utf-8");

    expect(text).toContain(
      "估值数据缺失：基本面接口中 PE、PB 字段显示为 “-”，本次未获取到有效估值指标。",
    );
    expect(text).toMatch(/exact\s+sentence/i);
    expect(text).toContain("本地基本面读回中 PE、PB 字段为空，无法给出精确估值区间。");
    expect(text).toMatch(/Do not replace that sentence with weaker wording/i);
    if (relativePath.includes("/stock/skill.md")) {
      expect(text).toMatch(/valuation status explicitly/i);
      expect(text).toMatch(/report PE\/PB with source\/time/i);
    }
  });

  it("documents TradingView/local fallback source-time separation for dashboards", () => {
    const files = [
      "assets/skills/tradingview/skill.md",
      "assets/skills/tradingview/references/dynamic-digits.md",
      "assets/skills/tradingview/references/finagent-workstation-bridge.md",
    ].map((relativePath) => readFileSync(resolve(repoRoot, relativePath), "utf-8"));
    const text = files.join("\n");

    expect(text).toContain("TradingView visual quote");
    expect(text).toContain("provider timestamp unavailable");
    expect(text).toMatch(/data time|as-of/i);
    expect(text).toMatch(/retrieved-at|retrieved at|fetched-at/i);
    expect(text).toMatch(/mismatch|may differ/i);
  });

  it.each([
    "assets/skills/strategy-system/skill.md",
    "assets/skills/stock/skill.md",
    "assets/skills/stock-picking/skill.md",
  ])("%s keeps strategy ranking on the governed MarketData contract", (relativePath) => {
    const text = readFileSync(resolve(repoRoot, relativePath), "utf-8");

    expect(text).toContain("custom_strategy_rank");
    expect(text).toMatch(/governed/i);
    expect(text).toMatch(/strategy-candidate scoring|strategy ranking|strategy-selection/i);
    expect(text).toMatch(/DataProcess\(score_technical\)|technical\s+diagnostics|technical\s+scoring/i);
    expect(text).toMatch(/not the evidence source|do not add|instead of/i);
  });

  it("documents bounded finance dashboard generation with supported Bridge routes", () => {
    const files = [
      "assets/skills/stock/skill.md",
      "assets/skills/tradingview/skill.md",
      "assets/skills/html-artifact/skill.md",
    ].map((relativePath) => readFileSync(resolve(repoRoot, relativePath), "utf-8"));
    const text = files.join("\n");

    expect(text).toMatch(/Dashboard\(template:/);
    expect(text).toMatch(/Do not use `Read`, `Glob`,\s+`Grep`, `Bash`/);
    expect(text).toContain("dashboards/report.html");
    expect(text).toContain("generated dashboard HTML");
    expect(text).toMatch(/WebView\(action:"get_info"\)|WebView\(action:"screenshot"\)/);
    expect(text).toMatch(/12k|12000/i);
    expect(text).toContain("/api/finance/quote");
    expect(text).toContain("/api/finance/kline");
    expect(text).toContain("/api/finance/technical");
    expect(text).toContain("/api/finance/news");
    expect(text).toMatch(/Do not invent\s+routes/i);
    expect(text).toMatch(/compact|bounded/i);
    expect(text).toMatch(/app design system|default dark theme|active design system/i);
  });

  it("documents executable EastMoney K-line source priority for desktop feeds", () => {
    const dataManagement = readFileSync(
      resolve(repoRoot, "assets/skills/data-management/skill.md"),
      "utf-8",
    );
    const dataSources = readFileSync(
      resolve(repoRoot, "assets/skills/data-sources/skill.md"),
      "utf-8",
    );

    expect(dataManagement).toMatch(/eastmoneyDirect/);
    expect(dataManagement).toMatch(/generic AkShare compatibility/);
    expect(dataSources).toMatch(/eastmoneyDirect/);
    expect(dataSources).toMatch(/validated gotdx index bars/);
    expect(dataSources).toMatch(/explicit EastMoney index K-line route/);
  });

  it("does not advertise stale desktop finance tool call shapes", () => {
    const skillFiles = markdownFiles(
      resolve(repoRoot, "assets/skills"),
    );

    for (const file of skillFiles) {
      const text = readFileSync(file, "utf-8");
      expect(
        text,
        `${file} uses class name instead of registered tool name`,
      ).not.toMatch(/\bDashboardTool\b/);
      expect(text, `${file} uses stale ReportParse argument`).not.toMatch(
        /ReportParse\(\s*filePath:/,
      );
      expect(text, `${file} uses stale MarketData params wrapper`).not.toMatch(
        /MarketData\(\s*action:\s*"kline"\s*,\s*params:/,
      );
      expect(text, `${file} uses stale Research params wrapper`).not.toMatch(
        /Research\(\s*action:\s*"news"\s*,\s*params:/,
      );
      expect(text, `${file} uses unsupported DataProcess action`).not.toMatch(
        /DataProcess\(\s*action:\s*"fundamental_score"/,
      );
      expect(
        text,
        `${file} uses mobile-style MarketData symbols for single-code desktop action`,
      ).not.toMatch(
        /MarketData\(\s*action:\s*"(quote|earnings|sector)"\s*,\s*symbols:/,
      );
      expect(
        text,
        `${file} uses mobile-style DataProcess symbol argument`,
      ).not.toMatch(/DataProcess\(\s*action:\s*"summary"\s*,\s*symbol:/);
    }
  });
});

function markdownFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...markdownFiles(path));
    else if (path.endsWith(".md")) files.push(path);
  }
  return files;
}
