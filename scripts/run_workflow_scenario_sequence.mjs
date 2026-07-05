#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { basename, join, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? process.env.FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION_PORT ?? 39173);
const scenarioFile = resolve(String(args.file ?? "reports/evaluation/finance_agent_p0_real_agent_scenarios_2026_06_26.json"));
const scenarioId = args.scenario ? String(args.scenario) : undefined;
const outDir = resolve(String(args.out ?? "reports/evaluation/workflow_runs"));

if (!Number.isFinite(port) || port <= 0) {
  fail("A valid --port or FINAGENT_WORKSTATION_WORKFLOW_AUTOMATION_PORT is required.");
}
if (!existsSync(scenarioFile)) fail(`Scenario file not found: ${scenarioFile}`);

const catalog = JSON.parse(readFileSync(scenarioFile, "utf-8"));
const scenarios = Array.isArray(catalog.scenarios) ? catalog.scenarios : [];
const selected = scenarioId
  ? scenarios.filter((scenario) => scenario.id === scenarioId)
  : scenarios;
if (selected.length === 0) {
  fail(`No scenarios selected from ${scenarioFile}${scenarioId ? ` for ${scenarioId}` : ""}.`);
}

const health = await getJson("/health");
if (!health.enabled || !health.agentReady) {
  fail(
    `Workflow automation endpoint is not ready on 127.0.0.1:${port}. ` +
      `health=${JSON.stringify({ enabled: health.enabled, agentReady: health.agentReady, agentRunning: health.agentRunning })}`,
  );
}

mkdirSync(outDir, { recursive: true });
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const summaries = [];

for (const scenario of selected) {
  let cleanSessionResult = null;
  if (args["clean-session"] || scenario.cleanSession === true) {
    console.log(`Clearing workflow session before ${scenario.id}`);
    cleanSessionResult = await postJson("/workflow/clear_session", {});
  }
  const payload = {
    id: scenario.id,
    turns: Array.isArray(scenario.turns)
      ? scenario.turns.map((turn) => ({
          ...turn,
          maxToolCalls: turn.maxToolCalls,
          maxDataToolCalls: turn.maxDataToolCalls,
          timeoutMs: turn.timeoutMs,
          disallowRawHtml: turn.disallowRawHtml,
          disallowTools: turn.disallowTools,
          expectTools: turn.expectTools,
          expectToolActions: turn.expectToolActions,
          expectToolErrors: turn.expectToolErrors,
          expectToolResultContains: turn.expectToolResultContains,
          expectFinalContains: turn.expectFinalContains,
          expectSessionContains: turn.expectSessionContains,
          allowPendingUserQuestion: turn.allowPendingUserQuestion,
          autoAnswerUserQuestions: turn.autoAnswerUserQuestions,
          expectUiStateKeys: turn.expectUiStateKeys,
          expectUiEvidencePaths: turn.expectUiEvidencePaths,
          expectUiArtifactKinds: turn.expectUiArtifactKinds,
        }))
      : scenario.turns,
    expectSessionContains: scenario.expectSessionContains,
    expectToolActions: scenario.expectToolActions,
    expectPanelStateKeys: scenario.expectPanelStateKeys,
    expectUiStateKeys: scenario.expectUiStateKeys,
    expectUiEvidencePaths: scenario.expectUiEvidencePaths,
    expectUiArtifactKinds: scenario.expectUiArtifactKinds,
    maxToolCalls: scenario.maxToolCalls,
    maxDataToolCalls: scenario.maxDataToolCalls,
    timeoutMs: scenario.timeoutMs,
    disallowRawHtml: scenario.disallowRawHtml,
    disallowTools: scenario.disallowTools,
  };
  console.log(`Running ${scenario.id} through http://127.0.0.1:${port}/workflow/scenario_sequence`);
  const result = await postJson("/workflow/scenario_sequence", payload);
  const review = buildReview(scenario, result);
  review.sessionHygiene = {
    requestedCleanSession: Boolean(args["clean-session"] || scenario.cleanSession === true),
    cleanSessionResult,
    scenarioSessionId: result.turns?.[0]?.run?.sessionId ?? result.turns?.[0]?.run?.report?.sessionId ?? result.sessionId ?? null,
  };
  const jsonPath = join(outDir, `${runStamp}-${safeFilePart(scenario.id)}.json`);
  const mdPath = join(outDir, `${runStamp}-${safeFilePart(scenario.id)}.md`);
  writeFileSync(jsonPath, JSON.stringify({ scenario, result, review }, null, 2), "utf-8");
  writeFileSync(mdPath, renderReviewMarkdown({ scenario, result, review, jsonPath }), "utf-8");
  summaries.push({ scenarioId: scenario.id, ok: result.ok, jsonPath, mdPath });
  console.log(`Wrote ${mdPath}`);
}

const indexPath = join(outDir, `${runStamp}-index.json`);
writeFileSync(
  indexPath,
  JSON.stringify(
    {
      source: basename(scenarioFile),
      port,
      generatedAt: new Date().toISOString(),
      summaries,
    },
    null,
    2,
  ),
  "utf-8",
);
console.log(`Wrote ${indexPath}`);

function buildReview(scenario, result) {
  const turns = Array.isArray(result.turns) ? result.turns : [];
  return {
    reviewRequired: true,
    scenarioId: scenario.id,
    ok: Boolean(result.ok),
    scenarioReportPath: result.scenarioReportPath ?? null,
    assertionFailures: Array.isArray(result.assertions)
      ? result.assertions.filter((assertion) => assertion?.ok !== true)
      : [],
    reviewCriteria: scenario.reviewCriteria ?? [],
    turns: turns.map((turn) => {
      const runReport = turn?.run?.report ?? turn?.run ?? {};
      const agentReview = runReport.agentReview ?? turn?.run?.agentReview ?? turn?.agentReview ?? {};
      const finalAssistant =
        agentReview.finalAssistant ??
        runReport.finalAssistantText ??
        [...(runReport.messages ?? turn?.run?.messages ?? [])]
          .reverse()
          .find((message) => message.role === "assistant")?.content ??
        "";
      const toolCalls =
        agentReview.toolCalls ??
        runReport.toolCalls ??
        (runReport.messages ?? turn?.run?.messages ?? []).flatMap((message) => message.toolUses ?? []);
      const toolErrors =
        agentReview.toolErrors ??
        runReport.toolErrors ??
        (runReport.messages ?? turn?.run?.messages ?? [])
          .filter((message) => message.toolResult?.isError)
          .map((message) => message.toolResult);
      return {
        turnId: turn.turnId,
        prompt: runReport.prompt ?? turn.run?.prompt,
        ok: Boolean(turn.ok),
        finalAssistant,
        toolNames: [...new Set(toolCalls.map((tool) => (tool.name ?? tool.toolName)).filter(Boolean))],
        toolCallCount: toolCalls.length,
        toolErrorCount: toolErrors.length,
        panelEvidenceAvailable:
          agentReview.panelEvidenceAvailable ??
          (turn.run?.panelState != null || runReport.uiState != null || runReport.panelState != null),
        uiArtifactKinds: agentReview.uiArtifactKinds ?? (runReport.uiArtifacts ?? turn.run?.uiArtifacts ?? []).map((artifact) => artifact.kind),
        reportPath: turn.scenarioReportPath ?? turn.run?.reportPath ?? runReport.reportPath ?? null,
      };
    }),
  };
}

function renderReviewMarkdown({ scenario, result, review, jsonPath }) {
  const priority = scenario.priority ?? "P0";
  const lines = [
    `# Workflow Review: ${scenario.id}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Runtime: ${scenario.runtime ?? "unknown"}`,
    `Priority: ${scenario.priority ?? "unknown"}`,
    `Result: ${result.ok ? "ok" : "needs review/fix"}`,
    `Scenario report: ${result.scenarioReportPath ?? "-"}`,
    `Raw JSON: ${jsonPath}`,
    `Session hygiene: ${review.sessionHygiene?.requestedCleanSession ? "clean session requested" : "continuation/default session"}; session=${review.sessionHygiene?.scenarioSessionId ?? "-"}`,
    "",
    "## Purpose",
    "",
    scenario.purpose ?? "",
    "",
    "## Review Criteria",
    "",
    ...(review.reviewCriteria.length
      ? review.reviewCriteria.map((item) => `- ${item}`)
      : ["- No explicit review criteria supplied."]),
    "",
    "## Assertion Failures",
    "",
    ...(review.assertionFailures.length
      ? review.assertionFailures.map((item) => `- ${item.name ?? "unknown"}: expected ${JSON.stringify(item.expected)} actual ${JSON.stringify(item.actual)}`)
      : ["- None recorded by the automation endpoint."]),
    "",
    "## Turns",
    "",
  ];
  for (const turn of review.turns) {
    lines.push(
      `### ${turn.turnId ?? "turn"}`,
      "",
      `Prompt: ${turn.prompt ?? ""}`,
      `Status: ${turn.ok ? "ok" : "needs review/fix"}`,
      `Tools: ${turn.toolNames.length ? turn.toolNames.join(", ") : "-"}`,
      `Tool calls: ${turn.toolCallCount}`,
      `Tool errors: ${turn.toolErrorCount}`,
      `Panel evidence: ${turn.panelEvidenceAvailable ? "yes" : "no"}`,
      `UI artifacts: ${turn.uiArtifactKinds?.length ? turn.uiArtifactKinds.join(", ") : "-"}`,
      `Report: ${turn.reportPath ?? "-"}`,
      "",
      "Agent final answer:",
      "",
      "```text",
      trimForMarkdown(String(turn.finalAssistant ?? ""), 6000),
      "```",
      "",
    );
  }
  lines.push(
    "## Reviewer Decision",
    "",
    "- [ ] Agent content addresses the user intent.",
    "- [ ] Tool/environment interactions are appropriate.",
    "- [ ] API/provider failures are visible.",
    "- [ ] Agent-reported issues were verified against tool results, local data, UI state, or logs.",
    "- [ ] Confirmed app/agent/harness/data/UI defects were fixed or root-caused with a next action.",
    "- [ ] UI/session evidence supports the answer.",
    `- [ ] Case can be marked verified in the ${priority} ledger.`,
    "",
  );
  return `${lines.join("\n")}\n`;
}

async function getJson(path) {
  return requestJson("GET", path);
}

async function postJson(path, body) {
  return requestJson("POST", path, body);
}

function requestJson(method, path, body) {
  const payload = body == null ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: payload
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
            }
          : undefined,
        timeout: 15 * 60_000,
      },
      (res) => {
        const chunks = [];
        res.setEncoding("utf8");
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = chunks.join("");
          if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
            reject(new Error(`${path} failed ${res.statusCode}: ${text}`));
            return;
          }
          try {
            resolve(text ? JSON.parse(text) : null);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`${path} timed out waiting for workflow response`));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function trimForMarkdown(value, max) {
  return value.length > max ? `${value.slice(0, max)}\n...` : value;
}

function safeFilePart(value) {
  return (
    String(value)
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "scenario"
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
