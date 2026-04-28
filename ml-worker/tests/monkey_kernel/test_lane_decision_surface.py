"""
test_lane_decision_surface.py — v0.8.6 (#586) lane feature tests.

Tests:
  1. BankEntry schema includes lane field; default is 'swing'.
  2. score_nearest without lane filter returns all entries.
  3. score_nearest with lane='scalp' returns only scalp entries.
  4. choose_lane emits all 4 lanes correctly given mock basin states.
  5. choose_lane temperature scaling: high κ exploits, low κ explores.
  6. TickDecision has lane field; defaults to 'swing'.
  7. LaneType is exported from state.py.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

# Remove DATABASE_URL so registry uses defaults.
os.environ.pop("DATABASE_URL", None)

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.executive import (  # noqa: E402
    ExecBasinState,
    choose_lane,
)
from monkey_kernel.modes import MonkeyMode  # noqa: E402
from monkey_kernel.resonance_bank import BankEntry, score_nearest  # noqa: E402
from monkey_kernel.state import KAPPA_STAR, LaneType, NeurochemicalState  # noqa: E402
from monkey_kernel.tick import TickDecision  # noqa: E402


# ── Helpers ──────────────────────────────────────────────────────────────────

def _nominal_nc() -> NeurochemicalState:
    return NeurochemicalState(
        acetylcholine=0.5, dopamine=0.5, serotonin=0.5,
        norepinephrine=0.5, gaba=0.5, endorphins=0.5,
    )


def _nominal_state(
    *,
    phi: float = 0.5,
    kappa: float | None = None,
    sovereignty: float = 0.5,
    basin_velocity: float = 0.02,
) -> ExecBasinState:
    if kappa is None:
        kappa = KAPPA_STAR
    basin = np.ones(64) / 64
    return ExecBasinState(
        basin=basin,
        identity_basin=basin,
        phi=phi,
        kappa=kappa,
        regime_weights={"quantum": 1/3, "efficient": 1/3, "equilibrium": 1/3},
        sovereignty=sovereignty,
        basin_velocity=basin_velocity,
        neurochemistry=_nominal_nc(),
    )


def _make_entry(lane: str = "swing") -> BankEntry:
    basin = np.ones(64) / 64
    return BankEntry(
        id="test-id",
        symbol="ETH",
        entry_basin=basin,
        realized_pnl=0.0,
        trade_duration_ms=None,
        trade_outcome="win",
        order_id=None,
        basin_depth=0.5,
        access_count=1,
        phi_at_creation=0.5,
        source="lived",
        lane=lane,  # type: ignore[arg-type]
    )


# ── 1. BankEntry schema ───────────────────────────────────────────────────────

class TestBankEntrySchema:
    def test_default_lane_is_swing(self):
        """BankEntry.lane defaults to 'swing'."""
        e = _make_entry()
        assert e.lane == "swing"

    def test_lane_field_accepts_all_four_values(self):
        for lane in ("scalp", "swing", "trend", "observe"):
            e = _make_entry(lane=lane)
            assert e.lane == lane

    def test_lane_type_exported_from_state(self):
        """LaneType Literal is exported from state.py."""
        # Just asserting the import works and has the expected members.
        import typing
        args = typing.get_args(LaneType)
        assert set(args) == {"scalp", "swing", "trend", "observe"}


# ── 2 & 3. score_nearest lane filtering ──────────────────────────────────────

class TestScoreNearestLaneFilter:
    def test_no_lane_filter_returns_all_entries(self):
        """score_nearest without lane= returns entries of every lane."""
        entries = [
            _make_entry("scalp"),
            _make_entry("swing"),
            _make_entry("trend"),
            _make_entry("observe"),
        ]
        basin = np.ones(64) / 64
        results = score_nearest(basin, entries, top_k=10)
        assert len(results) == 4

    def test_lane_filter_returns_only_matching_entries(self):
        """score_nearest(lane='scalp') returns only scalp entries."""
        entries = [
            _make_entry("scalp"),
            _make_entry("swing"),
            _make_entry("swing"),
            _make_entry("trend"),
        ]
        basin = np.ones(64) / 64
        results = score_nearest(basin, entries, top_k=10, lane="scalp")
        assert len(results) == 1
        assert results[0].entry.lane == "scalp"

    def test_lane_filter_empty_when_no_match(self):
        """score_nearest(lane='trend') with no trend entries returns []."""
        entries = [_make_entry("scalp"), _make_entry("swing")]
        basin = np.ones(64) / 64
        results = score_nearest(basin, entries, top_k=5, lane="trend")
        assert results == []

    def test_top_k_respected_within_lane(self):
        """top_k is respected after lane filtering."""
        entries = [_make_entry("swing") for _ in range(10)]
        basin = np.ones(64) / 64
        results = score_nearest(basin, entries, top_k=3, lane="swing")
        assert len(results) == 3


# ── 4. choose_lane emits all 4 lanes ─────────────────────────────────────────

class TestChooseLaneEmits:
    def test_returns_valid_lane(self):
        """choose_lane always returns a valid LaneType."""
        s = _nominal_state()
        result = choose_lane(s, tape_trend=0.0)
        assert result["value"] in ("scalp", "swing", "trend", "observe")

    def test_low_phi_low_sovereignty_prefers_scalp(self):
        """At very low Φ + very low sovereignty + zero velocity → scalp wins."""
        s = _nominal_state(phi=0.0, sovereignty=0.0, basin_velocity=0.0)
        result = choose_lane(s, tape_trend=0.0)
        assert result["value"] == "scalp", (
            f"Expected scalp at low phi/sovereignty, got {result['value']}: {result['reason']}"
        )

    def test_high_phi_strong_trend_prefers_trend(self):
        """At high Φ + high sovereignty + strong tape → trend wins."""
        s = _nominal_state(phi=1.0, sovereignty=1.0, basin_velocity=0.0)
        result = choose_lane(s, tape_trend=1.0)
        assert result["value"] == "trend", (
            f"Expected trend at high phi/sov/tape, got {result['value']}: {result['reason']}"
        )

    def test_observe_wins_high_velocity(self):
        """Very high basin velocity → observe wins."""
        s = _nominal_state(phi=0.5, sovereignty=0.5, basin_velocity=10.0)
        result = choose_lane(s, tape_trend=0.0)
        assert result["value"] == "observe", (
            f"Expected observe at extreme velocity, got {result['value']}: {result['reason']}"
        )

    def test_derivation_contains_required_keys(self):
        """Derivation dict must contain tau, softmax_probs, raw_scores, chosen."""
        s = _nominal_state()
        result = choose_lane(s, tape_trend=0.0)
        for key in ("tau", "softmax_probs", "raw_scores", "chosen"):
            assert key in result["derivation"], f"Missing derivation key: {key}"

    def test_softmax_probs_sum_to_one(self):
        """Softmax probabilities sum to 1 (within floating-point tolerance)."""
        s = _nominal_state()
        result = choose_lane(s, tape_trend=0.0)
        probs = result["derivation"]["softmax_probs"]
        assert abs(sum(probs.values()) - 1.0) < 1e-9


# ── 5. Temperature scaling ────────────────────────────────────────────────────

class TestChooseLaneTemperature:
    def test_high_kappa_low_temperature(self):
        """High κ → τ = 1/κ → small → more exploitation (sharper distribution)."""
        s_hi = _nominal_state(kappa=200.0)
        s_lo = _nominal_state(kappa=1.0)
        r_hi = choose_lane(s_hi, tape_trend=0.0)
        r_lo = choose_lane(s_lo, tape_trend=0.0)
        # High kappa: max prob should be higher than low kappa.
        max_hi = max(r_hi["derivation"]["softmax_probs"].values())
        max_lo = max(r_lo["derivation"]["softmax_probs"].values())
        assert max_hi >= max_lo, "High κ should produce sharper (more exploitative) distribution"

    def test_tau_matches_kappa_inverse(self):
        """τ in derivation equals 1/max(κ, 1)."""
        kappa = 40.0
        s = _nominal_state(kappa=kappa)
        result = choose_lane(s)
        assert result["derivation"]["tau"] == pytest.approx(1.0 / kappa, rel=1e-6)


# ── 6. TickDecision has lane field ────────────────────────────────────────────

class TestTickDecisionLaneField:
    def test_tick_decision_has_lane_default_swing(self):
        """TickDecision lane field defaults to 'swing'."""
        # Build a minimal TickDecision to check the default.
        basin = np.ones(64) / 64
        nc = _nominal_nc()
        dec = TickDecision(
            action="hold",
            reason="test",
            mode="investigation",
            size_usdt=0.0,
            leverage=10,
            entry_threshold=0.5,
            phi=0.5,
            kappa=64.0,
            basin_velocity=0.0,
            f_health=0.5,
            drift_from_identity=0.0,
            basin_direction=0.0,
            tape_trend=0.0,
            side_candidate="long",
            side_override=False,
            neurochemistry=nc,
            derivation={},
            basin=basin,
        )
        assert dec.lane == "swing"
        assert dec.direction == "flat"
        assert dec.size_fraction == 0.0
        assert dec.dca_intent is False

    def test_tick_decision_lane_can_be_set(self):
        """TickDecision lane field accepts all valid LaneType values."""
        basin = np.ones(64) / 64
        nc = _nominal_nc()
        for lane in ("scalp", "swing", "trend", "observe"):
            dec = TickDecision(
                action="hold",
                reason="test",
                mode="investigation",
                size_usdt=0.0,
                leverage=10,
                entry_threshold=0.5,
                phi=0.5,
                kappa=64.0,
                basin_velocity=0.0,
                f_health=0.5,
                drift_from_identity=0.0,
                basin_direction=0.0,
                tape_trend=0.0,
                side_candidate="long",
                side_override=False,
                neurochemistry=nc,
                derivation={},
                basin=basin,
                lane=lane,  # type: ignore[arg-type]
            )
            assert dec.lane == lane


# ── 7. choose_lane reward injection ──────────────────────────────────────────

class TestChooseLaneRewardInjection:
    def test_reward_amplifies_preferred_lane(self):
        """Positive reward for a lane amplifies its probability."""
        s = _nominal_state(phi=0.5, sovereignty=0.5)
        # Without reward, get baseline choice.
        r_base = choose_lane(s, tape_trend=0.0)
        base_probs = r_base["derivation"]["softmax_probs"]

        # Inject a positive reward for 'trend'.
        r_rewarded = choose_lane(
            s, tape_trend=0.0,
            recent_reward_by_lane={"trend": 5.0, "scalp": 0.0, "swing": 0.0, "observe": 0.0},
        )
        rew_probs = r_rewarded["derivation"]["softmax_probs"]
        # trend probability should have risen
        assert rew_probs["trend"] >= base_probs["trend"], (
            "Positive reward for trend should increase its probability"
        )


if __name__ == "__main__":
    import inspect
    failures = []
    for cls_name, cls in list(globals().items()):
        if not inspect.isclass(cls) or not cls_name.startswith("Test"):
            continue
        instance = cls()
        for method_name, method in inspect.getmembers(cls, predicate=inspect.isfunction):
            if not method_name.startswith("test_"):
                continue
            try:
                method(instance)
                print(f"  ✓ {cls_name}.{method_name}")
            except AssertionError as exc:
                failures.append(f"{cls_name}.{method_name}: {exc}")
                print(f"  ✗ {cls_name}.{method_name}: {exc}")
    if failures:
        print(f"\n{len(failures)} failure(s)")
        sys.exit(1)
    print("\nall lane-surface tests passed")
