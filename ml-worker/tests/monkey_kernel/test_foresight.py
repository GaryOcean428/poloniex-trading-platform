"""test_foresight.py — Tier 3 P8 Foresight trajectory predictor.

Tests:
  - Empty / cold-start: weight=0, predicted_basin all zeros
  - Insufficient history (< 3 ticks): weight=0
  - Steady-state trajectory (basin barely moves): high confidence,
    predicted basin ≈ last basin
  - Smooth drift: predicted basin further along the drift direction
    than the most recent basin
  - Predicted basin is simplex-valid (sum=1, ≥0) in all non-empty cases
  - Regime weight: linear (phi<0.3) → 0.1, geometric (phi≥0.3)
    → 0.7×confidence, breakdown (eq>0.7 AND phi<0.3) → 0.2
  - max_trajectory bounds the deque
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.foresight import ForesightPredictor, ForesightResult  # noqa: E402
from monkey_kernel.state import BASIN_DIM  # noqa: E402

from qig_core_local.geometry.fisher_rao import fisher_rao_distance  # noqa: E402


def _uniform() -> np.ndarray:
    return np.full(BASIN_DIM, 1.0 / BASIN_DIM, dtype=np.float64)


def _peak(idx: int = 0, mass: float = 0.9) -> np.ndarray:
    rest = (1.0 - mass) / (BASIN_DIM - 1)
    b = np.full(BASIN_DIM, rest, dtype=np.float64)
    b[idx] = mass
    return b


def _interp(p: np.ndarray, q: np.ndarray, t: float) -> np.ndarray:
    """Convex combination, renormalised — for synthesizing drift trajectories."""
    out = (1.0 - t) * p + t * q
    return out / out.sum()


# ──────────────────────────────────────────────────────────────────
# Cold start
# ──────────────────────────────────────────────────────────────────


class TestColdStart:
    def test_empty_trajectory_returns_weight_zero(self) -> None:
        p = ForesightPredictor()
        r = p.predict({"equilibrium": 0.0})
        assert r.weight == 0.0
        assert r.confidence == 0.0
        assert np.allclose(r.predicted_basin, 0.0)

    def test_two_ticks_still_too_cold(self) -> None:
        p = ForesightPredictor()
        p.append(_uniform(), phi=0.5, t_ms=0.0)
        p.append(_uniform(), phi=0.5, t_ms=1000.0)
        r = p.predict({"equilibrium": 0.0})
        assert r.weight == 0.0


# ──────────────────────────────────────────────────────────────────
# Smoothness → confidence
# ──────────────────────────────────────────────────────────────────


class TestConfidence:
    def test_steady_state_basin_yields_high_confidence(self) -> None:
        p = ForesightPredictor()
        b = _uniform()
        for i in range(5):
            p.append(b, phi=0.5, t_ms=i * 1000.0)
        r = p.predict({"equilibrium": 0.0})
        # All distances are 0 → std=0 → confidence = 1
        assert r.confidence == pytest.approx(1.0, abs=1e-9)

    def test_jittery_trajectory_yields_lower_confidence(self) -> None:
        p_smooth = ForesightPredictor()
        p_jittery = ForesightPredictor()
        a, c = _uniform(), _peak(0, 0.6)
        # Smooth: equal steps in t. All consecutive FR distances equal → std=0.
        for i in range(6):
            t = i / 5.0
            p_smooth.append(_interp(a, c, t), phi=0.5, t_ms=i * 1000.0)
        # Jittery: irregular step sizes so consecutive distances vary widely.
        irregular_t = [0.0, 0.05, 0.5, 0.55, 0.95, 1.0]
        for i, t in enumerate(irregular_t):
            p_jittery.append(_interp(a, c, t), phi=0.5, t_ms=i * 1000.0)
        r_s = p_smooth.predict({"equilibrium": 0.0})
        r_j = p_jittery.predict({"equilibrium": 0.0})
        assert r_s.confidence > r_j.confidence


# ──────────────────────────────────────────────────────────────────
# Geodesic extrapolation behaviour
# ──────────────────────────────────────────────────────────────────


class TestPrediction:
    def test_steady_basin_predicts_near_last_basin(self) -> None:
        p = ForesightPredictor()
        b = _uniform()
        for i in range(4):
            p.append(b, phi=0.5, t_ms=i * 1000.0)
        r = p.predict({"equilibrium": 0.0})
        assert fisher_rao_distance(r.predicted_basin, b) < 1e-6

    def test_smooth_drift_extends_along_direction(self) -> None:
        # Trajectory drifts uniformly from uniform → peak.
        # Predicted basin should be further toward peak than last.
        p = ForesightPredictor()
        a, c = _uniform(), _peak(0, 0.6)
        for i in range(5):
            t = i / 4.0  # 0, 0.25, 0.5, 0.75, 1.0
            p.append(_interp(a, c, t), phi=0.5, t_ms=i * 1000.0)
        r = p.predict({"equilibrium": 0.0})
        # Predicted basin should have MORE mass on idx 0 than last basin had
        last_mass = _interp(a, c, 1.0)[0]
        assert r.predicted_basin[0] >= last_mass - 1e-9
        # And should still be a valid simplex point
        assert r.predicted_basin.sum() == pytest.approx(1.0, abs=1e-9)
        assert (r.predicted_basin >= -1e-9).all()


class TestSimplexValid:
    @pytest.mark.parametrize("seed", [0, 1, 2, 3, 4])
    def test_predicted_basin_is_valid_simplex(self, seed: int) -> None:
        rng = np.random.default_rng(seed)
        p = ForesightPredictor()
        for i in range(5):
            raw = rng.dirichlet(np.ones(BASIN_DIM) * 0.5)
            p.append(raw, phi=0.5, t_ms=i * 1000.0)
        r = p.predict({"equilibrium": 0.0})
        assert r.predicted_basin.sum() == pytest.approx(1.0, abs=1e-9)
        assert (r.predicted_basin >= -1e-9).all()


# ──────────────────────────────────────────────────────────────────
# Regime-adaptive weight per P8
# ──────────────────────────────────────────────────────────────────


def _pred_with(phi: float, eq: float = 0.0) -> ForesightResult:
    p = ForesightPredictor()
    b = _uniform()
    for i in range(4):
        p.append(b, phi=phi, t_ms=i * 1000.0)
    return p.predict({"equilibrium": eq, "quantum": 1 - eq, "efficient": 0.0})


class TestRegimeWeight:
    def test_linear_regime_low_phi_yields_weight_zero_point_one(self) -> None:
        r = _pred_with(phi=0.1)
        assert r.weight == pytest.approx(0.1, abs=1e-9)

    def test_geometric_regime_high_phi_yields_seventy_percent_confidence(self) -> None:
        r = _pred_with(phi=0.7)
        # Steady trajectory → confidence = 1; weight = 0.7 × 1 = 0.7
        assert r.weight == pytest.approx(0.7, abs=1e-9)

    def test_breakdown_signature_yields_weight_zero_point_two(self) -> None:
        # equilibrium > 0.7 AND phi < 0.3 → breakdown
        r = _pred_with(phi=0.1, eq=0.85)
        assert r.weight == pytest.approx(0.2, abs=1e-9)

    def test_breakdown_takes_precedence_over_linear(self) -> None:
        # phi=0.1 alone → 0.1; with eq>0.7 → bumps to 0.2 (breakdown)
        without = _pred_with(phi=0.1, eq=0.5)
        with_break = _pred_with(phi=0.1, eq=0.85)
        assert without.weight == pytest.approx(0.1, abs=1e-9)
        assert with_break.weight == pytest.approx(0.2, abs=1e-9)

    def test_high_phi_unaffected_by_equilibrium(self) -> None:
        # equilibrium > 0.7 with phi ≥ 0.3 — NOT breakdown, geometric applies
        r = _pred_with(phi=0.5, eq=0.85)
        # confidence = 1 → weight = 0.7
        assert r.weight == pytest.approx(0.7, abs=1e-9)


# ──────────────────────────────────────────────────────────────────
# Trajectory bounds + reset
# ──────────────────────────────────────────────────────────────────


class TestTrajectoryBounds:
    def test_max_trajectory_caps_deque(self) -> None:
        p = ForesightPredictor(max_trajectory=5)
        for i in range(20):
            p.append(_uniform(), phi=0.5, t_ms=float(i))
        assert p.trajectory_length == 5

    def test_reset_clears_trajectory(self) -> None:
        p = ForesightPredictor()
        for i in range(5):
            p.append(_uniform(), phi=0.5, t_ms=float(i))
        p.reset()
        assert p.trajectory_length == 0
        r = p.predict({"equilibrium": 0.0})
        assert r.weight == 0.0


# ──────────────────────────────────────────────────────────────────
# Horizon = median of consecutive timestamps
# ──────────────────────────────────────────────────────────────────


class TestHorizon:
    def test_uniform_intervals_yield_that_horizon(self) -> None:
        p = ForesightPredictor()
        for i in range(5):
            p.append(_uniform(), phi=0.5, t_ms=i * 1000.0)
        r = p.predict({"equilibrium": 0.0})
        assert r.horizon_ms == pytest.approx(1000.0, abs=1e-9)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
