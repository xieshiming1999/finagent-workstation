import type { RunServiceUiRuntimeMode } from "./run-service-contract";

export type ExternalFinanceAvailability = "available" | "runtime-check-required" | "unavailable";

export interface ExternalFinanceOperationDescriptor {
  id: string;
  contractVersion: "finagent.finance-operation.v1";
  category: "data" | "analysis" | "strategy" | "execution";
  availability: ExternalFinanceAvailability;
  readinessReason: string;
  recovery: string;
  inputSchema: Record<string, unknown>;
  resultContract: string;
  uiRuntimeModes: RunServiceUiRuntimeMode[];
  requiredProviders: string[];
  interaction: "none" | "possible" | "required";
  permission: "none" | "possible" | "required";
  sideEffect: "read-only" | "preparation" | "simulated" | "real";
  typicalDurationSeconds: { minimum: number; maximum: number };
  streamingRequired: boolean;
  quotaWarning: string | null;
  artifactKinds: string[];
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  additionalProperties: true,
  properties,
  ...(required.length > 0 ? { required } : {}),
});

export function externalFinanceCapabilityDescriptor(runtime: "mobile" | "workstation") {
  const uiRuntimeModes: RunServiceUiRuntimeMode[] = ["visible", "headless", "mirror"];
  const operation = (
    value: Omit<ExternalFinanceOperationDescriptor, "contractVersion" | "uiRuntimeModes">,
  ): ExternalFinanceOperationDescriptor => ({
    contractVersion: "finagent.finance-operation.v1",
    uiRuntimeModes,
    ...value,
  });
  const operations: ExternalFinanceOperationDescriptor[] = [
    operation({
      id: "data.query",
      category: "data",
      availability: "runtime-check-required",
      readinessReason: "Provider and reusable canonical data readiness are resolved by the selected runtime.",
      recovery: "Inspect provider health and local reusable coverage before requesting a refresh.",
      inputSchema: objectSchema({ dataset: { type: "string" }, symbol: { type: "string" }, provider: { type: "string" }, refresh: { type: "boolean" } }, ["dataset"]),
      resultContract: "canonical-finance-data-v1",
      requiredProviders: [],
      interaction: "possible",
      permission: "none",
      sideEffect: "read-only",
      typicalDurationSeconds: { minimum: 1, maximum: 300 },
      streamingRequired: true,
      quotaWarning: "A refresh may consume provider quota; prefer canonical readback.",
      artifactKinds: ["data-evidence", "provider-provenance"],
    }),
    operation({
      id: "analysis.run",
      category: "analysis",
      availability: "runtime-check-required",
      readinessReason: "Analysis depends on requested market coverage and configured evidence providers.",
      recovery: "Use capability and provider health output to choose supported evidence sources.",
      inputSchema: objectSchema({ subject: { type: "string" }, symbols: { type: "array", items: { type: "string" } }, question: { type: "string" } }, ["subject"]),
      resultContract: "analysis-evidence-v1",
      requiredProviders: [],
      interaction: "possible",
      permission: "none",
      sideEffect: "read-only",
      typicalDurationSeconds: { minimum: 10, maximum: 600 },
      streamingRequired: true,
      quotaWarning: "Live evidence collection may consume provider quota.",
      artifactKinds: ["analysis-report", "dashboard", "evidence"],
    }),
    operation({
      id: "strategy.review",
      category: "strategy",
      availability: "runtime-check-required",
      readinessReason: "Strategy inputs and market history must be available in the selected runtime.",
      recovery: "Query canonical history coverage before requesting review or backtest.",
      inputSchema: objectSchema({ strategy: { type: "object" }, symbols: { type: "array", items: { type: "string" } }, backtest: { type: "boolean" } }, ["strategy"]),
      resultContract: "strategy-review-v1",
      requiredProviders: [],
      interaction: "possible",
      permission: "none",
      sideEffect: "preparation",
      typicalDurationSeconds: { minimum: 10, maximum: 900 },
      streamingRequired: true,
      quotaWarning: null,
      artifactKinds: ["strategy-report", "backtest-report", "dashboard"],
    }),
    operation({
      id: "execution.preview",
      category: "execution",
      availability: "runtime-check-required",
      readinessReason: "Account and instrument readiness are checked without placing an order.",
      recovery: "Resolve missing account, quote, sizing, or risk evidence and request a new preview.",
      inputSchema: objectSchema({ account: { type: "string" }, symbol: { type: "string" }, side: { enum: ["buy", "sell"] }, quantity: { type: "number", exclusiveMinimum: 0 } }, ["account", "symbol", "side", "quantity"]),
      resultContract: "trade-prep-v1",
      requiredProviders: [],
      interaction: "possible",
      permission: "none",
      sideEffect: "preparation",
      typicalDurationSeconds: { minimum: 2, maximum: 300 },
      streamingRequired: true,
      quotaWarning: null,
      artifactKinds: ["trade-preparation"],
    }),
    operation({
      id: "execution.simulate",
      category: "execution",
      availability: "runtime-check-required",
      readinessReason: "Paper-account readiness and explicit permission are required at run time.",
      recovery: "Use execution.preview, then answer the exact permission request with an idempotency key.",
      inputSchema: objectSchema({ account: { type: "string" }, symbol: { type: "string" }, side: { enum: ["buy", "sell"] }, quantity: { type: "number", exclusiveMinimum: 0 }, price: { type: "number", exclusiveMinimum: 0 }, idempotencyKey: { type: "string", minLength: 1 } }, ["account", "symbol", "side", "quantity", "price", "idempotencyKey"]),
      resultContract: "finagent.execution-receipt.v1",
      requiredProviders: [],
      interaction: "required",
      permission: "required",
      sideEffect: "simulated",
      typicalDurationSeconds: { minimum: 2, maximum: 600 },
      streamingRequired: true,
      quotaWarning: null,
      artifactKinds: ["execution-receipt"],
    }),
    operation({
      id: "execution.real",
      category: "execution",
      availability: "unavailable",
      readinessReason: "The external v1 contract does not advertise audited real-broker execution.",
      recovery: "Use preview or simulated execution; a separate audited contract is required for real orders.",
      inputSchema: objectSchema({}),
      resultContract: "execution-receipt-v1",
      requiredProviders: [],
      interaction: "required",
      permission: "required",
      sideEffect: "real",
      typicalDurationSeconds: { minimum: 0, maximum: 0 },
      streamingRequired: true,
      quotaWarning: null,
      artifactKinds: [],
    }),
  ];
  return {
    contract: "finagent.external-capabilities.v1",
    runtime,
    operationEnvelope: "finagent.finance-operation.v1",
    resultEnvelope: "finagent.finance-result.v1",
    selection: "explicit-or-capability-based",
    operations,
  };
}

export function promptForExternalFinanceOperation(input: {
  runtime: "mobile" | "workstation";
  category: string;
  operation: string;
  arguments: Record<string, unknown>;
}): string {
  const id = `${input.category}.${input.operation}`;
  const descriptor = externalFinanceCapabilityDescriptor(input.runtime).operations.find(
    (candidate) => candidate.id === id,
  );
  if (!descriptor) throw new Error(`unsupported finance operation ${id}`);
  if (descriptor.availability === "unavailable") {
    throw new Error(`${id} is unavailable: ${descriptor.readinessReason}`);
  }
  const operationInstruction = id === "execution.simulate"
    ? simulatedExecutionInstruction(input.arguments)
    : "Let the agent select the appropriate tools from the typed operation and return the declared result contract.";
  return [
    "Execute the following typed external finance operation through the normal FinAgent agent and tool contracts.",
    "Do not infer missing side-effect consent. Preserve the declared result contract and provider provenance.",
    operationInstruction,
    JSON.stringify({
      contract: "finagent.finance-operation.v1",
      operationId: id,
      arguments: input.arguments,
      resultContract: descriptor.resultContract,
      sideEffect: descriptor.sideEffect,
    }),
  ].join("\n");
}

function simulatedExecutionInstruction(args: Record<string, unknown>): string {
  const account = String(args.account ?? "").trim();
  const symbol = String(args.symbol ?? "").trim();
  const side = String(args.side ?? "").trim().toLowerCase();
  const quantity = Number(args.quantity);
  const price = Number(args.price);
  const idempotencyKey = String(args.idempotencyKey ?? "").trim();
  if (!account.startsWith("local-paper-")) throw new Error("execution.simulate supports only local-paper-* accounts");
  const market = account.slice("local-paper-".length);
  if (!["cn", "us", "hk"].includes(market)) throw new Error("execution.simulate account market must be cn, us, or hk");
  if (!symbol || !["buy", "sell"].includes(side) || !(quantity > 0) || !(price > 0) || !idempotencyKey) {
    throw new Error("execution.simulate requires symbol, side, positive quantity, positive price, and idempotencyKey");
  }
  return [
    "Call Portfolio exactly once with the JSON input below. Do not ask for confirmation in assistant prose:",
    JSON.stringify({ action: "trade", market, symbol, side, shares: quantity, price, idempotencyKey }),
    "The normal Portfolio permission resolver must emit permission.required and pause this same run before the tool mutates paper state.",
  ].join("\n");
}
