import { createHash } from "crypto";
import type { TechnicalIndicatorSeriesRow } from "../store/data-store-types";
import type { FundamentalFact, IndexMomentum, KlineBar, MoneyFlow, QuoteSnapshot, XdxrEvent } from "./types";

export function parseWindPayload(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function windScreeningRows(
  payload: Record<string, unknown>,
  market: string,
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const table of extractWindTables(payload)) {
    table.rows.forEach((row, index) => {
      const obj = rowToObject(table.columns, row);
      const code = normalizeWindCode(
        stringField(obj, [
          "Wind代码",
          "windcode",
          "证券代码",
          "股票代码",
          "基金代码",
          "基金Wind代码",
          "代码",
          "code",
        ]),
      );
      if (!code) return;
      rows.push({
        symbol: code,
        name: stringField(obj, [
          "证券简称",
          "中文简称",
          "名称",
          "股票名称",
          "基金名称",
          "简称",
          "name",
        ]),
        market:
          stringField(obj, ["市场", "交易所", "market", "exchange"]) ||
          windMarketFromRawCode(String(obj["Wind代码"] ?? obj.windcode ?? obj["代码"] ?? "")) ||
          market,
        rank: numberField(obj, ["排名", "序号", "rank", "position"]) ?? index + 1,
        score: numberField(obj, ["评分", "得分", "score", "综合得分", "value"]),
        ...obj,
      });
    });
  }
  return rows;
}

export function windStockQuoteSnapshots(
  payload: Record<string, unknown>,
  fallbackCode: string,
): QuoteSnapshot[] {
  const table = extractWindTables(payload)[0];
  if (!table) return [];
  return table.rows
    .map((row) => {
      const obj = rowToObject(table.columns, row);
      const code = normalizeWindCode(
        stringField(obj, ["Wind代码", "windcode", "code"]) || fallbackCode,
      );
      return {
        code,
        source: "wind",
        name: stringField(obj, ["证券简称", "中文简称", "名称", "name"]),
        price: numberField(obj, ["最新成交价", "最新价", "收盘价"]),
        change: numberField(obj, ["涨跌", "涨跌额"]),
        change_pct: numberField(obj, ["涨跌幅"]),
        open: numberField(obj, ["今日开盘价", "开盘价"]),
        high: numberField(obj, ["今日最高价", "最高价"]),
        low: numberField(obj, ["今日最低价", "最低价"]),
        prev_close: numberField(obj, ["前收盘价", "昨收盘"]),
        volume: numberField(obj, ["成交量"]),
        amount: numberField(obj, ["成交额"]),
        pe: numberField(obj, ["市盈率(TTM)", "最新市盈率PE", "市盈率"]),
        pb: numberField(obj, ["市净率", "最新市净率PB"]),
        market_cap: numberField(obj, ["总市值1", "总市值", "流通市值"]),
        turnover_rate: numberField(obj, ["换手率"]),
        raw_json: JSON.stringify(obj),
      };
    })
    .filter((r) => r.code.length > 0);
}

export function windStockFundamentals(
  payload: Record<string, unknown>,
): FundamentalFact[] {
  const now = new Date().toISOString();
  const result: FundamentalFact[] = [];
  for (const table of extractWindTables(payload)) {
    for (const row of table.rows) {
      const obj = rowToObject(table.columns, row);
      const code = normalizeWindCode(
        stringField(obj, ["Wind代码", "windcode", "code"]),
      );
      if (!code) continue;
      const reportDate = normalizeReportDate(
        stringField(obj, ["交易时间", "报告期", "report_date"]) ?? now,
      );
      result.push({
        code,
        report_date: reportDate,
        pe_ttm: numberField(obj, [
          "最新市盈率PE_TTM",
          "最新市盈率PE",
          "市盈率(TTM)",
          "市盈率",
        ]),
        pb: numberField(obj, ["最新市净率PB_LF", "最新市净率PB", "市净率"]),
        ps_ttm: numberField(obj, ["市销率(TTM)", "最新市销率PS"]),
        roe: numberField(obj, ["最新净资产收益率ROE", "最新ROE", "ROE"]),
        gross_margin: numberField(obj, ["销售毛利率", "毛利率", "gross_margin"]),
        net_margin: numberField(obj, ["销售净利率", "净利率", "net_margin"]),
        revenue: numberField(obj, ["营业总收入", "营业收入", "营收", "revenue"]),
        revenue_yoy: numberField(obj, ["营收同比增长率", "营业收入同比增长率"]),
        net_profit: numberField(obj, ["归母净利润", "净利润", "利润总额", "net_profit"]),
        profit_yoy: numberField(obj, [
          "净利润同比增长率",
          "归母净利润同比增长率",
        ]),
        total_assets: numberField(obj, ["总资产", "资产总计", "total_assets"]),
        total_liabilities: numberField(obj, ["总负债", "负债合计", "total_liabilities"]),
        debt_ratio: numberField(obj, ["资产负债率", "debt_ratio"]),
        market_cap: numberField(obj, ["总市值", "总市值1", "流通市值"]),
        source: "wind",
        updated_at: now,
      });
    }
  }
  return result;
}

export function windGlobalStatementRows(
  payload: Record<string, unknown>,
  fallbackCode: string,
): Array<Record<string, unknown>> {
  const updatedAt = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  for (const table of extractWindTables(payload)) {
    for (const row of table.rows) {
      const obj = rowToObject(table.columns, row);
      const symbol = normalizeWindCode(
        stringField(obj, ["Wind代码", "windcode", "证券代码", "code"]) ||
          fallbackCode,
      ).toUpperCase();
      const period = normalizeReportDate(
        stringField(obj, ["交易时间", "报告期", "日期", "时间", "date"]) ??
          updatedAt,
      );
      if (!symbol || !period) continue;
      for (const [field, value] of Object.entries(obj)) {
        if (isIdentityOrDateField(field)) continue;
        const n = Number(value);
        if (!Number.isFinite(n)) continue;
        rows.push({
          symbol,
          statement_type: "wind_global_fundamentals",
          period,
          item: field,
          value: n,
          source: "wind",
          updated_at: updatedAt,
          raw_json: JSON.stringify({ field, value, row: obj }),
        });
      }
    }
  }
  return rows;
}

export function windGlobalRecommendationRows(
  payload: Record<string, unknown>,
  fallbackCode: string,
): Array<Record<string, unknown>> {
  const updatedAt = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  for (const table of extractWindTables(payload)) {
    for (const row of table.rows) {
      const obj = rowToObject(table.columns, row);
      const symbol = normalizeWindCode(
        stringField(obj, ["Wind代码", "windcode", "证券代码", "code"]) ||
          fallbackCode,
      ).toUpperCase();
      const period =
        normalizeReportDate(
          stringField(obj, ["交易时间", "报告期", "日期", "时间", "date"]) ??
            updatedAt,
        ) || "0m";
      if (!symbol || !period) continue;
      const counts = windRecommendationCounts(obj);
      if (!counts) continue;
      rows.push({
        symbol,
        period,
        strong_buy: counts.strong_buy,
        buy: counts.buy,
        hold: counts.hold,
        sell: counts.sell,
        strong_sell: counts.strong_sell,
        source: "wind",
        updated_at: updatedAt,
        raw_json: JSON.stringify(obj),
      });
    }
  }
  return rows;
}

export function windGlobalProfileRows(
  payload: Record<string, unknown>,
  fallbackCode: string,
): Array<Record<string, unknown>> {
  const updatedAt = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  for (const table of extractWindTables(payload)) {
    for (const row of table.rows) {
      const obj = rowToObject(table.columns, row);
      const symbol = normalizeWindCode(
        stringField(obj, ["Wind代码", "windcode", "证券代码", "code"]) ||
          fallbackCode,
      ).toUpperCase();
      if (!symbol) continue;
      for (const [field, value] of Object.entries(obj)) {
        if (value == null || String(value).trim() === "") continue;
        if (/Wind代码|windcode|证券代码|code/i.test(field)) continue;
        rows.push({
          symbol,
          field_key: field,
          field_value: typeof value === "object" ? JSON.stringify(value) : String(value),
          field_type: Array.isArray(value) ? "array" : typeof value,
          source: "wind",
          updated_at: updatedAt,
          raw_json: JSON.stringify({ [field]: value }),
        });
      }
    }
  }
  return rows;
}

export function windGlobalHolderRows(
  payload: Record<string, unknown>,
  fallbackCode: string,
): Array<Record<string, unknown>> {
  const updatedAt = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  for (const table of extractWindTables(payload)) {
    for (const row of table.rows) {
      const obj = rowToObject(table.columns, row);
      const symbol = normalizeWindCode(
        stringField(obj, ["Wind代码", "windcode", "证券代码", "code"]) ||
          fallbackCode,
      ).toUpperCase();
      const holderName = stringField(obj, [
        "股东名称",
        "持有人名称",
        "机构名称",
        "名称",
        "holder_name",
        "name",
      ]);
      const reportedDate = normalizeReportDate(
        stringField(obj, ["报告期", "截止日期", "日期", "date", "reported_date"]) ??
          updatedAt,
      );
      if (!symbol || !holderName || !reportedDate) continue;
      rows.push({
        symbol,
        holder_type:
          stringField(obj, ["股东类型", "持有人类型", "类型", "holder_type", "type"]) ||
          "wind_equity_holder",
        holder_name: holderName,
        reported_date: reportedDate,
        pct_held: numberField(obj, [
          "持股比例",
          "占总股本比例",
          "持仓比例",
          "pct_held",
          "percent",
        ]),
        shares: numberField(obj, ["持股数", "持股数量", "shares", "数量"]),
        value: numberField(obj, ["持仓市值", "市值", "value"]),
        pct_change: numberField(obj, ["持股变动比例", "变动比例", "pct_change"]),
        source: "wind",
        updated_at: updatedAt,
        raw_json: JSON.stringify(obj),
      });
    }
  }
  return rows;
}

export function windStockShareholderRows(
  payload: Record<string, unknown>,
  fallbackCode: string,
): Array<Record<string, unknown>> {
  const fetchedAt = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  for (const table of extractWindTables(payload)) {
    for (let index = 0; index < table.rows.length; index += 1) {
      const obj = rowToObject(table.columns, table.rows[index]);
      const code = normalizeWindCode(
        stringField(obj, ["Wind代码", "windcode", "证券代码", "code"]) ||
          fallbackCode,
      );
      const holderName = stringField(obj, [
        "股东名称",
        "持有人名称",
        "机构名称",
        "名称",
        "holder_name",
        "name",
      ]);
      const reportDate = normalizeReportDate(
        stringField(obj, ["报告期", "截止日期", "日期", "date", "reported_date"]) ??
          fetchedAt,
      );
      if (!code || !holderName || !reportDate) continue;
      rows.push({
        code,
        report_date: reportDate,
        holder_name: holderName,
        holder_type:
          stringField(obj, ["股东类型", "持有人类型", "股本性质", "类型", "holder_type", "type"]) ||
          "wind_equity_holder",
        rank: numberField(obj, ["排名", "序号", "编号", "rank"]) ?? index + 1,
        hold_shares: numberField(obj, ["持股数", "持股数量", "shares", "数量"]),
        hold_pct: numberField(obj, ["持股比例", "占总股本比例", "持仓比例", "pct_held", "percent"]),
        share_nature: stringField(obj, ["股本性质", "股份性质", "share_nature"]),
        announcement_date: normalizeReportDate(
          stringField(obj, ["公告日期", "ann_date", "announcement_date"]) ?? "",
        ),
        shareholder_note: stringField(obj, ["股东说明", "说明", "备注", "note"]),
        shareholder_count: numberField(obj, ["股东总数", "shareholder_count"]),
        average_holding: numberField(obj, ["平均持股数", "average_holding"]),
        source: "wind",
        fetched_at: fetchedAt,
        raw_json: JSON.stringify(obj),
      });
    }
  }
  return rows;
}

export function windFundPerformanceRows(
  payload: Record<string, unknown>,
  fallbackFundCode: string,
): Array<Record<string, unknown>> {
  const fetchedAt = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  for (const table of extractWindTables(payload)) {
    for (const row of table.rows) {
      const obj = rowToObject(table.columns, row);
      const code = normalizeWindCode(
        stringField(obj, ["基金代码", "基金Wind代码", "Wind代码", "windcode", "code"]) ||
          fallbackFundCode,
      );
      const metricDate = normalizeReportDate(
        stringField(obj, ["净值日期", "交易日期", "日期", "报告期", "date"]) ??
          fetchedAt,
      );
      if (!code || !metricDate) continue;
      rows.push({
        code,
        metric_date: metricDate,
        provider: "wind",
        capability_id: "wind.fund.performance_metrics",
        source_action: "get_fund_performance",
        nav: numberField(obj, ["单位净值", "最新净值", "nav"]),
        return_ytd: numberField(obj, ["今年以来", "年初至今", "return_ytd"]),
        return_1w: numberField(obj, ["近1周", "近一周", "return_1w"]),
        return_1m: numberField(obj, ["近1月", "近一月", "return_1m"]),
        return_3m: numberField(obj, ["近3月", "近三月", "return_3m"]),
        return_6m: numberField(obj, ["近6月", "近六月", "return_6m"]),
        return_1y: numberField(obj, ["近1年", "近一年", "return_1y"]),
        return_2y: numberField(obj, ["近2年", "近二年", "return_2y"]),
        return_3y: numberField(obj, ["近3年", "近三年", "return_3y"]),
        return_since_inception: numberField(obj, ["成立以来", "return_since_inception"]),
        fetched_at: fetchedAt,
        raw_json: JSON.stringify(obj),
      });
    }
  }
  return rows;
}

export function windFundManagerRows(
  payload: Record<string, unknown>,
  fallbackFundCode: string,
  sourceAction: "get_fund_info" | "get_fund_company_info",
): Array<Record<string, unknown>> {
  const updatedAt = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  for (const table of extractWindTables(payload)) {
    for (const row of table.rows) {
      const obj = rowToObject(table.columns, row);
      const code = normalizeWindCode(
        stringField(obj, ["基金代码", "基金Wind代码", "Wind代码", "windcode", "code"]) ||
          fallbackFundCode,
      );
      const company = stringField(obj, ["基金公司", "管理人", "基金管理人", "company"]);
      const rawManagers = stringField(obj, ["基金经理", "现任基金经理", "经理", "manager"]);
      if (!rawManagers) continue;
      for (const name of splitWindNames(rawManagers)) {
        rows.push({
          manager_id: `wind_${name}_${company ?? ""}_${code}`,
          name,
          company,
          start_date: normalizeReportDate(
            stringField(obj, ["任职日期", "起始日期", "开始日期", "start_date"]) ?? "",
          ) || null,
          total_size: numberField(obj, ["管理规模", "最新规模", "total_size"]),
          fund_count: null,
          best_return: numberField(obj, ["最佳回报", "best_return"]),
          experience_years: numberField(obj, ["从业年限", "experience_years"]),
          updated_at: updatedAt,
          source: "wind",
          capability_id: "wind.fund.manager",
          source_action: sourceAction,
          raw_json: JSON.stringify({ fund_code: code, row: obj }),
        });
      }
    }
  }
  return rows;
}

export function windMoneyFlowRows(
  payload: Record<string, unknown>,
  fallbackCode: string,
): MoneyFlow[] {
  const rows: MoneyFlow[] = [];
  for (const table of extractWindTables(payload)) {
    for (const row of table.rows) {
      const obj = rowToObject(table.columns, row);
      const code = normalizeWindCode(
        stringField(obj, ["Wind代码", "windcode", "证券代码", "股票代码", "code"]) ||
          fallbackCode,
      );
      const date = normalizeReportDate(
        stringField(obj, ["交易时间", "交易日期", "日期", "时间", "date"]) ?? "",
      );
      if (!code || !date) continue;

      const superLarge = numberField(obj, [
        "超大单净流入额(万元)",
        "超大单净流入-净额",
        "今日超大单净流入-净额",
        "super_large_net",
      ]);
      const large = numberField(obj, [
        "大单净流入额(万元)",
        "大单净流入-净额",
        "今日大单净流入-净额",
        "large_net",
      ]);
      const medium = numberField(obj, [
        "中单净流入额(万元)",
        "中单净流入-净额",
        "今日中单净流入-净额",
        "medium_net",
      ]);
      const small = numberField(obj, [
        "小单净流入额(万元)",
        "小单净流入-净额",
        "今日小单净流入-净额",
        "small_net",
      ]);
      const main = numberField(obj, [
        "当日主力净流入额",
        "今日主力净流入-净额",
        "主力净流入-净额",
        "main_net",
      ]) ?? (superLarge != null || large != null ? (superLarge ?? 0) + (large ?? 0) : null);
      if (
        main == null &&
        small == null &&
        medium == null &&
        large == null &&
        superLarge == null
      ) {
        continue;
      }

      rows.push({
        code,
        date,
        main_net: main,
        small_net: small,
        medium_net: medium,
        large_net: large,
        super_large_net: superLarge,
        close_price: numberField(obj, ["收盘价", "最新成交价", "最新价", "close_price"]),
        change_pct: numberField(obj, ["涨跌幅", "change_pct", "pct_chg"]),
        source: "wind",
      });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export function windTechnicalIndicatorRows(
  payload: Record<string, unknown>,
  fallbackCode: string,
  sourceAction: "get_stock_technicals" | "get_index_technicals",
): TechnicalIndicatorSeriesRow[] {
  const fetchedAt = new Date().toISOString();
  const indicator =
    sourceAction === "get_index_technicals"
      ? "wind_index_technicals"
      : "wind_stock_technicals";
  const paramsJson = JSON.stringify({ provider: "wind", sourceAction, windcode: fallbackCode });
  const paramsHash = createHash("sha1").update(paramsJson).digest("hex");
  const rows: TechnicalIndicatorSeriesRow[] = [];

  for (const table of extractWindTables(payload)) {
    for (const row of table.rows) {
      const obj = rowToObject(table.columns, row);
      const symbol = normalizeWindCode(
        stringField(obj, [
          "Wind代码",
          "windcode",
          "指数代码",
          "证券代码",
          "股票代码",
          "code",
        ]) || fallbackCode,
      );
      const sourceDate = normalizeReportDate(
        stringField(obj, ["交易时间", "交易日期", "日期", "时间", "date"]) ?? "",
      );
      if (!symbol || !sourceDate) continue;

      for (const [fieldName, value] of Object.entries(obj)) {
        if (isIdentityOrDateField(fieldName)) continue;
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) continue;
        rows.push({
          provider: "wind",
          capability_id: "wind.technical.indicator_series",
          source_action: sourceAction,
          symbol,
          indicator,
          field_name: fieldName,
          params_hash: paramsHash,
          source_date: sourceDate,
          value: numeric,
          fetched_at: fetchedAt,
          params_json: paramsJson,
          raw_json: JSON.stringify(obj),
        });
      }
    }
  }
  return rows.sort(
    (a, b) =>
      a.source_date.localeCompare(b.source_date) ||
      a.symbol.localeCompare(b.symbol) ||
      a.field_name.localeCompare(b.field_name),
  );
}

export function windXdxrEventRows(
  payload: Record<string, unknown>,
  fallbackCode: string,
): XdxrEvent[] {
  const now = new Date().toISOString();
  const rows: XdxrEvent[] = [];
  for (const table of extractWindTables(payload)) {
    for (const row of table.rows) {
      const obj = rowToObject(table.columns, row);
      const code = normalizeWindCode(
        stringField(obj, ["Wind代码", "windcode", "证券代码", "股票代码", "code"]) ||
          fallbackCode,
      );
      const eventDate = normalizeReportDate(
        stringField(obj, [
          "除权除息日",
          "股权登记日",
          "派息日",
          "分红年度",
          "公告日期",
          "事件日期",
          "日期",
          "date",
        ]) ?? "",
      );
      const categoryName =
        stringField(obj, [
          "事件类型",
          "事件名称",
          "方案类型",
          "分红方案",
          "标题",
          "名称",
          "category_name",
        ]) ?? "Wind corporate action";
      if (!code || !eventDate || !isXdxrLikeEvent(categoryName, obj)) continue;
      rows.push({
        code,
        event_date: eventDate,
        category: 1,
        source: "wind",
        fetched_at: now,
        category_name: categoryName,
        a: numberField(obj, [
          "每股派息税前",
          "每股派息",
          "派息比例",
          "现金分红比例",
          "现金分红",
          "每10股派息",
          "派息",
          "a",
        ]),
        b: numberField(obj, [
          "送股比例",
          "每10股送股",
          "送股",
          "b",
        ]),
        c: numberField(obj, [
          "转增比例",
          "每10股转增",
          "转增",
          "c",
        ]),
        d: numberField(obj, [
          "配股比例",
          "每10股配股",
          "配股",
          "d",
        ]),
        raw_json: JSON.stringify(obj),
      });
    }
  }
  return rows.sort((a, b) => a.event_date.localeCompare(b.event_date));
}

export function windCorporateActionRows(
  payload: Record<string, unknown>,
  fallbackSymbol: string,
): Array<Record<string, unknown>> {
  const now = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  for (const table of extractWindTables(payload)) {
    for (const row of table.rows) {
      const obj = rowToObject(table.columns, row);
      const symbol = normalizeWindCode(
        stringField(obj, ["Wind代码", "windcode", "证券代码", "股票代码", "code"]) ||
          fallbackSymbol,
      ).toUpperCase();
      const actionDate = normalizeReportDate(
        stringField(obj, [
          "除权除息日",
          "股权登记日",
          "派息日",
          "分红年度",
          "公告日期",
          "事件日期",
          "日期",
          "date",
        ]) ?? "",
      );
      const label =
        stringField(obj, [
          "事件类型",
          "事件名称",
          "方案类型",
          "分红方案",
          "标题",
          "名称",
          "category_name",
        ]) ?? "";
      const actionType = corporateActionType(label, obj);
      if (!symbol || !actionDate || !actionType) continue;
      rows.push({
        symbol,
        action_type: actionType,
        action_date: actionDate,
        value: corporateActionValue(actionType, obj),
        source: "wind",
        updated_at: now,
        raw_json: JSON.stringify(obj),
      });
    }
  }
  return rows.sort((a, b) => String(a.action_date).localeCompare(String(b.action_date)));
}

export function windIndexMomentumRows(
  payload: Record<string, unknown>,
  fallbackCode: string,
): IndexMomentum[] {
  const fetchedAt = new Date().toISOString();
  const rows: IndexMomentum[] = [];
  for (const table of extractWindTables(payload)) {
    for (const row of table.rows) {
      const obj = rowToObject(table.columns, row);
      const code = normalizeWindCode(
        stringField(obj, ["Wind代码", "windcode", "指数代码", "证券代码", "code"]) ||
          fallbackCode,
      );
      const tradeDate = normalizeReportDate(
        stringField(obj, ["交易时间", "交易日期", "日期", "时间", "date"]) ?? "",
      );
      if (!code || !tradeDate) continue;
      for (const [field, value] of windMomentumValues(obj)) {
        rows.push({
          code,
          trade_date: tradeDate,
          sequence: rows.length,
          source: "wind",
          fetched_at: fetchedAt,
          value,
          raw_json: JSON.stringify({ field, value, row: obj }),
        });
      }
    }
  }
  return rows.sort((a, b) => a.trade_date.localeCompare(b.trade_date) || a.sequence - b.sequence);
}

export function windDocumentRows(
  payload: Record<string, unknown>,
  tool: string,
  query: string,
): Array<Record<string, unknown>> {
  const now = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  for (const table of extractWindTables(payload)) {
    table.rows.forEach((row, index) => {
      const obj = rowToObject(table.columns, row);
      const entityCode = normalizeWindCode(
        stringField(obj, ["Wind代码", "windcode", "证券代码", "股票代码", "代码", "code"]),
      );
      const title =
        stringField(obj, [
          "标题",
          "title",
          "公告标题",
          "新闻标题",
          "名称",
          "摘要标题",
        ]) || `${tool}-${index + 1}`;
      const publishedAt =
        normalizeDateTime(
          stringField(obj, ["发布时间", "发布日期", "日期", "时间", "publish_time"]),
        ) || now;
      rows.push({
        doc_id: `${tool}_${query}_${entityCode}_${publishedAt}_${title}`,
        tool,
        query,
        title,
        publisher: stringField(obj, ["媒体", "来源", "发布机构", "publisher", "source"]),
        published_at: publishedAt,
        url: stringField(obj, ["链接", "url", "URL", "公告链接", "新闻链接"]),
        summary:
          stringField(obj, ["摘要", "summary", "内容摘要", "内容"]) ||
          previewWindObject(obj),
        entity_code: entityCode || null,
        entity_name: stringField(obj, [
          "证券简称",
          "中文简称",
          "公司名称",
          "发行人",
          "entity_name",
        ]),
        source: "wind",
        updated_at: now,
        raw_json: JSON.stringify(obj),
      });
    });
  }
  return rows;
}

export function windFinanceNewsRows(
  payload: Record<string, unknown>,
  query: string,
): Array<Record<string, unknown>> {
  const now = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  for (const table of extractWindTables(payload)) {
    table.rows.forEach((row, index) => {
      const obj = rowToObject(table.columns, row);
      const title =
        stringField(obj, [
          "标题",
          "title",
          "公告标题",
          "新闻标题",
          "名称",
          "摘要标题",
        ]) || `get_financial_news-${index + 1}`;
      const publishedAt =
        normalizeDateTime(
          stringField(obj, ["发布时间", "发布日期", "日期", "时间", "publish_time"]),
        ) || now;
      const url = stringField(obj, ["链接", "url", "URL", "公告链接", "新闻链接"]);
      rows.push({
        news_id: `wind_${query}_${publishedAt}_${title}`,
        title,
        summary:
          stringField(obj, ["摘要", "summary", "内容摘要"]) ||
          previewWindObject(obj),
        content: stringField(obj, ["内容", "content", "正文", "body"]),
        publisher: stringField(obj, ["媒体", "来源", "发布机构", "publisher", "source"]),
        published_at: publishedAt,
        url,
        source: "wind",
        fetched_at: now,
        raw_json: JSON.stringify(obj),
      });
    });
  }
  return rows;
}

export function windGlobalNewsRows(
  payload: Record<string, unknown>,
  fallbackCode: string,
): Array<Record<string, unknown>> {
  const now = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  for (const table of extractWindTables(payload)) {
    table.rows.forEach((row, index) => {
      const obj = rowToObject(table.columns, row);
      const symbol = normalizeWindCode(
        stringField(obj, ["Wind代码", "windcode", "证券代码", "股票代码", "代码", "code"]) ||
          fallbackCode,
      ).toUpperCase();
      if (!symbol) return;
      const title =
        stringField(obj, [
          "标题",
          "title",
          "公告标题",
          "新闻标题",
          "名称",
          "摘要标题",
        ]) || `get_financial_news-${index + 1}`;
      const publishedAt =
        normalizeDateTime(
          stringField(obj, ["发布时间", "发布日期", "日期", "时间", "publish_time"]),
        ) || now;
      const link = stringField(obj, ["链接", "url", "URL", "公告链接", "新闻链接"]);
      const newsId = `wind_${symbol}_${publishedAt}_${title}`;
      rows.push({
        symbol,
        news_id: newsId,
        title,
        publisher: stringField(obj, ["媒体", "来源", "发布机构", "publisher", "source"]),
        published_at: publishedAt,
        link,
        summary:
          stringField(obj, ["摘要", "summary", "内容摘要", "内容"]) ||
          previewWindObject(obj),
        source: "wind",
        updated_at: now,
        raw_json: JSON.stringify(obj),
      });
    });
  }
  return rows;
}

export function windEconomicSeriesRows(
  payload: Record<string, unknown>,
  metricQuery: string,
): Array<Record<string, unknown>> {
  const now = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  for (const table of extractWindTables(payload)) {
    for (const row of table.rows) {
      const obj = rowToObject(table.columns, row);
      const metricName =
        stringField(obj, ["指标名称", "指标", "名称", "metric_name", "name"]) ||
        metricQuery;
      const date = normalizeReportDate(
        stringField(obj, ["日期", "交易日期", "时间", "报告期", "date"]) ||
          now,
      );
      const valueNum = numberField(obj, ["值", "数值", "value", "最新值", "指标值"]);
      rows.push({
        series_key: `${metricQuery}_${metricName}`,
        metric_query: metricQuery,
        metric_name: metricName,
        metric_code: stringField(obj, ["指标代码", "metric_id", "metric_code", "Wind代码"]),
        date,
        value_num: valueNum,
        value_text:
          valueNum != null
            ? String(valueNum)
            : stringField(obj, ["值", "数值", "value", "最新值", "指标值"]) ||
              previewWindObject(obj),
        unit: stringField(obj, ["单位", "unit"]),
        frequency: stringField(obj, ["频率", "freq", "frequency"]),
        currency: stringField(obj, ["币种", "currency"]),
        source: "wind",
        updated_at: now,
        raw_json: JSON.stringify(obj),
      });
    }
  }
  return rows;
}

export function windAnalyticsRows(
  payload: Record<string, unknown>,
  question: string,
): Array<Record<string, unknown>> {
  const now = new Date().toISOString();
  const rows: Array<Record<string, unknown>> = [];
  for (const table of extractWindTables(payload)) {
    table.rows.forEach((row, index) => {
      const obj = rowToObject(table.columns, row);
      const entityCode = normalizeWindCode(
        stringField(obj, ["Wind代码", "windcode", "证券代码", "代码", "code"]),
      );
      const valueNum = numberField(obj, ["值", "数值", "value", "最新值", "收盘价", "最新价"]);
      rows.push({
        result_id: `${question}_${entityCode}_${index + 1}`,
        question,
        entity_code: entityCode || null,
        entity_name: stringField(obj, [
          "证券简称",
          "中文简称",
          "名称",
          "name",
          "公司名称",
        ]),
        value_date: normalizeReportDate(
          stringField(obj, ["日期", "交易日期", "时间", "报告期", "date"]) || now,
        ),
        title:
          stringField(obj, ["标题", "title", "名称", "name", "指标名称"]) ||
          question,
        content: previewWindObject(obj),
        value_num: valueNum,
        value_text:
          stringField(obj, ["值", "数值", "value", "最新值", "收盘价", "最新价"]) ||
          previewWindObject(obj),
        unit: stringField(obj, ["单位", "unit"]),
        source: "wind",
        updated_at: now,
        raw_json: JSON.stringify(obj),
      });
    });
  }
  return rows;
}

export function windFundHoldingRows(
  payload: Record<string, unknown>,
  fallbackFundCode: string,
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  for (const table of extractWindTables(payload)) {
    table.rows.forEach((row, index) => {
      const obj = rowToObject(table.columns, row);
      const fundCode = normalizeWindCode(
        stringField(obj, ["基金代码", "基金Wind代码", "fund_code", "Wind代码"]) ||
          fallbackFundCode,
      );
      const stockCode = normalizeWindCode(
        stringField(obj, [
          "股票代码",
          "持仓证券代码",
          "证券代码",
          "stock_code",
          "code",
        ]),
      );
      if (!fundCode || !stockCode) return;
      result.push({
        fund_code: fundCode,
        report_date:
          normalizeReportDate(
            stringField(obj, [
              "报告期",
              "截止日期",
              "持仓日期",
              "日期",
              "report_date",
            ]) ?? "",
          ) || "",
        stock_code: stockCode,
        stock_name:
          stringField(obj, [
            "股票名称",
            "持仓证券简称",
            "证券简称",
            "中文简称",
            "stock_name",
            "name",
          ]) ?? "",
        hold_shares: numberField(obj, [
          "持股数",
          "持仓数量",
          "持有股数",
          "hold_shares",
        ]),
        hold_value: numberField(obj, [
          "持仓市值",
          "持有市值",
          "市值",
          "hold_value",
        ]),
        hold_pct: numberField(obj, [
          "占净值比例",
          "占基金净值比例",
          "持仓占比",
          "占净值",
          "hold_pct",
        ]),
        rank:
          numberField(obj, ["序号", "排名", "rank"]) == null
            ? index + 1
            : Math.round(numberField(obj, ["序号", "排名", "rank"]) ?? index + 1),
        source: "wind",
      });
    });
  }
  return result;
}

export function windCompanyInfoRows(
  payload: Record<string, unknown>,
  fallbackCode: string,
  infoType: string,
): Array<Record<string, unknown>> {
  const now = new Date().toISOString();
  const result: Array<Record<string, unknown>> = [];
  for (const table of extractWindTables(payload)) {
    for (const row of table.rows) {
      const obj = rowToObject(table.columns, row);
      const code = normalizeWindCode(
        stringField(obj, ["Wind代码", "windcode", "证券代码", "code"]) ||
          fallbackCode,
      );
      if (!code) continue;
      const title =
        stringField(obj, [
          "标题",
          "title",
          "名称",
          "name",
          "基金名称",
          "债券简称",
          "指数简称",
          "公司名称",
          "证券简称",
          "中文简称",
          "类型",
          "type",
          "类别",
          "category",
        ]) || infoType;
      result.push({
        code,
        info_type: infoType,
        title,
        content: previewWindObject(obj),
        source: "wind",
        updated_at: now,
        raw_json: JSON.stringify(obj),
      });
    }
  }
  return result;
}

export function windKlineRows(
  payload: Record<string, unknown>,
  fallbackCode: string,
  adjust = "qfq",
): KlineBar[] {
  const rows: KlineBar[] = [];
  for (const table of extractWindTables(payload)) {
    for (const row of table.rows) {
      const obj = rowToObject(table.columns, row);
      const code = normalizeWindCode(
        stringField(obj, ["Wind代码", "windcode", "证券代码", "code"]) ||
          fallbackCode,
      );
      const date = normalizeReportDate(
        stringField(obj, ["交易日期", "日期", "时间", "trade_date", "date"]) ??
          "",
      );
      const open = numberField(obj, ["开盘价", "今日开盘价", "open"]);
      const high = numberField(obj, ["最高价", "今日最高价", "high"]);
      const low = numberField(obj, ["最低价", "今日最低价", "low"]);
      const close = numberField(obj, ["收盘价", "最新成交价", "close"]);
      if (
        !code ||
        !date ||
        open == null ||
        high == null ||
        low == null ||
        close == null ||
        close <= 0
      )
        continue;
      rows.push({
        code,
        date,
        open,
        high,
        low,
        close,
        volume: numberField(obj, ["成交量", "volume"]),
        amount: numberField(obj, ["成交额", "amount"]),
        change_pct: numberField(obj, ["涨跌幅", "changePct", "pct_chg"]),
        turnover_rate: numberField(obj, ["换手率", "turnoverRate"]),
        adjust,
        source: "wind",
      });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

function extractWindTables(
  payload: Record<string, unknown>,
): Array<{ columns: string[]; rows: unknown[][] }> {
  const candidates: unknown[] = [];
  if (isRecord(payload.data)) {
    candidates.push(payload.data);
    if (Array.isArray(payload.data.data)) candidates.push(...payload.data.data);
  }
  const tables: Array<{ columns: string[]; rows: unknown[][] }> = [];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    if (!Array.isArray(candidate.columns) || !Array.isArray(candidate.rows))
      continue;
    const columns = candidate.columns
      .map((c) => (isRecord(c) ? String(c.name ?? "") : String(c)))
      .filter(Boolean);
    const rows = candidate.rows.filter(Array.isArray) as unknown[][];
    if (columns.length > 0 && rows.length > 0) tables.push({ columns, rows });
  }
  return tables;
}

function rowToObject(
  columns: string[],
  row: unknown[],
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  columns.forEach((c, i) => {
    obj[c] = row[i];
  });
  return obj;
}

function stringField(
  obj: Record<string, unknown>,
  names: string[],
): string | null {
  for (const name of names) {
    const value = obj[name];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

function numberField(
  obj: Record<string, unknown>,
  names: string[],
): number | null {
  for (const name of names) {
    const value = obj[name];
    if (value == null || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isIdentityOrDateField(field: string): boolean {
  return /代码|名称|简称|日期|时间|报告期|name|code|date|time|period/i.test(field);
}

function splitWindNames(value: string): string[] {
  return value
    .split(/[、,，;；/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function windRecommendationCounts(
  obj: Record<string, unknown>,
): {
  strong_buy: number | null
  buy: number | null
  hold: number | null
  sell: number | null
  strong_sell: number | null
} | null {
  const direct = {
    strong_buy: numberField(obj, ["强烈买入", "强力买入", "strong_buy", "strongBuy"]),
    buy: numberField(obj, ["买入", "推荐", "增持", "buy"]),
    hold: numberField(obj, ["持有", "中性", "neutral", "hold"]),
    sell: numberField(obj, ["卖出", "减持", "sell"]),
    strong_sell: numberField(obj, ["强烈卖出", "strong_sell", "strongSell"]),
  };
  if (Object.values(direct).some((value) => value != null)) return direct;
  return null;
}

function normalizeReportDate(value: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(value);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return value.slice(0, 10);
}

function normalizeDateTime(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  const date = normalizeReportDate(value);
  return date ? `${date}T00:00:00.000Z` : null;
}

function normalizeWindCode(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const noPrefix = raw.replace(/^(SH|SZ|BJ)/i, "");
  return noPrefix.replace(/\.[A-Z]+$/i, "");
}

function windMarketFromRawCode(value: string): string | null {
  const raw = value.trim().toUpperCase();
  const suffix = raw.match(/\.([A-Z]+)$/)?.[1];
  if (suffix) return suffix;
  const prefix = raw.match(/^(SH|SZ|BJ)/)?.[1];
  return prefix ?? null;
}

function isXdxrLikeEvent(
  categoryName: string,
  obj: Record<string, unknown>,
): boolean {
  const text = `${categoryName}\n${previewWindObject(obj)}`;
  return /(分红|派息|除权|除息|送股|转增|配股|股息|dividend|split|rights)/i.test(text);
}

function corporateActionType(
  label: string,
  obj: Record<string, unknown>,
): string | null {
  const text = `${label}\n${previewWindObject(obj)}`;
  if (/(配股|供股|rights)/i.test(text)) return "rights";
  if (/(拆股|合股|拆细|split)/i.test(text)) return "split";
  if (/(送股|转增)/i.test(text)) return "split";
  if (/(分红|派息|除息|股息|dividend)/i.test(text)) return "dividend";
  if (/(资本利得|capital gains?)/i.test(text)) return "capital_gains";
  return null;
}

function corporateActionValue(
  actionType: string,
  obj: Record<string, unknown>,
): number | null {
  if (actionType === "dividend" || actionType === "capital_gains") {
    return numberField(obj, [
      "每股派息税前",
      "每股派息",
      "派息比例",
      "现金分红比例",
      "现金分红",
      "每10股派息",
      "派息",
      "amount",
      "value",
    ]);
  }
  if (actionType === "split") {
    const bonus = numberField(obj, ["送股比例", "每10股送股", "送股"]);
    const transfer = numberField(obj, ["转增比例", "每10股转增", "转增"]);
    return numberField(obj, ["拆股比例", "splitRatio", "ratio", "value"]) ??
      (bonus != null || transfer != null ? (bonus ?? 0) + (transfer ?? 0) : null);
  }
  if (actionType === "rights") {
    return numberField(obj, ["配股比例", "每10股配股", "配股", "rightsRatio", "ratio", "value"]);
  }
  return numberField(obj, ["value", "amount"]);
}

function windMomentumValues(obj: Record<string, unknown>): Array<[string, number]> {
  const result: Array<[string, number]> = [];
  const preferred = [
    "涨跌幅",
    "近1月涨跌幅",
    "近3月涨跌幅",
    "近6月涨跌幅",
    "近1年涨跌幅",
    "6周期相对强弱指标",
    "12周期相对强弱指标",
    "指数平滑异同移动平均",
    "DIF快线",
    "DEA慢线",
    "随机指标K值",
    "随机指标D值",
    "随机指标J值",
    "14周期顺势指标",
    "26周期能量指标",
    "MACD",
    "RSI",
    "KDJ_K",
    "KDJ_D",
    "KDJ_J",
    "momentum",
    "value",
  ];
  for (const field of preferred) {
    const value = numberField(obj, [field]);
    if (value != null) result.push([field, value]);
  }
  if (result.length > 0) return result;
  for (const [field, raw] of Object.entries(obj)) {
    if (/代码|名称|简称|日期|时间|name|code/i.test(field)) continue;
    if (!/(涨跌|强弱|动量|RSI|MACD|KDJ|DIF|DEA|CCI|能量|momentum|return|change)/i.test(field)) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) result.push([field, value]);
  }
  return result;
}

function previewWindObject(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .filter(([, value]) => value != null && String(value).trim() !== "")
    .slice(0, 12)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
