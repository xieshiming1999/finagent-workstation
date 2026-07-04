"""Backtest analyzers: compute post-run metrics."""
from __future__ import annotations
from abc import ABC, abstractmethod
import math
import numpy as np
from .orders import Trade


class Analyzer(ABC):
    def on_bar(self, bar_idx: int, equity: float, cash: float, positions: dict, prices: dict):
        pass

    def on_trade(self, trade: Trade):
        pass

    @abstractmethod
    def result(self) -> dict:
        pass


class EquityTracker(Analyzer):
    def __init__(self):
        self.equities: list[float] = []

    def on_bar(self, bar_idx, equity, cash, positions, prices):
        self.equities.append(equity)

    def result(self):
        return {}


class TotalReturnAnalyzer(Analyzer):
    def __init__(self):
        self.first = None
        self.last = None

    def on_bar(self, bar_idx, equity, cash, positions, prices):
        if self.first is None:
            self.first = equity
        self.last = equity

    def result(self):
        if not self.first or self.first == 0:
            return {"total_return": 0}
        return {"total_return": round((self.last - self.first) / self.first, 4)}


class AnnualizedReturnAnalyzer(Analyzer):
    def __init__(self):
        self.equities: list[float] = []

    def on_bar(self, bar_idx, equity, cash, positions, prices):
        self.equities.append(equity)

    def result(self):
        if len(self.equities) < 2 or self.equities[0] == 0:
            return {"annualized_return": 0}
        total = self.equities[-1] / self.equities[0]
        years = len(self.equities) / 252
        if years <= 0 or total <= 0:
            return {"annualized_return": 0}
        ann = total ** (1 / years) - 1
        return {"annualized_return": round(ann, 4)}


class MaxDrawdownAnalyzer(Analyzer):
    def __init__(self):
        self.peak = 0
        self.max_dd = 0
        self.max_dd_duration = 0
        self._dd_start = 0
        self._bar = 0

    def on_bar(self, bar_idx, equity, cash, positions, prices):
        self._bar = bar_idx
        if equity > self.peak:
            self.peak = equity
            self._dd_start = bar_idx
        if self.peak > 0:
            dd = (self.peak - equity) / self.peak
            if dd > self.max_dd:
                self.max_dd = dd
            dur = bar_idx - self._dd_start
            if dur > self.max_dd_duration:
                self.max_dd_duration = dur

    def result(self):
        return {
            "max_drawdown": round(self.max_dd, 4),
            "max_drawdown_duration": self.max_dd_duration,
        }


class SharpeRatioAnalyzer(Analyzer):
    def __init__(self, risk_free_rate: float = 0.03, periods_per_year: int = 252):
        self.rf = risk_free_rate
        self.periods = periods_per_year
        self.equities: list[float] = []

    def on_bar(self, bar_idx, equity, cash, positions, prices):
        self.equities.append(equity)

    def result(self):
        if len(self.equities) < 30:
            return {"sharpe_ratio": 0}
        eq = np.array(self.equities)
        returns = np.diff(eq) / eq[:-1]
        returns = returns[np.isfinite(returns)]
        if len(returns) < 2:
            return {"sharpe_ratio": 0}
        excess = returns - self.rf / self.periods
        std = np.std(excess, ddof=1)
        if std < 1e-10:
            return {"sharpe_ratio": 0}
        sharpe = np.mean(excess) / std * math.sqrt(self.periods)
        return {"sharpe_ratio": round(float(sharpe), 4)}


class CalmarRatioAnalyzer(Analyzer):
    def __init__(self):
        self.equities: list[float] = []
        self.peak = 0
        self.max_dd = 0

    def on_bar(self, bar_idx, equity, cash, positions, prices):
        self.equities.append(equity)
        if equity > self.peak:
            self.peak = equity
        if self.peak > 0:
            dd = (self.peak - equity) / self.peak
            if dd > self.max_dd:
                self.max_dd = dd

    def result(self):
        if len(self.equities) < 2 or self.equities[0] == 0 or self.max_dd < 1e-10:
            return {"calmar_ratio": 0}
        total = self.equities[-1] / self.equities[0]
        years = len(self.equities) / 252
        if years <= 0 or total <= 0:
            return {"calmar_ratio": 0}
        ann = total ** (1 / years) - 1
        return {"calmar_ratio": round(ann / self.max_dd, 4)}


class WinRateAnalyzer(Analyzer):
    def __init__(self):
        self.wins = 0
        self.losses = 0

    def on_trade(self, trade: Trade):
        if trade.pnl > 0:
            self.wins += 1
        elif trade.pnl < 0:
            self.losses += 1

    def result(self):
        total = self.wins + self.losses
        if total == 0:
            return {"win_rate": 0, "wins": 0, "losses": 0}
        return {
            "win_rate": round(self.wins / total, 4),
            "wins": self.wins,
            "losses": self.losses,
        }


class ProfitFactorAnalyzer(Analyzer):
    def __init__(self):
        self.gross_profit = 0.0
        self.gross_loss = 0.0

    def on_trade(self, trade: Trade):
        if trade.pnl > 0:
            self.gross_profit += trade.pnl
        elif trade.pnl < 0:
            self.gross_loss += abs(trade.pnl)

    def result(self):
        if self.gross_loss < 1e-10:
            pf = float("inf") if self.gross_profit > 0 else 0
        else:
            pf = self.gross_profit / self.gross_loss
        return {
            "profit_factor": round(pf, 4) if pf != float("inf") else 999.0,
            "gross_profit": round(self.gross_profit, 2),
            "gross_loss": round(self.gross_loss, 2),
        }


class TradeCountAnalyzer(Analyzer):
    def __init__(self):
        self.count = 0
        self.avg_bars = 0
        self.total_bars = 0

    def on_trade(self, trade: Trade):
        self.count += 1
        self.total_bars += trade.bars_held

    def result(self):
        return {
            "trade_count": self.count,
            "avg_holding_bars": round(self.total_bars / self.count, 1) if self.count else 0,
        }


class SQNAnalyzer(Analyzer):
    """System Quality Number (Van Tharp)."""
    def __init__(self):
        self.r_multiples: list[float] = []

    def on_trade(self, trade: Trade):
        if trade.entry_price > 0:
            self.r_multiples.append(trade.pnl_pct)

    def result(self):
        if len(self.r_multiples) < 10:
            return {"sqn": 0}
        arr = np.array(self.r_multiples)
        std = np.std(arr, ddof=1)
        if std < 1e-10:
            return {"sqn": 0}
        sqn = math.sqrt(len(arr)) * np.mean(arr) / std
        return {"sqn": round(float(sqn), 4)}


class BenchmarkComparisonAnalyzer(Analyzer):
    def __init__(self):
        self.equities: list[float] = []
        self.benchmark_prices: list[float] = []

    def on_bar(self, bar_idx, equity, cash, positions, prices):
        self.equities.append(equity)

    def set_benchmark(self, prices: list[float]):
        self.benchmark_prices = prices

    def result(self):
        if len(self.equities) < 30:
            return {"alpha": 0, "beta": 0, "information_ratio": 0}

        eq = np.array(self.equities)
        strat_ret = np.diff(eq) / eq[:-1]
        strat_ret = strat_ret[np.isfinite(strat_ret)]

        if not self.benchmark_prices or len(self.benchmark_prices) < len(self.equities):
            total_ret = eq[-1] / eq[0] - 1 if eq[0] > 0 else 0
            ann_years = len(eq) / 252
            ann_ret = (1 + total_ret) ** (1 / ann_years) - 1 if ann_years > 0 and total_ret > -1 else 0
            return {"alpha": round(float(ann_ret), 4), "beta": 0, "information_ratio": 0}

        bench = np.array(self.benchmark_prices[:len(self.equities)])
        bench_ret = np.diff(bench) / bench[:-1]
        bench_ret = bench_ret[np.isfinite(bench_ret)]

        n = min(len(strat_ret), len(bench_ret))
        if n < 30:
            return {"alpha": 0, "beta": 0, "information_ratio": 0}

        sr = strat_ret[:n]
        br = bench_ret[:n]

        cov = np.cov(sr, br)
        beta = float(cov[0, 1] / cov[1, 1]) if cov[1, 1] > 1e-10 else 0

        ann_strat = float(np.mean(sr) * 252)
        ann_bench = float(np.mean(br) * 252)
        alpha = ann_strat - beta * ann_bench

        excess = sr - br
        te = float(np.std(excess, ddof=1) * math.sqrt(252))
        ir = float(np.mean(excess) * 252 / te) if te > 1e-10 else 0

        return {
            "alpha": round(alpha, 4),
            "beta": round(beta, 4),
            "information_ratio": round(ir, 4),
            "tracking_error": round(te, 4),
        }


ANALYZER_REGISTRY: dict[str, type[Analyzer]] = {
    "total_return": TotalReturnAnalyzer,
    "annualized_return": AnnualizedReturnAnalyzer,
    "max_drawdown": MaxDrawdownAnalyzer,
    "sharpe": SharpeRatioAnalyzer,
    "calmar": CalmarRatioAnalyzer,
    "win_rate": WinRateAnalyzer,
    "profit_factor": ProfitFactorAnalyzer,
    "trade_count": TradeCountAnalyzer,
    "sqn": SQNAnalyzer,
    "benchmark_comparison": BenchmarkComparisonAnalyzer,
    "equity_curve": EquityTracker,
}

DEFAULT_ANALYZERS = ["total_return", "annualized_return", "max_drawdown", "sharpe", "win_rate", "profit_factor", "trade_count"]


def create_analyzers(names: list[str] | None = None, config: dict | None = None) -> list[Analyzer]:
    names = names or DEFAULT_ANALYZERS
    cfg = config or {}
    analyzers = []
    for name in names:
        cls = ANALYZER_REGISTRY.get(name)
        if cls:
            if cls == SharpeRatioAnalyzer:
                analyzers.append(cls(risk_free_rate=cfg.get("risk_free_rate", 0.03)))
            else:
                analyzers.append(cls())
    return analyzers
