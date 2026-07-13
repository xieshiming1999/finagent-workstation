import {
  externalFinanceCapabilityDescriptor,
  promptForExternalFinanceOperation,
} from "./external-finance-contract";

export const externalTaskBriefContract = "finagent.task-brief.v1";
export const externalEvidenceLedgerContract = "finagent.evidence-ledger.v1";
export const externalInterventionContract = "finagent.intervention.v1";
export const externalReportRevisionContract = "finagent.report-revision.v1";
export const externalArbitrationContract = "finagent.arbitration-v1";

export const externalInterventionIntents = [
  "retrieve_detail",
  "clarify_result",
  "retry_tool",
  "refresh_data",
  "fill_evidence_gap",
  "revise_report",
  "compare_results",
  "stop",
] as const;

export function externalOrchestrationCapabilityDescriptor() {
  return {
    contract: "finagent.external-orchestration-capabilities.v1",
    taskBrief: externalTaskBriefContract,
    evidenceLedger: externalEvidenceLedgerContract,
    intervention: externalInterventionContract,
    reportRevision: externalReportRevisionContract,
    arbitration: externalArbitrationContract,
    interventionIntents: [...externalInterventionIntents],
    historyPolicy: "append-only",
    finalAuthority: "calling-code-agent",
    interactionPolicy: "caller-mediated",
  };
}

export function validateExternalTaskBrief(input: Record<string, unknown>) {
  requireContract(input, externalTaskBriefContract);
  const taskId = requiredString(input, "taskId");
  const request = requiredString(input, "request");
  const category = requiredEnum(input, "category", ["data", "analysis", "strategy", "execution"]);
  const operation = requiredString(input, "operation");
  const product = requiredEnum(input, "product", ["auto", "mobile", "workstation"]);
  const uiRuntime = requiredEnum(input, "uiRuntime", ["visible", "headless", "mirror"]);
  const allowedSideEffect = requiredEnum(input, "allowedSideEffect", ["read-only", "preparation", "simulated"]);
  if (input.interactionPolicy !== "caller-mediated") {
    throw new Error("interactionPolicy must be caller-mediated; FinAgent cannot answer for the caller");
  }
  const argumentsValue = objectValue(input, "arguments");
  const evidenceRequirements = objectList(input, "evidenceRequirements");
  if (!evidenceRequirements.length) throw new Error("evidenceRequirements must contain at least one item");
  const ids = new Set<string>();
  const normalizedRequirements = evidenceRequirements.map((requirement) => {
    const id = requiredString(requirement, "id");
    if (ids.has(id)) throw new Error(`duplicate evidence requirement id ${id}`);
    ids.add(id);
    return {
      id,
      description: requiredString(requirement, "description"),
      required: requirement.required !== false,
      ...(isObject(requirement.freshness) ? { freshness: requirement.freshness } : {}),
    };
  });
  const completionConditions = stringList(input, "completionConditions");
  if (!completionConditions.length) throw new Error("completionConditions must contain at least one item");
  const limits = isObject(input.limits) ? input.limits : {};
  return {
    contract: externalTaskBriefContract,
    taskId,
    request,
    product,
    category,
    operation,
    arguments: argumentsValue,
    evidenceRequirements: normalizedRequirements,
    uiRuntime,
    allowedSideEffect,
    interactionPolicy: "caller-mediated" as const,
    completionConditions,
    limits: {
      maxInterventions: positiveInteger(limits.maxInterventions, 3, 20),
      maxDurationSeconds: positiveInteger(limits.maxDurationSeconds, 1800, 14400),
    },
  };
}

export function promptForExternalTaskBrief(input: {
  runtime: "mobile" | "workstation";
  brief: Record<string, unknown>;
}): string {
  const brief = validateExternalTaskBrief(input.brief);
  if (brief.product !== "auto" && brief.product !== input.runtime) {
    throw new Error(`task brief product ${brief.product} does not match selected runtime ${input.runtime}`);
  }
  const operationId = `${brief.category}.${brief.operation}`;
  const sideEffectRank: Record<string, number> = { "read-only": 0, preparation: 1, simulated: 2, real: 3 };
  const descriptor = externalFinanceCapabilityDescriptor(input.runtime).operations.find((candidate) => candidate.id === operationId);
  if (!descriptor) throw new Error(`unsupported finance operation ${operationId}`);
  if ((sideEffectRank[descriptor.sideEffect] ?? 99) > (sideEffectRank[brief.allowedSideEffect] ?? -1)) {
    throw new Error(`${operationId} has side effect ${descriptor.sideEffect}, broader than allowedSideEffect ${brief.allowedSideEffect}`);
  }
  const financePrompt = promptForExternalFinanceOperation({
    runtime: input.runtime,
    category: brief.category,
    operation: brief.operation,
    arguments: brief.arguments,
  });
  return [
    financePrompt,
    "The calling code agent owns the evidence checklist and final judgment. Fulfill each requirement with typed tool evidence or report it as missing, stale, conflicting, failed, or unsupported.",
    "Do not claim that your terminal prose is the caller final answer. Do not answer questions or approve side effects for the caller.",
    JSON.stringify(brief),
  ].join("\n");
}

export function validateExternalIntervention(input: Record<string, unknown>) {
  requireContract(input, externalInterventionContract);
  const target = objectValue(input, "target");
  const intent = requiredEnum(input, "intent", [...externalInterventionIntents]);
  const changeRequest = objectValue(input, "changeRequest");
  if (!Object.keys(changeRequest).length && intent !== "stop") {
    throw new Error(`changeRequest is required for intervention ${intent}`);
  }
  return {
    contract: externalInterventionContract,
    taskId: requiredString(input, "taskId"),
    intent,
    target: {
      product: requiredEnum(target, "product", ["mobile", "workstation"]),
      runId: requiredString(target, "runId"),
      sessionId: requiredString(target, "sessionId"),
      turnId: requiredString(target, "turnId"),
      ...(optionalString(target.toolCallId) ? { toolCallId: optionalString(target.toolCallId) } : {}),
      ...(optionalString(target.artifactId) ? { artifactId: optionalString(target.artifactId) } : {}),
    },
    rationale: requiredString(input, "rationale"),
    expectedContract: requiredString(input, "expectedContract"),
    changeRequest,
  };
}

export function promptForExternalIntervention(input: {
  runtime: "mobile" | "workstation";
  intervention: Record<string, unknown>;
}): string {
  const intervention = validateExternalIntervention(input.intervention);
  if (intervention.target.product !== input.runtime) {
    throw new Error(`intervention product ${intervention.target.product} does not match selected runtime ${input.runtime}`);
  }
  return [
    "Continue the existing FinAgent session for a typed caller intervention.",
    "Perform only the bounded intervention through normal tools. Preserve original messages, tool results, artifacts, and receipts; append corrected evidence or an immutable report revision.",
    "Return the expected contract or an explicit structured error/gap. Do not choose user answers or permissions.",
    JSON.stringify(intervention),
  ].join("\n");
}

export function validateExternalEvidenceLedger(input: Record<string, unknown>) {
  requireContract(input, externalEvidenceLedgerContract);
  const ids = new Set<string>();
  const entries = objectList(input, "entries").map((entry) => {
    const id = requiredString(entry, "id");
    if (ids.has(id)) throw new Error(`duplicate evidence entry id ${id}`);
    ids.add(id);
    return {
      ...entry,
      id,
      requirementId: requiredString(entry, "requirementId"),
      status: requiredEnum(entry, "status", ["success", "error", "missing", "stale", "conflicting", "unsupported"]),
      coordinates: objectValue(entry, "coordinates"),
    };
  });
  return {
    contract: externalEvidenceLedgerContract,
    taskId: requiredString(input, "taskId"),
    product: requiredEnum(input, "product", ["mobile", "workstation"]),
    entries,
  };
}

export function validateExternalArbitration(input: Record<string, unknown>) {
  requireContract(input, externalArbitrationContract);
  const claims = objectList(input, "claims");
  for (const claim of claims) {
    requiredString(claim, "claim");
    if (!stringList(claim, "evidenceEntryIds").length) {
      throw new Error("each arbitration claim needs evidenceEntryIds");
    }
  }
  return {
    ...input,
    contract: externalArbitrationContract,
    taskId: requiredString(input, "taskId"),
    product: requiredEnum(input, "product", ["mobile", "workstation"]),
    disposition: requiredEnum(input, "disposition", ["accepted", "qualified", "rejected", "needs-user-input", "incomplete"]),
    coordinates: objectList(input, "coordinates"),
    claims,
    conflicts: objectList(input, "conflicts"),
    interventions: objectList(input, "interventions"),
    safetyState: objectValue(input, "safetyState"),
    remainingUncertainty: stringList(input, "remainingUncertainty"),
    finalSummary: requiredString(input, "finalSummary"),
    artifactIds: stringList(input, "artifactIds"),
  };
}

function requireContract(input: Record<string, unknown>, expected: string): void {
  if (input.contract !== expected) throw new Error(`contract must be ${expected}`);
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = optionalString(input[key]);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function requiredEnum(input: Record<string, unknown>, key: string, allowed: readonly string[]): string {
  const value = requiredString(input, key);
  if (!allowed.includes(value)) throw new Error(`${key} must be one of ${allowed.join(", ")}`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  const text = value == null ? "" : String(value).trim();
  return text || undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function objectValue(input: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = input[key];
  if (!isObject(value)) throw new Error(`${key} must be an object`);
  return value;
}

function objectList(input: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = input[key];
  if (!Array.isArray(value) || value.some((item) => !isObject(item))) {
    throw new Error(`${key} must be an array of objects`);
  }
  return value as Record<string, unknown>[];
}

function stringList(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
  return value.map((item) => {
    const text = optionalString(item);
    if (!text) throw new Error(`${key} items must be non-empty`);
    return text;
  });
}

function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`limit must be between 1 and ${maximum}`);
  }
  return parsed;
}
