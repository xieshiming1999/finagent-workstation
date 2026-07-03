import type { DataStore } from "../data/store/data-store";
import { queryYfinance } from "./data-store-tool-query-yahoo";

function delegatedYfinanceReadback(
  ds: DataStore,
  input: Record<string, unknown>,
  dataset: string,
  action: string,
): string {
  return queryYfinance(ds, {
    ...input,
    dataset,
    _queryAction: action,
  });
}

export const queryGlobalFinanceNews = (
  ds: DataStore,
  input: Record<string, unknown>,
) => delegatedYfinanceReadback(ds, input, "news", "query_global_finance_news");
export const queryGlobalCompanyProfile = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "profile",
    "query_global_company_profile",
  );
export const queryGlobalFinancialStatements = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "statements",
    "query_global_financial_statements",
  );
export const queryGlobalIncomeStatement = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "income_statement",
    "query_global_income_statement",
  );
export const queryGlobalBalanceSheet = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "balance_sheet",
    "query_global_balance_sheet",
  );
export const queryGlobalCashFlow = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(ds, input, "cash_flow", "query_global_cash_flow");
export const queryGlobalEarningsCalendar = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "earnings_calendar",
    "query_global_earnings_calendar",
  );
export const queryGlobalEarningsHistory = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "earnings_history",
    "query_global_earnings_history",
  );
export const queryGlobalEarningsEstimates = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "earnings_estimates",
    "query_global_earnings_estimates",
  );
export const queryGlobalEpsRevisions = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "eps_revisions",
    "query_global_eps_revisions",
  );
export const queryGlobalEpsTrend = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(ds, input, "eps_trend", "query_global_eps_trend");
export const queryGlobalQuarterlyFinancialStatements = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "quarterly_financial_statements",
    "query_global_quarterly_financial_statements",
  );
export const queryGlobalQuarterlyIncomeStatement = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "quarterly_income_statement",
    "query_global_quarterly_income_statement",
  );
export const queryGlobalQuarterlyBalanceSheet = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "quarterly_balance_sheet",
    "query_global_quarterly_balance_sheet",
  );
export const queryGlobalQuarterlyCashFlow = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "quarterly_cash_flow",
    "query_global_quarterly_cash_flow",
  );
export const queryGlobalRecommendations = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "recommendations",
    "query_global_recommendations",
  );
export const queryGlobalUpgradeDowngradeEvents = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "upgrade_downgrade_events",
    "query_global_upgrade_downgrade_events",
  );
export const queryGlobalHolders = (
  ds: DataStore,
  input: Record<string, unknown>,
) => delegatedYfinanceReadback(ds, input, "holders", "query_global_holders");
export const queryGlobalMajorHolders = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "major_holders",
    "query_global_major_holders",
  );
export const queryGlobalInstitutionalHolders = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "institutional_holders",
    "query_global_institutional_holders",
  );
export const queryGlobalMutualFundHolders = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "mutual_fund_holders",
    "query_global_mutual_fund_holders",
  );
export const queryGlobalInsiderTransactions = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "insiders",
    "query_global_insider_transactions",
  );
export const queryGlobalCorporateActions = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "actions",
    "query_global_corporate_actions",
  );
export const queryGlobalDividends = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(ds, input, "dividends", "query_global_dividends");
export const queryGlobalCapitalGains = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "capital_gains",
    "query_global_capital_gains",
  );
export const queryGlobalStockSplits = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(ds, input, "splits", "query_global_stock_splits");
export const queryOptionExpiryCalendar = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "option_expiries",
    "query_option_expiry_calendar",
  );
export const queryOptionContractList = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(ds, input, "options", "query_option_contract_list");
export const queryOptionQuote = (
  ds: DataStore,
  input: Record<string, unknown>,
) => delegatedYfinanceReadback(ds, input, "options", "query_option_quote");
export const queryOptionOpenInterest = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "option_open_interest",
    "query_option_open_interest",
  );
export const queryOptionVolume = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(ds, input, "option_volume", "query_option_volume");
export const queryOptionImpliedVolatility = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "option_implied_volatility",
    "query_option_implied_volatility",
  );
export const queryOptionMoneyness = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "option_moneyness",
    "query_option_moneyness",
  );
export const queryOptionBidAskSpread = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "option_bid_ask_spread",
    "query_option_bid_ask_spread",
  );
export const queryOptionPriceChange = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "option_price_change",
    "query_option_price_change",
  );
export const queryOptionTradeRecency = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "option_trade_recency",
    "query_option_trade_recency",
  );
export const queryOptionChainSnapshot = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(
    ds,
    input,
    "options",
    "query_option_chain_snapshot",
  );
export const queryGlobalOptionsChain = (
  ds: DataStore,
  input: Record<string, unknown>,
) =>
  delegatedYfinanceReadback(ds, input, "options", "query_global_options_chain");
