"""Factor backtest: expression → quantile ranking → rebalance → returns."""
from __future__ import annotations
import math
import numpy as np
import pandas as pd


def safe_eval_expression(expr: str, df: pd.DataFrame) -> pd.Series:
    """Evaluate a factor expression on a DataFrame with OHLCV columns."""
    close = df["close"]
    open_ = df["open"]
    high = df["high"]
    low = df["low"]
    volume = df["volume"]

    def sma(s, n):
        return s.rolling(n).mean()
    def ema(s, n):
        return s.ewm(span=n).mean()
    def std(s, n):
        return s.rolling(n).std()
    def rolling_max(s, n):
        return s.rolling(n).max()
    def rolling_min(s, n):
        return s.rolling(n).min()
    def rank(s):
        return s.rank(pct=True)
    def delay(s, n):
        return s.shift(n)
    def delta(s, n):
        return s - s.shift(n)
    def returns(s, n=1):
        return s.pct_change(n)

    namespace = {
        "close": close, "open": open_, "high": high, "low": low, "volume": volume,
        "sma": sma, "ema": ema, "std": std,
        "max": rolling_max, "min": rolling_min,
        "rank": rank, "delay": delay, "delta": delta, "returns": returns,
        "log": np.log, "abs": np.abs, "sign": np.sign, "sqrt": np.sqrt,
    }
    return eval(expr, {"__builtins__": {}, "np": np, "pd": pd}, namespace)


class FactorBacktest:
    def __init__(self, config: dict):
        self.expression = config.get("expression", "close / sma(close, 20) - 1")
        self.universe_codes: list[str] = config.get("codes", [])
        self.start = config.get("start", "2020-01-01")
        self.end = config.get("end")
        self.quantiles = config.get("quantiles", 5)
        self.rebalance_days = config.get("rebalance_days", 20)
        self.cost_rate = config.get("cost_rate", 0.003)

    def run(self) -> dict:
        from local_cache import get_local_cache
        import akshare as ak

        if not self.universe_codes:
            return {"error": "codes required for factor backtest"}

        cache = get_local_cache()
        all_data: dict[str, pd.DataFrame] = {}
        remote_count = 0

        for code in self.universe_codes[:100]:
            try:
                # Try local first
                local_df = cache.query_kline(code, start=self.start, end=self.end)
                if local_df is not None and len(local_df) > 50:
                    df = local_df
                    for col in ["open", "high", "low", "close", "volume"]:
                        if col in df.columns:
                            df[col] = pd.to_numeric(df[col], errors="coerce")
                    if "date" in df.columns:
                        df["date"] = pd.to_datetime(df["date"])
                    all_data[code] = df.reset_index(drop=True)
                    continue

                # Remote — but limit to avoid full-market scan
                remote_count += 1
                if remote_count > 10:
                    continue  # Skip — too many remote fetches

                df = ak.stock_zh_a_hist(symbol=code, period="daily", adjust="qfq")
                df.columns = [c.lower() for c in df.columns]
                rename = {"日期": "date", "开盘": "open", "最高": "high", "最低": "low", "收盘": "close", "成交量": "volume"}
                df = df.rename(columns=rename)
                for col in ["open", "high", "low", "close", "volume"]:
                    if col in df.columns:
                        df[col] = pd.to_numeric(df[col], errors="coerce")
                if "date" in df.columns:
                    df["date"] = pd.to_datetime(df["date"])
                    if self.start:
                        df = df[df["date"] >= self.start]
                    if self.end:
                        df = df[df["date"] <= self.end]
                if len(df) > 50:
                    all_data[code] = df.reset_index(drop=True)
            except Exception:
                continue

        if len(all_data) < 5:
            local_available = len(all_data)
            return {
                "error": f"Insufficient data: only {local_available} stocks have local kline data. "
                         f"Use Data Manager to download kline data for the target universe first. "
                         f"(DataStore action='fetch', type='kline', codes='{','.join(self.universe_codes[:5])}...')",
                "available_locally": local_available,
                "requested": len(self.universe_codes),
            }

        dates_set = set()
        for df in all_data.values():
            dates_set.update(df["date"].tolist())
        all_dates = sorted(dates_set)

        rebalance_dates = all_dates[::self.rebalance_days]
        group_returns = {i: [] for i in range(self.quantiles)}
        ic_values = []

        for rb_idx in range(len(rebalance_dates) - 1):
            rb_date = rebalance_dates[rb_idx]
            next_date = rebalance_dates[rb_idx + 1]

            factor_values = {}
            forward_returns = {}

            for code, df in all_data.items():
                mask = df["date"] <= rb_date
                hist = df[mask]
                if len(hist) < 30:
                    continue
                try:
                    fv = safe_eval_expression(self.expression, hist)
                    val = float(fv.iloc[-1])
                    if not np.isfinite(val):
                        continue
                    factor_values[code] = val
                except Exception:
                    continue

                future = df[(df["date"] > rb_date) & (df["date"] <= next_date)]
                if len(future) > 0 and len(hist) > 0:
                    entry = float(hist["close"].iloc[-1])
                    exit_p = float(future["close"].iloc[-1])
                    if entry > 0:
                        forward_returns[code] = (exit_p / entry - 1) - self.cost_rate

            common = set(factor_values) & set(forward_returns)
            if len(common) < self.quantiles * 2:
                continue

            codes_sorted = sorted(common, key=lambda c: factor_values[c])
            n = len(codes_sorted)
            group_size = n // self.quantiles

            for q in range(self.quantiles):
                start = q * group_size
                end = start + group_size if q < self.quantiles - 1 else n
                group_codes = codes_sorted[start:end]
                if group_codes:
                    avg_ret = np.mean([forward_returns[c] for c in group_codes])
                    group_returns[q].append(float(avg_ret))

            fv_arr = np.array([factor_values[c] for c in common])
            fr_arr = np.array([forward_returns[c] for c in common])
            if len(fv_arr) > 5:
                ic = float(np.corrcoef(fv_arr, fr_arr)[0, 1])
                if np.isfinite(ic):
                    ic_values.append(ic)

        results = {}
        for q in range(self.quantiles):
            rets = group_returns[q]
            if rets:
                cum = 1.0
                for r in rets:
                    cum *= (1 + r)
                results[f"Q{q+1}_total_return"] = round(cum - 1, 4)
                results[f"Q{q+1}_avg_return"] = round(float(np.mean(rets)), 4)
                results[f"Q{q+1}_periods"] = len(rets)

        if ic_values:
            results["IC_mean"] = round(float(np.mean(ic_values)), 4)
            results["IC_std"] = round(float(np.std(ic_values)), 4)
            ic_std = np.std(ic_values)
            results["ICIR"] = round(float(np.mean(ic_values) / ic_std), 4) if ic_std > 1e-10 else 0
            results["IC_positive_pct"] = round(sum(1 for ic in ic_values if ic > 0) / len(ic_values), 4)

        top_rets = group_returns.get(self.quantiles - 1, [])
        bottom_rets = group_returns.get(0, [])
        if top_rets and bottom_rets:
            spread = [t - b for t, b in zip(top_rets, bottom_rets)]
            cum_spread = 1.0
            for s in spread:
                cum_spread *= (1 + s)
            results["long_short_return"] = round(cum_spread - 1, 4)
            if spread:
                results["long_short_sharpe"] = round(
                    float(np.mean(spread) / np.std(spread) * math.sqrt(252 / self.rebalance_days))
                    if np.std(spread) > 1e-10 else 0, 4)

        results["monotonicity"] = self._check_monotonicity(group_returns)

        return {
            "status": "ok",
            "expression": self.expression,
            "universe_size": len(all_data),
            "quantiles": self.quantiles,
            "rebalance_days": self.rebalance_days,
            "metrics": results,
        }

    def _check_monotonicity(self, group_returns: dict) -> float:
        avg_rets = []
        for q in range(self.quantiles):
            rets = group_returns.get(q, [])
            avg_rets.append(float(np.mean(rets)) if rets else 0)
        if len(avg_rets) < 2:
            return 0
        diffs = [avg_rets[i+1] - avg_rets[i] for i in range(len(avg_rets) - 1)]
        positive = sum(1 for d in diffs if d > 0)
        return round(positive / len(diffs), 4)
