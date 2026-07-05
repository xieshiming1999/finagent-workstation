"""Factor definitions for stock and fund screening."""
from __future__ import annotations
from dataclasses import dataclass
from typing import Callable, Optional


@dataclass
class FactorDef:
    name: str
    display: str
    category: str
    description: str
    higher_is_better: bool
    source: str

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "display": self.display,
            "category": self.category,
            "description": self.description,
            "higher_is_better": self.higher_is_better,
        }


STOCK_FACTORS: dict[str, FactorDef] = {
    # --- Valuation ---
    "pe_ttm": FactorDef("pe_ttm", "PE(TTM)", "valuation", "市盈率(滚动)", False, "quote"),
    "pb": FactorDef("pb", "PB", "valuation", "市净率", False, "quote"),
    "ps_ttm": FactorDef("ps_ttm", "PS(TTM)", "valuation", "市销率(滚动)", False, "fundamental"),
    "peg": FactorDef("peg", "PEG", "valuation", "PE/净利润增速", False, "computed"),
    "dividend_yield": FactorDef("dividend_yield", "股息率(%)", "valuation", "近12月股息率", True, "fundamental"),
    "ev_ebitda": FactorDef("ev_ebitda", "EV/EBITDA", "valuation", "企业价值/EBITDA", False, "fundamental"),

    # --- Growth ---
    "revenue_yoy": FactorDef("revenue_yoy", "营收同比(%)", "growth", "营收同比增长率", True, "fundamental"),
    "profit_yoy": FactorDef("profit_yoy", "净利同比(%)", "growth", "净利润同比增长率", True, "fundamental"),
    "eps_growth": FactorDef("eps_growth", "EPS增速(%)", "growth", "每股收益增长率", True, "fundamental"),
    "revenue_3y_cagr": FactorDef("revenue_3y_cagr", "3年营收CAGR(%)", "growth", "3年营收复合增长率", True, "fundamental"),
    "profit_3y_cagr": FactorDef("profit_3y_cagr", "3年利润CAGR(%)", "growth", "3年净利润复合增长率", True, "fundamental"),

    # --- Profitability ---
    "roe": FactorDef("roe", "ROE(%)", "profitability", "净资产收益率", True, "fundamental"),
    "roe_3y_avg": FactorDef("roe_3y_avg", "3年平均ROE(%)", "profitability", "近3年平均ROE", True, "fundamental"),
    "gross_margin": FactorDef("gross_margin", "毛利率(%)", "profitability", "销售毛利率", True, "fundamental"),
    "net_margin": FactorDef("net_margin", "净利率(%)", "profitability", "销售净利率", True, "fundamental"),
    "roa": FactorDef("roa", "ROA(%)", "profitability", "总资产收益率", True, "fundamental"),

    # --- Quality ---
    "debt_ratio": FactorDef("debt_ratio", "资产负债率(%)", "quality", "总负债/总资产", False, "fundamental"),
    "current_ratio": FactorDef("current_ratio", "流动比率", "quality", "流动资产/流动负债", True, "fundamental"),
    "interest_coverage": FactorDef("interest_coverage", "利息保障倍数", "quality", "EBIT/利息费用", True, "fundamental"),
    "fcf_yield": FactorDef("fcf_yield", "自由现金流率(%)", "quality", "自由现金流/市值", True, "computed"),
    "core_revenue_ratio": FactorDef("core_revenue_ratio", "主营比率", "quality", "主营利润/总利润", True, "fundamental"),

    # --- Size ---
    "market_cap": FactorDef("market_cap", "总市值(亿)", "size", "总市值", True, "quote"),
    "circ_cap": FactorDef("circ_cap", "流通市值(亿)", "size", "流通市值", True, "quote"),

    # --- Momentum ---
    "change_pct": FactorDef("change_pct", "涨跌幅(%)", "momentum", "当日涨跌幅", True, "quote"),
    "momentum_5d": FactorDef("momentum_5d", "5日涨幅(%)", "momentum", "5日收益率", True, "computed"),
    "momentum_20d": FactorDef("momentum_20d", "20日涨幅(%)", "momentum", "20日收益率", True, "computed"),
    "momentum_60d": FactorDef("momentum_60d", "60日涨幅(%)", "momentum", "60日收益率", True, "computed"),
    "volatility_20d": FactorDef("volatility_20d", "20日波动率(%)", "momentum", "20日年化波动率", False, "computed"),
    "turnover_rate": FactorDef("turnover_rate", "换手率(%)", "momentum", "当日换手率", True, "quote"),
    "volume_ratio": FactorDef("volume_ratio", "量比", "momentum", "当日成交量/5日均量", True, "quote"),
}


FUND_FACTORS: dict[str, FactorDef] = {
    "return_ytd": FactorDef("return_ytd", "今年以来收益(%)", "performance", "年初至今收益率", True, "fund"),
    "return_1y": FactorDef("return_1y", "近1年收益(%)", "performance", "近1年收益率", True, "fund"),
    "return_3y": FactorDef("return_3y", "近3年收益(%)", "performance", "近3年收益率", True, "fund"),
    "return_5y": FactorDef("return_5y", "近5年收益(%)", "performance", "近5年收益率", True, "fund"),
    "sharpe_1y": FactorDef("sharpe_1y", "1年Sharpe", "risk", "近1年夏普比率", True, "computed"),
    "max_drawdown": FactorDef("max_drawdown", "最大回撤(%)", "risk", "历史最大回撤", False, "computed"),
    "volatility": FactorDef("volatility", "波动率(%)", "risk", "年化波动率", False, "computed"),
    "aum": FactorDef("aum", "规模(亿)", "size", "基金规模", True, "fund"),
    "setup_years": FactorDef("setup_years", "成立年限", "size", "基金成立年限", True, "fund"),
    "manager_exp": FactorDef("manager_exp", "经理从业年限", "manager", "基金经理从业年限", True, "fund"),
    "nav": FactorDef("nav", "最新净值", "performance", "最新单位净值", True, "fund"),
}


def get_all_stock_factors() -> list[dict]:
    return [f.to_dict() for f in STOCK_FACTORS.values()]


def get_all_fund_factors() -> list[dict]:
    return [f.to_dict() for f in FUND_FACTORS.values()]
