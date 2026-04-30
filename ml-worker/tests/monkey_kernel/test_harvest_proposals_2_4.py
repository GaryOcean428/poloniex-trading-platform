"""Tests for proposals #2 (peak-tracking trailing stop) and #4
(sustained tape-flip streak) on ``should_profit_harvest``.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.executive import ExecBasinState, should_profit_harvest  # noqa: E402
from monkey_kernel.state import NeurochemicalState  # noqa: E402


def _state(serotonin: float = 0.5, ne: float = 0.5, dopamine: float = 0.5,
           phi: float = 0.5) -> ExecBasinState:
    nc = NeurochemicalState(
        acetylcholine=0.5, dopamine=dopamine, serotonin=serotonin,
        norepinephrine=ne, gaba=0.5, endorphins=0.5,
    )
    b = np.full(64, 1 / 64)
    return ExecBasinState(
        basin=b, identity_basin=b,
        kappa=64.0, basin_velocity=0.0, sovereignty=0.7, phi=phi,
        regime_weights={"equilibrium": 1.0, "efficient": 0.0, "quantum": 0.0},
        neurochemistry=nc,
    )


class TestPeakTrackingGuard:
    """Proposal #2 — trend-flip harvest now requires
    peak_frac >= 1% AND current_frac < peak_frac * 0.7."""

    def test_no_fire_when_peak_below_min_pct(self):
        # peak_frac = 0.5%, below the 1% min.
        out = should_profit_harvest(
            unrealized_pnl_usdt=0.5,
            peak_pnl_usdt=0.5,
            notional_usdt=100.0,
            tape_trend=-0.99,  # strong bearish align for long
            held_side="long",
            s=_state(),
            tape_flip_streak=10,  # streak is high (proposal #4 satisfied)
        )
        # peak too small → not enough conviction to harvest.
        assert out["value"] is False

    def test_no_fire_when_giveback_under_30pct(self):
        # peak_frac = 2%, current_frac = 1.8% → giveback only 10% from peak.
        out = should_profit_harvest(
            unrealized_pnl_usdt=1.8,
            peak_pnl_usdt=2.0,
            notional_usdt=100.0,
            tape_trend=-0.99,
            held_side="long",
            s=_state(),
            tape_flip_streak=10,
        )
        # Not enough giveback yet.
        assert out["value"] is False

    def test_fires_when_peak_high_and_giveback_high(self):
        # peak_frac = 1.0%, current_frac = 0.65% -> 35% giveback.
        # serotonin high so trailing_floor stays well below current.
        out = should_profit_harvest(
            unrealized_pnl_usdt=0.65,
            peak_pnl_usdt=1.0,
            notional_usdt=100.0,
            tape_trend=-0.99,
            held_side="long",
            s=_state(serotonin=1.0),
            tape_flip_streak=10,
        )
        assert out["value"] is True
        assert "trend_flip_harvest" in out["reason"]


class TestTapeFlipStreak:
    """Proposal #4 — trend-flip harvest requires N consecutive
    bearish-alignment ticks (default 3)."""

    # For trend_flip path tests we set serotonin high so trailing
    # giveback widens (giveback = 0.30 + 0.20*serotonin = 0.50 at
    # serotonin=1.0); peak=1%, current=0.7% -> trailing_floor = 0.5%
    # so trailing does NOT fire (current > floor). That isolates the
    # trend_flip branch for streak/peak-guard checks.
    def test_no_fire_with_zero_streak(self):
        out = should_profit_harvest(
            unrealized_pnl_usdt=0.7,
            peak_pnl_usdt=1.0,
            notional_usdt=100.0,
            tape_trend=-0.99,
            held_side="long",
            s=_state(serotonin=1.0),
            tape_flip_streak=0,
        )
        assert out["value"] is False

    def test_no_fire_with_1_streak(self):
        out = should_profit_harvest(
            unrealized_pnl_usdt=0.7,
            peak_pnl_usdt=1.0,
            notional_usdt=100.0,
            tape_trend=-0.99,
            held_side="long",
            s=_state(serotonin=1.0),
            tape_flip_streak=1,
        )
        assert out["value"] is False

    def test_no_fire_with_2_streak(self):
        out = should_profit_harvest(
            unrealized_pnl_usdt=0.7,
            peak_pnl_usdt=1.0,
            notional_usdt=100.0,
            tape_trend=-0.99,
            held_side="long",
            s=_state(serotonin=1.0),
            tape_flip_streak=2,
        )
        assert out["value"] is False

    def test_fires_at_streak_3(self):
        out = should_profit_harvest(
            unrealized_pnl_usdt=0.65,
            peak_pnl_usdt=1.0,
            notional_usdt=100.0,
            tape_trend=-0.99,
            held_side="long",
            s=_state(serotonin=1.0),
            tape_flip_streak=3,
        )
        assert out["value"] is True

    def test_streak_threshold_configurable(self):
        # Lower threshold to 1 — single tick fires harvest.
        out = should_profit_harvest(
            unrealized_pnl_usdt=0.65,
            peak_pnl_usdt=1.0,
            notional_usdt=100.0,
            tape_trend=-0.99,
            held_side="long",
            s=_state(serotonin=1.0),
            tape_flip_streak=1,
            tape_flip_streak_required=1,
        )
        assert out["value"] is True


class TestTrailingHarvestUnchanged:
    """The trailing-harvest branch (peak * (1 - giveback) trailing
    stop) should still fire as before — unaffected by #2/#4."""

    def test_trailing_harvest_fires_independently_of_streak(self):
        # Big peak, big giveback → trailing branch fires.
        out = should_profit_harvest(
            unrealized_pnl_usdt=0.05,  # 0.05% remaining
            peak_pnl_usdt=2.0,
            notional_usdt=100.0,
            tape_trend=0.5,  # bullish-aligned tape — no trend flip
            held_side="long",
            s=_state(serotonin=0.0),  # tighter giveback
            tape_flip_streak=0,
        )
        assert out["value"] is True
        assert "trailing_harvest" in out["reason"]


class TestProposalCombinedSemantics:
    def test_high_streak_low_peak_does_not_fire(self):
        # Streak high but peak too small → guard fails.
        out = should_profit_harvest(
            unrealized_pnl_usdt=0.3,
            peak_pnl_usdt=0.5,
            notional_usdt=100.0,
            tape_trend=-0.99,
            held_side="long",
            s=_state(),
            tape_flip_streak=10,
        )
        assert out["value"] is False

    def test_streak_resets_inhibits_harvest(self):
        # Streak = 0 even with strong peak → no harvest. serotonin
        # high so trailing branch doesn't shadow the streak gate.
        out = should_profit_harvest(
            unrealized_pnl_usdt=0.65,
            peak_pnl_usdt=1.0,
            notional_usdt=100.0,
            tape_trend=-0.99,
            held_side="long",
            s=_state(serotonin=1.0),
            tape_flip_streak=0,
        )
        assert out["value"] is False

    def test_short_position_align_inverts(self):
        # Short position: bearish alignment from short's POV is
        # tape_trend POSITIVE (since alignment_now = -tape_trend).
        out = should_profit_harvest(
            unrealized_pnl_usdt=0.65,
            peak_pnl_usdt=1.0,
            notional_usdt=100.0,
            tape_trend=0.99,
            held_side="short",
            s=_state(serotonin=1.0),
            tape_flip_streak=10,
        )
        assert out["value"] is True


class TestDerivationFields:
    def test_derivation_includes_streak_when_no_fire(self):
        out = should_profit_harvest(
            unrealized_pnl_usdt=0.5,
            peak_pnl_usdt=0.5,
            notional_usdt=100.0,
            tape_trend=0.0,
            held_side="long",
            s=_state(),
            tape_flip_streak=2,
        )
        assert out["derivation"]["tape_flip_streak"] == 2

    def test_derivation_includes_streak_on_fire(self):
        out = should_profit_harvest(
            unrealized_pnl_usdt=0.65,
            peak_pnl_usdt=1.0,
            notional_usdt=100.0,
            tape_trend=-0.99,
            held_side="long",
            s=_state(serotonin=1.0),
            tape_flip_streak=3,
        )
        assert out["value"] is True
        assert out["derivation"]["tape_flip_streak"] == 3
        assert "peak_giveback_floor" in out["derivation"]
