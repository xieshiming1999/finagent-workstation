import type { DataStore } from "../data/store/data-store";
import { formatRows } from "./data-store-tool-utils";
import { readbackProvenanceFromRows } from "./data-store-tool-query-common";
import { supportsMoneyFundYield } from "../data/fund-category";

function stringInput(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function stringListInput(input: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = input[key];
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof value === "string") {
      return value.split(/[,\s，]+/).map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function codeListInput(input: Record<string, unknown>, keys: string[]): string[] {
  const codes = new Set<string>();
  for (const key of keys) {
    const single = stringInput(input, [key]);
    if (single && !single.includes(",") && !/\s/.test(single)) codes.add(single);
    for (const code of stringListInput(input, [key])) codes.add(code);
  }
  return Array.from(codes);
}

function hasFundPerformanceValue(row: Record<string, unknown>): boolean {
  return [
    "nav",
    "return_ytd",
    "return_1w",
    "return_1m",
    "return_3m",
    "return_6m",
    "return_1y",
    "return_2y",
    "return_3y",
    "return_since_inception",
  ].some((key) => row[key] !== null && row[key] !== undefined && row[key] !== "");
}

function sortFundPerformanceRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return [...rows].sort((a, b) => {
    const meaningful = Number(hasFundPerformanceValue(b)) - Number(hasFundPerformanceValue(a));
    if (meaningful !== 0) return meaningful;
    return String(b.metric_date ?? "").localeCompare(String(a.metric_date ?? ""));
  });
}

function dateRangeInput(input: Record<string, unknown>): { start?: string; end?: string } {
  return {
    start: stringInput(input, ["start", "startDate", "from", "fromDate"]),
    end: stringInput(input, ["end", "endDate", "to", "toDate"]),
  };
}

function sortOrderInput(input: Record<string, unknown>): "asc" | "desc" {
  const raw = stringInput(input, ["order", "sort", "sortOrder"]);
  return raw?.toLowerCase() === "asc" ? "asc" : "desc";
}

function isKnownMoneyFund(ds: DataStore, code: string): boolean {
  return ds.queryFundList({ codes: [code], limit: 5 }).some((row) => supportsMoneyFundYield(row.fund_category));
}

export function queryFundNav(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const code = stringInput(input, ["code", "symbol", "fundCode"]) ?? "";
  if (!code) return "code required";
  const range = dateRangeInput(input);
  const rows = ds.queryFundNav(code, {
    ...range,
    limit: Number(input.limit ?? 30),
    order: sortOrderInput(input),
  });
  if (rows.length === 0) {
    if (isKnownMoneyFund(ds, code)) {
      return `No ordinary NAV data for known money fund ${code}. Use DataStore(action: "query_fund_money_yield", code: "${code}", limit: 60) for per-10k income and 7-day annualized yield; fetch type "fund_nav" is not valid for this fund class.`;
    }
    return `No NAV data for ${code}. Use DataStore(action: "fetch", type: "fund_nav", code: "${code}")`;
  }
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  return formatRows(
    `${code} fund NAV`,
    rowMaps,
    (r) =>
      `${r.date} [${r.source ?? "unknown"}] NAV:${r.nav} Acc:${r.acc_nav ?? "-"} Return:${r.daily_return ?? "-"}%`,
    readbackProvenanceFromRows(
      "fund.nav_history",
      "fund_nav",
      "fund_nav",
      "query_fund_nav",
      rowMaps,
      {
        asOfKeys: ["date"],
        fetchedAtKeys: ["fetched_at", "updated_at"],
      },
    ),
  );
}

export function queryFundMoneyYield(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const code = stringInput(input, ["code", "symbol", "fundCode"]) ?? "";
  if (!code) return "code required";
  const range = dateRangeInput(input);
  const rows = ds.queryFundMoneyYield(code, {
    ...range,
    limit: Number(input.limit ?? 30),
    order: sortOrderInput(input),
  });
  if (rows.length === 0) {
    return `No money-fund yield data for ${code}. Use DataStore(action: "fetch", type: "fund_money_yield", code: "${code}")`;
  }
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  return formatRows(
    `${code} money fund yield`,
    rowMaps,
    (r) =>
      `${r.date} [${r.source ?? "unknown"}] per10k:${r.million_copies_income ?? "-"} 7d:${r.seven_day_annualized_yield ?? "-"}%`,
    readbackProvenanceFromRows(
      "fund.money_yield_history",
      "fund_money_yield",
      "fund_money_yield",
      "query_fund_money_yield",
      rowMaps,
      {
        asOfKeys: ["date"],
        fetchedAtKeys: ["fetched_at", "updated_at"],
      },
    ),
  );
}

export function queryFundDividendFactor(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const code = String(input.code ?? input.symbol ?? input.fundCode ?? "");
  if (!code) return "code/symbol/fundCode required";
  const rows = ds.queryFundDividendFactors(code, {
    start: input.start as string | undefined,
    end: input.end as string | undefined,
    limit: Number(input.limit ?? 50),
  });
  if (rows.length === 0) {
    return `No fund dividend/factor data for ${code}. Use DataStore(action: "sina_fund_dividend_factor", code: "${code}") to refresh the governed Sina route.`;
  }
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  return formatRows(
    `${code} fund dividend/factor`,
    rowMaps,
    (r) =>
      `${r.event_date} [${r.source ?? "unknown"}] dividend:${r.dividend ?? "-"} factor:${r.factor ?? "-"}`,
    readbackProvenanceFromRows(
      "fund.dividend_factor",
      "fund_dividend_factor",
      "fund_dividend_factor",
      "query_fund_dividend_factor",
      rowMaps,
      {
        asOfKeys: ["event_date"],
        fetchedAtKeys: ["fetched_at"],
      },
    ),
  );
}

export function queryIntradayOhlcvBars(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const code = String(input.code ?? input.symbol ?? "");
  if (!code) return "code/symbol required";
  const rows = ds.queryIntradayOhlcvBars(code, {
    start: input.start as string | undefined,
    end: input.end as string | undefined,
    intervalMinutes: Number(input.intervalMinutes ?? input.scale ?? 5),
    limit: Number(input.limit ?? 120),
  });
  if (rows.length === 0) {
    return `No intraday OHLCV bars for ${code}. Use DataStore(action: "sina_intraday_ohlcv_bars", code: "${code}", intervalMinutes: 5) to refresh the governed Sina route.`;
  }
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  return formatRows(
    `${code} intraday OHLCV bars`,
    rowMaps,
    (r) =>
      `${r.bar_time} [${r.source ?? "unknown"}] ${r.interval_minutes ?? "-"}m O:${r.open ?? "-"} H:${r.high ?? "-"} L:${r.low ?? "-"} C:${r.close ?? "-"} V:${r.volume ?? "-"}`,
    readbackProvenanceFromRows(
      "market.intraday_ohlcv_bars",
      "intraday_ohlcv_bars",
      "intraday_ohlcv_bars",
      "query_intraday_ohlcv_bars",
      rowMaps,
      {
        asOfKeys: ["bar_time", "trade_date"],
        fetchedAtKeys: ["fetched_at"],
      },
    ),
  );
}

export function queryTradeCalendar(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const market = typeof input.market === "string" ? input.market : undefined;
  const date = typeof input.date === "string" ? input.date : undefined;
  const start =
    date ??
    (typeof input.start === "string"
      ? input.start
      : typeof input.startDate === "string"
        ? input.startDate
        : undefined);
  const end =
    date ??
    (typeof input.end === "string"
      ? input.end
      : typeof input.endDate === "string"
        ? input.endDate
        : undefined);
  const defaultMarket = market?.toUpperCase() ?? "CN";
  const coverage = ds
    .getAllCoverage("calendar")
    .find((row) => String(row.code ?? "").toUpperCase() === defaultMarket);
  const rows = ds.queryCalendar({
    market,
    start,
    end,
    limit: Number(input.limit ?? 100),
    order: start || end ? "asc" : "desc",
  });
  if (rows.length === 0)
    return "No trade calendar rows. Persist trade_cal first.";
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  const renderedRows = start || end ? rowMaps : [...rowMaps].reverse();
  const provenance = readbackProvenanceFromRows(
    "calendar.trade_days",
    "trade_calendar",
    "trade_calendar",
    "query_trade_calendar",
    rowMaps,
    {
      asOfKeys: ["date"],
      fetchedAtKeys: ["fetched_at", "updated_at"],
    },
  );
  provenance.coverageStart = coverage?.earliest_date ?? null;
  provenance.coverageEnd = coverage?.latest_date ?? null;
  provenance.coverageRows = coverage?.row_count ?? null;
  provenance.pageRows = rowMaps.length;
  return formatRows(
    "trade_calendar",
    renderedRows,
    (r) =>
      `${r.date} ${r.market ?? "-"} ${Number(r.is_trading_day) === 1 ? "open" : "closed"}`,
    provenance,
  );
}

export function queryFundList(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = ds.queryFundList({
    type: stringInput(input, ["type", "fundType", "fund_type", "category"]),
    code: stringInput(input, ["code", "symbol", "fundCode"]),
    codes: stringListInput(input, ["codes", "symbols", "fundCodes"]),
    limit: Number(input.limit ?? 50),
  });
  if (rows.length === 0) return "No fund list rows. Persist fund_list first.";
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  return formatRows(
    "fund_list",
    rowMaps,
    (r) =>
      `${r.code} ${r.name} ${r.fund_type ?? "-"} category:${r.fund_category ?? "-"} ${r.company ?? "-"} nav:${r.nav ?? "-"} navDate:${r.nav_date ?? "-"} updated:${r.updated_at ?? "-"} size:${r.total_size ?? "-"}`,
    readbackProvenanceFromRows(
      "fund.identity_list",
      "fund_list",
      "fund_list",
      "query_fund_list",
      rowMaps,
      {
        asOfKeys: ["nav_date", "updated_at"],
        fetchedAtKeys: ["fetched_at", "updated_at"],
      },
    ),
  );
}

export function queryFundPerformance(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const limit = Number(input.limit ?? 100);
  const provider = typeof input.provider === "string" ? input.provider : undefined;
  const metricDate =
    typeof input.date === "string"
      ? input.date
      : typeof input.metricDate === "string"
        ? input.metricDate
        : undefined;
  const codes = codeListInput(input, ["code", "symbol", "fundCode", "codes", "symbols", "fundCodes"]);
  const rows = codes.length > 0
    ? codes.flatMap((code) => {
        const codeRows = ds.queryFundPerformanceMetrics({
          code,
          provider,
          metricDate,
          limit,
        }) as unknown as Array<Record<string, unknown>>;
        return sortFundPerformanceRows(codeRows).slice(0, limit);
      })
    : ds.queryFundPerformanceMetrics({
        provider,
        metricDate,
        limit,
      });
  if (rows.length === 0) {
    return 'No fund_performance_metrics rows. Use DataStore(action:"fetch", type:"fund_performance") or refresh fund_list first.';
  }
  const rowMaps = sortFundPerformanceRows(rows as unknown as Array<Record<string, unknown>>).slice(0, limit);
  return formatRows(
    "fund_performance_metrics",
    rowMaps,
    (r) =>
      `${r.metric_date} ${r.code} [${r.provider}] nav:${r.nav ?? "-"} ytd:${r.return_ytd ?? "-"} 1w:${r.return_1w ?? "-"} 1m:${r.return_1m ?? "-"} 3m:${r.return_3m ?? "-"} 6m:${r.return_6m ?? "-"} 1y:${r.return_1y ?? "-"} 3y:${r.return_3y ?? "-"} fetched:${r.fetched_at ?? "-"}`,
    readbackProvenanceFromRows(
      "fund.performance_metrics",
      "fund_performance_metrics",
      "fund_performance_metrics",
      "query_fund_performance",
      rowMaps,
      {
        asOfKeys: ["metric_date"],
        fetchedAtKeys: ["fetched_at"],
      },
    ),
  );
}

export function queryIndexConstituents(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const indexCode =
    typeof input.indexCode === "string"
      ? input.indexCode
      : typeof input.code === "string"
        ? input.code
        : undefined;
  const rows = ds.queryIndexConstituents({
    indexCode,
    stockCode:
      typeof input.stockCode === "string" ? input.stockCode : undefined,
    asOfDate:
      typeof input.asOfDate === "string"
        ? input.asOfDate
        : typeof input.date === "string"
          ? input.date
          : undefined,
    provider: typeof input.provider === "string" ? input.provider : undefined,
    limit: Number(input.limit ?? 300),
  });
  if (rows.length === 0) {
    return 'No index_constituent rows. Use DataStore(action:"fetch", type:"index_components", code:"000300") first.';
  }
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  return formatRows(
    "index_constituent",
    rowMaps,
    (r) =>
      `${r.as_of_date} ${r.index_code} -> ${r.stock_code} ${r.stock_name ?? ""} weight:${r.weight ?? "-"} [${r.provider}] fetched:${r.fetched_at ?? "-"}`,
    readbackProvenanceFromRows(
      "index.constituents",
      "index_constituent",
      "index_constituent",
      "query_index_constituents",
      rowMaps,
      {
        asOfKeys: ["as_of_date"],
        fetchedAtKeys: ["fetched_at"],
      },
    ),
  );
}

export function queryFundHolding(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const limit = Number(input.limit ?? 100);
  const reportDate =
    typeof input.reportDate === "string"
      ? input.reportDate
      : typeof input.date === "string"
        ? input.date
        : undefined;
  const fundCodes = codeListInput(input, ["code", "fundCode", "fundCodes", "codes"]);
  const explicitStockCode = typeof input.stockCode === "string" ? input.stockCode : undefined;
  let rows = fundCodes.length > 0
    ? fundCodes.flatMap((fundCode) =>
        ds.queryFundHolding({
          fundCode,
          reportDate,
          limit,
        }),
      )
    : ds.queryFundHolding({
        stockCode: explicitStockCode,
        reportDate,
        limit,
      });
  if (rows.length === 0 && fundCodes.length === 0 && explicitStockCode) {
    rows = ds.queryFundHolding({
      fundCode: explicitStockCode,
      reportDate,
      limit,
    });
  }
  if (rows.length === 0)
    return "No fund holding rows. For a fund's holdings use code/fundCode/fundCodes; stockCode is a constituent-stock filter. Fetch/persist fund_holding first if the fund-code query is empty.";
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  return formatRows(
    "fund_holding",
    rowMaps,
    (r) =>
      `${r.report_date} ${r.fund_code} #${r.rank ?? "-"} ${r.stock_code} ${r.stock_name ?? ""} pct:${r.hold_pct ?? "-"} value:${r.hold_value ?? "-"} shares:${r.hold_shares ?? "-"}`,
    readbackProvenanceFromRows(
      "fund.holding",
      "fund_holding",
      "fund_holding",
      "query_fund_holding",
      rowMaps,
      {
        asOfKeys: ["report_date"],
        fetchedAtKeys: ["fetched_at", "updated_at"],
      },
    ),
  );
}

export function queryFundManager(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const rows = ds.queryFundManagers({
    company: typeof input.company === "string" ? input.company : undefined,
    name: typeof input.name === "string" ? input.name : undefined,
    limit: Number(input.limit ?? 100),
  });
  if (rows.length === 0)
    return "No fund manager rows. Fetch/persist fund_manager first.";
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  return formatRows(
    "fund_manager",
    rowMaps,
    (r) =>
      `${r.name} ${r.company ?? "-"} size:${r.total_size ?? "-"} funds:${r.fund_count ?? "-"} best:${r.best_return ?? "-"} yrs:${r.experience_years ?? "-"} start:${r.start_date ?? "-"}`,
    readbackProvenanceFromRows(
      "fund.manager",
      "fund_manager",
      "fund_manager",
      "query_fund_manager",
      rowMaps,
      {
        asOfKeys: ["updated_at", "start_date"],
        fetchedAtKeys: ["fetched_at", "updated_at"],
      },
    ),
  );
}
