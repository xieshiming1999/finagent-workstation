import { cached, sidecarGet } from "./data-manager-shared";

export async function getYahooPrice(symbol: string) {
  return cached(`yf:price:${symbol}`, 15_000, async () => {
    const json = await sidecarGet(
      `/yfinance/fast_info?symbol=${encodeURIComponent(symbol)}`,
    );
    return json.data ?? null;
  });
}

export async function getYahooHistory(symbol: string, range = "6mo") {
  return cached(`yf:hist:${symbol}:${range}`, 120_000, async () => {
    const json = await sidecarGet(
      `/yfinance/history?symbol=${encodeURIComponent(symbol)}&period=${range}`,
    );
    return json.data ?? [];
  });
}

export async function getYahooEarnings(symbol: string) {
  return cached(`yf:earn:${symbol}`, 300_000, async () => {
    const encoded = encodeURIComponent(symbol);
    const requests = await Promise.allSettled([
      sidecarGet(`/yfinance/info?symbol=${encoded}`),
      sidecarGet(`/yfinance/financials?symbol=${encoded}`),
      sidecarGet(`/yfinance/balance_sheet?symbol=${encoded}`),
      sidecarGet(`/yfinance/cash_flow?symbol=${encoded}`),
      sidecarGet(`/yfinance/recommendations?symbol=${encoded}`),
      sidecarGet(`/yfinance/major_holders?symbol=${encoded}`),
      sidecarGet(`/yfinance/institutional_holders?symbol=${encoded}`),
      sidecarGet(`/yfinance/mutualfund_holders?symbol=${encoded}`),
      sidecarGet(`/yfinance/insider_transactions?symbol=${encoded}`),
    ]);

    const pickData = (index: number) =>
      requests[index].status === "fulfilled"
        ? (requests[index].value?.data ?? null)
        : null;

    const info = pickData(0);
    const financials = pickData(1);
    const balanceSheet = pickData(2);
    const cashFlow = pickData(3);
    const recommendations = pickData(4);
    const majorHolders = pickData(5);
    const institutionalHolders = pickData(6);
    const fundHolders = pickData(7);
    const insiderTransactions = pickData(8);

    if (
      info == null &&
      financials == null &&
      balanceSheet == null &&
      cashFlow == null &&
      recommendations == null &&
      majorHolders == null &&
      institutionalHolders == null &&
      fundHolders == null &&
      insiderTransactions == null
    ) {
      return null;
    }

    const infoMap =
      info && typeof info === "object" ? (info as Record<string, unknown>) : {};
    return {
      info: infoMap,
      defaultKeyStatistics: {
        trailingPE: infoMap.trailingPE ?? null,
        priceToBook: infoMap.priceToBook ?? null,
        enterpriseValue: infoMap.enterpriseValue ?? null,
      },
      incomeStatementHistory: {
        incomeStatementHistory: Array.isArray(financials) ? financials : [],
      },
      balanceSheetHistory: {
        balanceSheetStatements: Array.isArray(balanceSheet) ? balanceSheet : [],
      },
      cashflowStatementHistory: {
        cashflowStatements: Array.isArray(cashFlow) ? cashFlow : [],
      },
      recommendationTrend: {
        trend: Array.isArray(recommendations) ? recommendations : [],
      },
      majorHoldersBreakdown: Array.isArray(majorHolders) ? majorHolders : [],
      institutionOwnership: {
        ownershipList: Array.isArray(institutionalHolders)
          ? institutionalHolders
          : [],
      },
      fundOwnership: {
        ownershipList: Array.isArray(fundHolders) ? fundHolders : [],
      },
      insiderTransactions: {
        transactions: Array.isArray(insiderTransactions)
          ? insiderTransactions
          : [],
      },
    };
  });
}

export async function getYahooNews(symbol: string) {
  return cached(`yf:news:${symbol}`, 60_000, async () => {
    const json = await sidecarGet(
      `/yfinance/news?symbol=${encodeURIComponent(symbol)}`,
    );
    return json.data ?? [];
  });
}

export async function getYahooOptions(symbol: string) {
  return cached(`yf:options:${symbol}`, 300_000, async () => {
    const json = await sidecarGet(
      `/yfinance/options?symbol=${encodeURIComponent(symbol)}`,
    );
    return Array.isArray(json.data) ? json.data : [];
  });
}

export async function getYahooOptionChain(symbol: string, expiry?: string) {
  return cached(
    `yf:option-chain:${symbol}:${expiry ?? ""}`,
    300_000,
    async () => {
      const qs = new URLSearchParams({ symbol });
      if (expiry) qs.set("date", expiry);
      const json = await sidecarGet(`/yfinance/option_chain?${qs.toString()}`);
      return json ?? null;
    },
  );
}

export async function getYahooActions(symbol: string) {
  return cached(`yf:actions:${symbol}`, 300_000, async () => {
    const [dividends, splits, capitalGains] = await Promise.all([
      sidecarGet(`/yfinance/dividends?symbol=${encodeURIComponent(symbol)}`),
      sidecarGet(`/yfinance/splits?symbol=${encodeURIComponent(symbol)}`),
      sidecarGet(
        `/yfinance/capital_gains?symbol=${encodeURIComponent(symbol)}`,
      ),
    ]);
    return {
      dividends: dividends?.data ?? [],
      splits: splits?.data ?? [],
      capitalGains: capitalGains?.data ?? [],
    };
  });
}
