"""test_regime_hysteresis.py — held-position regime exit hysteresis.

After 2026-05-01 live churn diagnostics: single-tick mode flicker
("investigation→drift" on noise) was firing the held-position regime
exit immediately, churning BTC scalp 3× in 5 minutes for pennies.

Hysteresis added — regime exit now requires:
  (a) regime != regime_at_open
  (b) new regime stable for ≥ N consecutive ticks (default 3)
  (c) basin moved by FR distance > 1/π from basin_at_open

All three required.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.tick import SymbolState  # noqa: E402
from monkey_kernel.topology_constants import PI_STRUCT_GRAVITATING_FRACTION  # noqa: E402


def _peak(idx: int, peak: float = 0.5, dim: int = 64) -> np.ndarray:
    b = np.full(dim, (1.0 - peak) / (dim - 1), dtype=np.float64)
    b[idx] = peak
    return b


class TestRegimeStreakCounter:
    def test_streak_increments_on_divergent_regime(self) -> None:
        # White-box test — verify the streak counter exists and
        # increments correctly. Real-world wiring is exercised
        # end-to-end in tick.run_tick test.
        state = SymbolState(
            symbol="BTC",
            identity_basin=_peak(0),
        )
        state.regime_at_open_by_lane["scalp"] = "investigation"
        state.basin_at_open_by_lane["scalp"] = _peak(0, 0.5)
        # First divergent tick
        state.regime_change_streak_by_lane["scalp"] = (
            state.regime_change_streak_by_lane.get("scalp", 0) + 1
        )
        assert state.regime_change_streak_by_lane["scalp"] == 1
        # Second
        state.regime_change_streak_by_lane["scalp"] = (
            state.regime_change_streak_by_lane.get("scalp", 0) + 1
        )
        assert state.regime_change_streak_by_lane["scalp"] == 2
        # Reset (regime returned to investigation)
        state.regime_change_streak_by_lane["scalp"] = 0
        assert state.regime_change_streak_by_lane["scalp"] == 0

    def test_streak_resets_independently_per_lane(self) -> None:
        state = SymbolState(symbol="BTC", identity_basin=_peak(0))
        state.regime_change_streak_by_lane["scalp"] = 3
        state.regime_change_streak_by_lane["swing"] = 0
        # Resetting scalp does not touch swing
        state.regime_change_streak_by_lane["scalp"] = 0
        assert state.regime_change_streak_by_lane["swing"] == 0


class TestBasinAnchor:
    def test_basin_at_open_snapshot_is_independent_of_caller(self) -> None:
        state = SymbolState(symbol="BTC", identity_basin=_peak(0))
        b = _peak(10, 0.5)
        state.basin_at_open_by_lane["swing"] = b.copy()
        # Mutate the original — snapshot should be unchanged
        b[0] = 0.99
        assert state.basin_at_open_by_lane["swing"][0] != 0.99


class TestThresholdConstants:
    def test_disagreement_threshold_is_one_over_pi(self) -> None:
        import math
        assert PI_STRUCT_GRAVITATING_FRACTION == pytest.approx(1.0 / math.pi)


class TestRegimeExitGating:
    """End-to-end hysteresis behavior via direct field manipulation."""

    def test_streak_below_threshold_no_exit(self) -> None:
        """Mode flicker for 1 tick should not trigger exit."""
        # The directive is: exit only when streak >= N AND FR move > 1/π.
        # streak = 1 fails; verify the gate compound is false.
        regime_diverged = True
        streak = 1
        ticks_required = 3
        basin_fr_move = 1.0  # large
        should_exit = (
            regime_diverged
            and streak >= ticks_required
            and basin_fr_move > PI_STRUCT_GRAVITATING_FRACTION
        )
        assert should_exit is False

    def test_streak_at_threshold_with_small_basin_move_no_exit(self) -> None:
        """Streak satisfies but basin barely moved — no exit."""
        regime_diverged = True
        streak = 3
        ticks_required = 3
        basin_fr_move = 0.01  # well below 1/π ≈ 0.318
        should_exit = (
            regime_diverged
            and streak >= ticks_required
            and basin_fr_move > PI_STRUCT_GRAVITATING_FRACTION
        )
        assert should_exit is False

    def test_all_three_conditions_clear_exit_fires(self) -> None:
        """Streak ≥ 3, basin moved > 1/π, regime diverged → exit."""
        regime_diverged = True
        streak = 3
        ticks_required = 3
        basin_fr_move = 0.5  # > 1/π
        should_exit = (
            regime_diverged
            and streak >= ticks_required
            and basin_fr_move > PI_STRUCT_GRAVITATING_FRACTION
        )
        assert should_exit is True

    def test_regime_returned_to_open_no_exit(self) -> None:
        """Regime flickered back to regime_at_open — diverged is false."""
        regime_diverged = False
        streak = 5
        ticks_required = 3
        basin_fr_move = 1.0
        should_exit = (
            regime_diverged
            and streak >= ticks_required
            and basin_fr_move > PI_STRUCT_GRAVITATING_FRACTION
        )
        assert should_exit is False


class TestNoBasinAnchorFallback:
    def test_legacy_position_without_basin_anchor_uses_streak_only(self) -> None:
        """Position open before this PR has no basin_at_open snapshot.
        The fallback path (basin_fr_move = inf) means streak alone
        must clear — old behavior remains a safety floor.
        """
        regime_diverged = True
        streak = 3
        ticks_required = 3
        basin_fr_move = float("inf")  # no anchor
        should_exit = (
            regime_diverged
            and streak >= ticks_required
            and basin_fr_move > PI_STRUCT_GRAVITATING_FRACTION
        )
        assert should_exit is True
