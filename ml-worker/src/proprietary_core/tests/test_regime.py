"""Tests for the regime adapter.

MIG-2 (2026-05-16): bespoke RegimeDetector deleted. The regime label
now comes from qig_warp.classify_regime; this file covers the
RegimeAdapter wrapper's behavioural surface — return-state shape,
pillar-1 gate, fisher-spike transition detection, reset semantics —
without asserting on bespoke entropy/trend thresholds. The canonical
mapping is exercised in test_regime_qigwarp.py.
"""

from __future__ import annotations

import sys
from unittest import mock

import numpy as np
import pytest

from proprietary_core.regime import MarketRegime, RegimeState
from proprietary_core.regime_adapter import RegimeAdapter


def _make_prices(
    n: int, base: float = 100.0, volatility: float = 0.02,
    trend: float = 0.0, seed: int = 42,
) -> list[float]:
    """Generate a synthetic price series."""
    rng = np.random.default_rng(seed)
    returns = rng.normal(trend, volatility, n)
    prices = [base]
    for r in returns:
        prices.append(prices[-1] * (1 + r))
    return prices


def _fake_qig_warp(regime_value: str) -> mock.MagicMock:
    """Build a fake qig_warp module whose classify_regime returns a
    Regime-like object with .value == regime_value."""
    fake_regime = mock.MagicMock()
    fake_regime.value = regime_value
    fake_module = mock.MagicMock()
    fake_module.classify_regime.return_value = fake_regime
    return fake_module


def test_adapter_returns_regime_state_shape() -> None:
    """RegimeAdapter.update returns a fully-populated RegimeState."""
    prices = _make_prices(200, volatility=0.02, trend=0.0)
    adapter = RegimeAdapter(window=100)
    with mock.patch.dict(sys.modules, {"qig_warp": _fake_qig_warp("ordered")}):
        state = adapter.update_batch(prices)
    assert state is not None
    assert isinstance(state, RegimeState)
    # Every field on RegimeState should be populated.
    assert state.regime in (MarketRegime.CREATOR, MarketRegime.PRESERVER, MarketRegime.DISSOLVER)
    assert isinstance(state.entropy, float)
    assert isinstance(state.fisher_info, float)
    assert isinstance(state.trend_strength, float)
    assert isinstance(state.volatility, float)
    assert isinstance(state.confidence, float)
    assert isinstance(state.is_transition, bool)
    assert isinstance(state.pillar1_gate, bool)


def test_adapter_delegates_label_to_qig_warp() -> None:
    """The adapter's regime label must come from qig_warp, not bespoke."""
    prices = _make_prices(200, volatility=0.02, trend=0.0)
    adapter = RegimeAdapter(window=100)
    # qig_warp returns ordered → PRESERVER per canonical mapping
    with mock.patch.dict(sys.modules, {"qig_warp": _fake_qig_warp("ordered")}):
        state = adapter.update_batch(prices)
    assert state is not None
    assert state.regime is MarketRegime.PRESERVER

    # qig_warp returns critical → CREATOR per canonical mapping
    adapter2 = RegimeAdapter(window=100)
    with mock.patch.dict(sys.modules, {"qig_warp": _fake_qig_warp("critical")}):
        state2 = adapter2.update_batch(prices)
    assert state2 is not None
    assert state2.regime is MarketRegime.CREATOR


def test_pillar1_gate_zero_volatility() -> None:
    """Zero volatility closes the pillar-1 gate regardless of regime label."""
    prices = [100.0] * 200  # perfectly flat
    adapter = RegimeAdapter(window=100)
    with mock.patch.dict(sys.modules, {"qig_warp": _fake_qig_warp("disordered")}):
        state = adapter.update_batch(prices)
    assert state is not None
    assert state.pillar1_gate is False


def test_pillar1_gate_open_with_volatility() -> None:
    """Real volatility opens the pillar-1 gate."""
    prices = _make_prices(200, volatility=0.02, trend=0.0)
    adapter = RegimeAdapter(window=100)
    with mock.patch.dict(sys.modules, {"qig_warp": _fake_qig_warp("ordered")}):
        state = adapter.update_batch(prices)
    assert state is not None
    assert state.pillar1_gate is True


def test_fisher_spike_detection() -> None:
    """A regime change mid-series should produce a Fisher-info spike."""
    calm = _make_prices(150, volatility=0.005, trend=0.0, seed=1)
    volatile = _make_prices(100, volatility=0.06, trend=0.0, seed=2)
    prices = calm + volatile[1:]

    adapter = RegimeAdapter(window=80)
    states = []
    with mock.patch.dict(sys.modules, {"qig_warp": _fake_qig_warp("ordered")}):
        for p in prices:
            s = adapter.update(p)
            if s is not None:
                states.append(s)

    transitions = [s for s in states if s.is_transition]
    assert len(transitions) > 0, "Expected at least one Fisher spike transition"


def test_warm_up_returns_none() -> None:
    """update() returns None until `window` returns have accumulated."""
    adapter = RegimeAdapter(window=50)
    # 30 prices → 29 returns → still warming up
    for p in _make_prices(30):
        assert adapter.update(p) is None


def test_reset_clears_state() -> None:
    """reset() clears the returns buffer and forces re-warmup."""
    adapter = RegimeAdapter(window=50)
    with mock.patch.dict(sys.modules, {"qig_warp": _fake_qig_warp("ordered")}):
        adapter.update_batch(_make_prices(100))
    adapter.reset()
    # After reset, one more tick is still warming up.
    assert adapter.update(100.0) is None


def test_adapter_fails_soft_to_dissolver_on_qig_warp_error() -> None:
    """If qig_warp raises, the adapter logs and returns DISSOLVER (safe)
    rather than propagating — strategyloop tick handler must not raise."""
    prices = _make_prices(200, volatility=0.02, trend=0.0)
    adapter = RegimeAdapter(window=100)
    fake_module = mock.MagicMock()
    fake_module.classify_regime.side_effect = RuntimeError("classifier down")
    with mock.patch.dict(sys.modules, {"qig_warp": fake_module}):
        state = adapter.update_batch(prices)
    assert state is not None
    assert state.regime is MarketRegime.DISSOLVER
