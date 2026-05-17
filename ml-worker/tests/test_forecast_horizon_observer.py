"""test_forecast_horizon_observer.py — CAL-4 observer tests.

Validates that per-regime amplitude + temporal-scale observers
replace the hardcoded knobs from MIG-4:
  - _AMPLITUDE_FLOOR ({ordered: 0.5, critical: 1.0, disordered: 0.2})
  - QIG_FORECAST_TEMPORAL_SCALE_HOURS = 4.0

Coverage:
- Warmup: per-regime n < _WARMUP_TICKS → legacy values
- Post-warmup: amplitude = median |Δprice/price|, temporal = autocorr lag
- Per-regime isolation: ORDERED warmup doesn't affect CRITICAL state
- Reset for test isolation
- Snapshot accessor for /governance
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import forecast_horizon_observer as obs


@pytest.fixture(autouse=True)
def _reset():
    obs._reset_observer()
    yield
    obs._reset_observer()


class TestWarmupFallThrough:
    def test_amplitude_warmup_returns_legacy_per_regime(self) -> None:
        # No observations recorded → all regimes return legacy floor.
        assert obs.amplitude_for("ordered") == pytest.approx(0.5)
        assert obs.amplitude_for("critical") == pytest.approx(1.0)
        assert obs.amplitude_for("disordered") == pytest.approx(0.2)
        # Unknown regime → default 0.3.
        assert obs.amplitude_for("unknown_regime") == pytest.approx(0.3)

    def test_temporal_warmup_returns_legacy(self) -> None:
        assert obs.temporal_scale_lags_for("ordered") == pytest.approx(4.0)
        assert obs.temporal_scale_lags_for("critical") == pytest.approx(4.0)

    def test_warmup_threshold_per_regime_isolated(self) -> None:
        # Push WARMUP - 1 observations to ORDERED — still warmup.
        for _ in range(obs._WARMUP_TICKS - 1):
            obs.observe_tick(regime="ordered", price_change_pct=0.01, log_return=0.01)
        assert obs.amplitude_for("ordered") == pytest.approx(0.5)  # legacy still
        # CRITICAL hasn't received any → still legacy.
        assert obs.amplitude_for("critical") == pytest.approx(1.0)


class TestObservedAmplitudeMedian:
    def test_post_warmup_amplitude_is_observed_median(self) -> None:
        # Push known magnitudes into ORDERED — observer should report
        # the median, not the legacy 0.5.
        magnitudes = np.linspace(0.001, 0.05, obs._WARMUP_TICKS + 50)
        for m in magnitudes:
            obs.observe_tick(regime="ordered", price_change_pct=m, log_return=0.0)
        expected_median = float(np.median(magnitudes))
        assert obs.amplitude_for("ordered") == pytest.approx(expected_median, rel=1e-6)
        # Other regimes still legacy.
        assert obs.amplitude_for("critical") == pytest.approx(1.0)

    def test_amplitude_is_absolute_value(self) -> None:
        """Negative price changes contribute their absolute magnitude."""
        for _ in range(obs._WARMUP_TICKS):
            obs.observe_tick(regime="critical", price_change_pct=-0.02, log_return=-0.02)
        assert obs.amplitude_for("critical") == pytest.approx(0.02)


class TestObservedTemporalScale:
    def test_temporal_scale_is_autocorr_decay_lag(self) -> None:
        """AR(1) process with rho=0.5 has theoretical 1/e crossing at
        lag = -1/log(0.5) ≈ 1.44 → first integer lag is 2."""
        np.random.seed(42)
        n = obs._WARMUP_TICKS + 200
        rho = 0.5
        series = np.zeros(n)
        noise = np.random.normal(0.0, 1.0, n)
        for i in range(1, n):
            series[i] = rho * series[i - 1] + noise[i]
        for r in series:
            obs.observe_tick(
                regime="critical",
                price_change_pct=0.01,  # amplitude isn't under test here
                log_return=float(r),
            )
        lag = obs.temporal_scale_lags_for("critical")
        # The fast decay puts the 1/e crossing at lag 1 or 2.
        assert lag in (1, 2)

    def test_temporal_warmup_falls_through(self) -> None:
        """Per-regime warmup applies to temporal scale too."""
        for _ in range(obs._WARMUP_TICKS - 1):
            obs.observe_tick(regime="ordered", price_change_pct=0.01, log_return=0.0)
        assert obs.temporal_scale_lags_for("ordered") == pytest.approx(4.0)


class TestSnapshotDiagnostic:
    def test_snapshot_reports_per_regime_observation_count(self) -> None:
        for _ in range(10):
            obs.observe_tick(regime="creator", price_change_pct=0.01, log_return=0.0)
        for _ in range(5):
            obs.observe_tick(regime="dissolver", price_change_pct=0.001, log_return=0.0)
        snap = obs.observer_snapshot()
        assert snap.n_observations["creator"] == 10
        assert snap.n_observations["dissolver"] == 5
        # Both still in warmup (< 30) → warmup_regimes contains both.
        assert set(snap.warmup_regimes) == {"creator", "dissolver"}

    def test_snapshot_distinguishes_warm_from_legacy(self) -> None:
        # Push WARMUP+10 to one regime; the other stays cold.
        for _ in range(obs._WARMUP_TICKS + 10):
            obs.observe_tick(regime="ordered", price_change_pct=0.02, log_return=0.0)
        for _ in range(5):
            obs.observe_tick(regime="critical", price_change_pct=0.005, log_return=0.0)
        snap = obs.observer_snapshot()
        # ORDERED is past warmup, observed amplitude = 0.02 (not legacy 0.5).
        assert snap.amplitude_per_regime["ordered"] == pytest.approx(0.02)
        # CRITICAL still legacy 1.0.
        assert snap.amplitude_per_regime["critical"] == pytest.approx(1.0)
        # warmup_regimes only contains the cold one.
        assert snap.warmup_regimes == ["critical"]
