import type { DataStore } from "../data/store/data-store";
import { readbackTitle } from "./data-store-tool-utils";
import {
  latestRowValue,
  readbackProvenance,
} from "./data-store-tool-query-common";

interface GlobalYfinanceCoverageSpec {
  table: string;
  interfaceId: string;
  canonicalSchema: string;
  readbackAction: string;
  dataset: string;
  where: string;
  latestColumn: string;
  codeColumn: string;
}

export function reusableSummary(ds: DataStore): string {
  const rows = ds.getReusableDataSummary();
  const rowMaps = rows as unknown as Array<Record<string, unknown>>;
  const title = readbackTitle(
    "Reusable local data",
    readbackProvenance(
      "data.coverage",
      "data_coverage",
      "data_coverage",
      "reusable_summary",
      "local",
      "local.data.coverage",
      "local-hit",
      {
        asOf: latestRowValue(rowMaps, ["latest"]),
        fetchedAt: latestRowValue(rowMaps, ["latest"]),
      },
    ),
  );
  return `${title}:\n${rows.map((r) => `${r.name}: ${r.count} rows${r.latest ? `, latest ${r.latest}` : ""}`).join("\n")}`;
}

export function coverage(
  ds: DataStore,
  input: Record<string, unknown>,
): string {
  const code = input.code as string | undefined;
  if (code) {
    const types = ["kline_daily", "fund_nav", "fundamental", "money_flow"];
    const lines: string[] = [];
    for (const t of types) {
      const cov = ds.getCoverage(code, t);
      if (cov && cov.row_count > 0) {
        lines.push(
          `${t}: ${cov.earliest_date} ~ ${cov.latest_date} (${cov.row_count} rows, updated ${cov.last_updated})`,
        );
      }
    }
    lines.push(...globalYfinanceCoverageLines(ds, code));
    const title = readbackTitle(
      `${code} data coverage`,
      readbackProvenance(
        "data.coverage",
        "data_coverage",
        "data_coverage",
        "coverage",
        "local",
        "local.data.coverage",
        "local-hit",
      ),
    );
    return lines.length > 0
      ? `${title}:\n${lines.join("\n")}`
      : `${title}:\nNo data for ${code}.`;
  }
  const all = ds.getAllCoverage();
  const emptyTitle = readbackTitle(
    "Data coverage summary",
    readbackProvenance(
      "data.coverage",
      "data_coverage",
      "data_coverage",
      "coverage",
      "local",
      "local.data.coverage",
      "local-miss",
    ),
  );
  if (all.length === 0) {
    return `${emptyTitle}:\nNo data downloaded yet. Use DataStore(action: "fetch") to start.`;
  }
  const byType = new Map<string, number>();
  for (const c of all) {
    byType.set(c.data_type, (byType.get(c.data_type) ?? 0) + 1);
  }
  const allRowMaps = all as unknown as Array<Record<string, unknown>>;
  const title = readbackTitle(
    "Data coverage summary",
    readbackProvenance(
      "data.coverage",
      "data_coverage",
      "data_coverage",
      "coverage",
      "local",
      "local.data.coverage",
      "local-hit",
      {
        asOf: latestRowValue(allRowMaps, ["latest_date", "last_updated"]),
        fetchedAt: latestRowValue(allRowMaps, ["last_updated"]),
      },
    ),
  );
  return `${title}:\n${[...byType.entries()].map(([t, n]) => `${t}: ${n} symbols`).join("\n")}\nTotal symbols: ${all.length}`;
}

function globalYfinanceCoverageLines(ds: DataStore, code: string): string[] {
  const symbol = code.trim().toUpperCase();
  if (!symbol || isAshareSymbol(symbol)) return [];
  const specs: GlobalYfinanceCoverageSpec[] = [
    [
      "yfinance_profile_fields",
      "global.company_profile",
      "yfinance_profile_fields",
      "query_global_company_profile",
      "profile",
      "",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_statement_items",
      "global.financial_statements",
      "yfinance_statement_items",
      "query_global_financial_statements",
      "statements",
      "",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_statement_items",
      "global.earnings_calendar",
      "yfinance_statement_items",
      "query_global_earnings_calendar",
      "earnings_calendar",
      " AND statement_type IN ('earnings_dates', 'earnings_history')",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_statement_items",
      "global.earnings_history",
      "yfinance_statement_items",
      "query_global_earnings_history",
      "earnings_history",
      " AND statement_type = 'earnings_history'",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_statement_items",
      "global.earnings_estimates",
      "yfinance_statement_items",
      "query_global_earnings_estimates",
      "earnings_estimates",
      " AND statement_type = 'earnings_estimate'",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_statement_items",
      "global.eps_revisions",
      "yfinance_statement_items",
      "query_global_eps_revisions",
      "eps_revisions",
      " AND statement_type = 'eps_revisions'",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_statement_items",
      "global.eps_trend",
      "yfinance_statement_items",
      "query_global_eps_trend",
      "eps_trend",
      " AND statement_type = 'eps_trend'",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_statement_items",
      "global.quarterly_financial_statements",
      "yfinance_statement_items",
      "query_global_quarterly_financial_statements",
      "quarterly_financial_statements",
      " AND statement_type IN ('quarterly_financials', 'quarterly_income_stmt', 'quarterly_balance_sheet', 'quarterly_balancesheet', 'quarterly_cash_flow', 'quarterly_cashflow')",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_recommendations",
      "global.recommendations",
      "yfinance_recommendations",
      "query_global_recommendations",
      "recommendations",
      "",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_recommendations",
      "global.upgrade_downgrade_events",
      "yfinance_recommendations",
      "query_global_upgrade_downgrade_events",
      "upgrade_downgrade_events",
      "",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_news",
      "global.finance_news",
      "yfinance_news",
      "query_global_finance_news",
      "news",
      "",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_option_expiries",
      "option.expiry_calendar",
      "yfinance_option_expiries",
      "query_option_expiry_calendar",
      "expiries",
      "",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_option_contracts",
      "option.quote",
      "yfinance_option_contracts",
      "query_option_quote",
      "options",
      "",
      "updated_at",
      "symbol",
    ],
    [
      "kline_daily",
      "option.daily_kline",
      "kline_daily",
      "query_option_daily_kline",
      "option_daily_kline",
      "",
      "date",
      "code",
    ],
    [
      "yfinance_option_contracts",
      "option.contract_list",
      "yfinance_option_contracts",
      "query_option_contract_list",
      "options",
      "",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_option_contracts",
      "option.open_interest",
      "yfinance_option_contracts",
      "query_option_open_interest",
      "option_open_interest",
      "",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_option_contracts",
      "option.volume",
      "yfinance_option_contracts",
      "query_option_volume",
      "option_volume",
      "",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_option_contracts",
      "option.implied_volatility",
      "yfinance_option_contracts",
      "query_option_implied_volatility",
      "option_implied_volatility",
      "",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_option_contracts",
      "option.moneyness",
      "yfinance_option_contracts",
      "query_option_moneyness",
      "option_moneyness",
      "",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_option_contracts",
      "option.bid_ask_spread",
      "yfinance_option_contracts",
      "query_option_bid_ask_spread",
      "option_bid_ask_spread",
      "",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_option_contracts",
      "option.price_change",
      "yfinance_option_contracts",
      "query_option_price_change",
      "option_price_change",
      "",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_option_contracts",
      "option.trade_recency",
      "yfinance_option_contracts",
      "query_option_trade_recency",
      "option_trade_recency",
      "",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_corporate_actions",
      "global.corporate_actions",
      "yfinance_corporate_actions",
      "query_global_corporate_actions",
      "actions",
      "",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_corporate_actions",
      "global.dividends",
      "yfinance_corporate_actions",
      "query_global_dividends",
      "dividends",
      " AND action_type IN ('dividend', 'dividends')",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_corporate_actions",
      "global.stock_splits",
      "yfinance_corporate_actions",
      "query_global_stock_splits",
      "splits",
      " AND action_type IN ('split', 'splits')",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_holders",
      "global.holders",
      "yfinance_holders",
      "query_global_holders",
      "holders",
      "",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_holders",
      "global.institutional_holders",
      "yfinance_holders",
      "query_global_institutional_holders",
      "institutional_holders",
      " AND holder_type IN ('institutional_holders', 'institutional')",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_holders",
      "global.mutual_fund_holders",
      "yfinance_holders",
      "query_global_mutual_fund_holders",
      "mutual_fund_holders",
      " AND holder_type IN ('mutualfund_holders', 'fund')",
      "updated_at",
      "symbol",
    ],
    [
      "yfinance_insider_transactions",
      "global.insider_transactions",
      "yfinance_insider_transactions",
      "query_global_insider_transactions",
      "insiders",
      "",
      "updated_at",
      "symbol",
    ],
  ].map(
    ([
      table,
      interfaceId,
      canonicalSchema,
      readbackAction,
      dataset,
      where,
      latestColumn,
      codeColumn,
    ]) => ({
      table,
      interfaceId,
      canonicalSchema,
      readbackAction,
      dataset,
      where,
      latestColumn,
      codeColumn,
    }),
  );
  return specs.map((spec) => {
    const row =
      ds.query<Record<string, unknown>>(
        `SELECT COUNT(*) AS count, MAX(${spec.latestColumn}) AS latest, GROUP_CONCAT(DISTINCT source) AS sources FROM ${spec.table} WHERE ${spec.codeColumn} = ?${spec.where}`,
        symbol,
      )[0] ?? {};
    const count = Number(row.count ?? 0);
    const cacheStatus = count > 0 ? "local-hit" : "local-miss";
    const latest = row.latest ? `, latest ${row.latest}` : "";
    const sources = row.sources ? `, sources ${row.sources}` : "";
    return `${spec.canonicalSchema} (${spec.interfaceId}, ${spec.readbackAction} dataset:${spec.dataset}, ${cacheStatus}): ${count} rows${latest}${sources}`;
  });
}

function isAshareSymbol(symbol: string): boolean {
  return /^\d{6}(?:\.(?:SH|SZ|BJ))?$/.test(symbol);
}
