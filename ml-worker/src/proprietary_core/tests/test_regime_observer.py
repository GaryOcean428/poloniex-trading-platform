"""test_regime_observer.py — CAL-3 observer-driven regime classification.

Tests the OBSERVE → DISCOVER → NAVIGATE pattern ported from
WarpBubble.auto() to classification surfaces. Per Canonical
Principles v2.1 P1: regime boundaries derive from observed terciles
of the basin's own (h, J) distribution, not from hardcoded
physics-calibrated thresholds.

Coverage:
- Warmup falls through to qig_warp's fixed-threshold classifier
- After warmup, regime is derived from rolling-quantile terciles
- ORDERED / CRITICAL / DISORDERED partition is equal-mass on a
  uniform distribution
- Zero-coupling (J=0) ticks classify as DISSOLVER without breaking
  the rolling quantile estimator
- Snapshot accessor reports n_observations + bounds for /governance
"""

from __future__ import annotations

import sys
from unittest import mock

import numpy as np
import pytest

from proprietary_core.regime import MarketRegime
from proprietary_core.regime_observer import (
    _WARMUP_TICKS,
    RegimeObserver,
    _reset_observer,
    classify_via_observer,
    observer_snapshot,
)


@pytest.fixture(autouse=True)
def _reset_singleton():
    """Each test starts with a fresh observer."""
    _reset_observer()
    yield
    _reset_observer()


def _fake_qig_warp(label: str) -> mock.MagicMock:
    """qig_warp.classify_regime returns a Regime-like object."""
    rg = mock.MagicMock()
    rg.value = label
    fake = mock.MagicMock()
    fake.classify_regime.return_value = rg
    return fake


class TestWarmupFallThrough:
    """Before _WARMUP_TICKS observations accumulate the observer must
    delegate to qig_warp.classify_regime (the documented fall-through)."""

    def test_warmup_calls_qig_warp(self) -> None:
        """First tick falls through; verify qig_warp was invoked."""
        fake = _fake_qig_warp("disordered")
        with mock.patch.dict(sys.modules, {"qig_warp": fake}):
            regime = classify_via_observer(h_value=3.5, j_value=0.05, dim=2)
        assert regime is MarketRegime.DISSOLVER  # disordered → DISSOLVER
        fake.classify_regime.assert_called_once()

    def test_warmup_threshold_is_consistent(self) -> None:
        """Exactly _WARMUP_TICKS observations under warmup, then warm."""
        fake = _fake_qig_warp("disordered")
        with mock.patch.dict(sys.modules, {"qig_warp": fake}):
            for _ in range(_WARMUP_TICKS - 1):
                classify_via_observer(h_value=3.5, j_value=0.05)
        # Still warmup (n = _WARMUP_TICKS - 1, threshold is reached AT _WARMUP_TICKS).
        n, bounds = observer_snapshot()
        assert n == _WARMUP_TICKS - 1
        assert bounds is None
        # One more push — now we're at threshold, snapshot returns bounds.
        with mock.patch.dict(sys.modules, {"qig_warp": fake}):
            classify_via_observer(h_value=3.5, j_value=0.05)
        n, bounds = observer_snapshot()
        assert n == _WARMUP_TICKS
        assert bounds is not None
        assert not bounds.is_warmup


class TestObserverTerciles:
    """After warmup the observer should partition incoming ratios into
    three equal-mass buckets via rolling quantiles."""

    def test_uniform_distribution_partitions_equally(self) -> None:
        """Push a known uniform distribution of h/J ratios; verify the
        observer's terciles match np.quantile([0.33, 0.67])."""
        fake = _fake_qig_warp("disordered")
        ratios = np.linspace(0.5, 10.0, _WARMUP_TICKS + 100)
        for r in ratios:
            # Construct h, J so h/J = r and the warmup uses the same.
            h, j = r, 1.0
            with mock.patch.dict(sys.modules, {"qig_warp": fake}):
                classify_via_observer(h_value=h, j_value=j)
        n, bounds = observer_snapshot()
        assert n == len(ratios)
        # Bounds should match np.quantile of the observed ratios.
        expected_lower = float(np.quantile(ratios, 0.33))
        expected_upper = float(np.quantile(ratios, 0.67))
        assert bounds.lower == pytest.approx(expected_lower, rel=0.05)
        assert bounds.upper == pytest.approx(expected_upper, rel=0.05)

    def test_post_warmup_navigates_via_terciles(self) -> None:
        """Once warm, regime depends on which tercile the ratio falls in."""
        # Seed the observer with a uniform 0..100 distribution
        # (no qig_warp needed beyond the first call; build buffer directly).
        observer = RegimeObserver(window=_WARMUP_TICKS + 100, warmup=_WARMUP_TICKS)
        fake = _fake_qig_warp("ordered")
        with mock.patch.dict(sys.modules, {"qig_warp": fake}):
            for r in np.linspace(0.0, 100.0, _WARMUP_TICKS + 100):
                observer.observe_and_classify(h_value=r, j_value=1.0)
        # 33rd / 67th of [0, 100] ≈ [33, 67].
        n, bounds = observer.snapshot()
        assert bounds is not None
        assert bounds.lower == pytest.approx(33.0, abs=2.0)
        assert bounds.upper == pytest.approx(67.0, abs=2.0)
        # ratio = 10 → bottom tercile → ORDERED → PRESERVER
        assert observer.observe_and_classify(h_value=10.0, j_value=1.0) is MarketRegime.PRESERVER
        # ratio = 50 → middle tercile → CRITICAL → CREATOR
        assert observer.observe_and_classify(h_value=50.0, j_value=1.0) is MarketRegime.CREATOR
        # ratio = 90 → top tercile → DISORDERED → DISSOLVER
        assert observer.observe_and_classify(h_value=90.0, j_value=1.0) is MarketRegime.DISSOLVER


class TestZeroCouplingHandling:
    def test_zero_j_classifies_as_dissolver_post_warmup(self) -> None:
        """J=0 (degenerate, no coupling at all) → DISSOLVER. Doesn't
        break the quantile estimator (treated as inf, filtered out of
        the quantile calc)."""
        observer = RegimeObserver(window=_WARMUP_TICKS + 100, warmup=_WARMUP_TICKS)
        fake = _fake_qig_warp("ordered")
        with mock.patch.dict(sys.modules, {"qig_warp": fake}):
            # Seed warmup with finite ratios.
            for r in np.linspace(0.5, 10.0, _WARMUP_TICKS):
                observer.observe_and_classify(h_value=r, j_value=1.0)
        # Now a zero-coupling tick → DISSOLVER
        regime = observer.observe_and_classify(h_value=3.5, j_value=0.0)
        assert regime is MarketRegime.DISSOLVER

    def test_all_zero_coupling_yields_wide_bounds(self) -> None:
        """Pathological: every tick has J=0. Quantile estimator returns
        wide bounds; live ticks still classify defensively."""
        observer = RegimeObserver(window=_WARMUP_TICKS + 10, warmup=_WARMUP_TICKS)
        fake = _fake_qig_warp("disordered")
        with mock.patch.dict(sys.modules, {"qig_warp": fake}):
            for _ in range(_WARMUP_TICKS + 10):
                observer.observe_and_classify(h_value=3.5, j_value=0.0)
        n, bounds = observer.snapshot()
        # All inf → discover returned wide bounds (0, inf).
        assert bounds is not None
        assert bounds.lower == 0.0
        assert bounds.upper == float("inf")


class TestObserverSnapshotDiagnostic:
    def test_snapshot_returns_n_and_bounds(self) -> None:
        """Used by /governance/status to surface the observer state."""
        fake = _fake_qig_warp("ordered")
        with mock.patch.dict(sys.modules, {"qig_warp": fake}):
            for r in np.linspace(1.0, 5.0, _WARMUP_TICKS + 10):
                classify_via_observer(h_value=r, j_value=1.0)
        n, bounds = observer_snapshot()
        assert n == _WARMUP_TICKS + 10
        assert bounds is not None
        assert bounds.n_observations == n
        assert not bounds.is_warmup
        assert bounds.lower < bounds.upper
