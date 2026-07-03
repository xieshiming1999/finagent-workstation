import { createHash } from "crypto";

export function httpErrorCode(status: number): string {
  if (status === 401) return "KEY_INVALID";
  if (status === 403) return "KEY_FORBIDDEN_SERVER";
  if (status === 429) return "RATE_LIMIT_QPS";
  if (status >= 500) return "SERVER_5XX";
  return ["HTTP", String(status)].join("_");
}

export function httpErrorGuidance(status: number): string {
  if (status === 401)
    return "Check WIND_API_KEY and do not retry until corrected.";
  if (status === 403)
    return "The key may not have access to this Wind server group; try a different server or update account permissions.";
  if (status === 429)
    return "Slow down requests; if this persists, stop broad collection and retry later.";
  if (status >= 500)
    return "Wind server error; retry once later or fall back to another data source.";
  return "Inspect status/body and retry only with corrected input.";
}

export function extractJson(body: string): string {
  const dataLines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== "[DONE]");
  return dataLines.length ? dataLines[dataLines.length - 1] : body;
}

export function contentText(result: Record<string, unknown>): string {
  const content = result.content;
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0];
    if (isRecord(first) && first.text != null) return String(first.text);
  }
  return JSON.stringify(result, null, 2);
}

export function throwInnerErrorIfPresent(text: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  if (isRecord(parsed)) {
    const code = parsed.mcp_tool_error_code;
    if (code != null && code !== 0)
      throw new Error(
        `WIND_TOOL_ERROR: Wind tool returned mcp_tool_error_code=${code}. Check arguments against Wind help/docs before retrying. Body: ${text}`,
      );
    if (parsed.error)
      throw new Error(
        `WIND_TOOL_ERROR: Wind tool returned an application error. Check required parameters and allowed field names before retrying. Details: ${JSON.stringify(parsed.error)}`,
      );
  }
}

export function isCreditExhausted(text: string): boolean {
  return text.includes("RATE_LIMIT_DAILY") || text.includes("BALANCE_INSUFFICIENT");
}

export function quotaErrorCode(text: string): string {
  return text.includes("BALANCE_INSUFFICIENT")
    ? "BALANCE_INSUFFICIENT"
    : "RATE_LIMIT_DAILY";
}

export function parseUtcOffset(
  raw: string,
): { normalized: string; minutes: number } | null {
  const match = /^([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(raw);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutesPart = Number(match[3] ?? "0");
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutesPart) ||
    hours > 14 ||
    minutesPart > 59
  )
    return null;
  const sign = match[1] === "-" ? -1 : 1;
  const normalized = `${sign < 0 ? "-" : "+"}${String(hours).padStart(2, "0")}:${String(minutesPart).padStart(2, "0")}`;
  return { normalized, minutes: sign * (hours * 60 + minutesPart) };
}

export function usageDate(normalizedOffset: string): string {
  const parsed = parseUtcOffset(normalizedOffset);
  const offsetMinutes = parsed?.minutes ?? 8 * 60;
  return new Date(Date.now() + offsetMinutes * 60_000)
    .toISOString()
    .slice(0, 10);
}

export function isKnownWindFailure(text: string): boolean {
  return [
    "KEY_MISSING",
    "KEY_INVALID",
    "KEY_FORBIDDEN_SERVER",
    "RATE_LIMIT_DAILY",
    "RATE_LIMIT_QPS",
    "BALANCE_INSUFFICIENT",
    "SERVER_5XX",
    "MCP_PROTOCOL_ERROR",
    "WIND_TOOL_ERROR",
    "HTTP_",
  ].some((code) => text.includes(code));
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function windCacheTtlMs(tool: string): number {
  if (tool.includes("price_indicators") || tool.includes("quote")) return 60_000;
  if (tool.includes("kline")) return 60 * 60_000;
  if (tool.includes("fundamentals") || tool.includes("basicinfo")) return 24 * 60 * 60_000;
  if (tool.includes("announcements") || tool.includes("news")) return 30 * 60_000;
  return 6 * 60 * 60_000;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
