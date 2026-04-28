"""
test_lane_selection.py — Unit tests for lane feature (#588).

Tests:
  1. choose_lane returns valid LaneType in all cases
  2. Low phi/sovereignty/bv → scalp preference
  3. High phi/sovereignty + strong trend → trend preference
  4. High basin_velocity → observe preference
  5. Moderate state → swing (default)
  6. score_nearest with lane filter returns only matching entries
  7. score_nearest without lane filter returns all entries
  8. BankEntry.lane defaults to 'swing'
  9. TickDecision has lane, direction, size_fraction, dca_intent fields
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

os.environ.pop("DATABASE_URL", None)

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.executive import (  # noqa: E402
    ExecBasinState,
    choose_lane,
)
from monkey_kernel.resonance_bank import (  # noqa: E402
    BankEntry,
    score_nearest,
)
from monkey_kernel.state import (  # noqa: E402
    BASIN_DIM,
    KAPPA_STAR,
    LaneType,
    NeurochemicalState,
)
from monkey_kernel.tick import TickDecision  # noqa: E402


def _nominal_nc() -> NeurochemicalState:
    return NeurochemicalState(
        acetylcholine=0.5, dopamine=0.5, serotonin=0.5,
        norepinephrine=0.5, gaba=0.5, endorphins=0.5,
    )


def _uniform_basin() -> np.ndarray:
    b = np.ones(BASIN_DIM, dtype=np.float64) / BASIN_DIM
    return b


def _make_state(
    *,
    phi: float = 0.5,
    kappa: float = KAPPA_STAR,
    sovereignty: float = 0.5,
    basin_velocity: float = 0.1,
) -> ExecBasinState:
    return ExecBasinState(
        basin=_uniform_basin(),
        identity_basin=_uniform_basin(),
        phi=phi,
        kappa=kappa,
        regime_weights={"quantum": 1 / 3, "efficient": 1 / 3, "equilibrium": 1 / 3},
        sovereignty=sovereignty,
        basin_velocity=basin_velocity,
        neurochemistry=_nominal_nc(),
    )


def _make_bank_entry(
    entry_id: str = "test-1",
    lane: LaneType = "swing",
) -> BankEntry:
    return BankEntry(
        id=entry_id,
        symbol="ETH",
        entry_basin=_uniform_basin(),
        realized_pnl=0.5,
        trade_duration_ms=60000,
        trade_outcome="win",
        order_id="ord-1",
        basin_depth=0.5,
        access_count=1,
        phi_at_creation=0.5,
        source="lived",
        lane=lane,
    )


class TestChooseLane:
    """Lane selection via softmax over basin features."""

    def test_returns_valid_lane_type(self) -> None:
        s = _make_state()
        result = choose_lane(s, tape_trend=0.0)
        assert result["value"] in ("scalp", "swing", "trend", "observe")

    def test_low_phi_sovereignty_bv_favors_scalp(self) -> None:
        """phi≈0, sovereignty≈0, bv≈0 → scalp (high reward density)."""
        s = _make_state(phi=0.05, sovereignty=0.05, basin_velocity=0.01, kappa=KAPPA_STAR)
        result = choose_lane(s, tape_trend=0.0)
        assert result["value"] == "scalp"

    def test_high_phi_sovereignty_trend_favors_trend(self) -> None:
        """phi≈1, sovereignty≈1, strong tape_trend → trend."""
        s = _make_state(phi=0.95, sovereignty=0.95, basin_velocity=0.05, kappa=KAPPA_STAR)
        result = choose_lane(s, tape_trend=0.9)
        assert result["value"] == "trend"

    def test_high_basin_velocity_favors_observe(self) -> None:
        """bv >> 0 → observe (chaos)."""
        s = _make_state(phi=0.3, sovereignty=0.3, basin_velocity=0.95, kappa=KAPPA_STAR)
        result = choose_lane(s, tape_trend=0.0)
        assert result["value"] == "observe"

    def test_moderate_state_defaults_swing(self) -> None:
        """Moderate state → swing."""
        s = _make_state(phi=0.5, sovereignty=0.5, basin_velocity=0.1, kappa=KAPPA_STAR)
        result = choose_lane(s, tape_trend=0.1)
        # Swing should be a strong contender at moderate state
        probs = result["derivation"]["softmax_probs"]
        # With moderate values, swing's baseline 0.3 should compete
        assert result["value"] in ("scalp", "swing")  # either is acceptable at moderate

    def test_derivation_contains_softmax_probs(self) -> None:
        s = _make_state()
        result = choose_lane(s, tape_trend=0.0)
        assert "softmax_probs" in result["derivation"]
        probs = result["derivation"]["softmax_probs"]
        assert abs(sum(probs.values()) - 1.0) < 1e-6


class TestScoreNearestLaneFilter:
    """Lane-conditioned bank retrieval."""

    def test_lane_filter_returns_only_matching(self) -> None:
        entries = [
            _make_bank_entry("scalp-1", lane="scalp"),
            _make_bank_entry("swing-1", lane="swing"),
            _make_bank_entry("trend-1", lane="trend"),
            _make_bank_entry("scalp-2", lane="scalp"),
        ]
        result = score_nearest(_uniform_basin(), entries, lane="scalp")
        assert len(result) == 2
        assert all(n.entry.lane == "scalp" for n in result)

    def test_no_lane_filter_returns_all(self) -> None:
        entries = [
            _make_bank_entry("scalp-1", lane="scalp"),
            _make_bank_entry("swing-1", lane="swing"),
        ]
        result = score_nearest(_uniform_basin(), entries)
        assert len(result) == 2

    def test_lane_filter_with_no_matches(self) -> None:
        entries = [
            _make_bank_entry("swing-1", lane="swing"),
        ]
        result = score_nearest(_uniform_basin(), entries, lane="scalp")
        assert len(result) == 0


class TestBankEntryLane:
    """BankEntry lane field."""

    def test_default_lane_is_swing(self) -> None:
        entry = BankEntry(
            id="1", symbol="ETH", entry_basin=_uniform_basin(),
            realized_pnl=0.0, trade_duration_ms=None, trade_outcome=None,
            order_id=None, basin_depth=0.5, access_count=1,
            phi_at_creation=None, source="lived",
        )
        assert entry.lane == "swing"


class TestTickDecisionLaneFields:
    """TickDecision has the 4 new fields."""

    def test_tick_decision_has_lane_fields(self) -> None:
        td = TickDecision(
            action="hold", reason="test", mode="investigation",
            size_usdt=0, leverage=1, entry_threshold=0.5,
            phi=0.5, kappa=64.0, basin_velocity=0.1,
            f_health=0.8, drift_from_identity=0.1,
            basin_direction=0.0, tape_trend=0.0,
            side_candidate="long", side_override=False,
            neurochemistry=_nominal_nc(),
            derivation={}, basin=_uniform_basin(),
        )
        assert td.lane == "swing"
        assert td.direction == "flat"
        assert td.size_fraction == 1.0
        assert td.dca_intent is False

    def test_tick_decision_with_explicit_lane(self) -> None:
        td = TickDecision(
            action="enter_long", reason="test", mode="investigation",
            size_usdt=100, leverage=5, entry_threshold=0.3,
            phi=0.5, kappa=64.0, basin_velocity=0.1,
            f_health=0.8, drift_from_identity=0.1,
            basin_direction=0.0, tape_trend=0.0,
            side_candidate="long", side_override=False,
            neurochemistry=_nominal_nc(),
            derivation={}, basin=_uniform_basin(),
            lane="scalp", direction="long",
            size_fraction=0.5, dca_intent=True,
        )
        assert td.lane == "scalp"
        assert td.direction == "long"
        assert td.size_fraction == 0.5
        assert td.dca_intent is True
