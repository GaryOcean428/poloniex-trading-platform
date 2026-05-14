"""test_green_turn_reversal.py — green-turn reversal gate.

When a position is GREEN and the kernel's geometric direction has
flipped against the held side WITH tape confirmation, _decide_with_position
returns reverse_long / reverse_short (is_reverse=True) — capture the
realized gain AND open the new side in one decision, instead of the
plain trailing-harvest which only closes.

Motivation (2026-05-14): a +$50 combined-short position bled back to
-$30 in a sharp chop reversal because should_profit_harvest closed
nothing in time and re-entry on the new side never fired (margin-gated
/ cooldown-blocked). The green-turn reversal captures the turn while
still green.

Gate conditions (ALL must hold):
  1. position_roi >= executive.green_turn_reversal.min_roi (default 0.003)
  2. tape opposes held side by >= green_turn_reversal.tape_threshold (0.25)
  3. direction != "flat" AND direction != held_side
  4. MODE_PROFILES[mode].can_enter
  5. emotions present AND kernel_should_enter(emotions)
  6. size_val > 0

Placement: AFTER rejustification (a contradicted position must exit,
not reverse) and BEFORE trailing-harvest (reverse dominates harvest
when both would fire).

These tests exercise _decide_with_position directly.
"""
from __future__ import annotations

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


# ── Fixtures ──────────────────────────────────────────────────────


@dataclass
class _Emotions:
    """Minimal Emotions stand-in — kernel_should_enter + the
    rejustification conviction check read these fields. Defaults give
    a confident, low-anxiety state so kernel_should_enter passes."""
    confidence: float = 0.8
    anxiety: float = 0.05
    confusion: float = 0.05
    wonder: float = 0.1
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


def _basin_state(*, phi: float = 0.27, emotions: _Emotions | None = None) -> ExecBasinState:
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
        emotions=emotions or _Emotions(),  # type: ignore[arg-type]
    )


def _fresh_state() -> SymbolState:
    """A SymbolState with NO rejustification anchors — so the
    rejustification gate is skipped and execution reaches the
    green-turn-reversal gate."""
    return SymbolState(
        symbol="BTC_USDT_PERP",
        identity_basin=uniform_basin(64),
    )


def _inputs(*, entry_price: float, qty: float, held_side: str) -> TickInputs:
    return TickInputs(
        symbol="BTC_USDT_PERP",
        ohlcv=[],  # _decide_with_position does not read ohlcv
        account=AccountContext(
            equity_fraction=0.05,
            margin_fraction=0.03,
            open_positions=1,
            available_equity=1000.0,
            exchange_held_side=held_side,
            own_position_entry_price=entry_price,
            own_position_quantity=qty,
            own_position_trade_id="trade-gtr-1",
        ),
        bank_size=10,
        sovereignty=0.5,
        max_leverage=20,
        min_notional=10.0,
    )


def _call(
    *,
    held_side: str,
    entry_price: float,
    last_price: float,
    qty: float = 0.1,
    tape_trend: float,
    direction: str,
    side_candidate: str,
    mode: MonkeyMode = MonkeyMode.INVESTIGATION,
    size_val: float = 10.0,
    leverage_val: int = 5,
    emotions: _Emotions | None = None,
) -> tuple[str, str, bool, bool, dict[str, Any]]:
    """Drive _decide_with_position through the green-turn-reversal path."""
    derivation: dict[str, Any] = {}
    bs = _basin_state(emotions=emotions)
    action, reason, is_dca, is_reverse = _decide_with_position(
        inputs=_inputs(entry_price=entry_price, qty=qty, held_side=held_side),
        state=_fresh_state(),
        basin=uniform_basin(64),
        basin_state=bs,
        mode_enum=mode,
        last_price=last_price,
        tape_trend=tape_trend,
        held_side=held_side,
        side_candidate=side_candidate,
        side_override=False,
        direction=direction,
        entry_thr_val=0.5,
        size_val=size_val,
        leverage_val=leverage_val,
        derivation=derivation,
        position_lane="swing",
        phi=0.27,
        emotions=bs.emotions,
        mode_value=mode.value,
        regime_confidence=1.0,
    )
    return action, reason, is_dca, is_reverse, derivation


# ── Positive: the gate fires ──────────────────────────────────────


class TestGreenTurnReversalFires:
    def test_green_long_bearish_tape_flip_reverses_to_short(self) -> None:
        # Held LONG at 100, now 102 → green. Tape strongly bearish,
        # direction flipped to short → reverse_short.
        action, reason, is_dca, is_reverse, derivation = _call(
            held_side="long",
            entry_price=100.0,
            last_price=102.0,
            tape_trend=-0.40,
            direction="short",
            side_candidate="short",
        )
        assert action == "reverse_short"
        assert is_reverse is True
        assert is_dca is False
        assert reason.startswith("GREEN_TURN_REVERSAL[long→short]")
        gtr = derivation["green_turn_reversal"]
        assert gtr["eligible"] is True
        assert gtr["position_roi"] > 0.003
        assert gtr["tape_opposes_held"] is True
        assert gtr["direction_flipped"] is True
        # capture leg tagged on derivation.scalp for the executor
        assert derivation["scalp"]["exit_type_bit"] == 4

    def test_green_short_bullish_tape_flip_reverses_to_long(self) -> None:
        # Held SHORT at 100, now 98 → green. Tape strongly bullish,
        # direction flipped to long → reverse_long.
        action, reason, is_dca, is_reverse, derivation = _call(
            held_side="short",
            entry_price=100.0,
            last_price=98.0,
            tape_trend=0.40,
            direction="long",
            side_candidate="long",
        )
        assert action == "reverse_long"
        assert is_reverse is True
        assert reason.startswith("GREEN_TURN_REVERSAL[short→long]")
        assert derivation["green_turn_reversal"]["eligible"] is True


# ── Negative: the gate does NOT fire ──────────────────────────────


class TestGreenTurnReversalDoesNotFire:
    def test_red_position_does_not_reverse(self) -> None:
        # Held LONG at 100, now 98 → RED. Even with a bearish tape +
        # direction flip, a losing position is NOT a green-turn capture
        # — it falls through to the existing exit gates.
        action, _reason, _is_dca, is_reverse, derivation = _call(
            held_side="long",
            entry_price=100.0,
            last_price=98.0,
            tape_trend=-0.40,
            direction="short",
            side_candidate="short",
        )
        assert action != "reverse_short"
        assert is_reverse is False
        assert derivation["green_turn_reversal"]["eligible"] is False
        assert derivation["green_turn_reversal"]["position_roi"] < 0

    def test_weak_tape_does_not_reverse(self) -> None:
        # Green long, direction flipped, but tape only -0.10 — below
        # the 0.25 opposition threshold. Not a confirmed turn.
        action, _reason, _is_dca, is_reverse, derivation = _call(
            held_side="long",
            entry_price=100.0,
            last_price=102.0,
            tape_trend=-0.10,
            direction="short",
            side_candidate="short",
        )
        assert action != "reverse_short"
        assert is_reverse is False
        gtr = derivation["green_turn_reversal"]
        assert gtr["eligible"] is False
        assert gtr["tape_opposes_held"] is False

    def test_flat_direction_does_not_reverse(self) -> None:
        # Green short, tape bullish — but direction is flat (no genuine
        # opposite-side read). side_candidate defaults to 'long' when
        # direction is flat; the direction_flipped guard must reject it.
        action, _reason, _is_dca, is_reverse, derivation = _call(
            held_side="short",
            entry_price=100.0,
            last_price=98.0,
            tape_trend=0.40,
            direction="flat",
            side_candidate="long",
        )
        assert action != "reverse_long"
        assert is_reverse is False
        gtr = derivation["green_turn_reversal"]
        assert gtr["eligible"] is False
        assert gtr["direction_flipped"] is False

    def test_tiny_green_below_min_roi_does_not_reverse(self) -> None:
        # Held LONG at 100.000, now 100.001 — green but ROI far below
        # the 0.3% min_roi floor. A sub-noise gain is not worth the
        # round-trip fees + slippage of a reverse.
        action, _reason, _is_dca, is_reverse, derivation = _call(
            held_side="long",
            entry_price=100.0,
            last_price=100.001,
            tape_trend=-0.40,
            direction="short",
            side_candidate="short",
            leverage_val=1,  # ROI = pnl / (notional / 1) — smallest ROI
        )
        assert action != "reverse_short"
        assert is_reverse is False
        gtr = derivation["green_turn_reversal"]
        assert gtr["eligible"] is False
        assert gtr["position_roi"] < 0.003

    def test_same_direction_does_not_reverse(self) -> None:
        # Green long, tape still bullish, direction still long — no turn.
        action, _reason, _is_dca, is_reverse, derivation = _call(
            held_side="long",
            entry_price=100.0,
            last_price=102.0,
            tape_trend=0.40,
            direction="long",
            side_candidate="long",
        )
        assert action != "reverse_long"
        assert action != "reverse_short"
        assert is_reverse is False
        assert derivation["green_turn_reversal"]["eligible"] is False


# ── Derivation telemetry is always present ────────────────────────


class TestGreenTurnReversalTelemetry:
    def test_derivation_block_always_emitted(self) -> None:
        # Even on a no-fire tick the derivation carries the gate's
        # inputs so the decision is auditable from monkey_decisions.
        _action, _reason, _is_dca, _is_reverse, derivation = _call(
            held_side="long",
            entry_price=100.0,
            last_price=100.5,
            tape_trend=0.0,
            direction="long",
            side_candidate="long",
        )
        gtr = derivation["green_turn_reversal"]
        for key in (
            "eligible", "position_roi", "min_roi", "tape_trend",
            "tape_threshold", "tape_opposes_held", "direction",
            "direction_flipped", "unrealized_pnl",
        ):
            assert key in gtr, f"missing telemetry key: {key}"
