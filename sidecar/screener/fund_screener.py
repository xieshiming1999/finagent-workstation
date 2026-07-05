"""Fund screener: 4433 rule, custom criteria, manager screening."""
from __future__ import annotations
import numpy as np
import pandas as pd


class FundScreener:
    def screen(self, config: dict) -> dict:
        mode = config.get("mode", "4433")
        fund_type = config.get("fund_type")
        limit = config.get("limit", 30)

        df = self._load_funds(fund_type)
        if df is None or len(df) == 0:
            return {"status": "error", "error": "Failed to load fund data"}

        total = len(df)
        diagnostics = []

        if mode == "4433":
            df = self._apply_4433(df, config)
        elif mode == "manager":
            return self._screen_managers(config)
        elif mode == "custom":
            gates = config.get("gates", [])
            for gate in gates:
                df = self._apply_gate(df, gate)

        min_aum = config.get("min_aum")
        if min_aum:
            min_yi = min_aum / 1e8 if min_aum > 1e6 else min_aum
            aum = pd.to_numeric(df.get("aum", pd.Series(dtype=float)), errors="coerce")
            if aum.notna().sum() > 0:
                df = df[aum >= min_yi]
            else:
                diagnostics.append({
                    "factor": "aum",
                    "op": ">=",
                    "value": min_yi,
                    "available_rows": 0,
                    "total_rows": int(len(df)),
                    "missing_rows": int(len(df)),
                    "status": "skipped-no-values",
                    "message": "fund size/aum is unavailable in the local screening universe; do not treat this as zero funds satisfying the size gate",
                })

        sort_by = config.get("sort_by", "return_1y")
        if sort_by in df.columns:
            df = df.sort_values(sort_by, ascending=False, na_position="last")

        result_df = df.head(limit)
        funds = self._format_results(result_df)

        return {
            "status": "ok",
            "mode": mode,
            "total_universe": total,
            "passed": len(df),
            "returned": len(funds),
            "funds": funds,
            "data_source": str(df.attrs.get("data_source", "unknown")),
            "coverage": df.attrs.get("coverage", {}),
            "diagnostics": diagnostics,
        }

    def _load_funds(self, fund_type: str | None) -> pd.DataFrame | None:
        from local_cache import get_local_cache
        cache = get_local_cache()
        local_df = cache.query_fund_screening_universe(fund_type)
        if local_df is not None and len(local_df) > 0:
            local_df = self._normalize_fund_rows(local_df)
            if len(local_df) > 0:
                local_df.attrs["data_source"] = "local"
                local_df.attrs["coverage"] = self._coverage(local_df)
                return local_df.reset_index(drop=True)

        import akshare as ak
        try:
            symbol = self._provider_fund_type(fund_type)
            df = ak.fund_open_fund_rank_em(symbol=symbol)
            rename = {
                "基金代码": "code", "基金简称": "name",
                "近1年": "return_1y", "近3年": "return_3y", "近5年": "return_5y",
                "今年来": "return_ytd", "近6月": "return_6m", "近3月": "return_3m",
                "近1月": "return_1m", "近1周": "return_1w",
                "日期": "nav_date", "单位净值": "nav",
            }
            df = df.rename(columns=rename)

            for col in ["return_1y", "return_3y", "return_5y", "return_ytd",
                        "return_6m", "return_3m", "return_1m", "return_1w", "nav"]:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors="coerce")

            df = df.reset_index(drop=True)
            df.attrs["data_source"] = "akshare"
            df.attrs["coverage"] = self._coverage(df)
            return df
        except Exception:
            return None

    def _provider_fund_type(self, fund_type: str | None) -> str:
        if not fund_type:
            return "全部"
        key = str(fund_type).strip().lower()
        aliases = {
            "mixed": "混合型",
            "hybrid": "混合型",
            "stock": "股票型",
            "equity": "股票型",
            "bond": "债券型",
            "money": "货币型",
            "money_market": "货币型",
            "index": "指数型",
            "qdii": "QDII",
            "fof": "FOF",
        }
        return aliases.get(key, str(fund_type))

    def _normalize_fund_rows(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        if "code" not in df.columns:
            return pd.DataFrame()
        if "name" not in df.columns:
            df["name"] = ""
        df["code"] = df["code"].astype(str).str.extract(r"(\d{6})", expand=False).fillna(df["code"].astype(str))
        for col in ["return_1y", "return_3y", "return_5y", "return_ytd",
                    "return_6m", "return_3m", "return_1m", "return_1w", "nav", "aum"]:
            if col not in df.columns:
                df[col] = np.nan
            else:
                df[col] = pd.to_numeric(df[col], errors="coerce")
        return df[df["code"].astype(str).str.match(r"^\d{6}$", na=False)]

    def _coverage(self, df: pd.DataFrame) -> dict:
        fields = ["return_ytd", "return_1w", "return_1m", "return_3m", "return_6m", "return_1y", "return_3y", "nav", "aum"]
        coverage = {"rows": int(len(df))}
        for field in fields:
            if field in df.columns:
                coverage[field] = int(pd.to_numeric(df[field], errors="coerce").notna().sum())
        return coverage

    def _apply_4433(self, df: pd.DataFrame, config: dict) -> pd.DataFrame:
        result = df.copy()

        if "return_1y" in result.columns:
            series = pd.to_numeric(result["return_1y"], errors="coerce")
            if series.notna().sum() > 0:
                threshold = series.quantile(0.75)
                result = result[series >= threshold]

        for col in ["return_3y", "return_5y", "return_ytd"]:
            if col in result.columns:
                series = pd.to_numeric(result[col], errors="coerce")
                if series.notna().sum() > 0:
                    q75 = series.quantile(0.75)
                    result = result[series >= q75]

        if "return_6m" in result.columns:
            series = pd.to_numeric(result["return_6m"], errors="coerce")
            if series.notna().sum() > 0:
                q67 = series.quantile(0.67)
                result = result[series >= q67]

        if "return_3m" in result.columns:
            series = pd.to_numeric(result["return_3m"], errors="coerce")
            if series.notna().sum() > 0:
                q67 = series.quantile(0.67)
                result = result[series >= q67]

        return result.reset_index(drop=True)

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
        elif op == "between":
            mask = (col >= value[0]) & (col <= value[1])
        else:
            return df

        return df[mask].reset_index(drop=True)

    def _screen_managers(self, config: dict) -> dict:
        import akshare as ak
        try:
            df = ak.fund_manager_em()
            rename = {
                "姓名": "name", "基金公司": "company",
                "管理规模": "total_aum", "从业年限": "experience",
                "最佳回报": "best_return", "基金数量": "fund_count",
            }
            df = df.rename(columns=rename)
            for col in ["total_aum", "experience", "best_return", "fund_count"]:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors="coerce")

            min_exp = config.get("min_experience", 5)
            if "experience" in df.columns:
                df = df[df["experience"] >= min_exp]

            min_aum = config.get("min_aum")
            if min_aum and "total_aum" in df.columns:
                df = df[df["total_aum"] >= min_aum]

            min_return = config.get("min_best_return")
            if min_return and "best_return" in df.columns:
                df = df[df["best_return"] >= min_return]

            sort_candidates = ["best_return", "total_aum", "experience", "fund_count"]
            sort_col = next((col for col in sort_candidates if col in df.columns), None)
            if sort_col:
                df = df.sort_values(sort_col, ascending=False, na_position="last")
            limit = config.get("limit", 30)
            result_df = df.head(limit)

            managers = []
            for _, row in result_df.iterrows():
                managers.append({
                    "name": str(row.get("name", "")),
                    "company": str(row.get("company", "")),
                    "experience": self._safe_num(row.get("experience")),
                    "total_aum": self._safe_num(row.get("total_aum")),
                    "best_return": self._safe_num(row.get("best_return")),
                    "fund_count": int(row.get("fund_count", 0)) if not pd.isna(row.get("fund_count", 0)) else 0,
                })

            return {
                "status": "ok",
                "mode": "manager",
                "total": len(df),
                "returned": len(managers),
                "managers": managers,
            }
        except Exception as e:
            return {"status": "error", "error": str(e)}

    def _format_results(self, df: pd.DataFrame) -> list[dict]:
        results = []
        for _, row in df.iterrows():
            fund = {
                "code": str(row.get("code", "")),
                "name": str(row.get("name", "")),
                "nav": self._safe_num(row.get("nav")),
                "return_ytd": self._safe_num(row.get("return_ytd")),
                "return_1y": self._safe_num(row.get("return_1y")),
                "return_3y": self._safe_num(row.get("return_3y")),
                "return_5y": self._safe_num(row.get("return_5y")),
                "return_6m": self._safe_num(row.get("return_6m")),
                "return_3m": self._safe_num(row.get("return_3m")),
            }
            results.append(fund)
        return results

    def _safe_num(self, v) -> float | None:
        if v is None or (isinstance(v, float) and (np.isnan(v) or np.isinf(v))):
            return None
        try:
            return round(float(v), 4)
        except (TypeError, ValueError):
            return None
