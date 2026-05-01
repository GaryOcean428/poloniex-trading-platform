"""
test_kernel_improvements_2026_04_30.py — direct CC directive payload.

Three kernel-level changes get pinned here (the fourth, funding_drag in
compute_emotions, is in test_emotions.py::TestFundingDrag):

  1. Scalp lane TP at 3% — registry round-trip + should_scalp_exit fires
     at +3% ROI when ``executive.lane.scalp.tp_pct = 0.03``.
  2. Per-lane Kelly stats — the Python kernel itself doesn't query the
     DB (the TS caller does), so we just verify the rolling_kelly_stats
     plumbing accepts a lane-conditioned tuple and the kelly cap layer
     produces a different leverage when the lane's stats differ.
  3. CHOP regime entry suppression — synthetic ``RegimeReading`` with
     ``regime='CHOP'`` and ``confidence > 0.70`` triggers the gate;
     ``confidence == 0.50`` does not.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

# Don't hit Postgres during tests — registry falls back to defaults.
os.environ.pop("DATABASE_URL", None)

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel import parameters as parameters_mod  # noqa: E402
from monkey_kernel.executive import (  # noqa: E402
    ExecBasinState,
    lane_param,
    should_scalp_exit,
)
from monkey_kernel.modes import MonkeyMode  # noqa: E402
from monkey_kernel.parameters import ParamValue, VariableCategory  # noqa: E402
from monkey_kernel.regime import RegimeReading  # noqa: E402
from monkey_kernel.state import KAPPA_STAR, NeurochemicalState  # noqa: E402
from monkey_kernel.tick import (  # noqa: E402
    CHOP_SUPPRESSION_CONFIDENCE,
    _chop_suppress_entry,
)


def _basin_state(*, phi: float = 0.5) -> ExecBasinState:
    nc = NeurochemicalState(
        acetylcholine=0.5, dopamine=0.5, serotonin=0.5,
        norepinephrine=0.5, gaba=0.5, endorphins=0.5,
    )
    basin = np.full(64, 1.0 / 64.0, dtype=np.float64)
    return ExecBasinState(
        basin=basin, identity_basin=basin.copy(),
        phi=phi, kappa=KAPPA_STAR,
        regime_weights={"quantum": 0.33, "efficient": 0.33, "equilibrium": 0.34},
        sovereignty=0.5, basin_velocity=0.05, neurochemistry=nc,
    )


# ─────────────────────────────────────────────────────────────────
# 1. Scalp lane TP at 3% — registry round-trip
# ─────────────────────────────────────────────────────────────────


class TestScalpTpThreePercent:
    """The directive bumps ``executive.lane.scalp.tp_pct`` to 0.03 via
    SQL. The registry round-trip must reflect the new value AND
    should_scalp_exit must fire at +3% ROI on a scalp position."""

    def _live_registry(self) -> object:
        # The executive module captures the registry singleton at
        # import time; mutate THAT object so lane_param sees the
        # injected value. Resetting via _reset_registry_for_tests
        # would orphan the existing reference.
        from monkey_kernel import executive as _exec
        return _exec._registry

    def setup_method(self) -> None:
        reg = self._live_registry()
        with reg._lock:
            self._saved_tp = reg._cache.get("executive.lane.scalp.tp_pct")
            reg._loaded = True

    def teardown_method(self) -> None:
        reg = self._live_registry()
        with reg._lock:
            if self._saved_tp is None:
                reg._cache.pop("executive.lane.scalp.tp_pct", None)
            else:
                reg._cache["executive.lane.scalp.tp_pct"] = self._saved_tp

    def _inject_scalp_tp(self, value: float) -> None:
        reg = self._live_registry()
        with reg._lock:
            reg._loaded = True
            reg._cache["executive.lane.scalp.tp_pct"] = ParamValue(
                name="executive.lane.scalp.tp_pct",
                category=VariableCategory.OPERATIONAL,
                value=value,
                bounds_low=0.005,
                bounds_high=0.10,
                justification="test-inject",
                version=2,
            )

    def test_registry_round_trip_three_percent(self) -> None:
        self._inject_scalp_tp(0.03)
        assert lane_param("scalp", "tp_pct") == pytest.approx(0.03, abs=1e-12)

    def test_should_scalp_exit_fires_at_three_percent_pnl(self) -> None:
        self._inject_scalp_tp(0.03)
        bs = _basin_state()
        # +3.0% gain on $100 notional = $3.00 unrealized PnL — should
        # cross tp_thr = max(geometric, 0.03) = 0.03 in INVESTIGATION.
        result = should_scalp_exit(
            unrealized_pnl_usdt=3.0,
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="scalp",
        )
        assert result["value"] is True
        assert "take_profit[scalp]" in result["reason"]
        # The lane envelope is what the geometric formula deferred to.
        assert result["derivation"]["lane_tp_pct"] == pytest.approx(0.03, abs=1e-12)
        assert result["derivation"]["tp_thr"] == pytest.approx(0.03, abs=1e-12)

    def test_should_scalp_exit_holds_at_two_point_nine_percent(self) -> None:
        self._inject_scalp_tp(0.03)
        bs = _basin_state()
        # +2.9% < 3% TP — must hold.
        result = should_scalp_exit(
            unrealized_pnl_usdt=2.9,
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="scalp",
        )
        assert result["value"] is False
        assert "scalp hold[scalp]" in result["reason"]


# ─────────────────────────────────────────────────────────────────
# 2. Per-lane Kelly stats plumbing
# ─────────────────────────────────────────────────────────────────


class TestPerLaneKellyPlumbing:
    """The Python kernel consumes a 3-tuple of (win_rate, avg_win,
    avg_loss). The TS caller now scopes the underlying SQL query to the
    active lane, so the tuple injected here represents a single lane.
    We verify the kelly cap layer responds to lane-specific stats by
    yielding a different leverage when the same kernel state is
    paired with two lane-specific tuples."""

    def test_strong_lane_stats_produce_higher_kelly_cap_than_weak(self) -> None:
        from monkey_kernel.executive import kelly_leverage_cap
        # Strong lane: 70% win rate, avg_win=2, avg_loss=-1 → big edge.
        strong = kelly_leverage_cap(0.70, 2.0, -1.0, max_lev=20)
        # Weak lane: 51% win rate, avg_win=1, avg_loss=-1 → tiny edge.
        weak = kelly_leverage_cap(0.51, 1.0, -1.0, max_lev=20)
        # Different inputs must produce non-decreasing caps in win-rate
        # ordering. Lane isolation means each lane has its own cap.
        assert strong >= weak

    def test_uninformative_lane_stats_defer_to_geometric(self) -> None:
        from monkey_kernel.executive import kelly_leverage_cap
        # An uninformative lane (no edge / negative edge / no wins)
        # returns the max boundary so the geometric formula wins.
        assert kelly_leverage_cap(0.0, 0.0, 0.0, max_lev=20) == 20
        assert kelly_leverage_cap(0.40, 1.0, -1.0, max_lev=20) == 20  # f* < 0


# ─────────────────────────────────────────────────────────────────
# 3. CHOP regime entry suppression
# ─────────────────────────────────────────────────────────────────


class TestChopRegimeSuppression:
    """The kernel reads the regime classifier's own confidence and
    suspends NEW entries when it reads sustained chop above the
    confidence threshold. Held positions (re-justification + harvest)
    are unaffected."""

    def test_suppression_threshold_is_seventy_percent(self) -> None:
        # The threshold lives on the classifier's [0, 1] confidence
        # scale. Pinning it at 0.70 is the directive's anchor.
        assert CHOP_SUPPRESSION_CONFIDENCE == pytest.approx(0.70, abs=1e-12)

    def test_chop_high_confidence_suppresses(self) -> None:
        reading = RegimeReading(
            regime="CHOP", confidence=0.85,
            trend_strength=0.0, chop_score=0.95,
        )
        assert _chop_suppress_entry(reading) is True

    def test_chop_just_above_threshold_suppresses(self) -> None:
        reading = RegimeReading(
            regime="CHOP", confidence=0.71,
            trend_strength=0.0, chop_score=0.80,
        )
        assert _chop_suppress_entry(reading) is True

    def test_chop_at_threshold_does_not_suppress(self) -> None:
        # > 0.70 (strict). At exactly 0.70 the gate is open; tuning
        # bias is "the classifier needs to be MORE than ambivalent".
        reading = RegimeReading(
            regime="CHOP", confidence=0.70,
            trend_strength=0.0, chop_score=0.80,
        )
        assert _chop_suppress_entry(reading) is False

    def test_chop_low_confidence_does_not_suppress(self) -> None:
        reading = RegimeReading(
            regime="CHOP", confidence=0.50,
            trend_strength=0.0, chop_score=0.60,
        )
        assert _chop_suppress_entry(reading) is False

    def test_trend_up_high_confidence_does_not_suppress(self) -> None:
        # Only CHOP regime triggers the gate. A strongly-trending
        # market with the same high confidence stays open for entries.
        reading = RegimeReading(
            regime="TREND_UP", confidence=0.95,
            trend_strength=0.5, chop_score=0.10,
        )
        assert _chop_suppress_entry(reading) is False

    def test_trend_down_high_confidence_does_not_suppress(self) -> None:
        reading = RegimeReading(
            regime="TREND_DOWN", confidence=0.95,
            trend_strength=-0.5, chop_score=0.10,
        )
        assert _chop_suppress_entry(reading) is False
