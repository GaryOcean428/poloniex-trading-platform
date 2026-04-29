"""test_heart_ocean.py — Tier 7 Heart κ-monitor + Ocean meta-observer.

Heart is observation-only. Ocean is the single autonomic-intervention
authority (#599 refactor — sleep state machine moved here from
autonomic.py). Tests cover:

  - Heart cold start, FEELING/LOGIC/ANCHOR mode, HRV
  - Ocean sleep machine: AWAKE → SLEEP via drift_streak + flat,
    SLEEP → AWAKE via timeout (preserved verbatim from old
    SleepCycleManager)
  - Ocean intervention triggers: ESCAPE / SLEEP / DREAM /
    MUSHROOM_MICRO priority order
  - Ocean diagnostics: coherence, spread, phi_variance, drift_streak
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.heart import HeartMonitor, HeartState  # noqa: E402
from monkey_kernel.ocean import Ocean, OceanState, SleepPhase  # noqa: E402
from monkey_kernel.state import BASIN_DIM, KAPPA_STAR  # noqa: E402


# ─────────────────────────────────────────────────────────────────
# HEART
# ─────────────────────────────────────────────────────────────────


class TestHeartColdStart:
    def test_empty_returns_anchor_mode(self) -> None:
        h = HeartMonitor().read()
        assert h.mode == "ANCHOR"
        assert h.kappa == KAPPA_STAR
        assert h.kappa_offset == 0.0
        assert h.hrv == 0.0
        assert h.sample_count == 0


class TestHeartMode:
    def test_kappa_below_star_yields_feeling(self) -> None:
        m = HeartMonitor(); m.append(60.0, 0.0)
        h = m.read()
        assert h.mode == "FEELING"
        assert h.kappa_offset < 0.0

    def test_kappa_above_star_yields_logic(self) -> None:
        m = HeartMonitor(); m.append(70.0, 0.0)
        assert m.read().mode == "LOGIC"

    def test_kappa_at_star_yields_anchor(self) -> None:
        m = HeartMonitor(); m.append(KAPPA_STAR, 0.0)
        assert m.read().mode == "ANCHOR"


class TestHeartHRV:
    def test_hrv_zero_with_few_samples(self) -> None:
        m = HeartMonitor()
        m.append(64.0, 0.0); m.append(64.5, 1.0)
        assert m.read().hrv == 0.0

    def test_hrv_zero_for_constant_kappa(self) -> None:
        m = HeartMonitor()
        for i in range(10):
            m.append(64.0, float(i))
        assert m.read().hrv == pytest.approx(0.0, abs=1e-9)

    def test_hrv_positive_for_oscillating_kappa(self) -> None:
        m = HeartMonitor()
        for i in range(10):
            kappa = 64.0 + 5.0 * (1 if i % 2 == 0 else -1)
            m.append(kappa, float(i))
        assert m.read().hrv > 0.0

    def test_window_caps_samples(self) -> None:
        m = HeartMonitor(max_window=5)
        for i in range(20):
            m.append(64.0 + i, float(i))
        assert m.window_length == 5

    def test_reset_clears(self) -> None:
        m = HeartMonitor()
        for i in range(5):
            m.append(64.0, float(i))
        m.reset()
        assert m.window_length == 0
        assert m.read().sample_count == 0


# ─────────────────────────────────────────────────────────────────
# OCEAN — sleep state machine
# ─────────────────────────────────────────────────────────────────


def _basin(seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.dirichlet(np.ones(BASIN_DIM) * 0.5)


def _peak_basin(idx: int = 0, mass: float = 0.95) -> np.ndarray:
    rest = (1.0 - mass) / (BASIN_DIM - 1)
    b = np.full(BASIN_DIM, rest, dtype=np.float64)
    b[idx] = mass
    return b


def _uniform() -> np.ndarray:
    return np.full(BASIN_DIM, 1.0 / BASIN_DIM, dtype=np.float64)


class TestOceanSleepStateMachine:
    def test_starts_awake(self) -> None:
        ocean = Ocean()
        assert ocean.is_awake
        assert ocean.phase == SleepPhase.AWAKE

    def test_awake_to_sleep_requires_min_awake_drift_streak_and_flat(self) -> None:
        ocean = Ocean()
        # Below MIN_AWAKE_MS — should NOT sleep even with drift streak
        for i in range(15):
            s = ocean.observe(
                phi=0.7, basin=_uniform(), current_mode="drift",
                is_flat=True, now_ms=float(i * 1000),
            )
        assert s.sleep_phase == "AWAKE"

    def test_awake_to_sleep_fires_after_two_hours_drifting_flat(self) -> None:
        ocean = Ocean()
        # Pin the awake clock to t=0 so deterministic now_ms math works.
        ocean.sleep_state.phase_started_at_ms = 0.0
        # Build drift_streak >= 10 over a few ticks
        for i in range(15):
            ocean.observe(
                phi=0.7, basin=_uniform(), current_mode="drift",
                is_flat=True, now_ms=float(i * 1000),
            )
        # Jump past MIN_AWAKE_MS (2h) so the awake duration check fires
        s = ocean.observe(
            phi=0.7, basin=_uniform(), current_mode="drift",
            is_flat=True, now_ms=float(2 * 60 * 60 * 1000 + 60_000),
        )
        assert s.sleep_phase == "SLEEP"
        assert s.intervention == "SLEEP"

    def test_awake_to_sleep_blocked_when_not_flat(self) -> None:
        ocean = Ocean()
        for i in range(15):
            ocean.observe(
                phi=0.7, basin=_uniform(), current_mode="drift",
                is_flat=False,  # ← position open, can't sleep
                now_ms=float(i * 1000),
            )
        s = ocean.observe(
            phi=0.7, basin=_uniform(), current_mode="drift",
            is_flat=False, now_ms=float(2 * 60 * 60 * 1000 + 60_000),
        )
        assert s.sleep_phase == "AWAKE"

    def test_sleep_to_awake_fires_after_fifteen_minutes(self) -> None:
        ocean = Ocean()
        ocean.sleep_state.phase_started_at_ms = 0.0
        # Force into sleep
        for i in range(15):
            ocean.observe(
                phi=0.7, basin=_uniform(), current_mode="drift",
                is_flat=True, now_ms=float(i * 1000),
            )
        ocean.observe(
            phi=0.7, basin=_uniform(), current_mode="drift",
            is_flat=True, now_ms=float(2 * 60 * 60 * 1000 + 60_000),
        )
        assert ocean.phase == SleepPhase.SLEEP
        # Jump past sleep duration (15 min)
        wake_t = float(2 * 60 * 60 * 1000 + 16 * 60 * 1000)
        s = ocean.observe(
            phi=0.7, basin=_uniform(), current_mode="investigation",
            is_flat=True, now_ms=wake_t,
        )
        assert s.sleep_phase == "AWAKE"
        assert s.intervention == "WAKE"


# ─────────────────────────────────────────────────────────────────
# OCEAN — intervention priority
# ─────────────────────────────────────────────────────────────────


class TestOceanInterventionPriority:
    def test_escape_when_phi_below_zero_point_one_five(self) -> None:
        ocean = Ocean()
        # Build phi history with low variance so plateau doesn't fire
        # accidentally; phi here triggers ESCAPE first.
        for i in range(5):
            ocean.observe(
                phi=0.10, basin=_uniform(),
                current_mode="investigation", is_flat=False,
                now_ms=float(i * 1000),
            )
        s = ocean.observe(
            phi=0.10, basin=_uniform(),
            current_mode="investigation", is_flat=False,
            now_ms=float(6 * 1000),
        )
        assert s.intervention == "ESCAPE"

    def test_sleep_when_lane_spread_exceeds_zero_point_three(self) -> None:
        ocean = Ocean()
        # phi above ESCAPE bound + lane divergence high → SLEEP
        s = ocean.observe(
            phi=0.7, basin=_uniform(),
            current_mode="investigation", is_flat=False,
            now_ms=1000.0,
            cross_lane_basins=[_peak_basin(0, 0.95), _peak_basin(60, 0.95)],
        )
        assert s.intervention == "SLEEP"
        assert s.spread > 0.30

    def test_dream_when_phi_below_zero_point_five(self) -> None:
        ocean = Ocean()
        s = ocean.observe(
            phi=0.3, basin=_uniform(),
            current_mode="investigation", is_flat=False,
            now_ms=1000.0,
        )
        assert s.intervention == "DREAM"

    def test_mushroom_micro_when_phi_variance_below_zero_point_zero_one(self) -> None:
        ocean = Ocean()
        # Build phi history with tiny variance, phi above DREAM bound
        for i in range(10):
            ocean.observe(
                phi=0.7 + 0.001 * (i % 2),  # very small wiggle
                basin=_uniform(),
                current_mode="investigation", is_flat=False,
                now_ms=float(i * 1000),
            )
        s = ocean.observe(
            phi=0.7, basin=_uniform(),
            current_mode="investigation", is_flat=False,
            now_ms=float(11 * 1000),
        )
        assert s.intervention == "MUSHROOM_MICRO"

    def test_nominal_yields_no_intervention(self) -> None:
        ocean = Ocean()
        # Healthy phi history with real variance (above plateau bound)
        for i in range(10):
            ocean.observe(
                phi=0.5 + 0.2 * (i % 3 - 1),  # triangle wave 0.3 / 0.5 / 0.7
                basin=_uniform(),
                current_mode="investigation", is_flat=False,
                now_ms=float(i * 1000),
            )
        s = ocean.observe(
            phi=0.7, basin=_uniform(),
            current_mode="investigation", is_flat=False,
            now_ms=float(11 * 1000),
        )
        assert s.intervention is None


# ─────────────────────────────────────────────────────────────────
# OCEAN — telemetry / diagnostics
# ─────────────────────────────────────────────────────────────────


class TestOceanDiagnostics:
    def test_coherence_high_for_concentrated_basin(self) -> None:
        ocean = Ocean()
        s = ocean.observe(
            phi=0.7, basin=_peak_basin(0, 0.95),
            current_mode="investigation", is_flat=False, now_ms=0.0,
        )
        assert s.coherence > 0.5

    def test_coherence_low_for_uniform_basin(self) -> None:
        ocean = Ocean()
        s = ocean.observe(
            phi=0.7, basin=_uniform(),
            current_mode="investigation", is_flat=False, now_ms=0.0,
        )
        assert s.coherence < 0.01  # uniform has near-zero coherence

    def test_spread_zero_with_single_lane(self) -> None:
        ocean = Ocean()
        s = ocean.observe(
            phi=0.7, basin=_uniform(),
            current_mode="investigation", is_flat=False, now_ms=0.0,
            cross_lane_basins=[_peak_basin(0)],
        )
        assert s.spread == 0.0

    def test_diagnostics_present(self) -> None:
        ocean = Ocean()
        s = ocean.observe(
            phi=0.5, basin=_uniform(),
            current_mode="investigation", is_flat=False, now_ms=0.0,
        )
        assert "phi_now" in s.diagnostics
        assert "phi_variance" in s.diagnostics
        assert "drift_streak" in s.diagnostics
        assert "sleep_remaining_ms" in s.diagnostics


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
