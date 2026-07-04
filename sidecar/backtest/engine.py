"""Core backtest engine: DataFeed, Position, Broker, Cerebro."""
from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Optional
import numpy as np
import pandas as pd

from .orders import (
    Order, OrderType, OrderSide, OrderStatus, Trade,
    CommissionModel, SlippageModel,
)
from .sizers import PositionSizer, create_sizer


class DataFeed:
    def __init__(self, code: str, df: pd.DataFrame):
        self.code = code
        required = {"date", "open", "high", "low", "close", "volume"}
        missing = required - set(df.columns)
        if missing:
            raise ValueError(f"DataFeed {code}: missing columns {missing}")
        self.df = df.reset_index(drop=True)
        self.bar = 0
        self._len = len(df)

    def __len__(self):
        return self._len

    def advance(self):
        self.bar += 1

    @property
    def current(self) -> pd.Series:
        return self.df.iloc[self.bar]

    def get(self, col: str, ago: int = 0) -> float:
        idx = self.bar - ago
        if idx < 0 or idx >= self._len:
            return float("nan")
        return float(self.df[col].iloc[idx])

    def slice(self, col: str, length: int) -> np.ndarray:
        start = max(0, self.bar - length + 1)
        return self.df[col].iloc[start : self.bar + 1].values.astype(float)

    def add_indicator(self, name: str, series: pd.Series):
        self.df[name] = series.values if len(series) == self._len else series

    @property
    def date(self) -> str:
        return str(self.df["date"].iloc[self.bar])

    @property
    def open(self) -> float:
        return float(self.df["open"].iloc[self.bar])

    @property
    def high(self) -> float:
        return float(self.df["high"].iloc[self.bar])

    @property
    def low(self) -> float:
        return float(self.df["low"].iloc[self.bar])

    @property
    def close(self) -> float:
        return float(self.df["close"].iloc[self.bar])

    @property
    def volume(self) -> float:
        return float(self.df["volume"].iloc[self.bar])


@dataclass
class Position:
    code: str
    size: float = 0.0
    avg_price: float = 0.0
    total_commission: float = 0.0

    @property
    def is_long(self) -> bool:
        return self.size > 0

    @property
    def is_short(self) -> bool:
        return self.size < 0

    @property
    def is_flat(self) -> bool:
        return self.size == 0

    def unrealized_pnl(self, current_price: float) -> float:
        if self.size == 0:
            return 0.0
        return self.size * (current_price - self.avg_price)

    def update(self, fill_size: float, fill_price: float) -> float:
        old_size = self.size
        new_size = old_size + fill_size

        if old_size == 0:
            self.avg_price = fill_price
        elif (old_size > 0 and fill_size > 0) or (old_size < 0 and fill_size < 0):
            total_cost = abs(old_size) * self.avg_price + abs(fill_size) * fill_price
            self.avg_price = total_cost / abs(new_size)
        else:
            pass

        realized_pnl = 0.0
        if old_size != 0 and ((old_size > 0 and fill_size < 0) or (old_size < 0 and fill_size > 0)):
            closed_size = min(abs(old_size), abs(fill_size))
            if old_size > 0:
                realized_pnl = closed_size * (fill_price - self.avg_price)
            else:
                realized_pnl = closed_size * (self.avg_price - fill_price)

        self.size = new_size
        if abs(self.size) < 1e-10:
            self.size = 0.0
            self.avg_price = 0.0

        return realized_pnl


class Broker:
    def __init__(
        self,
        initial_cash: float = 1_000_000,
        commission: CommissionModel | None = None,
        slippage: SlippageModel | None = None,
        sizer: PositionSizer | None = None,
        allow_short: bool = False,
    ):
        self.initial_cash = initial_cash
        self.cash = initial_cash
        self.commission_model = commission or CommissionModel()
        self.slippage_model = slippage or SlippageModel()
        self.sizer = sizer or create_sizer({"type": "percent_of_cash", "value": 0.95})
        self.allow_short = allow_short
        self.positions: dict[str, Position] = {}
        self.pending_orders: list[Order] = []
        self.filled_orders: list[Order] = []
        self.trades: list[Trade] = []
        self._open_trades: dict[str, Trade] = {}
        self._next_order_id = 1
        self._next_trade_id = 1

    def get_position(self, code: str) -> Position:
        if code not in self.positions:
            self.positions[code] = Position(code=code)
        return self.positions[code]

    def portfolio_value(self, prices: dict[str, float]) -> float:
        value = self.cash
        for code, pos in self.positions.items():
            if pos.size != 0 and code in prices:
                value += pos.size * prices[code]
        return value

    def submit_order(
        self,
        code: str,
        side: OrderSide,
        size: float | None = None,
        price: float | None = None,
        stop_price: float | None = None,
        order_type: OrderType = OrderType.MARKET,
        bar: int = 0,
        date: str = "",
        reason: str = "",
    ) -> Order:
        if size is None:
            current_price = price or 0
            if current_price <= 0:
                return self._rejected_order(code, side, 0, bar, date, "price unknown for sizing")
            pos = self.get_position(code)
            if side == OrderSide.SELL and pos.size > 0:
                size = pos.size
            elif side == OrderSide.BUY and pos.size < 0:
                size = abs(pos.size)
            else:
                size = self.sizer.size(
                    cash=self.cash,
                    price=current_price,
                    portfolio_value=self.cash,
                )

        if size <= 0:
            return self._rejected_order(code, side, 0, bar, date, "size is 0")

        if not self.allow_short and side == OrderSide.SELL:
            pos = self.get_position(code)
            if pos.size <= 0:
                return self._rejected_order(code, side, size, bar, date, "no position to sell (short disabled)")
            size = min(size, pos.size)

        order = Order(
            id=self._next_order_id,
            code=code,
            side=side,
            order_type=order_type,
            size=size,
            price=price,
            stop_price=stop_price,
            status=OrderStatus.SUBMITTED,
            created_bar=bar,
            created_date=date,
            reason=reason,
        )
        self._next_order_id += 1
        self.pending_orders.append(order)
        return order

    def _rejected_order(self, code, side, size, bar, date, reason) -> Order:
        order = Order(
            id=self._next_order_id, code=code, side=side,
            order_type=OrderType.MARKET, size=size,
            status=OrderStatus.REJECTED, created_bar=bar, created_date=date,
            reason=reason,
        )
        self._next_order_id += 1
        return order

    def process_bar(self, bar_idx: int, feeds: dict[str, DataFeed]):
        remaining = []
        for order in self.pending_orders:
            feed = feeds.get(order.code)
            if not feed:
                order.status = OrderStatus.REJECTED
                order.reason = f"no data feed for {order.code}"
                continue

            fill_price = self._try_fill(order, feed)
            if fill_price is not None:
                self._execute_fill(order, fill_price, bar_idx, feed.date)
            else:
                remaining.append(order)

        self.pending_orders = remaining

    def _try_fill(self, order: Order, feed: DataFeed) -> float | None:
        o, h, l, c = feed.open, feed.high, feed.low, feed.close

        if order.order_type == OrderType.MARKET:
            return o

        if order.order_type == OrderType.LIMIT:
            if order.side == OrderSide.BUY and l <= (order.price or 0):
                return min(o, order.price or 0)
            if order.side == OrderSide.SELL and h >= (order.price or 0):
                return max(o, order.price or 0)

        if order.order_type == OrderType.STOP:
            if order.side == OrderSide.BUY and h >= (order.stop_price or 0):
                return max(o, order.stop_price or 0)
            if order.side == OrderSide.SELL and l <= (order.stop_price or 0):
                return min(o, order.stop_price or 0)

        if order.order_type == OrderType.STOP_LIMIT:
            sp = order.stop_price or 0
            lp = order.price or 0
            if order.side == OrderSide.BUY and h >= sp:
                triggered_price = max(o, sp)
                if triggered_price <= lp:
                    return triggered_price
            if order.side == OrderSide.SELL and l <= sp:
                triggered_price = min(o, sp)
                if triggered_price >= lp:
                    return triggered_price

        return None

    def _execute_fill(self, order: Order, raw_price: float, bar_idx: int, date: str):
        fill_price = self.slippage_model.apply(raw_price, order.side)
        fill_size = order.size if order.side == OrderSide.BUY else -order.size
        commission = self.commission_model.calculate(order.side, fill_price, order.size)
        cost = fill_size * fill_price + commission

        if order.side == OrderSide.BUY and cost > self.cash:
            affordable = math.floor(self.cash / (fill_price * (1 + self.commission_model.pct) + self.commission_model.fixed_per_trade / max(order.size, 1)))
            if affordable <= 0:
                order.status = OrderStatus.REJECTED
                order.reason = "insufficient cash"
                return
            fill_size = affordable
            commission = self.commission_model.calculate(order.side, fill_price, affordable)
            cost = fill_size * fill_price + commission

        pos = self.get_position(order.code)
        realized_pnl = pos.update(fill_size, fill_price)
        pos.total_commission += commission
        self.cash -= cost

        order.status = OrderStatus.FILLED
        order.filled_bar = bar_idx
        order.filled_date = date
        order.filled_price = fill_price
        order.filled_size = abs(fill_size)
        order.commission = commission
        self.filled_orders.append(order)

        self._update_trades(order, fill_price, realized_pnl, bar_idx, date)

    def _update_trades(self, order: Order, fill_price: float, realized_pnl: float, bar_idx: int, date: str):
        code = order.code
        if order.side == OrderSide.BUY and code not in self._open_trades:
            trade = Trade(
                id=self._next_trade_id,
                code=code,
                entry_date=date,
                entry_price=fill_price,
                entry_size=order.filled_size,
                side="long",
                reason_entry=order.reason,
            )
            trade._entry_bar = bar_idx
            self._next_trade_id += 1
            self._open_trades[code] = trade
        elif order.side == OrderSide.SELL and code in self._open_trades:
            trade = self._open_trades[code]
            trade.exit_date = date
            trade.exit_price = fill_price
            trade.bars_held = bar_idx - getattr(trade, '_entry_bar', bar_idx)
            if trade.entry_price > 0:
                trade.pnl = trade.entry_size * (fill_price - trade.entry_price) - order.commission
                trade.pnl_pct = (fill_price - trade.entry_price) / trade.entry_price
            trade.commission = order.commission
            trade.reason_exit = order.reason
            self.trades.append(trade)
            del self._open_trades[code]


class Cerebro:
    def __init__(self, config: dict):
        broker_cfg = config.get("broker", {})
        comm_cfg = broker_cfg.get("commission", {})
        slip_cfg = broker_cfg.get("slippage", {})
        sizer_cfg = config.get("position_sizing", {"type": "percent_of_cash", "value": 0.95})

        self.broker = Broker(
            initial_cash=broker_cfg.get("initial_cash", 1_000_000),
            commission=CommissionModel(
                fixed_per_trade=comm_cfg.get("fixed", 5.0),
                pct=comm_cfg.get("pct", 0.0003),
                stamp_tax_pct=comm_cfg.get("stamp_tax_pct", 0.001),
                min_commission=comm_cfg.get("min", 5.0),
            ),
            slippage=SlippageModel(
                fixed=slip_cfg.get("fixed", 0.0),
                pct=slip_cfg.get("pct", 0.0005),
            ),
            sizer=create_sizer(sizer_cfg),
            allow_short=config.get("allow_short", False),
        )
        self.feeds: dict[str, DataFeed] = {}
        self.benchmark_feed: DataFeed | None = None
        self.strategy = None
        self.analyzers = []
        self.equity_curve: list[dict] = []
        self.config = config

    def add_data(self, code: str, df: pd.DataFrame):
        self.feeds[code] = DataFeed(code, df)

    def set_benchmark(self, df: pd.DataFrame, code: str = "benchmark"):
        self.benchmark_feed = DataFeed(code, df)

    def set_strategy(self, strategy):
        self.strategy = strategy

    def set_analyzers(self, analyzers: list):
        self.analyzers = analyzers

    def run(self) -> dict:
        if not self.feeds:
            raise ValueError("No data feeds added")
        if not self.strategy:
            raise ValueError("No strategy set")

        self.strategy.broker = self.broker
        self.strategy.data = self.feeds
        self.strategy.init()

        max_bars = min(len(f) for f in self.feeds.values())
        if self.benchmark_feed:
            max_bars = min(max_bars, len(self.benchmark_feed))

        for bar_idx in range(max_bars):
            for feed in self.feeds.values():
                feed.bar = bar_idx
            if self.benchmark_feed:
                self.benchmark_feed.bar = min(bar_idx, len(self.benchmark_feed) - 1)

            self.broker.process_bar(bar_idx, self.feeds)

            try:
                self.strategy.next()
            except Exception:
                pass

            prices = {code: f.close for code, f in self.feeds.items()}
            equity = self.broker.portfolio_value(prices)
            bench_val = self.benchmark_feed.close if self.benchmark_feed else None

            record = {
                "date": list(self.feeds.values())[0].date,
                "equity": round(equity, 2),
                "cash": round(self.broker.cash, 2),
            }
            if bench_val is not None:
                record["benchmark_price"] = round(bench_val, 4)
            self.equity_curve.append(record)

            for analyzer in self.analyzers:
                analyzer.on_bar(bar_idx, equity, self.broker.cash, self.broker.positions, prices)

        for trade in self.broker.trades:
            for analyzer in self.analyzers:
                analyzer.on_trade(trade)

        for code, trade in list(self.broker._open_trades.items()):
            if code in self.feeds:
                trade.exit_date = self.feeds[code].date
                trade.exit_price = self.feeds[code].close
                if trade.entry_price > 0:
                    trade.pnl = trade.entry_size * (trade.exit_price - trade.entry_price)
                    trade.pnl_pct = (trade.exit_price - trade.entry_price) / trade.entry_price
                self.broker.trades.append(trade)
                for analyzer in self.analyzers:
                    analyzer.on_trade(trade)

        metrics = {}
        for analyzer in self.analyzers:
            metrics.update(analyzer.result())

        benchmark_curve = None
        if self.benchmark_feed and self.equity_curve:
            start_bench = self.equity_curve[0].get("benchmark_price", 1)
            if start_bench and start_bench > 0:
                initial = self.broker.initial_cash
                benchmark_curve = [
                    round(initial * r["benchmark_price"] / start_bench, 2)
                    for r in self.equity_curve if "benchmark_price" in r
                ]
                if benchmark_curve:
                    metrics["benchmark_return"] = round((benchmark_curve[-1] / initial - 1), 4)

        return {
            "status": "ok",
            "metrics": metrics,
            "trades": [t.to_dict() for t in self.broker.trades],
            "equity_curve": self.equity_curve[::max(1, len(self.equity_curve) // 500)],
            "trade_count": len(self.broker.trades),
            "bars": max_bars,
        }
