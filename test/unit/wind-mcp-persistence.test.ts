import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { WindMcpTool } from "../../src/agent/tools/wind-mcp";
import { DataStore } from "../../src/agent/data/store/data-store";
import { closeDb } from "../../src/agent/data/store/db";
import { DataStoreTool } from "../../src/agent/tools/data-store-tool";
import type { ToolContext } from "../../src/agent/tool";

function makeBasePath(): string {
  const base = mkdtempSync(join(tmpdir(), "fin-wind-tool-"));
  cpSync(
    join(process.cwd(), "assets", "migrations"),
    join(base, "data", "migrations"),
    { recursive: true },
  );
  return base;
}

function makeCtx(basePath: string): ToolContext {
  return {
    basePath,
    workDir: process.cwd(),
    memoryDir: join(basePath, "memory"),
    bundleDir: join(basePath, "bundle"),
    projectLocalDir: join(basePath, ".finagent-workstation"),
    pluginSkillPaths: [],
    skipPermissions: true,
    approvedTools: new Set(),
    planMode: false,
    readFileTimestamps: new Map(),
    taskRegistry: {} as ToolContext["taskRegistry"],
    teamRegistry: {} as ToolContext["teamRegistry"],
    getConfigValue: (key: string) => (key === "WIND_API_KEY" ? "test-key" : undefined),
  };
}

describe("WindMcp known-schema persistence", () => {
  let basePath = "";
  let store: DataStore;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-05T10:00:00.000Z"));
    basePath = makeBasePath();
    store = new DataStore(basePath);
    await store.init();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        if (body.method === "initialize") {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                result: { protocolVersion: "2025-03-26" },
              }),
          } as Response;
        }
        const tool = (body.params as Record<string, unknown>).name;
        let text = "{}";
        if (tool === "get_index_price_indicators") {
          text =
            '{"data":{"columns":["Wind代码","证券简称","最新价","今日开盘价","今日最高价","今日最低价","前收盘价","成交量","成交额"],"rows":[["000300.SH","沪深300",4100.5,4080,4112,4070,4090,123456,654321000]]}}';
        } else if (tool === "get_index_kline") {
          text =
            '{"data":{"columns":["Wind代码","交易日期","开盘价","最高价","最低价","收盘价","成交量","成交额","涨跌幅"],"rows":[["000300.SH","20260604",4080,4112,4070,4100.5,123456,654321000,1.2]]}}';
        } else if (tool === "get_global_stock_fundamentals") {
          text =
            '{"data":{"columns":["Wind代码","交易时间","最新市盈率PE_TTM","最新市净率PB_LF","最新净资产收益率ROE","总市值","营业收入","买入"],"rows":[["AAPL.O","20260603",28.5,12.4,18.2,3100000000000,390000000000,12]]}}';
        } else if (tool === "get_global_stock_equity_holders") {
          text =
            '{"data":{"columns":["Wind代码","报告期","股东名称","股东类型","持股数","持股比例","持仓市值"],"rows":[["AAPL.O","20260331","Vanguard Group","institution",1300000000,8.1,250000000000]]}}';
        } else if (tool === "get_stock_equity_holders") {
          text =
            '{"data":{"columns":["Wind代码","报告期","股东名称","股东类型","持股数","持股比例","股本性质"],"rows":[["600519.SH","20260331","中国贵州茅台酒厂集团有限责任公司","控股股东",678000000,54.0,"流通A股"]]}}';
        } else if (tool === "get_global_stock_basicinfo") {
          text =
            '{"data":{"columns":["Wind代码","证券简称","公司名称","交易所","行业"],"rows":[["AAPL.O","Apple","Apple Inc.","NASDAQ","Technology"]]}}';
        } else if (tool === "get_fund_info") {
          text =
            '{"data":{"columns":["Wind代码","基金名称","基金公司","基金经理"],"rows":[["110011.OF","易方达中小盘","易方达基金","张坤"]]}}';
        } else if (tool === "get_fund_financials") {
          text =
            '{"data":{"columns":["Wind代码","报告期","营业收入","净利润","总资产"],"rows":[["110011.OF","20251231",123000000,45600000,789000000]]}}';
        } else if (tool === "get_fund_company_info") {
          text =
            '{"data":{"columns":["Wind代码","基金名称","基金公司","管理人类型"],"rows":[["110011.OF","易方达中小盘","易方达基金","公募基金管理人"]]}}';
        } else if (tool === "get_fund_holders") {
          text =
            '{"data":{"columns":["Wind代码","报告期","持有人名称","持有比例"],"rows":[["110011.OF","20251231","机构投资者",66.6]]}}';
        } else if (tool === "get_fund_holdings") {
          text =
            '{"data":{"columns":["基金代码","报告期","股票代码","股票名称","持股数","持仓市值","占净值比例","排名"],"rows":[["110011.OF","20260331","600519.SH","贵州茅台",1200,1800000,8.5,1]]}}';
        } else if (tool === "get_fund_performance") {
          text =
            '{"data":{"columns":["基金代码","净值日期","单位净值","今年以来","近1周","近1月","近3月","近6月","近1年","近3年","成立以来"],"rows":[["110011.OF","20260604",1.234,4.5,1.1,2.2,3.3,6.6,12.3,35.5,88.8]]}}';
        } else if (tool === "search_stocks") {
          text =
            '{"data":{"columns":["Wind代码","证券简称","市场","排名","评分","市值"],"rows":[["600519.SH","贵州茅台","SH",1,98.5,1800000000000],["000001.SZ","平安银行","SZ",2,91.2,220000000000]]}}';
        } else if (tool === "search_funds") {
          text =
            '{"data":{"columns":["基金代码","基金名称","市场","排名","近1年收益率"],"rows":[["110011.OF","易方达中小盘","OF",1,18.6],["588200.SH","科创芯片ETF","SH",2,16.1]]}}';
        } else if (tool === "get_stock_technicals") {
          text =
            '{"data":{"columns":["Wind代码","交易时间","当日主力净流入额","超大单净流入额(万元)","大单净流入额(万元)","中单净流入额(万元)","小单净流入额(万元)","收盘价","涨跌幅"],"rows":[["600519.SH","20260604",1200,700,500,-100,-200,1410.5,1.2]]}}';
        } else if (tool === "get_stock_events") {
          text =
            '{"data":{"columns":["Wind代码","事件日期","事件类型","每10股派息","每10股送股","每10股转增"],"rows":[["600519.SH","20260612","年度分红派息",25.9,0,0],["600519.SH","20260613","重大资产重组",null,null,null]]}}';
        } else if (tool === "get_global_stock_events") {
          text =
            '{"data":{"columns":["Wind代码","事件日期","事件类型","每股派息","拆股比例"],"rows":[["AAPL.O","20260515","Quarterly dividend",0.26,null],["AAPL.O","20260516","Product launch",null,null]]}}';
        } else if (tool === "get_index_technicals") {
          text =
            '{"data":{"columns":["Wind代码","交易时间","涨跌幅","6周期相对强弱指标","指数平滑异同移动平均"],"rows":[["000300.SH","20260604",1.2,62.5,0.8]]}}';
        } else if (tool === "get_bond_basicinfo") {
          text =
            '{"data":{"columns":["Wind代码","债券简称","发行日期","票面利率"],"rows":[["2400001.IB","国债2601","20260101",2.35]]}}';
        } else if (tool === "get_bond_financial_data") {
          text =
            '{"data":{"columns":["Wind代码","报告期","营业收入","净利润","总资产","总负债","资产负债率"],"rows":[["2400001.IB","20251231",1234000000,456000000,9800000000,3200000000,32.65]]}}';
        } else if (tool === "get_company_announcements") {
          text =
            '{"data":{"columns":["Wind代码","证券简称","标题","发布日期","链接","摘要"],"rows":[["600519.SH","贵州茅台","2025年年度报告","20260315","https://example.com/600519-ar","年度报告摘要"]]}}';
        } else if (tool === "get_financial_news") {
          text =
            '{"data":{"columns":["Wind代码","标题","媒体","发布时间","链接","摘要"],"rows":[["AAPL.O","美联储维持利率不变","Wind资讯","2026-06-04 08:00:00","https://example.com/fed","政策观察"]]}}';
        } else if (tool === "get_economic_data") {
          text =
            '{"data":{"columns":["指标名称","日期","值","单位","频率"],"rows":[["中国CPI同比","20260501",0.7,"%","月"]]}}';
        } else if (tool === "get_financial_data") {
          text =
            '{"data":{"columns":["Wind代码","证券简称","日期","收盘价","涨跌幅"],"rows":[["RB.SHF","螺纹钢主力","20260604",3150,1.2]]}}';
        }
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                content: [{ type: "text", text }],
              },
            }),
        } as Response;
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    closeDb();
    if (basePath) rmSync(basePath, { recursive: true, force: true });
  });

  it("persists quote, broader fundamentals, and company info rows", async () => {
    const tool = new WindMcpTool((key) => (key === "WIND_API_KEY" ? "test-key" : undefined));
    const ctx = makeCtx(basePath);

    await tool.call("quote", {
      action: "call",
      server: "index_data",
      tool: "get_index_price_indicators",
      arguments: { windcode: "000300.SH", indexes: "证券简称,最新价" },
    }, ctx);

    await tool.call("index-kline", {
      action: "call",
      server: "index_data",
      tool: "get_index_kline",
      arguments: { windcode: "000300.SH", begin_date: "20260101", end_date: "20260604" },
    }, ctx);

    await tool.call("fundamental", {
      action: "call",
      server: "global_stock_data",
      tool: "get_global_stock_fundamentals",
      arguments: { windcode: "AAPL.O" },
    }, ctx);

    await tool.call("global-holders", {
      action: "call",
      server: "global_stock_data",
      tool: "get_global_stock_equity_holders",
      arguments: { windcode: "AAPL.O" },
    }, ctx);

    await tool.call("stock-holders", {
      action: "call",
      server: "stock_data",
      tool: "get_stock_equity_holders",
      arguments: { windcode: "600519.SH" },
    }, ctx);

    await tool.call("global-profile", {
      action: "call",
      server: "global_stock_data",
      tool: "get_global_stock_basicinfo",
      arguments: { windcode: "AAPL.O" },
    }, ctx);

    await tool.call("info", {
      action: "call",
      server: "fund_data",
      tool: "get_fund_info",
      arguments: { windcode: "110011.OF" },
    }, ctx);

    await tool.call("fund-financials", {
      action: "call",
      server: "fund_data",
      tool: "get_fund_financials",
      arguments: { windcode: "110011.OF" },
    }, ctx);

    await tool.call("fund-company-info", {
      action: "call",
      server: "fund_data",
      tool: "get_fund_company_info",
      arguments: { windcode: "110011.OF" },
    }, ctx);

    await tool.call("fund-holders", {
      action: "call",
      server: "fund_data",
      tool: "get_fund_holders",
      arguments: { windcode: "110011.OF" },
    }, ctx);

    await tool.call("fund-holdings", {
      action: "call",
      server: "fund_data",
      tool: "get_fund_holdings",
      arguments: { windcode: "110011.OF" },
    }, ctx);

    await tool.call("fund-performance", {
      action: "call",
      server: "fund_data",
      tool: "get_fund_performance",
      arguments: { windcode: "110011.OF" },
    }, ctx);

    await tool.call("stock-screen", {
      action: "call",
      server: "stock_data",
      tool: "search_stocks",
      arguments: { question: "筛选沪深市场大市值高评分股票" },
    }, ctx);

    await tool.call("fund-screen", {
      action: "call",
      server: "fund_data",
      tool: "search_funds",
      arguments: { question: "筛选近一年收益较高的基金" },
    }, ctx);

    await tool.call("money-flow", {
      action: "call",
      server: "stock_data",
      tool: "get_stock_technicals",
      arguments: { windcode: "600519.SH", indexes: "资金流向" },
    }, ctx);

    await tool.call("xdxr", {
      action: "call",
      server: "stock_data",
      tool: "get_stock_events",
      arguments: { windcode: "600519.SH", indexes: "分红" },
    }, ctx);

    await tool.call("global-actions", {
      action: "call",
      server: "global_stock_data",
      tool: "get_global_stock_events",
      arguments: { windcode: "AAPL.O", indexes: "dividend" },
    }, ctx);

    await tool.call("index-momentum", {
      action: "call",
      server: "index_data",
      tool: "get_index_technicals",
      arguments: { windcode: "000300.SH", indexes: "RSI,MACD" },
    }, ctx);

    await tool.call("bond-info", {
      action: "call",
      server: "bond_data",
      tool: "get_bond_basicinfo",
      arguments: { question: "国债2601基本信息" },
    }, ctx);

    await tool.call("bond-financial", {
      action: "call",
      server: "bond_data",
      tool: "get_bond_financial_data",
      arguments: { question: "国债2601主体2024年营收" },
    }, ctx);

    await tool.call("announcements", {
      action: "call",
      server: "financial_docs",
      tool: "get_company_announcements",
      arguments: { query: "贵州茅台2025年年报", top_k: 1 },
    }, ctx);

    await tool.call("global-news", {
      action: "call",
      server: "financial_docs",
      tool: "get_financial_news",
      arguments: { query: "AAPL macro policy news", windcode: "AAPL.O", top_k: 1 },
    }, ctx);

    await tool.call("macro", {
      action: "call",
      server: "economic_data",
      tool: "get_economic_data",
      arguments: { metricIdsStr: "中国CPI同比", freq: "月" },
    }, ctx);

    await tool.call("analytics", {
      action: "call",
      server: "analytics_data",
      tool: "get_financial_data",
      arguments: { question: "查询螺纹钢主力最近一天收盘价和涨跌幅" },
    }, ctx);

    expect(store.getRecentQuoteSnapshot("000300", 60_000)).toMatchObject({
      code: "000300",
      source: "wind",
      price: 4100.5,
    });

    expect(store.queryKline("000300", { start: "2026-06-04", end: "2026-06-04" })).toEqual([
      expect.objectContaining({
        code: "000300",
        date: "2026-06-04",
        open: 4080,
        high: 4112,
        low: 4070,
        close: 4100.5,
        volume: 123456,
        amount: 654321000,
        change_pct: 1.2,
        adjust: "qfq",
        source: "wind",
      }),
    ]);

    expect(
      store.queryStockList({ market: "SH", type: "index" }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "000300",
          name: "沪深300",
          market: "SH",
          stock_type: "index",
        }),
      ]),
    );

    expect(
      store.queryStockList({ market: "OF", type: "fund" }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "110011",
          name: "易方达中小盘",
          market: "OF",
          stock_type: "fund",
        }),
      ]),
    );

    expect(store.queryFundManagers({ company: "易方达基金", name: "张坤" })).toEqual([
      expect.objectContaining({
        manager_id: "wind_张坤_易方达基金_110011",
        name: "张坤",
        company: "易方达基金",
        source: "wind",
        capability_id: "wind.fund.manager",
        source_action: "get_fund_info",
      }),
    ]);

    expect(
      store.queryStockList({ market: "IB", type: "bond" }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "2400001",
          name: "国债2601",
          market: "IB",
          stock_type: "bond",
        }),
      ]),
    );

    expect(store.queryFundHolding({ fundCode: "110011" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fund_code: "110011",
          report_date: "2026-03-31",
          stock_code: "600519",
          stock_name: "贵州茅台",
          hold_shares: 1200,
          hold_value: 1800000,
          hold_pct: 8.5,
          rank: 1,
          source: "wind",
        }),
      ]),
    );

    expect(
      store.queryFundPerformanceMetrics({ code: "110011", provider: "wind" }),
    ).toEqual([
      expect.objectContaining({
        code: "110011",
        metric_date: "2026-06-04",
        provider: "wind",
        capability_id: "wind.fund.performance_metrics",
        source_action: "get_fund_performance",
        nav: 1.234,
        return_ytd: 4.5,
        return_1w: 1.1,
        return_1m: 2.2,
        return_3m: 3.3,
        return_6m: 6.6,
        return_1y: 12.3,
        return_3y: 35.5,
        return_since_inception: 88.8,
      }),
    ]);

    expect(store.queryMarketScreeningSnapshots({ provider: "wind", sourceAction: "search_stocks" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "wind",
          capability_id: "wind.market.screening",
          source_action: "search_stocks",
          symbol: "600519",
          name: "贵州茅台",
          market: "SH",
          rank: 1,
          score: 98.5,
        }),
      ]),
    );

    expect(store.queryMarketScreeningSnapshots({ provider: "wind", sourceAction: "search_funds" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "wind",
          capability_id: "wind.market.screening",
          source_action: "search_funds",
          symbol: "110011",
          name: "易方达中小盘",
          market: "OF",
          rank: 1,
        }),
      ]),
    );

    expect(store.queryMoneyFlow("600519", 5)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "600519",
          date: "2026-06-04",
          main_net: 1200,
          super_large_net: 700,
          large_net: 500,
          medium_net: -100,
          small_net: -200,
          source: "wind",
        }),
      ]),
    );

    expect(
      store.queryTechnicalIndicatorSeries({
        symbol: "600519",
        indicator: "wind_stock_technicals",
        fieldName: "当日主力净流入额",
      }),
    ).toEqual([
      expect.objectContaining({
        provider: "wind",
        capability_id: "wind.technical.indicator_series",
        source_action: "get_stock_technicals",
        symbol: "600519",
        indicator: "wind_stock_technicals",
        field_name: "当日主力净流入额",
        source_date: "2026-06-04",
        value: 1200,
      }),
    ]);

    expect(store.queryXdxrEvents("600519", 5)).toEqual([
      expect.objectContaining({
        code: "600519",
        event_date: "2026-06-12",
        category: 1,
        category_name: "年度分红派息",
        a: 25.9,
        b: 0,
        c: 0,
        source: "wind",
      }),
    ]);

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_corporate_actions WHERE symbol = ?",
        "AAPL",
      ),
    ).toEqual([
      expect.objectContaining({
        symbol: "AAPL",
        action_type: "dividend",
        action_date: "2026-05-15",
        value: 0.26,
        source: "wind",
      }),
    ]);

    expect(store.queryIndexMomentum("000300", "2026-06-04", 10)).toEqual([
      expect.objectContaining({
        code: "000300",
        trade_date: "2026-06-04",
        sequence: 0,
        value: 1.2,
        source: "wind",
      }),
      expect.objectContaining({
        code: "000300",
        trade_date: "2026-06-04",
        sequence: 1,
        value: 62.5,
        source: "wind",
      }),
      expect.objectContaining({
        code: "000300",
        trade_date: "2026-06-04",
        sequence: 2,
        value: 0.8,
        source: "wind",
      }),
    ]);

    expect(
      store.queryTechnicalIndicatorSeries({
        symbol: "000300",
        indicator: "wind_index_technicals",
        fieldName: "6周期相对强弱指标",
      }),
    ).toEqual([
      expect.objectContaining({
        provider: "wind",
        capability_id: "wind.technical.indicator_series",
        source_action: "get_index_technicals",
        symbol: "000300",
        indicator: "wind_index_technicals",
        field_name: "6周期相对强弱指标",
        source_date: "2026-06-04",
        value: 62.5,
      }),
    ]);

    expect(store.queryFundamental("AAPL", 5)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "AAPL",
          source: "wind",
          pe_ttm: 28.5,
          roe: 18.2,
        }),
      ]),
    );

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_statement_items WHERE symbol = ? ORDER BY item",
        "AAPL",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: "AAPL",
          statement_type: "wind_global_fundamentals",
          period: "2026-06-03",
          item: "营业收入",
          value: 390000000000,
          source: "wind",
        }),
      ]),
    );

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_recommendations WHERE symbol = ?",
        "AAPL",
      ),
    ).toEqual([
      expect.objectContaining({
        symbol: "AAPL",
        period: "2026-06-03",
        buy: 12,
        source: "wind",
      }),
    ]);

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_profile_fields WHERE symbol = ? ORDER BY field_key",
        "AAPL",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: "AAPL",
          field_key: "公司名称",
          field_value: "Apple Inc.",
          source: "wind",
        }),
      ]),
    );

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_holders WHERE symbol = ?",
        "AAPL",
      ),
    ).toEqual([
      expect.objectContaining({
        symbol: "AAPL",
        holder_type: "institution",
        holder_name: "Vanguard Group",
        reported_date: "2026-03-31",
        pct_held: 8.1,
        shares: 1300000000,
        value: 250000000000,
        source: "wind",
      }),
    ]);

    expect(store.queryStockShareholders({ code: "600519", source: "wind" })).toEqual([
      expect.objectContaining({
        code: "600519",
        report_date: "2026-03-31",
        holder_name: "中国贵州茅台酒厂集团有限责任公司",
        holder_type: "控股股东",
        hold_pct: 54,
        source: "wind",
      }),
    ]);

    expect(store.queryFundamental("2400001", 5)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "2400001",
          source: "wind",
          revenue: 1234000000,
          net_profit: 456000000,
          total_assets: 9800000000,
          debt_ratio: 32.65,
        }),
      ]),
    );

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM stock_company_info WHERE code = ? AND info_type = ?",
        "110011",
        "get_fund_info",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "110011",
          info_type: "get_fund_info",
          source: "wind",
          title: "易方达中小盘",
        }),
      ]),
    );

    expect(store.queryFundamental("110011", 5)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "110011",
          source: "wind",
          revenue: 123000000,
          net_profit: 45600000,
          total_assets: 789000000,
        }),
      ]),
    );

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM stock_company_info WHERE code = ? AND info_type = ?",
        "110011",
        "get_fund_company_info",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "110011",
          info_type: "get_fund_company_info",
          source: "wind",
          title: "易方达中小盘",
        }),
      ]),
    );

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM stock_company_info WHERE code = ? AND info_type = ?",
        "110011",
        "get_fund_holders",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "110011",
          info_type: "get_fund_holders",
          source: "wind",
        }),
      ]),
    );

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM stock_company_info WHERE code = ? AND info_type = ?",
        "2400001",
        "get_bond_basicinfo",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "2400001",
          info_type: "get_bond_basicinfo",
          source: "wind",
          title: "国债2601",
        }),
      ]),
    );

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM wind_document WHERE tool = ?",
        "get_company_announcements",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_code: "600519",
          title: "2025年年度报告",
          source: "wind",
        }),
      ]),
    );

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM yfinance_news WHERE symbol = ?",
        "AAPL",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: "AAPL",
          title: "美联储维持利率不变",
          publisher: "Wind资讯",
          source: "wind",
        }),
      ]),
    );

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM finance_news WHERE source = ?",
        "wind",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "美联储维持利率不变",
          publisher: "Wind资讯",
          source: "wind",
        }),
      ]),
    );

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM wind_economic_series WHERE metric_query = ?",
        "中国CPI同比",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric_name: "中国CPI同比",
          value_num: 0.7,
          source: "wind",
        }),
      ]),
    );

    expect(
      store.query<Record<string, unknown>>(
        "SELECT * FROM wind_analytics_result WHERE question = ?",
        "查询螺纹钢主力最近一天收盘价和涨跌幅",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_name: "螺纹钢主力",
          value_num: 3150,
          source: "wind",
        }),
      ]),
    );

    const queryTool = new DataStoreTool();
    queryTool.setDataStore(store);

    await expect(
      queryTool.call(
        "wind-docs",
        { action: "query_wind_document", tool: "get_company_announcements", code: "600519" },
        ctx,
      ),
    ).resolves.toContain("2025年年度报告");

    await expect(
      queryTool.call(
        "wind-econ",
        { action: "query_wind_economic", metricQuery: "中国CPI同比" },
        ctx,
      ),
    ).resolves.toContain("中国CPI同比");

    await expect(
      queryTool.call(
        "wind-analytics",
        { action: "query_wind_analytics", question: "查询螺纹钢主力最近一天收盘价和涨跌幅" },
        ctx,
      ),
    ).resolves.toContain("螺纹钢主力");

    await expect(
      queryTool.call(
        "finance-news",
        { action: "query_finance_news", keyword: "美联储" },
        ctx,
      ),
    ).resolves.toContain("美联储维持利率不变");
    await expect(
      queryTool.call(
        "finance-news-evidence",
        { action: "query_finance_news", keyword: "美联储" },
        ctx,
      ),
    ).resolves.toContain("kind\":\"news_analysis");

    await expect(
      queryTool.call(
        "fund-holding",
        { action: "query_fund_holding", fundCode: "110011" },
        ctx,
      ),
    ).resolves.toContain("贵州茅台");

    await expect(
      queryTool.call(
        "fund-performance",
        { action: "query_fund_performance", code: "110011", provider: "wind" },
        ctx,
      ),
    ).resolves.toContain("110011 [wind]");

    await expect(
      queryTool.call(
        "fund-manager",
        { action: "query_fund_manager", company: "易方达基金", manager: "张坤" },
        ctx,
      ),
    ).resolves.toContain("张坤");

    await expect(
      queryTool.call(
        "money-flow",
        { action: "query_money_flow", code: "600519" },
        ctx,
      ),
    ).resolves.toContain("2026-06-04");

    await expect(
      queryTool.call(
        "wind-stock-technical",
        {
          action: "query_technical_indicator",
          symbol: "600519",
          indicator: "wind_stock_technicals",
          fieldName: "当日主力净流入额",
        },
        ctx,
      ),
    ).resolves.toContain("当日主力净流入额");

    await expect(
      queryTool.call(
        "xdxr",
        { action: "query_xdxr", code: "600519" },
        ctx,
      ),
    ).resolves.toContain("年度分红派息");

    await expect(
      queryTool.call(
        "global-actions",
        { action: "query_yfinance", symbol: "AAPL", dataset: "actions" },
        ctx,
      ),
    ).resolves.toContain("2026-05-15");

    await expect(
      queryTool.call(
        "global-statements",
        { action: "query_yfinance", symbol: "AAPL", dataset: "statements" },
        ctx,
      ),
    ).resolves.toContain("营业收入");

    await expect(
      queryTool.call(
        "global-profile",
        { action: "query_yfinance", symbol: "AAPL", dataset: "profile" },
        ctx,
      ),
    ).resolves.toContain("Apple Inc.");

    await expect(
      queryTool.call(
        "global-holders",
        { action: "query_yfinance", symbol: "AAPL", dataset: "holders" },
        ctx,
      ),
    ).resolves.toContain("Vanguard Group");

    await expect(
      queryTool.call(
        "stock-holders",
        { action: "query_stock_shareholders", code: "600519", source: "wind" },
        ctx,
      ),
    ).resolves.toContain("中国贵州茅台酒厂集团有限责任公司");

    await expect(
      queryTool.call(
        "global-news",
        { action: "query_yfinance", symbol: "AAPL", dataset: "news" },
        ctx,
      ),
    ).resolves.toContain("美联储维持利率不变");

    await expect(
      queryTool.call(
        "index-momentum",
        { action: "query_momentum", code: "000300" },
        ctx,
      ),
    ).resolves.toContain("000300 index momentum");
  });

  it("normalizes common code aliases to Wind windcode before calling the provider", async () => {
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        if (body.method === "initialize") {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26" } }),
          } as Response;
        }
        const params = body.params as Record<string, unknown>;
        calls.push(params.arguments as Record<string, unknown>);
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              result: {
                content: [{ type: "text", text: '{"data":{"columns":["Wind代码","证券简称","最新价"],"rows":[["000300.SH","沪深300",4100.5]]}}' }],
              },
            }),
        } as Response;
      }),
    );

    const tool = new WindMcpTool((key) => (key === "WIND_API_KEY" ? "test-key" : undefined));
    const ctx = makeCtx(basePath);

    await tool.call("quote-alias", {
      action: "call",
      server: "index_data",
      tool: "get_index_price_indicators",
      arguments: { codes: ["000300.SH", "000905.SH"], indexes: "证券简称,最新价" },
    }, ctx);

    expect(calls[0]).toMatchObject({
      windcode: "000300.SH,000905.SH",
      indexes: "证券简称,最新价",
    });
  });
});
