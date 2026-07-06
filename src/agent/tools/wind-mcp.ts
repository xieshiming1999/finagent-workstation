import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { Tool, ToolContext } from "../tool";
import { globalApiStats } from "../data/resilience";
import { DataStore } from "../data/store/data-store";
import { persistWindResult } from "./wind-mcp-persistence";
import {
  contentText,
  extractJson,
  httpErrorCode,
  httpErrorGuidance,
  isCreditExhausted,
  isKnownWindFailure,
  parseUtcOffset,
  quotaErrorCode,
  stableHash,
  throwInnerErrorIfPresent,
  usageDate,
  windCacheTtlMs,
} from "./wind-mcp-utils";

const WIND_SERVERS: Record<string, string> = {
  stock_data: "https://mcp.wind.com.cn/vserver_stock_data/mcp/",
  global_stock_data: "https://mcp.wind.com.cn/vserver_global_stock_data/mcp/",
  fund_data: "https://mcp.wind.com.cn/vserver_fund_data/mcp/",
  index_data: "https://mcp.wind.com.cn/vserver_index_data/mcp/",
  bond_data: "https://mcp.wind.com.cn/vserver_bond_data/mcp/",
  financial_docs: "https://mcp.wind.com.cn/vserver_financial_docs/mcp/",
  economic_data: "https://mcp.wind.com.cn/vserver_economic_data/mcp/",
  analytics_data: "https://mcp.wind.com.cn/vserver_analytics_data/mcp/",
};

const WIND_TOOLS: Record<string, string[]> = {
  stock_data: [
    "get_stock_price_indicators",
    "get_stock_kline",
    "get_stock_quote",
    "get_stock_basicinfo",
    "get_stock_fundamentals",
    "get_stock_equity_holders",
    "get_stock_events",
    "get_stock_technicals",
    "get_risk_metrics",
  ],
  global_stock_data: [
    "get_global_stock_price_indicators",
    "get_global_stock_kline",
    "get_global_stock_quote",
    "get_global_stock_basicinfo",
    "get_global_stock_fundamentals",
    "get_global_stock_equity_holders",
    "get_global_stock_events",
    "get_global_stock_technicals",
    "get_global_stock_risk_metrics",
  ],
  fund_data: [
    "get_fund_price_indicators",
    "get_fund_kline",
    "get_fund_quote",
    "get_fund_info",
    "get_fund_financials",
    "get_fund_holdings",
    "get_fund_performance",
    "get_fund_holders",
    "get_fund_company_info",
  ],
  index_data: [
    "get_index_price_indicators",
    "get_index_kline",
    "get_index_quote",
    "get_index_basicinfo",
    "get_index_fundamentals",
    "get_index_technicals",
  ],
  bond_data: [
    "get_bond_basicinfo",
    "get_bond_issuer_info",
    "get_bond_market_data",
    "get_bond_financial_data",
  ],
  financial_docs: ["get_company_announcements", "get_financial_news"],
  economic_data: ["get_economic_data"],
  analytics_data: ["get_financial_data"],
};

type GetConfigValue = (key: string) => string | undefined;
let localStore: DataStore | null = null;

function getLocalStore(ctx: ToolContext): DataStore {
  if (!localStore) localStore = new DataStore(ctx.basePath);
  return localStore;
}

export class WindMcpTool implements Tool {
  name = "WindMcp";
  description =
    "Call Wind AIFinMarket MCP data tools over direct HTTPS. Requires WIND_API_KEY in Settings.";
  isReadOnly = true;
  canParallel = false;
  inputSchema = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["help", "call", "usage"],
        description:
          "help lists tools, usage shows local daily usage, call invokes Wind.",
      },
      server: {
        type: "string",
        enum: Object.keys(WIND_SERVERS),
        description: "Wind MCP server group.",
      },
      tool: {
        type: "string",
        description: "Wind tool name, e.g. get_stock_quote.",
      },
      arguments: {
        type: "object",
        description: "Arguments passed to the Wind tool.",
      },
    },
    required: ["action"],
  };

  constructor(private getConfigValue: GetConfigValue) {}

  validateInput(input: Record<string, unknown>): string | null {
    const action = String(input.action ?? "help");
    if (!["help", "usage", "call"].includes(action)) {
      return `INVALID_ACTION: "${action}" is not supported. Use action="help" to discover tools, action="usage" to check daily quota, or action="call" to invoke Wind.`;
    }
    if (action !== "call") return null;
    const server = String(input.server ?? "");
    const tool = String(input.tool ?? "");
    if (!WIND_SERVERS[server])
      return `INVALID_SERVER: server must be one of: ${Object.keys(WIND_SERVERS).join(", ")}. Use WindMcp(action: "help") to inspect server groups.`;
    if (!tool)
      return `MISSING_TOOL: tool is required for action=call. Use WindMcp(action: "help") to choose a tool for server "${server}".`;
    if (!WIND_TOOLS[server]?.includes(tool))
      return `INVALID_TOOL: "${tool}" is not listed for server "${server}". Use WindMcp(action: "help") and retry with one of: ${WIND_TOOLS[server].join(", ")}.`;
    return null;
  }

  async call(
    _id: string,
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<string> {
    const action = String(input.action ?? "help");
    if (action === "help") return this.help();
    if (action === "usage") return JSON.stringify(this.readUsage(ctx), null, 2);
    if (action !== "call")
      throw new Error(
        `INVALID_ACTION: "${action}" is not supported. Use action="help" to discover tools, action="usage" to check daily quota, or action="call" to invoke Wind.`,
      );

    const apiKey = this.getConfigValue("WIND_API_KEY")?.trim() ?? "";
    if (!apiKey)
      throw new Error(
        "KEY_MISSING: set WIND_API_KEY in Settings > Finance before using WindMcp. Do not retry Wind calls until the key is configured.",
      );

    const usage = this.readUsage(ctx);
    if (usage.exhausted) {
      const code = usage.exhaustedCode ?? "RATE_LIMIT_DAILY";
      const message =
        usage.exhaustedMessage ??
        "Wind reported daily quota exhaustion or insufficient balance.";
      throw new Error(
        `${code}: stored Wind daily limitation for quota date ${usage.date} (reset offset ${usage.resetUtcOffset}). ${message} Stop Wind calls for this quota day. It is appropriate to try Wind again after the next quota day starts, or after the Wind account/key is updated. Until then, fall back to cache, AkShare, EastMoney, TDX, Yahoo, or DataStore.`,
      );
    }

    const server = String(input.server);
    const tool = String(input.tool);
    const args = normalizeWindArguments(isRecord(input.arguments) ? input.arguments : {});
    const requestHash = stableHash({ server, tool, args });
    const cacheTtlMs = windCacheTtlMs(tool);
    const cached = this.readResultCache(ctx, tool, requestHash);
    if (cached?.response_json && !cached.is_error) {
      return `WindMcp cache hit (${server}.${tool}, cached ${cached.created_at})\n${cached.response_json}`;
    }
    try {
      const result = await this.callWind(apiKey, server, tool, args);
      this.incrementUsage(ctx);
      if (isCreditExhausted(result)) this.markUsageExhausted(ctx, result);
      this.writeResultCache(
        ctx,
        server,
        tool,
        args,
        requestHash,
        result,
        false,
        cacheTtlMs,
      );
      persistWindResult(getLocalStore(ctx), ctx, server, tool, args, result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isCreditExhausted(message)) this.markUsageExhausted(ctx, message);
      this.writeResultCache(
        ctx,
        server,
        tool,
        args,
        requestHash,
        message,
        true,
        10 * 60_000,
      );
      if (isKnownWindFailure(message)) throw new Error(message);
      throw new Error(
        `NETWORK_ERROR: Wind HTTPS request failed before a usable MCP response was parsed. Details: ${message}. Retry only if this looks transient; otherwise fall back to non-Wind sources.`,
      );
    }
  }

  private async callWind(
    apiKey: string,
    server: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const endpoint = WIND_SERVERS[server];
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    };
    const initPayload = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "cc-mobile-finagent-workstation", version: "1.0.0" },
      },
    };
    await this.postJson(endpoint, headers, initPayload, 30_000);
    const payload = {
      jsonrpc: "2.0",
      id: Date.now() + 1,
      method: "tools/call",
      params: {
        name: tool,
        arguments: args,
        _meta: { clientVersion: "1.6.1" },
      },
    };
    const body = await this.postJson(endpoint, headers, payload, 60_000);
    return this.parseResponse(body);
  }

  private async postJson(
    url: string,
    headers: Record<string, string>,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();
    let recorded = false;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await res.text();
      globalApiStats.record({
        source: "wind",
        url,
        status: res.status,
        durationMs: Date.now() - start,
        success: res.ok,
        error: res.ok ? undefined : body,
        timestamp: new Date().toISOString(),
        tool: "WindMcp",
        action: "https",
      });
      recorded = true;
      if (!res.ok)
        throw new Error(
          `${httpErrorCode(res.status)}: Wind HTTP ${res.status}. ${httpErrorGuidance(res.status)} Body: ${body}`,
        );
      return body;
    } catch (err) {
      if (!recorded) {
        globalApiStats.record({
          source: "wind",
          url,
          status: 0,
          durationMs: Date.now() - start,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
          tool: "WindMcp",
          action: "https",
        });
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseResponse(body: string): string {
    const jsonText = extractJson(body);
    const payload = JSON.parse(jsonText);
    if (payload.error)
      throw new Error(
        `MCP_PROTOCOL_ERROR: Wind returned a JSON-RPC error. Check server/tool/arguments and retry with corrected input. Error: ${JSON.stringify(payload.error)}`,
      );
    if (isRecord(payload) && payload.data == null && payload.error) {
      throw new Error(
        `WIND_TOOL_ERROR: Wind returned an application error. Check required parameters and allowed field names before retrying. Details: ${JSON.stringify(payload.error)}`,
      );
    }
    const result = payload.result;
    if (!result || typeof result !== "object")
      return JSON.stringify(payload, null, 2);
    const text = contentText(result);
    if (result.isError) throw new Error(text);
    throwInnerErrorIfPresent(text);
    return text || JSON.stringify(result, null, 2);
  }

  private usagePath(ctx: ToolContext): string {
    return join(ctx.basePath, "memory", "wind_usage.json");
  }

  private readUsage(ctx: ToolContext): {
    date: string;
    resetUtcOffset: string;
    count: number;
    exhausted: boolean;
    exhaustedCode?: string;
    exhaustedMessage?: string;
    exhaustedAt?: string;
  } {
    const resetUtcOffset = this.usageUtcOffset();
    const today = usageDate(resetUtcOffset);
    const file = this.usagePath(ctx);
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, "utf-8"));
        if (data.date === today) {
          return {
            date: today,
            resetUtcOffset,
            count: Number(data.count ?? 0),
            exhausted: data.exhausted === true,
            exhaustedCode:
              typeof data.exhaustedCode === "string"
                ? data.exhaustedCode
                : undefined,
            exhaustedMessage:
              typeof data.exhaustedMessage === "string"
                ? data.exhaustedMessage
                : undefined,
            exhaustedAt:
              typeof data.exhaustedAt === "string"
                ? data.exhaustedAt
                : undefined,
          };
        }
      } catch {}
    }
    return { date: today, resetUtcOffset, count: 0, exhausted: false };
  }

  private incrementUsage(ctx: ToolContext): void {
    const usage = this.readUsage(ctx);
    usage.count += 1;
    this.writeUsage(ctx, usage);
  }

  private markUsageExhausted(ctx: ToolContext, message: string): void {
    const usage = this.readUsage(ctx);
    usage.exhausted = true;
    usage.exhaustedCode = quotaErrorCode(message);
    usage.exhaustedMessage = message;
    usage.exhaustedAt = new Date().toISOString();
    this.writeUsage(ctx, usage);
  }

  private writeUsage(
    ctx: ToolContext,
    usage: {
      date: string;
      resetUtcOffset: string;
      count: number;
      exhausted: boolean;
      exhaustedCode?: string;
      exhaustedMessage?: string;
      exhaustedAt?: string;
    },
  ): void {
    const file = this.usagePath(ctx);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(usage), "utf-8");
  }

  private usageUtcOffset(): string {
    return (
      parseUtcOffset(
        this.getConfigValue("WIND_DAILY_RESET_UTC_OFFSET")?.trim() || "+08:00",
      )?.normalized ?? "+08:00"
    );
  }

  private readResultCache(ctx: ToolContext, tool: string, requestHash: string) {
    try {
      return getLocalStore(ctx).getApiResultCache(
        "wind",
        "WindMcp",
        tool,
        requestHash,
      );
    } catch {
      return null;
    }
  }

  private writeResultCache(
    ctx: ToolContext,
    server: string,
    tool: string,
    args: Record<string, unknown>,
    requestHash: string,
    result: string,
    isError: boolean,
    ttlMs: number,
  ): void {
    try {
      const now = new Date();
      getLocalStore(ctx).saveApiResultCache({
        source: "wind",
        tool: "WindMcp",
        action: tool,
        request_hash: requestHash,
        request_json: JSON.stringify({ server, tool, arguments: args }),
        response_json: result,
        is_error: isError,
        created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + ttlMs).toISOString(),
      });
    } catch {}
  }

  private help(): string {
    const lines = [
      "WindMcp uses direct HTTPS JSON-RPC to Wind AIFinMarket MCP endpoints.",
      "",
      "Progressive use:",
      '1. action="usage" before broad collection to check same-day Wind quota status.',
      '2. action="help" to choose a server/tool.',
      '3. action="call" with server, tool, and targeted arguments.',
      "",
      "Example:",
      '{"action":"call","server":"stock_data","tool":"get_stock_price_indicators","arguments":{"windcode":"600519.SH","indexes":"中文简称,最新成交价,涨跌幅"}}',
      "",
      "Required config: WIND_API_KEY in Settings > Finance.",
      "Usage: memory/wind_usage.json stores local call count for visibility and same-day Wind quota/balance errors. It is not official Wind credit accounting. Daily rollover uses WIND_DAILY_RESET_UTC_OFFSET internally, default +08:00 because the official skill only says next-day 00:00 refresh.",
      "Parameter rules: quote/K-line/price tools use windcode; price tools require Chinese indexes from the bundled indicators reference; NL tools use question; financial_docs tools use query; economic_data uses metricIdsStr.",
      "Failures: stop Wind calls on RATE_LIMIT_DAILY or BALANCE_INSUFFICIENT; fall back to cache, AkShare, EastMoney, TDX, Yahoo, or DataStore.",
      "",
      "Servers and tools:",
    ];
    for (const [server, tools] of Object.entries(WIND_TOOLS))
      lines.push(`- ${server}: ${tools.join(", ")}`);
    return lines.join("\n");
  }
}

function normalizeWindArguments(args: Record<string, unknown>): Record<string, unknown> {
  if (args.windcode !== undefined) return args;
  const codes = args.codes ?? args.code ?? args.symbols ?? args.symbol;
  if (codes === undefined) return args;
  return { ...args, windcode: normalizeWindCodeList(codes) };
}

function normalizeWindCodeList(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).join(",");
  }
  return String(value).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
