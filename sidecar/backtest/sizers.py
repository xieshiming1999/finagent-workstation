"""Position sizing strategies."""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass
import math


class PositionSizer(ABC):
    @abstractmethod
    def size(self, cash: float, price: float, portfolio_value: float, **kwargs) -> float:
        """Return number of shares to buy. Always positive."""


@dataclass
class FixedSize(PositionSizer):
    shares: float = 100

    def size(self, cash: float, price: float, portfolio_value: float, **kwargs) -> float:
        affordable = math.floor(cash / price)
        return min(self.shares, affordable)


@dataclass
class PercentOfCash(PositionSizer):
    pct: float = 0.95

    def size(self, cash: float, price: float, portfolio_value: float, **kwargs) -> float:
        target_value = cash * self.pct
        shares = math.floor(target_value / price)
        return max(shares, 0)


@dataclass
class AllIn(PositionSizer):
    def size(self, cash: float, price: float, portfolio_value: float, **kwargs) -> float:
        return math.floor(cash / price)


@dataclass
class FixedRisk(PositionSizer):
    risk_pct: float = 0.02
    atr_period: int = 14
    atr_multiplier: float = 2.0

    def size(self, cash: float, price: float, portfolio_value: float, **kwargs) -> float:
        atr = kwargs.get("atr", price * 0.02)
        risk_per_share = atr * self.atr_multiplier
        if risk_per_share <= 0:
            return 0
        risk_amount = portfolio_value * self.risk_pct
        shares = math.floor(risk_amount / risk_per_share)
        affordable = math.floor(cash / price)
        return min(shares, affordable)


SIZER_REGISTRY: dict[str, type[PositionSizer]] = {
    "fixed_size": FixedSize,
    "percent_of_cash": PercentOfCash,
    "all_in": AllIn,
    "fixed_risk": FixedRisk,
}


def create_sizer(config: dict) -> PositionSizer:
    sizer_type = config.get("type", "percent_of_cash")
    cls = SIZER_REGISTRY.get(sizer_type, PercentOfCash)
    params = {k: v for k, v in config.items() if k != "type"}

    if cls == FixedSize:
        return FixedSize(shares=params.get("value", params.get("shares", 100)))
    elif cls == PercentOfCash:
        return PercentOfCash(pct=params.get("value", params.get("pct", 0.95)))
    elif cls == AllIn:
        return AllIn()
    elif cls == FixedRisk:
        return FixedRisk(
            risk_pct=params.get("risk_pct", 0.02),
            atr_period=params.get("atr_period", 14),
            atr_multiplier=params.get("atr_multiplier", 2.0),
        )
    return PercentOfCash()
