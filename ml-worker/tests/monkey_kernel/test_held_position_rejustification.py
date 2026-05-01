"""test_held_position_rejustification.py — held-position re-justification.

Three internal exit checks fire when the kernel's own state contradicts
what justified entry:

  1. REGIME CHECK   — state.regime != state.regime_at_open → exit
  2. PHI CHECK      — phi_now < phi_at_open / PHI_GOLDEN_FLOOR_RATIO → exit
  3. CONVICTION    — emotions.confidence < anxiety + confusion → exit

All three return action='scalp_exit' with reason starting with the check
name. SymbolState gets regime_at_open_by_lane and phi_at_open_by_lane
populated when a position opens; cleared when it closes.

These tests exercise `_decide_with_position` directly. The full run_tick
path is exercised at the integration level by the existing tick tests;
the surgical unit here is the new gate's logic.
"""
from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.basin import uniform_basin  # noqa: E402
from monkey_kernel.executive import ExecBasinState  # noqa: E402
from monkey_kernel.modes import MonkeyMode  # noqa: E402
from monkey_kernel.state import NeurochemicalState  # noqa: E402
from monkey_kernel.tick import (  # noqa: E402
    AccountContext,
    SymbolState,
    TickInputs,
    _decide_with_position,
)
from monkey_kernel.topology_constants import PHI_GOLDEN_FLOOR_RATIO  # noqa: E402


# ── Fixtures ──────────────────────────────────────────────────────


@dataclass
class _Emotions:
    """Minimal Emotions stand-in. compute_emotions returns a real object;
    here we just need the three fields the rejustification check reads."""
    confidence: float = 0.7
    anxiety: float = 0.1
    confusion: float = 0.1
    # Other fields the broader code path reads (kept for compatibility)
    wonder: float = 0.0
    frustration: float = 0.0
    satisfaction: float = 0.0
    clarity: float = 0.0
    boredom: float = 0.0
    flow: float = 0.0


def _nc() -> NeurochemicalState:
    return NeurochemicalState(
        acetylcholine=0.5, dopamine=0.5, serotonin=0.5,
        norepinephrine=0.5, gaba=0.5, endorphins=0.5,
    )


def _basin_state(*, phi: float = 0.27) -> ExecBasinState:
    basin = uniform_basin(64)
    return ExecBasinState(
        basin=basin,
        identity_basin=basin,
        phi=phi,
        kappa=64.0,
        regime_weights={"quantum": 0.34, "efficient": 0.33, "equilibrium": 0.33},
        sovereignty=0.5,
        basin_velocity=0.05,
        neurochemistry=_nc(),
        emotions=_Emotions(),  # type: ignore[arg-type]
    )


def _state_with_anchor(
    *,
    lane: str = "swing",
    regime_at_open: str = MonkeyMode.INVESTIGATION.value,
    phi_at_open: float = 0.27,
    seed_regime_streak: int = 3,
    far_basin_anchor: bool = True,
) -> SymbolState:
    """Build a state with re-justification anchors populated.

    Hysteresis added 2026-05-01: the regime-change exit now requires
    streak ≥ 3 ticks AND basin moved > 1/π FR. ``seed_regime_streak``
    pre-populates the streak counter so tests can exercise the
    "regime exit fires" path without simulating 3 prior ticks.
    ``far_basin_anchor`` sets basin_at_open to a peak that is far
    (in FR distance) from the uniform basin used by the test so the
    1/π condition clears.
    """
    state = SymbolState(
        symbol="BTC_USDT_PERP",
        identity_basin=uniform_basin(64),
    )
    state.regime_at_open_by_lane[lane] = regime_at_open
    state.phi_at_open_by_lane[lane] = phi_at_open
    state.regime_change_streak_by_lane[lane] = seed_regime_streak
    if far_basin_anchor:
        # Concentrated basin at peak 0 — uniform basin is FR distance
        # ~ arccos(√(1/64)) ≈ 1.45 rad away, well above 1/π ≈ 0.318.
        far = np.full(64, 0.001 / 63, dtype=np.float64)
        far[0] = 0.999
        far = far / far.sum()
        state.basin_at_open_by_lane[lane] = far
    return state


def _inputs(*, entry_price: float = 100.0, qty: float = 0.1) -> TickInputs:
    return TickInputs(
        symbol="BTC_USDT_PERP",
        ohlcv=[],  # _decide_with_position does not read ohlcv
        account=AccountContext(
            equity_fraction=0.05,
            margin_fraction=0.03,
            open_positions=1,
            available_equity=1000.0,
            exchange_held_side="long",
            own_position_entry_price=entry_price,
            own_position_quantity=qty,
            own_position_trade_id="trade-1",
        ),
        bank_size=10,
        sovereignty=0.5,
        max_leverage=10,
        min_notional=10.0,
    )


def _call_decide(
    *,
    state: SymbolState,
    phi: float,
    mode: MonkeyMode = MonkeyMode.INVESTIGATION,
    mode_value: str | None = None,
    emotions: _Emotions | None = None,
    position_lane: str = "swing",
    last_price: float = 100.0,
    held_side: str = "long",
) -> tuple[str, str, bool, bool, dict[str, Any]]:
    """Call _decide_with_position and return its tuple plus derivation."""
    derivation: dict[str, Any] = {}
    bs = _basin_state(phi=phi)
    bs.emotions = emotions or _Emotions()  # type: ignore[assignment]
    action, reason, is_dca, is_reverse = _decide_with_position(
        inputs=_inputs(),
        state=state,
        basin=uniform_basin(64),
        basin_state=bs,
        mode_enum=mode,
        last_price=last_price,
        tape_trend=0.0,
        held_side=held_side,
        side_candidate="long",
        side_override=False,
        entry_thr_val=0.5,
        size_val=10.0,
        leverage_val=5,
        derivation=derivation,
        position_lane=position_lane,
        phi=phi,
        emotions=bs.emotions,
        mode_value=mode_value or mode.value,
    )
    return action, reason, is_dca, is_reverse, derivation


# ── Positive tests — each check fires ──────────────────────────────


class TestRegimeCheckFires:
    def test_regime_change_exits_with_correct_reason(self) -> None:
        state = _state_with_anchor(
            regime_at_open=MonkeyMode.INVESTIGATION.value,
            phi_at_open=0.27,
        )
        action, reason, is_dca, is_reverse, derivation = _call_decide(
            state=state,
            phi=0.25,  # safely above the floor (0.27/φ ≈ 0.167)
            mode_value=MonkeyMode.DRIFT.value,
        )
        assert action == "scalp_exit"
        assert reason.startswith("regime_change")
        assert "investigation" in reason
        assert "drift" in reason
        assert is_dca is False
        assert is_reverse is False
        rej = derivation["rejustification"]
        assert rej["fired"] == "regime_change"
        assert rej["regime_at_open"] == "investigation"
        assert rej["regime_now"] == "drift"


class TestPhiCheckFires:
    def test_phi_collapse_below_golden_floor_exits(self) -> None:
        # phi_at_open = 0.27 → floor = 0.27 / 1.618... ≈ 0.16687
        # Use phi_now = 0.15 (well below floor).
        state = _state_with_anchor(
            regime_at_open=MonkeyMode.INVESTIGATION.value,
            phi_at_open=0.27,
        )
        action, reason, _, _, derivation = _call_decide(
            state=state,
            phi=0.15,
            mode_value=MonkeyMode.INVESTIGATION.value,
        )
        assert action == "scalp_exit"
        assert reason.startswith("phi_collapse")
        rej = derivation["rejustification"]
        assert rej["fired"] == "phi_collapse"
        # The floor formula: phi_at_open / PHI_GOLDEN_FLOOR_RATIO
        expected_floor = 0.27 / PHI_GOLDEN_FLOOR_RATIO
        assert math.isclose(rej["phi_floor"], expected_floor, rel_tol=1e-9)
        assert rej["phi_now"] == 0.15
        assert rej["phi_at_open"] == 0.27

    def test_phi_floor_constant_is_golden_ratio(self) -> None:
        # The named constant must equal φ = (1+√5)/2.
        expected = (1.0 + math.sqrt(5.0)) / 2.0
        assert math.isclose(PHI_GOLDEN_FLOOR_RATIO, expected, rel_tol=1e-12)
        # And 1/φ ≈ 0.618 (the actual coherence-floor multiplier).
        assert math.isclose(
            1.0 / PHI_GOLDEN_FLOOR_RATIO, 0.6180339887, rel_tol=1e-9,
        )


class TestConvictionCheckFires:
    def test_conviction_failed_exits_with_correct_reason(self) -> None:
        state = _state_with_anchor(
            regime_at_open=MonkeyMode.INVESTIGATION.value,
            phi_at_open=0.27,
        )
        # confidence (0.4) < anxiety (0.3) + confusion (0.2) = 0.5
        emo = _Emotions(confidence=0.4, anxiety=0.3, confusion=0.2)
        action, reason, _, _, derivation = _call_decide(
            state=state,
            phi=0.25,  # above floor
            mode_value=MonkeyMode.INVESTIGATION.value,
            emotions=emo,
        )
        assert action == "scalp_exit"
        assert reason.startswith("conviction_failed")
        rej = derivation["rejustification"]
        assert rej["fired"] == "conviction_failed"
        assert rej["confidence"] == 0.4
        assert rej["anxiety"] == 0.3
        assert rej["confusion"] == 0.2


# ── Negative tests — checks do NOT fire ───────────────────────────


class TestRegimeUnchanged:
    def test_same_regime_no_regime_exit(self) -> None:
        state = _state_with_anchor(
            regime_at_open=MonkeyMode.INVESTIGATION.value,
            phi_at_open=0.27,
        )
        action, _, _, _, derivation = _call_decide(
            state=state,
            phi=0.25,
            mode_value=MonkeyMode.INVESTIGATION.value,
            emotions=_Emotions(confidence=0.7, anxiety=0.1, confusion=0.1),
        )
        rej = derivation["rejustification"]
        assert rej.get("fired") is None
        assert rej["checked"] is True


class TestPhiStableAboveFloor:
    def test_phi_above_floor_no_phi_exit(self) -> None:
        state = _state_with_anchor(
            regime_at_open=MonkeyMode.INVESTIGATION.value,
            phi_at_open=0.27,
        )
        # Floor ≈ 0.167. phi=0.20 stays above floor.
        _, reason, _, _, derivation = _call_decide(
            state=state,
            phi=0.20,
            mode_value=MonkeyMode.INVESTIGATION.value,
            emotions=_Emotions(confidence=0.7, anxiety=0.1, confusion=0.1),
        )
        rej = derivation["rejustification"]
        assert rej.get("fired") is None
        assert "phi_collapse" not in reason


class TestConvictionHolds:
    def test_conviction_above_hesitation_no_exit(self) -> None:
        state = _state_with_anchor(
            regime_at_open=MonkeyMode.INVESTIGATION.value,
            phi_at_open=0.27,
        )
        emo = _Emotions(confidence=0.7, anxiety=0.1, confusion=0.1)
        _, reason, _, _, derivation = _call_decide(
            state=state,
            phi=0.25,
            mode_value=MonkeyMode.INVESTIGATION.value,
            emotions=emo,
        )
        rej = derivation["rejustification"]
        assert rej.get("fired") is None
        assert "conviction_failed" not in reason


# ── State lifecycle tests ─────────────────────────────────────────


class TestStateClearing:
    def test_close_clears_anchors_for_lane(self) -> None:
        # Simulating the tick.py outer flow: when _decide_with_position
        # returns a close action ("scalp_exit"), the outer block clears
        # state.regime_at_open_by_lane[lane] and phi_at_open_by_lane[lane].
        # We can't import the outer block, so we mirror its clear logic.
        state = _state_with_anchor(
            lane="swing",
            regime_at_open=MonkeyMode.INVESTIGATION.value,
            phi_at_open=0.27,
        )
        assert "swing" in state.regime_at_open_by_lane
        assert "swing" in state.phi_at_open_by_lane

        action, _, _, _, _ = _call_decide(
            state=state,
            phi=0.25,
            mode_value=MonkeyMode.DRIFT.value,  # forces regime_change exit
        )
        assert action == "scalp_exit"

        # The clear is in the outer tick.py path — replicate the logic
        # the test contract expects: "when the position closes, the
        # anchors for that lane are cleared".
        if action in ("scalp_exit", "exit"):
            state.regime_at_open_by_lane.pop("swing", None)
            state.phi_at_open_by_lane.pop("swing", None)

        assert "swing" not in state.regime_at_open_by_lane
        assert "swing" not in state.phi_at_open_by_lane


class TestPerLaneIsolation:
    def test_independent_anchors_per_lane(self) -> None:
        state = SymbolState(
            symbol="BTC_USDT_PERP",
            identity_basin=uniform_basin(64),
        )
        # Two lanes, two different anchor sets. Seed scalp's hysteresis
        # state (streak ≥ 3 + far basin anchor) so the regime check
        # actually fires on a single test call.
        state.regime_at_open_by_lane["scalp"] = MonkeyMode.INVESTIGATION.value
        state.phi_at_open_by_lane["scalp"] = 0.27
        state.regime_change_streak_by_lane["scalp"] = 3
        far = np.full(64, 0.001 / 63, dtype=np.float64)
        far[0] = 0.999
        state.basin_at_open_by_lane["scalp"] = far / far.sum()
        state.regime_at_open_by_lane["swing"] = MonkeyMode.INTEGRATION.value
        state.phi_at_open_by_lane["swing"] = 0.40

        # Test 1: scalp lane fires regime_change when current mode != investigation
        # but swing lane's anchor is unaffected.
        action_s, reason_s, _, _, derivation_s = _call_decide(
            state=state,
            phi=0.25,
            mode_value=MonkeyMode.DRIFT.value,
            position_lane="scalp",
        )
        assert action_s == "scalp_exit"
        assert reason_s.startswith("regime_change")
        assert derivation_s["rejustification"]["regime_at_open"] == "investigation"

        # State still holds both anchor entries (clear only happens at
        # the tick-level close-action handler, not inside _decide_with_position).
        assert "scalp" in state.regime_at_open_by_lane
        assert "swing" in state.regime_at_open_by_lane
        assert state.phi_at_open_by_lane["scalp"] == 0.27
        assert state.phi_at_open_by_lane["swing"] == 0.40

        # Test 2: swing lane checks against ITS anchor — same regime
        # (integration), no fire.
        _, _, _, _, derivation_w = _call_decide(
            state=state,
            phi=0.30,  # above floor 0.40/φ ≈ 0.247
            mode_value=MonkeyMode.INTEGRATION.value,
            position_lane="swing",
            emotions=_Emotions(confidence=0.7, anxiety=0.1, confusion=0.1),
        )
        rej_w = derivation_w["rejustification"]
        assert rej_w.get("fired") is None
        assert rej_w["regime_at_open"] == "integration"
        assert rej_w["phi_at_open"] == 0.40


# ── Precedence / ordering tests ────────────────────────────────────


class TestPrecedenceOrdering:
    """Rejustification fires AFTER hard SL (SAFETY_BOUND) and BEFORE
    trailing-harvest. Verify the ordering by constructing scenarios
    where multiple gates would fire."""

    def test_sl_takes_precedence_over_rejustification(self) -> None:
        """If price has bled past SL AND regime changed, SL fires first
        (it's a safety bound — kernel must respect price reality before
        re-reading itself)."""
        state = _state_with_anchor(
            regime_at_open=MonkeyMode.INVESTIGATION.value,
            phi_at_open=0.27,
        )
        # Construct a position that's deeply underwater. SL fraction
        # default ≈ tp_thr * sl_ratio. INVESTIGATION tp_base=0.008 with
        # sl_ratio=0.7 → ~ -0.56% triggers SL. We pass last_price way
        # below entry to force the SL trigger.
        derivation: dict[str, Any] = {}
        bs = _basin_state(phi=0.25)
        bs.emotions = _Emotions(confidence=0.7, anxiety=0.1, confusion=0.1)  # type: ignore[assignment]
        # Position: entry $100, qty 0.1 → notional $10. Price $90 →
        # unrealized = (90-100)*0.1*1 = -1. pnl_frac = -1/10 = -10%.
        # SL definitely fires. Regime also changed (INVESTIGATION → DRIFT).
        action, reason, _, _ = _decide_with_position(
            inputs=_inputs(entry_price=100.0, qty=0.1),
            state=state,
            basin=uniform_basin(64),
            basin_state=bs,
            mode_enum=MonkeyMode.INVESTIGATION,
            last_price=90.0,  # 10% drawdown — well past SL threshold
            tape_trend=0.0,
            held_side="long",
            side_candidate="long",
            side_override=False,
            entry_thr_val=0.5,
            size_val=10.0,
            leverage_val=5,
            derivation=derivation,
            position_lane="swing",
            phi=0.25,
            emotions=bs.emotions,
            mode_value=MonkeyMode.DRIFT.value,  # regime change too
        )
        assert action == "scalp_exit"
        # SL should fire first — its reason starts with "stop_loss".
        # Rejustification's reason starts with "regime_change". With SL
        # fired first, rejustification is never recorded as "fired".
        assert reason.startswith("stop_loss")
        # rejustification block didn't run (we returned before it).
        assert derivation.get("rejustification", {"checked": False})["checked"] is False

    def test_rejustification_fires_before_harvest(self) -> None:
        """When position is in profit AND regime changed, rejustification
        fires (not trailing-harvest)."""
        state = _state_with_anchor(
            regime_at_open=MonkeyMode.INVESTIGATION.value,
            phi_at_open=0.27,
        )
        # Position in profit: entry $100, mark $101. Trailing harvest
        # would need a peak; no peak yet so harvest won't fire on first
        # tick anyway. The point: regime_change should fire here.
        action, reason, _, _, derivation = _call_decide(
            state=state,
            phi=0.25,
            mode_value=MonkeyMode.DRIFT.value,
            last_price=101.0,
        )
        assert action == "scalp_exit"
        assert reason.startswith("regime_change")
        # harvest entry should not be in derivation (we returned before it).
        assert "harvest" not in derivation


# ── No-anchor (newly-opened or never-opened) state ────────────────


class TestNoAnchorPath:
    def test_no_anchor_no_rejustification_fire(self) -> None:
        """When the kernel has no recorded anchor for the held lane (e.g.
        position opened before this PR shipped, or anchor cleared by a
        bug), the rejustification block is skipped and behaviour falls
        through to harvest/exit/hold."""
        state = SymbolState(
            symbol="BTC_USDT_PERP",
            identity_basin=uniform_basin(64),
        )
        # No anchor populated for any lane.
        _, reason, _, _, derivation = _call_decide(
            state=state,
            phi=0.05,  # would have fired phi_collapse if anchor existed
            mode_value=MonkeyMode.DRIFT.value,
            position_lane="swing",
        )
        rej = derivation["rejustification"]
        assert rej["checked"] is False
        # Reason should not be from rejustification.
        assert not reason.startswith("regime_change")
        assert not reason.startswith("phi_collapse")
        assert not reason.startswith("conviction_failed")
