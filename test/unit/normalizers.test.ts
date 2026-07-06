import { describe, expect, it } from "vitest";
import {
  quoteToSnapshot,
  snapshotToQuote,
} from "../../src/agent/data/normalizers/quote-normalizer";
import {
  normalizeTdxMacSectorRankingRows,
  normalizeTdxEndpoint,
  normalizeTdxKlineRows,
} from "../../src/agent/data/normalizers/tdx-normalizer";
import {
  parseWindPayload,
  windKlineRows,
  windStockFundamentals,
  windStockQuoteSnapshots,
} from "../../src/agent/data/normalizers/wind-normalizer";
import {
  normalizeSectorRows,
  normalizeSectorStockRows,
} from "../../src/agent/data/eastmoney-fetcher";
import type { Quote } from "../../src/agent/data/data-manager";

describe("quote normalizer", () => {
  it("round-trips quote snapshots through the canonical shape", () => {
    const quote: Quote = {
      code: "600519",
      name: "贵州茅台",
      price: 1302.22,
      change: -23.7,
      changePct: -1.79,
      open: 1320,
      high: 1330,
      low: 1298,
      prevClose: 1325.92,
      volume: 2983762,
      amount: 3911995891,
      pe: 19.68,
      pb: 6.18,
      marketCap: 1.6e12,
      turnoverRate: 0.239,
    };

    const snapshot = quoteToSnapshot(
      quote,
      "eastmoney",
      "2026-06-01T04:00:00.000Z",
    );

    expect(snapshot.source).toBe("eastmoney");
    expect(snapshot.change_pct).toBe(-1.79);
    expect(snapshot.prev_close).toBe(1325.92);
    expect(snapshotToQuote(snapshot)).toEqual({
      ...quote,
      source: "eastmoney",
      timestamp: "2026-06-01T04:00:00.000Z",
      fetchedAt: null,
    });
  });
});

describe("EastMoney sector normalizers", () => {
  it("normalizes sector board rows and filters invalid board entries", () => {
    const rows = normalizeSectorRows({
      data: {
        diff: [
          {
            f12: "BK0475",
            f14: "白酒",
            f3: 1.23,
            f8: 2.5,
            f104: 8,
            f105: 3,
            f140: "贵州茅台",
            f141: 0.8,
          },
          { f12: "", f14: "invalid" },
        ],
      },
    });

    expect(rows).toEqual([
      {
        code: "BK0475",
        name: "白酒",
        changePct: 1.23,
        turnoverRate: 2.5,
        upCount: 8,
        downCount: 3,
        leadingStock: "贵州茅台",
        leadingChangePct: 0.8,
      },
    ]);
  });

  it("normalizes direct sector constituents and tolerates empty/malformed responses", () => {
    expect(normalizeSectorStockRows({ data: null })).toEqual([]);
    expect(
      normalizeSectorStockRows({ data: { diff: [{ f14: "missing code" }] } }),
    ).toEqual([]);

    const rows = normalizeSectorStockRows({
      data: {
        diff: [
          {
            f12: "600519",
            f14: "贵州茅台",
            f2: 1281.91,
            f3: -1.94,
            f4: -25.31,
            f5: 5000,
            f6: 640000000,
            f8: 0.24,
            f9: 19.37,
            f15: 1304,
            f16: 1276,
            f17: 1304,
            f18: 1307.22,
            f20: 1600000000000,
          },
        ],
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: "600519",
      name: "贵州茅台",
      price: 1281.91,
      change: -25.31,
      changePct: -1.94,
      prevClose: 1307.22,
      pe: 19.37,
      turnoverRate: 0.24,
    });
  });
});

describe("wind normalizer", () => {
  it("normalizes Wind price indicator tables into quote snapshots", () => {
    const payload = parseWindPayload(
      JSON.stringify({
        data: {
          columns: [
            { name: "Wind代码" },
            { name: "证券简称" },
            { name: "最新成交价" },
            { name: "涨跌幅" },
            { name: "成交量" },
            { name: "成交额" },
            { name: "换手率" },
          ],
          rows: [
            [
              "600519.SH",
              "贵州茅台",
              "1302.22",
              "-1.79",
              "2983762",
              "3911995891",
              "0.239",
            ],
          ],
        },
        error: null,
      }),
    );

    expect(payload).not.toBeNull();
    const rows = windStockQuoteSnapshots(payload!, "600519.SH");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: "600519",
      source: "wind",
      name: "贵州茅台",
      price: 1302.22,
      change_pct: -1.79,
      volume: 2983762,
      amount: 3911995891,
      turnover_rate: 0.239,
    });
  });

  it("normalizes Wind market-server quote fields", () => {
    const payload = parseWindPayload(
      JSON.stringify({
        data: {
          columns: [
            "Wind代码",
            "证券简称",
            "最新价",
            "今日开盘价",
            "今日最高价",
            "今日最低价",
            "前收盘价",
            "成交量",
            "成交额",
            "市盈率(TTM)",
            "市净率",
            "总市值1",
          ],
          rows: [
            [
              "000300.SH",
              "沪深300",
              4100.5,
              4080,
              4112,
              4070,
              4090,
              123456,
              654321000,
              12.3,
              1.5,
              36000000000000,
            ],
          ],
        },
      }),
    );

    expect(payload).not.toBeNull();
    const rows = windStockQuoteSnapshots(payload!, "000300.SH");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: "000300",
      name: "沪深300",
      price: 4100.5,
      open: 4080,
      high: 4112,
      low: 4070,
      prev_close: 4090,
      pe: 12.3,
      pb: 1.5,
      market_cap: 36000000000000,
    });
  });

  it("normalizes nested Wind fundamentals tables", () => {
    const payload = parseWindPayload(
      JSON.stringify({
        data: {
          data: [
            {
              columns: [
                { name: "Wind代码" },
                { name: "最新市净率PB" },
                { name: "最新净资产收益率ROE" },
                { name: "最新市盈率PE" },
                { name: "交易时间" },
              ],
              rows: [
                ["600519.SH", 6.1876, 10.5687, 19.6806, "20260601 11:29:59"],
              ],
            },
          ],
        },
        error: null,
      }),
    );

    expect(payload).not.toBeNull();
    const rows = windStockFundamentals(payload!);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: "600519",
      report_date: "2026-06-01",
      pe_ttm: 19.6806,
      pb: 6.1876,
      roe: 10.5687,
      source: "wind",
    });
  });

  it("normalizes Wind daily K-line tables", () => {
    const payload = parseWindPayload(
      JSON.stringify({
        data: {
          columns: [
            "Wind代码",
            "交易日期",
            "开盘价",
            "最高价",
            "最低价",
            "收盘价",
            "成交量",
            "成交额",
            "涨跌幅",
            "换手率",
          ],
          rows: [
            [
              "600519.SH",
              "20260603",
              1280,
              1290,
              1270,
              1281.91,
              12300,
              4567000,
              -1.94,
              0.24,
            ],
          ],
        },
      }),
    );

    expect(payload).not.toBeNull();
    const rows = windKlineRows(payload!, "600519.SH", "qfq");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: "600519",
      date: "2026-06-03",
      open: 1280,
      high: 1290,
      low: 1270,
      close: 1281.91,
      volume: 12300,
      amount: 4567000,
      change_pct: -1.94,
      turnover_rate: 0.24,
      adjust: "qfq",
      source: "wind",
    });
  });

  it("normalizes Wind fund/index daily K-line tables", () => {
    const payload = parseWindPayload(
      JSON.stringify({
        data: {
          columns: [
            "Wind代码",
            "日期",
            "开盘价",
            "最高价",
            "最低价",
            "收盘价",
            "成交量",
            "成交额",
          ],
          rows: [
            [
              "510300.SH",
              "2026-06-03",
              4.08,
              4.11,
              4.07,
              4.1,
              12345600,
              505000000,
            ],
          ],
        },
      }),
    );

    expect(payload).not.toBeNull();
    const rows = windKlineRows(payload!, "510300.SH", "qfq");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: "510300",
      date: "2026-06-03",
      close: 4.1,
      amount: 505000000,
      adjust: "qfq",
      source: "wind",
    });
  });
});

describe("tdx normalizer", () => {
  it("keeps gotdx K-line prices in yuan instead of dividing again", () => {
    const rows = normalizeTdxKlineRows(
      {
        List: [
          {
            DateTime: "2026-05-07 15:00:00",
            Open: 1375,
            High: 1388,
            Low: 1370.01,
            Close: 1371.05,
            Vol: 40461,
            Amount: 5573286400,
          },
        ],
      },
      { code: "600519" },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      code: "600519",
      date: "2026-05-07",
      open: 1375,
      high: 1388,
      low: 1370.01,
      close: 1371.05,
      source: "tdx",
    });
  });

  it("normalizes TDX MAC bars into canonical stock K-line rows", () => {
    const normalized = normalizeTdxEndpoint(
      "mac/bars",
      {
        List: [
          {
            DateTime: "2026-06-04 15:00:00",
            Open: 1280,
            High: 1290,
            Low: 1276,
            Close: 1288,
            Amount: 154800000,
            Vol: 120000,
            Turnover: 0.3,
          },
        ],
      },
      { code: "600519" },
    ) as any;

    expect(normalized.normalized).toBe(true);
    expect(normalized.source).toBe("tdx:mac");
    expect(normalized.schema).toBe("kline_daily");
    expect(normalized.data).toHaveLength(1);
    expect(normalized.data[0]).toMatchObject({
      code: "600519",
      date: "2026-06-04",
      open: 1280,
      high: 1290,
      low: 1276,
      close: 1288,
      volume: 120000,
      amount: 154800000,
      source: "tdx:mac",
    });
  });

  it("normalizes TDX MAC board rows into canonical sector ranking rows", () => {
    const rows = normalizeTdxMacSectorRankingRows(
      {
        List: [
          {
            Code: "BK0475",
            Name: "白酒",
            Price: 101.5,
            PreClose: 100,
            RiseSpeed: 1.4,
            SymbolName: "贵州茅台",
            SymbolRiseSpeed: 2.2,
          },
        ],
      },
      { sectorType: "industry" },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sector_type: "industry",
      code: "BK0475",
      name: "白酒",
      change_pct: 1.5,
      leading_stock: "贵州茅台",
      leading_pct: 2.2,
      rank: 1,
      source: "tdx:mac",
    });
  });

  it("rejects corrupt gotdx index bars before they reach DataStore or agents", () => {
    const normalized = normalizeTdxEndpoint(
      "index_bars",
      {
        List: [
          {
            DateTime: "2026-06-01 15:00:00",
            Open: 15601.03,
            Close: 15340.36,
            High: 15717.45,
            Low: 15316.02,
          },
          {
            DateTime: "5738-12-13 15:00:00",
            Open: -2.49,
            Close: 0.053,
            High: 0.001,
            Low: 15410.7,
          },
        ],
      },
      { code: "399001" },
    ) as any;

    expect(normalized.normalized).toBe(true);
    expect(normalized.data).toHaveLength(1);
    expect(normalized.data[0].close).toBe(15340.36);
  });

  it("rejects TDX quote rows that do not match the requested code", () => {
    const normalized = normalizeTdxEndpoint(
      "quote",
      {
        List: [
          {
            Code: "600519",
            Name: "贵州茅台",
            Price: 1281.91,
            LastClose: 1279.22,
            Open: 1280,
            High: 1288,
            Low: 1272,
          },
        ],
      },
      { code: "600036" },
    ) as any;

    expect(normalized.normalized).toBe(true);
    expect(normalized.schema).toBe("quote_snapshot");
    expect(normalized.data).toEqual([]);
    expect(normalized.warning).toContain("600036");
  });

  it("normalizes the TDX Shanghai index alias to the public index code", () => {
    const normalized = normalizeTdxEndpoint(
      "index_info",
      {
        Code: "999999",
        Name: "上证指数",
        Close: 4083.97,
        PreClose: 4075,
        Open: 4078,
        High: 4090,
        Low: 4060,
      },
      { code: "000001" },
    ) as any;

    expect(normalized.data).toHaveLength(1);
    expect(normalized.data[0]).toMatchObject({
      code: "000001",
      price: 4083.97,
      name: "上证指数",
    });
  });
});
