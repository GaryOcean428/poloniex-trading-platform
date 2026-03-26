"""Tests for the regime detector."""

import numpy as np
import pytest

from proprietary_core.regime import MarketRegime, RegimeDetector


def _make_prices(n: int, base: float = 100.0, volatility: float = 0.02, trend: float = 0.0, seed: int = 42) -> list[float]:
    """Generate synthetic price series."""
    rng = np.random.default_rng(seed)
    returns = rng.normal(trend, volatility, n)
    prices = [base]
    for r in returns:
        prices.append(prices[-1] * (1 + r))
    return prices


def test_creator_regime_high_volatility():
    """High volatility should classify as Creator."""
    prices = _make_prices(200, volatility=0.08, trend=0.0)
    det = RegimeDetector(window=100, entropy_threshold=2.0)
    state = det.update_batch(prices)
    assert state is not None
    assert state.regime == MarketRegime.CREATOR
    assert state.pillar1_gate is True


def test_preserver_regime_trending():
    """Strong trend with low noise should classify as Preserver."""
    prices = _make_prices(200, volatility=0.005, trend=0.003)
    det = RegimeDetector(window=100, entropy_threshold=2.5, trend_threshold=0.1)
    state = det.update_batch(prices)
    assert state is not None
    assert state.regime == MarketRegime.PRESERVER


def test_dissolver_regime_flat():
    """Flat market with minimal movement should classify as Dissolver."""
    prices = _make_prices(200, volatility=0.0005, trend=0.0)
    det = RegimeDetector(window=100, entropy_threshold=2.5, trend_threshold=0.15)
    state = det.update_batch(prices)
    assert state is not None
    assert state.regime == MarketRegime.DISSOLVER


def test_pillar1_gate_zero_volatility():
    """Zero volatility should close the Pillar 1 gate."""
    prices = [100.0] * 200  # perfectly flat
    det = RegimeDetector(window=100)
    state = det.update_batch(prices)
    assert state is not None
    assert state.pillar1_gate is False


def test_fisher_spike_detection():
    """A regime change mid-series should produce a Fisher spike."""
    # Calm market then sudden volatility
    calm = _make_prices(150, volatility=0.005, trend=0.0, seed=1)
    volatile = _make_prices(100, volatility=0.06, trend=0.0, seed=2)
    prices = calm + volatile[1:]  # skip first to avoid duplicate

    det = RegimeDetector(window=80)
    states = []
    for p in prices:
        s = det.update(p)
        if s is not None:
            states.append(s)

    # At least one transition should be detected
    transitions = [s for s in states if s.is_transition]
    assert len(transitions) > 0, "Expected at least one Fisher spike transition"


def test_reset():
    """Reset should clear state."""
    det = RegimeDetector(window=50)
    prices = _make_prices(100)
    det.update_batch(prices)
    det.reset()
    assert det.update(100.0) is None  # needs window again
