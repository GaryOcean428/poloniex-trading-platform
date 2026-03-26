"""Tests for the strategy loop."""

import numpy as np
import pytest

from proprietary_core.strategy_loop import StrategyLoop, StrategyType


def _make_prices(n: int, base: float = 100.0, vol: float = 0.02, trend: float = 0.0, seed: int = 42) -> list[float]:
    rng = np.random.default_rng(seed)
    returns = rng.normal(trend, vol, n)
    prices = [base]
    for r in returns:
        prices.append(prices[-1] * (1 + r))
    return prices


def test_loop_accumulates_then_decides():
    """Loop should return CASH with reason 'insufficient' until enough data."""
    loop = StrategyLoop(symbol="BTC_USDT", regime_window=50)
    decision = loop.tick(price=50000.0)
    assert decision.selected_strategy == StrategyType.CASH
    assert "Insufficient" in decision.reason


def test_volatile_market_selects_momentum_or_breakout():
    """High volatility should select Creator-regime strategies."""
    loop = StrategyLoop(symbol="BTC_USDT", regime_window=80)
    prices = _make_prices(200, base=50000, vol=0.06, trend=0.002)

    decision = None
    for p in prices:
        decision = loop.tick(price=p)

    assert decision is not None
    assert decision.selected_strategy in (StrategyType.MOMENTUM, StrategyType.BREAKOUT)


def test_flat_market_selects_cash():
    """Dead market should select CASH (Dissolver)."""
    loop = StrategyLoop(symbol="BORING_USDT", regime_window=80)
    prices = _make_prices(200, base=100, vol=0.0005, trend=0.0)

    decision = None
    for p in prices:
        decision = loop.tick(price=p)

    assert decision is not None
    assert decision.selected_strategy == StrategyType.CASH


def test_loop_to_dict_serialisation():
    """Decision.to_dict() should produce a valid dict."""
    loop = StrategyLoop(symbol="ETH_USDT", regime_window=50)
    prices = _make_prices(100, base=3000, vol=0.03)
    for p in prices:
        loop.tick(price=p)

    decision = loop.last_decision
    assert decision is not None
    d = decision.to_dict()
    assert isinstance(d, dict)
    assert d["symbol"] == "ETH_USDT"
    assert "strategy" in d
    assert "should_trade" in d
