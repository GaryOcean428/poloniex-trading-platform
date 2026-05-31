"""Tests for the REGIME-1 compositional cell matrix (Python port).

Mirrors apps/api/src/services/monkey/__tests__/compositionalExecutive.test.ts
exactly so the TS and Py parity table is a single source of truth.
"""
from __future__ import annotations

import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.compositional_executive import (  # noqa: E402
    CellObserverContext,
    evaluate_cell,
    canonical_to_phase,
    regime_to_direction,
    qig_warp_label_to_phase,
    RegimePhase,
    TrajectoryDirection,
)


class TestEvaluateCellMatrix:
    """evaluateCell — 3×3 compositional matrix coverage (Python port)."""

    phases: list[RegimePhase] = ["CREATOR", "PRESERVER", "DISSOLVER"]
    directions: list[TrajectoryDirection] = ["TREND_UP", "CHOP", "TREND_DOWN"]

    def test_returns_cell_action_for_all_nine_pairs(self):
        """All 9 (phase, direction) combinations return a valid CellAction."""
        for p in self.phases:
            for d in self.directions:
                cell = evaluate_cell(p, d)
                assert cell.phase == p
                assert cell.direction == d
                assert cell.label
                assert p in cell.label
                assert cell.lane_bias in ("trend", "swing", "scalp", "observe")
                assert cell.harvest_tightness in ("loose", "normal", "tight")
                assert 0 <= cell.size_multiplier <= 1.0

    def test_dissolver_cells_floor_at_0_2_safety_bound(self):
        """DISSOLVER cells use 0.2 SAFETY_BOUND floor — autonomy doctrine
        (2026-05-26: hard 0.0 replaced; catastrophic safety owned by P15)."""
        for d in self.directions:
            cell = evaluate_cell("DISSOLVER", d)
            assert cell.size_multiplier == pytest.approx(0.2)
            assert cell.lane_bias == "observe"

    def test_preserver_trend_cells_favor_loose_harvest(self):
        """PRESERVER + TREND cells: trend lane, loose harvest, full size."""
        for d in ("TREND_UP", "TREND_DOWN"):
            cell = evaluate_cell("PRESERVER", d)
            assert cell.lane_bias == "trend"
            assert cell.harvest_tightness == "loose"
            assert cell.size_multiplier == pytest.approx(1.0)

    def test_creator_chop_scalp_tight_observer_size(self):
        """CREATOR + CHOP: scalp bias, tight harvest, observer-derived size.
        Default observer (phi=0.5, confidence=1.0) → max(0.2, 0.5×1.0) = 0.5."""
        cell = evaluate_cell("CREATOR", "CHOP")
        assert cell.lane_bias == "scalp"
        assert cell.harvest_tightness == "tight"
        assert cell.size_multiplier == pytest.approx(0.5, abs=1e-9)

    def test_preserver_chop_swing_normal_observer_size(self):
        """PRESERVER + CHOP: swing (mean-revert), normal harvest, observer size.
        Same observer formula as CREATOR×CHOP; differentiation emerges from
        observables (PRESERVER states have higher phi × confidence naturally)."""
        cell = evaluate_cell("PRESERVER", "CHOP")
        assert cell.lane_bias == "swing"
        assert cell.harvest_tightness == "normal"
        assert cell.size_multiplier == pytest.approx(0.5, abs=1e-9)

    def test_chop_cells_scale_with_phi_times_confidence(self):
        """CHOP-cell multiplier = phi × regime_confidence, floored at 0.2."""
        high = evaluate_cell("CREATOR", "CHOP", CellObserverContext(phi=0.85, regime_confidence=0.9))
        assert high.size_multiplier == pytest.approx(0.85 * 0.9, abs=1e-9)

        moderate = evaluate_cell("CREATOR", "CHOP", CellObserverContext(phi=0.6, regime_confidence=0.7))
        assert moderate.size_multiplier == pytest.approx(0.6 * 0.7, abs=1e-9)

        # phi=0.3 × confidence=0.4 = 0.12 → clamped to 0.2 floor.
        floored = evaluate_cell("CREATOR", "CHOP", CellObserverContext(phi=0.3, regime_confidence=0.4))
        assert floored.size_multiplier == pytest.approx(0.2)

    def test_creator_trend_cells_full_size_normal_harvest(self):
        """CREATOR + TREND cells: trend lane, full size, normal harvest."""
        for d in ("TREND_UP", "TREND_DOWN"):
            cell = evaluate_cell("CREATOR", d)
            assert cell.lane_bias == "trend"
            assert cell.size_multiplier == pytest.approx(1.0)
            assert cell.harvest_tightness == "normal"

    def test_dissolver_label_distinguishes_chop_vs_trend(self):
        """DISSOLVER cell labels distinguish CHOP (max entropy) from
        TREND (momentum reverting)."""
        assert "max entropy" in evaluate_cell("DISSOLVER", "CHOP").label
        assert "momentum reverting" in evaluate_cell("DISSOLVER", "TREND_UP").label
        assert "momentum reverting" in evaluate_cell("DISSOLVER", "TREND_DOWN").label

    def test_is_pure_same_input_same_output(self):
        """Pure function — same (phase, direction, observer) yields identical CellAction."""
        obs = CellObserverContext(phi=0.7, regime_confidence=0.8)
        a = evaluate_cell("CREATOR", "TREND_UP", obs)
        b = evaluate_cell("CREATOR", "TREND_UP", obs)
        assert a == b


class TestRegimeToDirection:
    """regime_to_direction — trajectory regime string mapping."""

    def test_maps_recognised_values(self):
        assert regime_to_direction("TREND_UP") == "TREND_UP"
        assert regime_to_direction("CHOP") == "CHOP"
        assert regime_to_direction("TREND_DOWN") == "TREND_DOWN"

    def test_returns_none_for_unrecognised(self):
        assert regime_to_direction("unknown") is None
        assert regime_to_direction("") is None
        assert regime_to_direction("creator") is None  # phase regime, not direction


class TestCanonicalToPhase:
    """canonical_to_phase — qig_warp / CAL-3 phase regime string mapping."""

    def test_maps_recognised_values(self):
        assert canonical_to_phase("creator") == "CREATOR"
        assert canonical_to_phase("preserver") == "PRESERVER"
        assert canonical_to_phase("dissolver") == "DISSOLVER"

    def test_returns_none_for_unrecognised(self):
        assert canonical_to_phase("TREND_UP") is None   # direction regime, not phase
        assert canonical_to_phase(None) is None
        assert canonical_to_phase("disordered") is None  # qig_warp raw label, not CAL-3


class TestQigWarpLabelToPhase:
    """qig_warp_label_to_phase — raw qig_warp bubble.regime.regime.value mapping."""

    def test_maps_critical_to_creator(self):
        assert qig_warp_label_to_phase("CRITICAL") == "CREATOR"

    def test_maps_ordered_to_preserver(self):
        assert qig_warp_label_to_phase("ORDERED") == "PRESERVER"

    def test_maps_disordered_to_dissolver(self):
        assert qig_warp_label_to_phase("DISORDERED") == "DISSOLVER"

    def test_case_insensitive(self):
        assert qig_warp_label_to_phase("critical") == "CREATOR"
        assert qig_warp_label_to_phase("ordered") == "PRESERVER"
        assert qig_warp_label_to_phase("disordered") == "DISSOLVER"

    def test_returns_none_for_unrecognised(self):
        assert qig_warp_label_to_phase(None) is None
        assert qig_warp_label_to_phase("") is None
        assert qig_warp_label_to_phase("unknown") is None
        assert qig_warp_label_to_phase("CREATOR") is None  # already-mapped label

    def test_whitespace_stripped(self):
        """Leading/trailing whitespace in the raw qig_warp string is handled."""
        assert qig_warp_label_to_phase("  CRITICAL  ") == "CREATOR"


class TestTSPythonParityTable:
    """Parity table: Python evaluateCell matches the TS evaluateCell spec.

    Every entry encodes the expected cell fields for a given (phase, direction)
    pair. When adding cells to one side, update both.
    """

    CASES = [
        # (phase, direction, lane_bias, size_mult, harvest_tightness)
        ("CREATOR",  "TREND_UP",   "trend",   1.0, "normal"),
        ("CREATOR",  "TREND_DOWN", "trend",   1.0, "normal"),
        ("CREATOR",  "CHOP",       "scalp",   0.5, "tight"),   # default observer phi=0.5
        ("PRESERVER","TREND_UP",   "trend",   1.0, "loose"),
        ("PRESERVER","TREND_DOWN", "trend",   1.0, "loose"),
        ("PRESERVER","CHOP",       "swing",   0.5, "normal"),  # default observer phi=0.5
        ("DISSOLVER","TREND_UP",   "observe", 0.2, "tight"),
        ("DISSOLVER","TREND_DOWN", "observe", 0.2, "tight"),
        ("DISSOLVER","CHOP",       "observe", 0.2, "tight"),
    ]

    @pytest.mark.parametrize(
        "phase,direction,expected_lane,expected_size,expected_harvest",
        CASES,
    )
    def test_parity(
        self,
        phase: str,
        direction: str,
        expected_lane: str,
        expected_size: float,
        expected_harvest: str,
    ) -> None:
        cell = evaluate_cell(phase, direction)  # type: ignore[arg-type]
        assert cell.lane_bias == expected_lane, (
            f"{phase}×{direction}: expected lane_bias={expected_lane!r}, "
            f"got {cell.lane_bias!r}"
        )
        assert cell.size_multiplier == pytest.approx(expected_size, abs=1e-9), (
            f"{phase}×{direction}: expected size_mult={expected_size}, "
            f"got {cell.size_multiplier}"
        )
        assert cell.harvest_tightness == expected_harvest, (
            f"{phase}×{direction}: expected harvest_tightness={expected_harvest!r}, "
            f"got {cell.harvest_tightness!r}"
        )
