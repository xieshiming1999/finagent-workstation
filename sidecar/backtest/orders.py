"""Backtest order system: Order types, commission, slippage models."""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class OrderType(Enum):
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"
    STOP_LIMIT = "stop_limit"


class OrderSide(Enum):
    BUY = "buy"
    SELL = "sell"


class OrderStatus(Enum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    FILLED = "filled"
    PARTIALLY_FILLED = "partially_filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


@dataclass
class Order:
    id: int
    code: str
    side: OrderSide
    order_type: OrderType
    size: float
    price: Optional[float] = None
    stop_price: Optional[float] = None
    status: OrderStatus = OrderStatus.PENDING
    created_bar: int = 0
    created_date: str = ""
    filled_bar: Optional[int] = None
    filled_date: Optional[str] = None
    filled_price: Optional[float] = None
    filled_size: float = 0
    commission: float = 0.0
    slippage: float = 0.0
    reason: str = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "code": self.code,
            "side": self.side.value,
            "type": self.order_type.value,
            "size": self.size,
            "price": self.price,
            "stop_price": self.stop_price,
            "status": self.status.value,
            "created_date": self.created_date,
            "filled_date": self.filled_date,
            "filled_price": self.filled_price,
            "filled_size": self.filled_size,
            "commission": round(self.commission, 2),
            "reason": self.reason,
        }


@dataclass
class Trade:
    id: int
    code: str
    entry_date: str
    entry_price: float
    entry_size: float
    exit_date: Optional[str] = None
    exit_price: Optional[float] = None
    side: str = "long"
    pnl: float = 0.0
    pnl_pct: float = 0.0
    commission: float = 0.0
    bars_held: int = 0
    reason_entry: str = ""
    reason_exit: str = ""

    @property
    def is_open(self) -> bool:
        return self.exit_date is None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "code": self.code,
            "side": self.side,
            "entry_date": self.entry_date,
            "entry_price": round(self.entry_price, 4),
            "size": self.entry_size,
            "exit_date": self.exit_date,
            "exit_price": round(self.exit_price, 4) if self.exit_price else None,
            "pnl": round(self.pnl, 2),
            "pnl_pct": round(self.pnl_pct, 4),
            "commission": round(self.commission, 2),
            "bars_held": self.bars_held,
        }


@dataclass
class CommissionModel:
    fixed_per_trade: float = 5.0
    pct: float = 0.0003
    stamp_tax_pct: float = 0.001
    min_commission: float = 5.0

    def calculate(self, side: OrderSide, price: float, size: float) -> float:
        value = abs(price * size)
        comm = max(value * self.pct, self.min_commission)
        comm += self.fixed_per_trade
        if side == OrderSide.SELL:
            comm += value * self.stamp_tax_pct
        return comm


@dataclass
class SlippageModel:
    fixed: float = 0.0
    pct: float = 0.0005

    def apply(self, price: float, side: OrderSide) -> float:
        slip = price * self.pct + self.fixed
        if side == OrderSide.BUY:
            return price + slip
        return price - slip
