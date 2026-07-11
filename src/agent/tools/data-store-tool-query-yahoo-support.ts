import { defaultYfinanceFunc } from "./data-store-tool-utils";
import {
  latestRowValue,
  readbackProvenance,
} from "./data-store-tool-query-common";

export interface YfinanceQuerySpec {
  table: string;
  order: string;
  interfaceId: string;
  canonicalSchema: string;
  readbackAction?: string;
  where?: string;
  formatter: (r: Record<string, unknown>) => string;
}

export function normalizeYfinanceDataset(requestedDataset: string): string {
  const normalized = requestedDataset.trim().toLowerCase();
  const aliases: Record<string, string> = {
    option_expiries: "expiries",
    open_interest: "option_open_interest",
    volume: "option_volume",
    implied_volatility: "option_implied_volatility",
    moneyness: "option_moneyness",
    in_the_money: "option_moneyness",
    spread: "option_bid_ask_spread",
    option_spread: "option_bid_ask_spread",
    bid_ask_spread: "option_bid_ask_spread",
    price_change: "option_price_change",
    change: "option_price_change",
    percent_change: "option_price_change",
    trade_recency: "option_trade_recency",
    last_trade: "option_trade_recency",
    last_trade_date: "option_trade_recency",
    earnings_dates: "earnings_calendar",
    earnings_estimate: "earnings_estimates",
    income: "income_statement",
    income_stmt: "income_statement",
    balancesheet: "balance_sheet",
    cashflow: "cash_flow",
    quarterly_statements: "quarterly_financial_statements",
    quarterly_financials: "quarterly_financial_statements",
    quarterly_income: "quarterly_income_statement",
    quarterly_income_stmt: "quarterly_income_statement",
    quarterly_balancesheet: "quarterly_balance_sheet",
    quarterly_cashflow: "quarterly_cash_flow",
    upgrades_downgrades: "upgrade_downgrade_events",
    upgrades: "upgrade_downgrade_events",
    downgrades: "upgrade_downgrade_events",
    capitalgains: "capital_gains",
  };
  return aliases[normalized] ?? normalized;
}

export function supportedYfinanceDatasets(): string[] {
  return [
    "profile",
    "statements",
    "income_statement",
    "income",
    "income_stmt",
    "balance_sheet",
    "balancesheet",
    "cash_flow",
    "cashflow",
    "earnings_calendar",
    "earnings_dates",
    "earnings_history",
    "earnings_estimates",
    "earnings_estimate",
    "eps_revisions",
    "eps_trend",
    "quarterly_financial_statements",
    "quarterly_financials",
    "quarterly_statements",
    "quarterly_income_statement",
    "quarterly_income",
    "quarterly_income_stmt",
    "quarterly_balance_sheet",
    "quarterly_balancesheet",
    "quarterly_cash_flow",
    "quarterly_cashflow",
    "recommendations",
    "upgrade_downgrade_events",
    "upgrades_downgrades",
    "news",
    "options",
    "option_expiries",
    "expiries",
    "option_open_interest",
    "open_interest",
    "option_volume",
    "volume",
    "option_implied_volatility",
    "implied_volatility",
    "option_moneyness",
    "moneyness",
    "in_the_money",
    "option_bid_ask_spread",
    "option_spread",
    "bid_ask_spread",
    "spread",
    "option_price_change",
    "price_change",
    "change",
    "percent_change",
    "option_trade_recency",
    "trade_recency",
    "last_trade",
    "last_trade_date",
    "actions",
    "dividends",
    "capital_gains",
    "splits",
    "stock_splits",
    "holders",
    "major_holders",
    "institutional_holders",
    "institutions",
    "mutualfund_holders",
    "mutual_fund_holders",
    "fund_holders",
    "insiders",
  ];
}

export function unsupportedYfinanceDatasetMessage(requestedDataset: string) {
  return `Yfinance dataset "${requestedDataset}" is not supported. Use one of: ${supportedYfinanceDatasets().join(", ")}`;
}

export function missingYfinanceRowsMessage(
  requestedDataset: string,
  symbol: string,
) {
  return `No yfinance ${requestedDataset} rows for ${symbol}. Use a requirement-level Yahoo workflow to fetch and persist the registered ${defaultYfinanceFunc(requestedDataset)} schema, or use provider_diagnostic only for bounded provider inspection.`;
}

export function yfinanceQuerySpecs(): Record<string, YfinanceQuerySpec> {
  const statementFormatter = (r: Record<string, unknown>) =>
    `${r.period} ${r.statement_type} ${r.item}: ${r.value ?? "-"}`;
  const optionContractFormatter = (r: Record<string, unknown>) =>
    `${r.expiry_date} ${r.option_type} ${r.contract_symbol} strike:${r.strike ?? "-"} last:${r.last_price ?? "-"} bid:${r.bid ?? "-"} ask:${r.ask ?? "-"} openInterest:${r.open_interest ?? "-"} iv:${r.implied_volatility ?? "-"}`;
  const numericSpread = (bid: unknown, ask: unknown) => {
    const left = Number(bid);
    const right = Number(ask);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return "-";
    return String(Number((right - left).toFixed(6)));
  };
  return {
    profile: {
      table: "yfinance_profile_fields",
      order: "updated_at DESC, field_key",
      interfaceId: "global.company_profile",
      canonicalSchema: "yfinance_profile_fields",
      readbackAction: "query_global_company_profile",
      formatter: (r) =>
        `${r.field_key}: ${String(r.field_value ?? "").slice(0, 180)}`,
    },
    statements: {
      table: "yfinance_statement_items",
      order: "period DESC, statement_type, item",
      interfaceId: "global.financial_statements",
      canonicalSchema: "yfinance_statement_items",
      readbackAction: "query_global_financial_statements",
      formatter: statementFormatter,
    },
    income_statement: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      interfaceId: "global.income_statement",
      canonicalSchema: "yfinance_statement_items",
      readbackAction: "query_global_income_statement",
      where: "statement_type = 'income'",
      formatter: statementFormatter,
    },
    balance_sheet: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      interfaceId: "global.balance_sheet",
      canonicalSchema: "yfinance_statement_items",
      readbackAction: "query_global_balance_sheet",
      where: "statement_type = 'balance_sheet'",
      formatter: statementFormatter,
    },
    cash_flow: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      interfaceId: "global.cash_flow",
      canonicalSchema: "yfinance_statement_items",
      readbackAction: "query_global_cash_flow",
      where: "statement_type = 'cash_flow'",
      formatter: statementFormatter,
    },
    earnings_calendar: {
      table: "yfinance_statement_items",
      order: "period DESC, statement_type, item",
      interfaceId: "global.earnings_calendar",
      canonicalSchema: "yfinance_statement_items",
      readbackAction: "query_global_earnings_calendar",
      where: "statement_type IN ('earnings_dates', 'earnings_history')",
      formatter: statementFormatter,
    },
    earnings_history: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      interfaceId: "global.earnings_history",
      canonicalSchema: "yfinance_statement_items",
      readbackAction: "query_global_earnings_history",
      where: "statement_type = 'earnings_history'",
      formatter: statementFormatter,
    },
    earnings_estimates: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      interfaceId: "global.earnings_estimates",
      canonicalSchema: "yfinance_statement_items",
      readbackAction: "query_global_earnings_estimates",
      where: "statement_type = 'earnings_estimate'",
      formatter: statementFormatter,
    },
    eps_revisions: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      interfaceId: "global.eps_revisions",
      canonicalSchema: "yfinance_statement_items",
      readbackAction: "query_global_eps_revisions",
      where: "statement_type = 'eps_revisions'",
      formatter: statementFormatter,
    },
    eps_trend: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      interfaceId: "global.eps_trend",
      canonicalSchema: "yfinance_statement_items",
      readbackAction: "query_global_eps_trend",
      where: "statement_type = 'eps_trend'",
      formatter: statementFormatter,
    },
    quarterly_financial_statements: {
      table: "yfinance_statement_items",
      order: "period DESC, statement_type, item",
      interfaceId: "global.quarterly_financial_statements",
      canonicalSchema: "yfinance_statement_items",
      readbackAction: "query_global_quarterly_financial_statements",
      where:
        "statement_type IN ('quarterly_financials', 'quarterly_income_stmt', 'quarterly_balance_sheet', 'quarterly_balancesheet', 'quarterly_cash_flow', 'quarterly_cashflow')",
      formatter: statementFormatter,
    },
    quarterly_income_statement: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      interfaceId: "global.quarterly_income_statement",
      canonicalSchema: "yfinance_statement_items",
      readbackAction: "query_global_quarterly_income_statement",
      where: "statement_type = 'quarterly_income_stmt'",
      formatter: statementFormatter,
    },
    quarterly_balance_sheet: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      interfaceId: "global.quarterly_balance_sheet",
      canonicalSchema: "yfinance_statement_items",
      readbackAction: "query_global_quarterly_balance_sheet",
      where:
        "statement_type IN ('quarterly_balance_sheet', 'quarterly_balancesheet')",
      formatter: statementFormatter,
    },
    quarterly_cash_flow: {
      table: "yfinance_statement_items",
      order: "period DESC, item",
      interfaceId: "global.quarterly_cash_flow",
      canonicalSchema: "yfinance_statement_items",
      readbackAction: "query_global_quarterly_cash_flow",
      where: "statement_type IN ('quarterly_cash_flow', 'quarterly_cashflow')",
      formatter: statementFormatter,
    },
    recommendations: {
      table: "yfinance_recommendations",
      order: "updated_at DESC, period",
      interfaceId: "global.recommendations",
      canonicalSchema: "yfinance_recommendations",
      readbackAction: "query_global_recommendations",
      formatter: (r) =>
        `${r.period} strongBuy:${r.strong_buy ?? "-"} buy:${r.buy ?? "-"} hold:${r.hold ?? "-"} sell:${r.sell ?? "-"} strongSell:${r.strong_sell ?? "-"}`,
    },
    upgrade_downgrade_events: {
      table: "yfinance_recommendations",
      order: "updated_at DESC, period",
      interfaceId: "global.upgrade_downgrade_events",
      canonicalSchema: "yfinance_recommendations",
      readbackAction: "query_global_upgrade_downgrade_events",
      formatter: (r) =>
        `${r.period} strongBuy:${r.strong_buy ?? "-"} buy:${r.buy ?? "-"} hold:${r.hold ?? "-"} sell:${r.sell ?? "-"} strongSell:${r.strong_sell ?? "-"}`,
    },
    news: {
      table: "yfinance_news",
      order: "published_at DESC, updated_at DESC",
      interfaceId: "global.finance_news",
      canonicalSchema: "yfinance_news",
      readbackAction: "query_global_finance_news",
      formatter: (r) =>
        `${r.published_at ?? "-"} ${r.title ?? "-"} (${r.publisher ?? "-"})`,
    },
    options: {
      table: "yfinance_option_contracts",
      order: "expiry_date DESC, option_type, strike",
      interfaceId: "option.chain_snapshot",
      canonicalSchema: "yfinance_options",
      readbackAction: "query_option_chain_snapshot",
      formatter: optionContractFormatter,
    },
    option_open_interest: {
      table: "yfinance_option_contracts",
      order: "expiry_date DESC, open_interest DESC, option_type, strike",
      interfaceId: "option.open_interest",
      canonicalSchema: "yfinance_option_contracts",
      where: "open_interest IS NOT NULL",
      formatter: (r) =>
        `${r.expiry_date} ${r.option_type} ${r.contract_symbol} strike:${r.strike ?? "-"} openInterest:${r.open_interest ?? "-"} volume:${r.volume ?? "-"} last:${r.last_price ?? "-"}`,
    },
    option_volume: {
      table: "yfinance_option_contracts",
      order: "expiry_date DESC, volume DESC, option_type, strike",
      interfaceId: "option.volume",
      canonicalSchema: "yfinance_option_contracts",
      where: "volume IS NOT NULL",
      formatter: (r) =>
        `${r.expiry_date} ${r.option_type} ${r.contract_symbol} strike:${r.strike ?? "-"} volume:${r.volume ?? "-"} openInterest:${r.open_interest ?? "-"} last:${r.last_price ?? "-"}`,
    },
    option_implied_volatility: {
      table: "yfinance_option_contracts",
      order: "expiry_date DESC, implied_volatility DESC, option_type, strike",
      interfaceId: "option.implied_volatility",
      canonicalSchema: "yfinance_option_contracts",
      where: "implied_volatility IS NOT NULL",
      formatter: (r) =>
        `${r.expiry_date} ${r.option_type} ${r.contract_symbol} strike:${r.strike ?? "-"} iv:${r.implied_volatility ?? "-"} inMoney:${r.in_the_money ?? "-"} last:${r.last_price ?? "-"}`,
    },
    option_moneyness: {
      table: "yfinance_option_contracts",
      order: "expiry_date DESC, in_the_money DESC, option_type, strike",
      interfaceId: "option.moneyness",
      canonicalSchema: "yfinance_option_contracts",
      where: "in_the_money IS NOT NULL",
      formatter: (r) =>
        `${r.expiry_date} ${r.option_type} ${r.contract_symbol} strike:${r.strike ?? "-"} inMoney:${r.in_the_money ?? "-"} last:${r.last_price ?? "-"} bid:${r.bid ?? "-"} ask:${r.ask ?? "-"}`,
    },
    option_bid_ask_spread: {
      table: "yfinance_option_contracts",
      order: "expiry_date DESC, (ask - bid) ASC, option_type, strike",
      interfaceId: "option.bid_ask_spread",
      canonicalSchema: "yfinance_option_contracts",
      where: "bid IS NOT NULL AND ask IS NOT NULL",
      formatter: (r) =>
        `${r.expiry_date} ${r.option_type} ${r.contract_symbol} strike:${r.strike ?? "-"} bid:${r.bid ?? "-"} ask:${r.ask ?? "-"} spread:${numericSpread(r.bid, r.ask)} last:${r.last_price ?? "-"}`,
    },
    option_price_change: {
      table: "yfinance_option_contracts",
      order: "expiry_date DESC, ABS(percent_change) DESC, option_type, strike",
      interfaceId: "option.price_change",
      canonicalSchema: "yfinance_option_contracts",
      where: "change IS NOT NULL OR percent_change IS NOT NULL",
      formatter: (r) =>
        `${r.expiry_date} ${r.option_type} ${r.contract_symbol} strike:${r.strike ?? "-"} change:${r.change ?? "-"} pct:${r.percent_change ?? "-"} last:${r.last_price ?? "-"}`,
    },
    option_trade_recency: {
      table: "yfinance_option_contracts",
      order: "last_trade_date DESC, expiry_date DESC, option_type, strike",
      interfaceId: "option.trade_recency",
      canonicalSchema: "yfinance_option_contracts",
      where: "last_trade_date IS NOT NULL",
      formatter: (r) =>
        `${r.expiry_date} ${r.option_type} ${r.contract_symbol} strike:${r.strike ?? "-"} lastTrade:${r.last_trade_date ?? "-"} last:${r.last_price ?? "-"} volume:${r.volume ?? "-"}`,
    },
    expiries: {
      table: "yfinance_option_expiries",
      order: "expiry_date DESC",
      interfaceId: "option.expiry_calendar",
      canonicalSchema: "yfinance_option_expiries",
      readbackAction: "query_option_expiry_calendar",
      formatter: (r) => `${r.expiry_date}`,
    },
    actions: {
      table: "yfinance_corporate_actions",
      order: "action_date DESC, action_type",
      interfaceId: "global.corporate_actions",
      canonicalSchema: "yfinance_corporate_actions",
      readbackAction: "query_global_corporate_actions",
      formatter: (r) => `${r.action_date} ${r.action_type}: ${r.value ?? "-"}`,
    },
    dividends: {
      table: "yfinance_corporate_actions",
      order: "action_date DESC",
      interfaceId: "global.dividends",
      canonicalSchema: "yfinance_corporate_actions",
      readbackAction: "query_global_dividends",
      where: "action_type IN ('dividend', 'dividends')",
      formatter: (r) => `${r.action_date} dividend:${r.value ?? "-"}`,
    },
    capital_gains: {
      table: "yfinance_corporate_actions",
      order: "action_date DESC",
      interfaceId: "global.capital_gains",
      canonicalSchema: "yfinance_corporate_actions",
      readbackAction: "query_global_capital_gains",
      where: "action_type = 'capital_gains'",
      formatter: (r) => `${r.action_date} capital_gains:${r.value ?? "-"}`,
    },
    splits: {
      table: "yfinance_corporate_actions",
      order: "action_date DESC",
      interfaceId: "global.stock_splits",
      canonicalSchema: "yfinance_corporate_actions",
      readbackAction: "query_global_stock_splits",
      where: "action_type IN ('split', 'splits')",
      formatter: (r) => `${r.action_date} split:${r.value ?? "-"}`,
    },
    stock_splits: {
      table: "yfinance_corporate_actions",
      order: "action_date DESC",
      interfaceId: "global.stock_splits",
      canonicalSchema: "yfinance_corporate_actions",
      readbackAction: "query_global_stock_splits",
      where: "action_type IN ('split', 'splits')",
      formatter: (r) => `${r.action_date} split:${r.value ?? "-"}`,
    },
    holders: {
      table: "yfinance_holders",
      order: "reported_date DESC, holder_type, holder_name",
      interfaceId: "global.holders",
      canonicalSchema: "yfinance_holders",
      readbackAction: "query_global_holders",
      formatter: (r) =>
        `${r.reported_date} ${r.holder_type} ${r.holder_name} shares:${r.shares ?? "-"} value:${r.value ?? "-"}`,
    },
    major_holders: {
      table: "yfinance_holders",
      order: "reported_date DESC, holder_name",
      interfaceId: "global.major_holders",
      canonicalSchema: "yfinance_holders",
      readbackAction: "query_global_major_holders",
      where: "holder_type = 'major_holders'",
      formatter: (r) =>
        `${r.reported_date} ${r.holder_name} pct:${r.pct_held ?? "-"} value:${r.value ?? "-"}`,
    },
    institutional_holders: {
      table: "yfinance_holders",
      order: "reported_date DESC, holder_name",
      interfaceId: "global.institutional_holders",
      canonicalSchema: "yfinance_holders",
      readbackAction: "query_global_institutional_holders",
      where: "holder_type IN ('institutional_holders', 'institutional')",
      formatter: (r) =>
        `${r.reported_date} institutional ${r.holder_name} shares:${r.shares ?? "-"} value:${r.value ?? "-"}`,
    },
    institutions: {
      table: "yfinance_holders",
      order: "reported_date DESC, holder_name",
      interfaceId: "global.institutional_holders",
      canonicalSchema: "yfinance_holders",
      where: "holder_type IN ('institutional_holders', 'institutional')",
      formatter: (r) =>
        `${r.reported_date} institutional ${r.holder_name} shares:${r.shares ?? "-"} value:${r.value ?? "-"}`,
    },
    mutualfund_holders: {
      table: "yfinance_holders",
      order: "reported_date DESC, holder_name",
      interfaceId: "global.mutual_fund_holders",
      canonicalSchema: "yfinance_holders",
      readbackAction: "query_global_mutual_fund_holders",
      where: "holder_type IN ('mutualfund_holders', 'fund')",
      formatter: (r) =>
        `${r.reported_date} mutualFund ${r.holder_name} shares:${r.shares ?? "-"} value:${r.value ?? "-"}`,
    },
    mutual_fund_holders: {
      table: "yfinance_holders",
      order: "reported_date DESC, holder_name",
      interfaceId: "global.mutual_fund_holders",
      canonicalSchema: "yfinance_holders",
      readbackAction: "query_global_mutual_fund_holders",
      where: "holder_type IN ('mutualfund_holders', 'fund')",
      formatter: (r) =>
        `${r.reported_date} mutualFund ${r.holder_name} shares:${r.shares ?? "-"} value:${r.value ?? "-"}`,
    },
    fund_holders: {
      table: "yfinance_holders",
      order: "reported_date DESC, holder_name",
      interfaceId: "global.mutual_fund_holders",
      canonicalSchema: "yfinance_holders",
      where: "holder_type IN ('mutualfund_holders', 'fund')",
      formatter: (r) =>
        `${r.reported_date} mutualFund ${r.holder_name} shares:${r.shares ?? "-"} value:${r.value ?? "-"}`,
    },
    insiders: {
      table: "yfinance_insider_transactions",
      order: "start_date DESC, insider",
      interfaceId: "global.insider_transactions",
      canonicalSchema: "yfinance_insider_transactions",
      readbackAction: "query_global_insider_transactions",
      formatter: (r) =>
        `${r.start_date ?? "-"} ${r.insider ?? "-"} ${r.transaction_text ?? "-"} shares:${r.shares ?? "-"} value:${r.value ?? "-"}`,
    },
  };
}

export function resolveYfinanceReadbackSpec(
  dataset: string,
  readbackAction: string,
  specs: Record<string, YfinanceQuerySpec>,
): YfinanceQuerySpec | undefined {
  if (dataset !== "options") return specs[dataset];
  const options = specs.options;
  if (readbackAction === "query_option_quote") {
    return {
      ...options,
      interfaceId: "option.quote",
      canonicalSchema: "yfinance_option_contracts",
      readbackAction,
    };
  }
  if (readbackAction === "query_option_daily_kline") {
    return {
      ...options,
      interfaceId: "option.daily_kline",
      canonicalSchema: "kline_daily",
      readbackAction,
    };
  }
  if (readbackAction === "query_option_contract_list") {
    return {
      ...options,
      interfaceId: "option.contract_list",
      canonicalSchema: "yfinance_option_contracts",
    };
  }
  if (readbackAction === "query_global_options_chain") {
    return {
      ...options,
      interfaceId: "global.options_chain",
      canonicalSchema: "yfinance_options",
    };
  }
  return specs[dataset];
}

export function yfinanceReadbackProvenance(
  interfaceId: string,
  canonicalSchema: string,
  canonicalTable: string,
  readbackAction: string,
  cacheStatus: string,
  rows: Array<Record<string, unknown>>,
) {
  return {
    ...readbackProvenance(
      interfaceId,
      canonicalSchema,
      canonicalTable,
      readbackAction,
      "yahoo",
      `yahoo.${interfaceId}`,
      cacheStatus,
    ),
    providerId: "yahoo",
    providerStatus: "global-only",
    globalOnly: true,
    marketScope: ["US", "HK", "global"],
    asOf: latestRowValue(rows, [
      "timestamp",
      "as_of",
      "asOf",
      "published_at",
      "action_date",
      "last_trade_date",
      "period",
      "reported_date",
      "start_date",
    ]),
    fetchedAt: latestRowValue(rows, ["fetched_at", "fetchedAt", "updated_at"]),
  };
}
