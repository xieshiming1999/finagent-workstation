"""Stock screener: gate filtering + multi-factor scoring + fair value."""
from __future__ import annotations
import numpy as np
import pandas as pd
from .factors import STOCK_FACTORS


class StockScreener:
    def screen(self, config: dict) -> dict:
        universe_cfg = config.get("universe", {})
        gates = config.get("gates", [])
        scoring_cfg = config.get("scoring")
        sort_by = config.get("sort_by", "composite_score" if scoring_cfg else "market_cap")
        sort_desc = config.get("sort_desc", True)
        limit = config.get("limit", 30)
        include_fair_value = config.get("include_fair_value", False)

        df = self._load_universe(universe_cfg)
        if df is None or len(df) == 0:
            return {"status": "error", "error": "Failed to load stock universe"}

        total_universe = len(df)

        quote_factors = {"pe_ttm", "pb", "market_cap", "circ_cap", "change_pct",
                         "turnover_rate", "volume_ratio", "momentum_60d", "price"}
        fundamental_factors = {"roe", "roe_3y_avg", "gross_margin", "net_margin", "roa",
                               "debt_ratio", "current_ratio", "revenue_yoy", "profit_yoy",
                               "eps_growth", "dividend_yield", "ps_ttm", "peg"}

        quote_gates = [g for g in gates if g.get("factor") in quote_factors]
        fundamental_gates = [g for g in gates if g.get("factor") in fundamental_factors]
        gate_diagnostics = []

        ordered_gates = quote_gates + fundamental_gates

        for gate in quote_gates:
            gate_diagnostics.append(self._gate_diagnostic(df, gate))
            df = self._apply_gate(df, gate)
            if len(df) == 0:
                gate_diagnostics.extend(self._skipped_gate_diagnostics(ordered_gates[len(gate_diagnostics):]))
                return {"status": "ok", "total_universe": total_universe, "passed_gates": 0, "returned": 0, "stocks": [], "gate_diagnostics": gate_diagnostics}

        needs_fundamental = bool(fundamental_gates)
        if scoring_cfg:
            needs_fundamental = needs_fundamental or any(
                f in fundamental_factors for f in scoring_cfg.get("weights", {}).keys()
            )

        if needs_fundamental:
            df = self._load_fundamentals(df)
            for gate in fundamental_gates:
                gate_diagnostics.append(self._gate_diagnostic(df, gate))
                df = self._apply_gate(df, gate)
                if len(df) == 0:
                    gate_diagnostics.extend(self._skipped_gate_diagnostics(ordered_gates[len(gate_diagnostics):]))
                    return {"status": "ok", "total_universe": total_universe, "passed_gates": 0, "returned": 0, "stocks": [], "gate_diagnostics": gate_diagnostics}

        if scoring_cfg:
            df = self._compute_score(df, scoring_cfg)

        sort_col = sort_by if sort_by in df.columns else "market_cap"
        ascending = not sort_desc
        if sort_col in df.columns:
            df = df.sort_values(sort_col, ascending=ascending, na_position="last")

        result_df = df.head(limit)
        stocks = self._format_results(result_df, gates, include_fair_value)

        return {
            "status": "ok",
            "total_universe": total_universe,
            "passed_gates": len(df),
            "returned": len(stocks),
            "stocks": stocks,
            "gate_diagnostics": gate_diagnostics,
        }

    def _load_universe(self, cfg: dict) -> pd.DataFrame | None:
        """Load stock universe: prefer local cache, fallback to single AkShare call (spot data only)."""
        from local_cache import get_local_cache
        cache = get_local_cache()

        # Try local stock_list first
        local_df = cache.query_stock_list()
        if local_df is not None and len(local_df) > 100:
            local_df = self._normalize_local_stock_list(local_df, cfg)

        import akshare as ak
        try:
            # This is a single API call returning all A-shares with price/PE/PB/market_cap
            # It's acceptable (not a per-stock scan)
            df = ak.stock_zh_a_spot_em()
            rename = {
                "代码": "code", "名称": "name", "最新价": "price",
                "涨跌幅": "change_pct", "涨跌额": "change",
                "成交量": "volume", "成交额": "amount",
                "今开": "open", "最高": "high", "最低": "low",
                "昨收": "prev_close", "换手率": "turnover_rate",
                "市盈率-动态": "pe_ttm", "市净率": "pb",
                "总市值": "market_cap", "流通市值": "circ_cap",
                "量比": "volume_ratio",
                "60日涨跌幅": "momentum_60d",
                "年初至今涨跌幅": "ytd_change",
            }
            df = df.rename(columns=rename)
            for col in ["price", "change_pct", "pe_ttm", "pb", "market_cap", "circ_cap",
                        "turnover_rate", "volume_ratio", "momentum_60d"]:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors="coerce")

            if "market_cap" in df.columns:
                df["market_cap"] = df["market_cap"] / 1e8
            if "circ_cap" in df.columns:
                df["circ_cap"] = df["circ_cap"] / 1e8

            market = cfg.get("market")
            if market:
                if market == "SH":
                    df = df[df["code"].str.startswith("6")]
                elif market == "SZ":
                    df = df[df["code"].str.startswith(("0", "3"))]
                elif market == "BJ":
                    df = df[df["code"].str.startswith(("4", "8"))]

            if cfg.get("exclude_st", True):
                df = df[~df["name"].str.contains("ST|退", na=False)]

            min_cap = cfg.get("min_market_cap")
            if min_cap:
                min_cap_yi = min_cap / 1e8 if min_cap > 1e6 else min_cap
                df = df[df["market_cap"] >= min_cap_yi]

            return df.reset_index(drop=True)
        except Exception as e:
            if local_df is not None and len(local_df) > 0:
                return local_df.reset_index(drop=True)
            return None

    def _normalize_local_stock_list(self, df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
        """Build a bounded local fallback universe from canonical stock_list rows."""
        rename = {
            "symbol": "code",
            "ts_code": "code",
            "stock_name": "name",
            "security_name": "name",
        }
        df = df.rename(columns={k: v for k, v in rename.items() if k in df.columns}).copy()
        if "code" not in df.columns:
            return pd.DataFrame()
        if "name" not in df.columns:
            df["name"] = ""
        df["code"] = df["code"].astype(str).str.extract(r"(\d{6})", expand=False).fillna(df["code"].astype(str))
        if "market" in df.columns:
            market = df["market"].astype(str).str.upper()
            df = df[~((market == "SH") & df["code"].str.startswith(("000", "399"), na=False))]
        tradable_prefix = r"^(000|001|002|003|300|301|600|601|603|605|688|689|430|83|87|88|92)"
        df = df[df["code"].str.match(tradable_prefix, na=False)]
        non_stock_name = r"指数|成指|上证|深证|沪深|中证|Ａ股|Ｂ股|基金|债券|回购|总\s*成\s*交|权证|期权|REITS|国债|企债|ABS|DR$"
        df = df[~df["name"].astype(str).str.contains(non_stock_name, na=False)]
        for col in ["price", "change_pct", "pe_ttm", "pb", "market_cap", "circ_cap", "turnover_rate", "volume_ratio", "momentum_60d"]:
            if col not in df.columns:
                df[col] = np.nan
            else:
                df[col] = pd.to_numeric(df[col], errors="coerce")

        market = cfg.get("market")
        if market:
            if market == "SH":
                df = df[df["code"].str.startswith("6")]
            elif market == "SZ":
                df = df[df["code"].str.startswith(("0", "3"))]
            elif market == "BJ":
                df = df[df["code"].str.startswith(("4", "8"))]

        if cfg.get("exclude_st", True):
            df = df[~df["name"].astype(str).str.contains("ST|退", na=False)]

        min_cap = cfg.get("min_market_cap")
        if min_cap and "market_cap" in df.columns:
            min_cap_yi = min_cap / 1e8 if min_cap > 1e6 else min_cap
            df = df[df["market_cap"] >= min_cap_yi]

        return df[["code", "name", "price", "change_pct", "pe_ttm", "pb", "market_cap", "circ_cap", "turnover_rate", "volume_ratio", "momentum_60d"]].drop_duplicates("code")

    def _load_fundamentals(self, df: pd.DataFrame) -> pd.DataFrame:
        """Load fundamental data: local cache first, remote only for small batches."""
        from local_cache import get_local_cache
        import akshare as ak
        import time

        cache = get_local_cache()
        codes = df["code"].tolist()
        fundamental_data = []
        remote_needed = []

        # Phase 1: read from local cache
        for code in codes:
            local = cache.query_fundamental(code, limit=1)
            if local is not None and len(local) > 0:
                row = local.iloc[0]
                fundamental_data.append({
                    "code": code,
                    "roe": self._safe_num(row.get("roe")),
                    "gross_margin": self._safe_num(row.get("gross_margin")),
                    "net_margin": self._safe_num(row.get("net_margin")),
                    "roa": self._safe_num(row.get("roa") if "roa" in row.index else None),
                    "debt_ratio": self._safe_num(row.get("debt_ratio")),
                    "revenue_yoy": self._safe_num(row.get("revenue_yoy")),
                    "profit_yoy": self._safe_num(row.get("profit_yoy")),
                    "dividend_yield": self._safe_num(row.get("dividend_yield")),
                })
            else:
                remote_needed.append(code)

        # Phase 2: refuse bulk remote fetch — only allow small batches
        MAX_REMOTE_FETCH = 50
        if len(remote_needed) > MAX_REMOTE_FETCH:
            # Too many stocks need remote fetch — skip fundamentals for them
            # User should use Data Manager to download fundamental data first
            for code in remote_needed:
                fundamental_data.append({"code": code})
        else:
            for code in remote_needed:
                try:
                    fin = ak.stock_financial_analysis_indicator(symbol=code)
                    if fin is None or len(fin) == 0:
                        fundamental_data.append({"code": code})
                        continue

                    latest = fin.iloc[0]

                    def safe(col_names, default=None):
                        for cn in col_names if isinstance(col_names, list) else [col_names]:
                            if cn in latest.index:
                                v = latest[cn]
                                try:
                                    n = float(v)
                                    if not np.isnan(n):
                                        return n
                                except (TypeError, ValueError):
                                    pass
                        return default

                    row = {
                        "code": code,
                        "roe": safe(["净资产收益率", "加权净资产收益率", "摊薄净资产收益率"]),
                        "gross_margin": safe(["销售毛利率"]),
                        "net_margin": safe(["销售净利率"]),
                        "roa": safe(["总资产净利润率", "总资产利润率"]),
                        "debt_ratio": safe(["资产负债率"]),
                        "current_ratio": safe(["流动比率"]),
                        "revenue_yoy": safe(["营业总收入同比增长率", "营业收入同比增长率"]),
                        "profit_yoy": safe(["归属净利润同比增长率", "净利润同比增长率"]),
                        "eps_growth": safe(["基本每股收益同比增长率"]),
                    }

                    pe_val = df.loc[df["code"] == code, "pe_ttm"].values
                    if len(pe_val) > 0 and row.get("profit_yoy"):
                        pe = float(pe_val[0]) if not np.isnan(float(pe_val[0])) else 0
                        growth = row["profit_yoy"]
                        if pe > 0 and growth and growth > 0:
                            row["peg"] = round(pe / growth, 4)

                    fundamental_data.append(row)
                    time.sleep(0.3)
                except Exception:
                    fundamental_data.append({"code": code})

        if fundamental_data:
            fund_df = pd.DataFrame(fundamental_data)
            for col in fund_df.columns:
                if col != "code":
                    fund_df[col] = pd.to_numeric(fund_df[col], errors="coerce")
            df = df.merge(fund_df, on="code", how="left", suffixes=("", "_fund"))

        return df

    def _apply_gate(self, df: pd.DataFrame, gate: dict) -> pd.DataFrame:
        factor = gate.get("factor", "")
        op = gate.get("op", ">=")
        value = gate.get("value")

        if factor not in df.columns:
            return df

        col = pd.to_numeric(df[factor], errors="coerce")
        if op == ">":
            mask = col > value
        elif op == ">=":
            mask = col >= value
        elif op == "<":
            mask = col < value
        elif op == "<=":
            mask = col <= value
        elif op == "==":
            mask = col == value
        elif op == "!=":
            mask = col != value
        elif op == "between":
            lo, hi = value[0], value[1]
            mask = (col >= lo) & (col <= hi)
        elif op == "in":
            mask = col.isin(value)
        else:
            return df

        return df[mask].reset_index(drop=True)

    def _gate_diagnostic(self, df: pd.DataFrame, gate: dict) -> dict:
        factor = gate.get("factor", "")
        op = gate.get("op", ">=")
        value = gate.get("value")
        if factor not in df.columns:
            return {
                "factor": factor,
                "op": op,
                "value": value,
                "available_rows": 0,
                "total_rows": int(len(df)),
                "missing_rows": int(len(df)),
                "status": "missing-factor",
            }
        col = pd.to_numeric(df[factor], errors="coerce")
        available = int(col.notna().sum())
        return {
            "factor": factor,
            "op": op,
            "value": value,
            "available_rows": available,
            "total_rows": int(len(df)),
            "missing_rows": int(len(df) - available),
            "status": "ok" if available > 0 else "no-values",
        }

    def _skipped_gate_diagnostics(self, gates: list) -> list[dict]:
        diagnostics = []
        for gate in gates:
            diagnostics.append({
                "factor": gate.get("factor", ""),
                "op": gate.get("op", ">="),
                "value": gate.get("value"),
                "available_rows": 0,
                "total_rows": 0,
                "missing_rows": 0,
                "status": "not-evaluated-after-prior-empty-gate",
            })
        return diagnostics

    def _compute_score(self, df: pd.DataFrame, scoring_cfg: dict) -> pd.DataFrame:
        weights = scoring_cfg.get("weights", {})
        normalize = scoring_cfg.get("normalize", "rank")

        scores = pd.Series(0.0, index=df.index)
        total_weight = sum(weights.values())
        if total_weight == 0:
            df["composite_score"] = 0
            return df

        for factor, weight in weights.items():
            if factor not in df.columns:
                continue
            col = pd.to_numeric(df[factor], errors="coerce")
            fdef = STOCK_FACTORS.get(factor)
            ascending = True if fdef and fdef.higher_is_better else False

            if normalize == "rank":
                normalized = col.rank(pct=True, ascending=ascending, na_option="bottom")
            elif normalize == "zscore":
                mean = col.mean()
                std = col.std()
                normalized = (col - mean) / std if std > 0 else 0
                if not ascending:
                    normalized = -normalized
            elif normalize == "minmax":
                mn, mx = col.min(), col.max()
                normalized = (col - mn) / (mx - mn) if mx > mn else 0
                if not ascending:
                    normalized = 1 - normalized
            else:
                normalized = col.rank(pct=True, ascending=ascending)

            scores += normalized * (weight / total_weight)

        df["composite_score"] = (scores * 100).round(2)
        return df

    def _format_results(self, df: pd.DataFrame, gates: list, include_fv: bool) -> list[dict]:
        results = []
        for _, row in df.iterrows():
            stock = {
                "code": str(row.get("code", "")),
                "name": str(row.get("name", "")),
                "price": self._safe_num(row.get("price")),
                "market_cap": self._safe_num(row.get("market_cap")),
            }
            if "composite_score" in row:
                stock["composite_score"] = self._safe_num(row.get("composite_score"))

            factors = {}
            for factor in STOCK_FACTORS:
                if factor in row.index:
                    v = self._safe_num(row.get(factor))
                    if v is not None:
                        factors[factor] = v
            stock["factors"] = factors

            if include_fv:
                stock["fair_value"] = self.fair_value(str(row.get("code", "")))

            results.append(stock)
        return results

    def _safe_num(self, v) -> float | None:
        if v is None or (isinstance(v, float) and (np.isnan(v) or np.isinf(v))):
            return None
        try:
            return round(float(v), 4)
        except (TypeError, ValueError):
            return None

    def fair_value(self, code: str) -> dict:
        """PE中位数法合理估值: 取5年PE分布中位数 × 预测EPS."""
        import akshare as ak
        try:
            df = ak.stock_zh_a_hist(symbol=code, period="daily", adjust="qfq")
            rename = {"日期": "date", "收盘": "close"}
            df = df.rename(columns=rename)
            df["close"] = pd.to_numeric(df["close"], errors="coerce")
            current_price = float(df["close"].iloc[-1])

            eps = current_price / 20
            growth_rate = 0.1
            try:
                fin = ak.stock_financial_analysis_indicator(symbol=code)
                if fin is not None and len(fin) > 0:
                    latest = fin.iloc[0]
                    for col in ["摊薄每股收益", "基本每股收益"]:
                        if col in latest.index:
                            v = pd.to_numeric(latest[col], errors="coerce")
                            if not np.isnan(v) and v > 0:
                                eps = float(v)
                                break
                    for col in ["归属净利润同比增长率", "净利润同比增长率"]:
                        if col in latest.index:
                            v = pd.to_numeric(latest[col], errors="coerce")
                            if not np.isnan(v):
                                growth_rate = float(v) / 100
                                break
            except Exception:
                pass

            pe_history = []
            close_arr = df["close"].values
            n = len(close_arr)
            if eps > 0 and n > 250:
                step = max(1, n // 250)
                for i in range(0, n, step):
                    pe = float(close_arr[i]) / eps
                    if 0 < pe < 200:
                        pe_history.append(pe)

            if pe_history:
                pe_median = float(np.median(pe_history))
                pe_25 = float(np.percentile(pe_history, 25))
                pe_75 = float(np.percentile(pe_history, 75))
            else:
                pe_median = current_price / eps if eps > 0 else 20
                pe_25 = pe_median * 0.7
                pe_75 = pe_median * 1.3

            projected_eps = eps * (1 + growth_rate)
            fair_price = pe_median * projected_eps
            conservative_price = pe_25 * projected_eps
            optimistic_price = pe_75 * projected_eps

            return {
                "code": code,
                "current_price": round(current_price, 2),
                "eps": round(eps, 4),
                "growth_rate": round(growth_rate, 4),
                "projected_eps": round(projected_eps, 4),
                "pe_median": round(pe_median, 2),
                "pe_25th": round(pe_25, 2),
                "pe_75th": round(pe_75, 2),
                "fair_price": round(fair_price, 2),
                "conservative_price": round(conservative_price, 2),
                "optimistic_price": round(optimistic_price, 2),
                "margin_of_safety": round((fair_price - current_price) / current_price, 4) if current_price > 0 else 0,
                "upside": round((optimistic_price - current_price) / current_price, 4) if current_price > 0 else 0,
            }
        except Exception as e:
            return {"code": code, "error": str(e)}
