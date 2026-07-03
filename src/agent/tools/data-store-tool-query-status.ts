import { toolError } from "../tool";
import type { DataStore } from "../data/store/data-store";
import { formatRows } from "./data-store-tool-utils";
import {
  latestRowValue,
  readbackProvenance,
} from "./data-store-tool-query-common";

export function queryRawPayload(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const source = String(input.source ?? "");
  const endpoint = String(
    input.endpoint ?? input.func ?? input.tdx_action ?? "",
  );
  const limit = Number(input.limit ?? 20);
  let sql =
    "SELECT source, endpoint, request_hash, is_error, created_at, expires_at, request_json, substr(response_json, 1, 500) as response_preview FROM raw_api_payload WHERE 1=1";
  const params: unknown[] = [];
  if (source) {
    sql += " AND source = ?";
    params.push(source);
  }
  if (endpoint) {
    sql += " AND endpoint = ?";
    params.push(endpoint);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  const rows = ds.query<Record<string, unknown>>(sql, ...params);
  const provenance = [
    "interface:provider.raw_payload_audit",
    "provider:local",
    "capability:local.raw_payload_audit",
    "schema:raw_api_payload",
    "table:raw_api_payload",
    "cache:diagnostic-readback",
    "policy:diagnostic-only",
    "normalWorkflowAllowed:false",
    "next: use governed interfaces and query/readback actions for normal data; use raw payload rows only to inspect legacy or explicit diagnostic evidence before adding a normalizer/interface.",
  ].join(" · ");
  if (rows.length === 0) return `No raw API payload audit rows.\n${provenance}`;
  return `${provenance}\n${formatRows(
    "Raw API payload audit",
    rows,
    (r) =>
      `${r.created_at} [${r.source}/${r.endpoint}] error:${r.is_error} hash:${String(r.request_hash).slice(0, 12)} preview:${r.response_preview ?? ""}`,
  )}`;
}

export function queryApiCalls(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const source = typeof input.source === "string" ? input.source.trim() : "";
  const provider =
    typeof input.provider === "string" ? input.provider.trim() : "";
  const interfaceId =
    typeof input.interfaceId === "string"
      ? input.interfaceId.trim()
      : typeof input.interface_id === "string"
        ? input.interface_id.trim()
        : "";
  const capabilityId =
    typeof input.capabilityId === "string"
      ? input.capabilityId.trim()
      : typeof input.capability_id === "string"
        ? input.capability_id.trim()
        : "";
  const endpoint =
    typeof input.endpoint === "string" ? input.endpoint.trim() : "";
  const action =
    typeof input.actionName === "string"
      ? input.actionName.trim()
      : typeof input.apiAction === "string"
        ? input.apiAction.trim()
        : "";
  const onlyFailures = input.failures !== false;
  const minutes = Math.max(1, Number(input.minutes ?? 30));
  const since =
    typeof input.since === "string" && input.since.trim()
      ? input.since.trim()
      : null;
  const limit = Math.min(500, Math.max(1, Number(input.limit ?? 50)));
  const cutoff = since ?? new Date(Date.now() - minutes * 60_000).toISOString();
  let sql = "SELECT * FROM api_call_log WHERE created_at >= ?";
  const params: unknown[] = [cutoff];
  if (onlyFailures) sql += " AND success = 0";
  for (const [column, value] of [
    ["source", source],
    ["provider", provider],
    ["endpoint", endpoint],
  ] as const) {
    if (!value) continue;
    sql += ` AND ${column} LIKE ?`;
    params.push(`%${value}%`);
  }
  if (interfaceId) {
    sql += " AND interface_id = ?";
    params.push(interfaceId);
  }
  if (capabilityId) {
    sql += " AND capability_id = ?";
    params.push(capabilityId);
  }
  if (action) {
    sql += " AND action = ?";
    params.push(action);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  const rows = ds.query<Record<string, unknown>>(sql, ...params);
  if (rows.length === 0) {
    return onlyFailures
      ? "No matching failed API calls in api_call_log."
      : "No matching API calls in api_call_log.";
  }
  return formatRows(
    "API call log",
    rows,
    (r) => {
      const ok = Number(r.success) === 1 ? "OK" : "ERR";
      const endpointText = String(r.endpoint ?? "").replace(
        /^https?:\/\/[^/]+/i,
        "",
      );
      const route = r.interface_id
        ? ` interface:${r.interface_id}${r.capability_id ? ` capability:${r.capability_id}` : ""}`
        : "";
      const error = r.error ? ` error:${String(r.error).slice(0, 160)}` : "";
      return `${r.created_at} ${r.provider ?? r.source ?? "-"} ${ok} ${r.duration_ms ?? "-"}ms ${endpointText}${route}${error}`;
    },
    readbackProvenance(
      "provider.api_call_log",
      "api_call_log",
      "api_call_log",
      "query_api_calls",
      "local",
      "local.provider.api_call_log",
      "local-hit",
      {
        asOf: latestRowValue(rows, ["created_at"]),
        fetchedAt: latestRowValue(rows, ["created_at"]),
      },
    ),
  );
}
