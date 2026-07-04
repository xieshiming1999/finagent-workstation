"""Strategy base class + 7 built-in strategies."""
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Optional
import numpy as np
import pandas as pd

from .engine import DataFeed, Broker
from .orders import OrderType, OrderSide


class Strategy(ABC):
    broker: Broker
    data: dict[str, DataFeed]
    params: dict

    def __init__(self, params: dict | None = None):
        self.params = params or {}
        self.broker = None  # type: ignore
        self.data = {}

    def init(self):
        pass

    @abstractmethod
    def next(self):
        pass

    @property
    def feed(self) -> DataFeed:
        return list(self.data.values())[0]

    def buy(self, code: str | None = None, size: float | None = None,
            price: float | None = None, order_type: OrderType = OrderType.MARKET,
            stop_price: float | None = None, reason: str = ""):
        code = code or self.feed.code
        feed = self.data.get(code, self.feed)
        self.broker.submit_order(
            code=code, side=OrderSide.BUY, size=size,
            price=price or feed.close, stop_price=stop_price,
            order_type=order_type, bar=feed.bar, date=feed.date, reason=reason,
        )

    def sell(self, code: str | None = None, size: float | None = None,
             price: float | None = None, order_type: OrderType = OrderType.MARKET,
             stop_price: float | None = None, reason: str = ""):
        code = code or self.feed.code
        feed = self.data.get(code, self.feed)
        self.broker.submit_order(
            code=code, side=OrderSide.SELL, size=size,
            price=price or feed.close, stop_price=stop_price,
            order_type=order_type, bar=feed.bar, date=feed.date, reason=reason,
        )

    def close(self, code: str | None = None, reason: str = ""):
        code = code or self.feed.code
        pos = self.broker.get_position(code)
        if pos.size > 0:
            self.sell(code, size=pos.size, reason=reason)
        elif pos.size < 0:
            self.buy(code, size=abs(pos.size), reason=reason)

    def position(self, code: str | None = None) -> float:
        code = code or self.feed.code
        return self.broker.get_position(code).size

    def _add_ta(self, feed: DataFeed, indicator: str, **kwargs):
        try:
            import pandas_ta as ta
            result = feed.df.ta.__getattribute__(indicator)(**kwargs)
            if isinstance(result, pd.DataFrame):
                for col in result.columns:
                    feed.add_indicator(col, result[col])
            elif isinstance(result, pd.Series):
                feed.add_indicator(f"{indicator}_{kwargs.get('length', '')}", result)
        except Exception:
            pass


class RSIStrategy(Strategy):
    def init(self):
        period = self.params.get("period", 14)
        oversold = self.params.get("oversold", 30)
        overbought = self.params.get("overbought", 70)
        self._oversold = oversold
        self._overbought = overbought
        for feed in self.data.values():
            self._add_ta(feed, "rsi", length=period)

    def next(self):
        for code, feed in self.data.items():
            rsi_col = [c for c in feed.df.columns if "rsi" in c.lower()]
            if not rsi_col:
                continue
            rsi = feed.get(rsi_col[0])
            if np.isnan(rsi):
                continue
            pos = self.position(code)
            if pos == 0 and rsi < self._oversold:
                self.buy(code, reason=f"RSI={rsi:.1f}<{self._oversold}")
            elif pos > 0 and rsi > self._overbought:
                self.close(code, reason=f"RSI={rsi:.1f}>{self._overbought}")


class MACDCrossStrategy(Strategy):
    def init(self):
        fast = self.params.get("fast", 12)
        slow = self.params.get("slow", 26)
        signal = self.params.get("signal", 9)
        for feed in self.data.values():
            self._add_ta(feed, "macd", fast=fast, slow=slow, signal=signal)

    def next(self):
        for code, feed in self.data.items():
            macd_col = [c for c in feed.df.columns if "MACD_" in c and "h" not in c.lower() and "s" not in c.lower()]
            signal_col = [c for c in feed.df.columns if "MACDs_" in c]
            if not macd_col or not signal_col:
                continue
            macd = feed.get(macd_col[0])
            sig = feed.get(signal_col[0])
            prev_macd = feed.get(macd_col[0], 1)
            prev_sig = feed.get(signal_col[0], 1)
            if any(np.isnan(v) for v in [macd, sig, prev_macd, prev_sig]):
                continue
            pos = self.position(code)
            if pos == 0 and prev_macd <= prev_sig and macd > sig:
                self.buy(code, reason="MACD golden cross")
            elif pos > 0 and prev_macd >= prev_sig and macd < sig:
                self.close(code, reason="MACD death cross")


class BollingerStrategy(Strategy):
    def init(self):
        period = self.params.get("period", 20)
        std = self.params.get("std_dev", 2.0)
        for feed in self.data.values():
            self._add_ta(feed, "bbands", length=period, std=std)

    def next(self):
        for code, feed in self.data.items():
            lower_col = [c for c in feed.df.columns if "BBL_" in c]
            upper_col = [c for c in feed.df.columns if "BBU_" in c]
            mid_col = [c for c in feed.df.columns if "BBM_" in c]
            if not lower_col or not upper_col:
                continue
            lower = feed.get(lower_col[0])
            upper = feed.get(upper_col[0])
            close = feed.close
            if np.isnan(lower) or np.isnan(upper):
                continue
            pos = self.position(code)
            if pos == 0 and close < lower:
                self.buy(code, reason=f"price {close:.2f} < BBL {lower:.2f}")
            elif pos > 0 and close > upper:
                self.close(code, reason=f"price {close:.2f} > BBU {upper:.2f}")


class EMACrossStrategy(Strategy):
    def init(self):
        fast = self.params.get("fast", 5)
        slow = self.params.get("slow", 20)
        for feed in self.data.values():
            self._add_ta(feed, "ema", length=fast)
            self._add_ta(feed, "ema", length=slow)
        self._fast = fast
        self._slow = slow

    def next(self):
        for code, feed in self.data.items():
            fast_col = f"ema_{self._fast}"
            slow_col = f"ema_{self._slow}"
            if fast_col not in feed.df.columns or slow_col not in feed.df.columns:
                fast_col = [c for c in feed.df.columns if f"EMA_{self._fast}" in c]
                slow_col = [c for c in feed.df.columns if f"EMA_{self._slow}" in c]
                if not fast_col or not slow_col:
                    continue
                fast_col, slow_col = fast_col[0], slow_col[0]
            ema_f = feed.get(fast_col)
            ema_s = feed.get(slow_col)
            prev_f = feed.get(fast_col, 1)
            prev_s = feed.get(slow_col, 1)
            if any(np.isnan(v) for v in [ema_f, ema_s, prev_f, prev_s]):
                continue
            pos = self.position(code)
            if pos == 0 and prev_f <= prev_s and ema_f > ema_s:
                self.buy(code, reason=f"EMA{self._fast} cross above EMA{self._slow}")
            elif pos > 0 and prev_f >= prev_s and ema_f < ema_s:
                self.close(code, reason=f"EMA{self._fast} cross below EMA{self._slow}")


class DualMAStrategy(Strategy):
    def init(self):
        fast = self.params.get("fast", 5)
        slow = self.params.get("slow", 20)
        for feed in self.data.values():
            self._add_ta(feed, "sma", length=fast)
            self._add_ta(feed, "sma", length=slow)
        self._fast = fast
        self._slow = slow

    def next(self):
        for code, feed in self.data.items():
            fast_col = [c for c in feed.df.columns if f"SMA_{self._fast}" in c]
            slow_col = [c for c in feed.df.columns if f"SMA_{self._slow}" in c]
            if not fast_col or not slow_col:
                continue
            ma_f = feed.get(fast_col[0])
            ma_s = feed.get(slow_col[0])
            prev_f = feed.get(fast_col[0], 1)
            prev_s = feed.get(slow_col[0], 1)
            if any(np.isnan(v) for v in [ma_f, ma_s, prev_f, prev_s]):
                continue
            pos = self.position(code)
            if pos == 0 and prev_f <= prev_s and ma_f > ma_s:
                self.buy(code, reason=f"MA{self._fast} golden cross MA{self._slow}")
            elif pos > 0 and prev_f >= prev_s and ma_f < ma_s:
                self.close(code, reason=f"MA{self._fast} death cross MA{self._slow}")


class TurtleStrategy(Strategy):
    def init(self):
        self._entry = self.params.get("entry_period", 20)
        self._exit = self.params.get("exit_period", 10)

    def next(self):
        for code, feed in self.data.items():
            if feed.bar < self._entry:
                continue
            highs = feed.slice("high", self._entry)
            lows = feed.slice("low", self._exit)
            entry_high = np.max(highs[:-1]) if len(highs) > 1 else highs[0]
            exit_low = np.min(lows[:-1]) if len(lows) > 1 else lows[0]
            close = feed.close
            pos = self.position(code)
            if pos == 0 and close > entry_high:
                self.buy(code, reason=f"breakout {self._entry}d high {entry_high:.2f}")
            elif pos > 0 and close < exit_low:
                self.close(code, reason=f"break below {self._exit}d low {exit_low:.2f}")


class MeanReversionStrategy(Strategy):
    def init(self):
        self._period = self.params.get("period", 20)
        self._z_entry = self.params.get("z_entry", 2.0)
        self._z_exit = self.params.get("z_exit", 0.0)

    def next(self):
        for code, feed in self.data.items():
            if feed.bar < self._period:
                continue
            closes = feed.slice("close", self._period)
            mean = np.mean(closes)
            std = np.std(closes)
            if std < 1e-10:
                continue
            z = (feed.close - mean) / std
            pos = self.position(code)
            if pos == 0 and z < -self._z_entry:
                self.buy(code, reason=f"z-score={z:.2f} < -{self._z_entry}")
            elif pos > 0 and z > self._z_exit:
                self.close(code, reason=f"z-score={z:.2f} > {self._z_exit}")


class BuyAndHoldStrategy(Strategy):
    def next(self):
        for code, feed in self.data.items():
            if feed.bar == 0 and self.position(code) == 0:
                self.buy(code, reason="buy and hold baseline")


STRATEGY_REGISTRY: dict[str, type[Strategy]] = {
    "rsi": RSIStrategy,
    "macd_cross": MACDCrossStrategy,
    "bollinger": BollingerStrategy,
    "ema_cross": EMACrossStrategy,
    "dual_ma": DualMAStrategy,
    "turtle": TurtleStrategy,
    "mean_reversion": MeanReversionStrategy,
    "buy_and_hold": BuyAndHoldStrategy,
    "buy_hold": BuyAndHoldStrategy,
}

STRATEGY_INFO = [
    {"name": "rsi", "display": "RSI Oversold/Overbought", "params": {"period": 14, "oversold": 30, "overbought": 70}},
    {"name": "macd_cross", "display": "MACD Cross", "params": {"fast": 12, "slow": 26, "signal": 9}},
    {"name": "bollinger", "display": "Bollinger Band", "params": {"period": 20, "std_dev": 2.0}},
    {"name": "ema_cross", "display": "EMA Cross", "params": {"fast": 5, "slow": 20}},
    {"name": "dual_ma", "display": "Dual MA (SMA)", "params": {"fast": 5, "slow": 20}},
    {"name": "turtle", "display": "Turtle (Donchian Breakout)", "params": {"entry_period": 20, "exit_period": 10}},
    {"name": "mean_reversion", "display": "Mean Reversion (Z-Score)", "params": {"period": 20, "z_entry": 2.0, "z_exit": 0.0}},
    {"name": "buy_and_hold", "display": "Buy and Hold Baseline", "params": {}},
]


def create_strategy(name: str, params: dict | None = None) -> Strategy:
    cls = STRATEGY_REGISTRY.get(name)
    if not cls:
        raise ValueError(f"Unknown strategy: {name}. Available: {list(STRATEGY_REGISTRY.keys())}")
    return cls(params or {})
