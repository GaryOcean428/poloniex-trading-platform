"""test_kernel_direction.py — agent-separation: Agent K's geometry-only
direction reader and conviction gate.

Verifies that:
  1. kernel_direction() produces long/short/flat from basin geometry
     alone — no ml_signal, no ml_strength, no external label.
  2. kernel_should_enter() fires when conviction (confidence × (1+wonder))
     strictly exceeds hesitation (anxiety + confusion).
"""
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.executive import (  # noqa: E402
    ExecBasinState,
    kernel_direction,
    kernel_should_enter,
)
from monkey_kernel.state import KAPPA_STAR, NeurochemicalState  # noqa: E402


@dataclass
class _Emo:
    confidence: float = 0.5
    anxiety: float = 0.1
    wonder: float = 0.0
    confusion: float = 0.0


@dataclass
class _Mot:
    surprise: float = 0.0
    curiosity: float = 0.0
    investigation: float = 0.0


def _basin_with_momentum(direction: str) -> np.ndarray:
    """Build a 64-D simplex basin where the momentum-spectrum dims
    (7..14) carry mass biased to produce basin_direction() of the
    requested sign.

    basin_direction reads sum(basin[7:15]) and compares to
    8/64 = 0.125. To produce positive basin_dir, we put extra mass
    on those dims; for negative, reduce the mass below 0.125.
    """
    b = np.full(64, 1.0 / 64.0, dtype=np.float64)
    if direction == "up":
        # Pull mass into momentum dims
        for i in range(7, 15):
            b[i] *= 6.0
    elif direction == "down":
        for i in range(7, 15):
            b[i] *= 0.05
    # Renormalise to simplex
    b = b / b.sum()
    return b


def _basin_state(basin: np.ndarray) -> ExecBasinState:
    nc = NeurochemicalState(
        acetylcholine=0.5, dopamine=0.5, serotonin=0.5,
        norepinephrine=0.5, gaba=0.5, endorphins=0.0,
    )
    identity = np.full(64, 1.0 / 64.0, dtype=np.float64)
    return ExecBasinState(
        basin=basin,
        identity_basin=identity,
        phi=0.5,
        kappa=KAPPA_STAR,
        regime_weights={"quantum": 0.33, "efficient": 0.33, "equilibrium": 0.34},
        sovereignty=0.5,
        basin_velocity=0.1,
        neurochemistry=nc,
    )


# ─────────────────────────────────────────────────────────────────
# kernel_direction — signal sign comes from geometry, not ml
# ─────────────────────────────────────────────────────────────────


class TestKernelDirection:
    def test_upward_basin_with_calm_emotions_yields_long(self) -> None:
        s = _basin_state(_basin_with_momentum("up"))
        emo = _Emo(confidence=0.7, anxiety=0.1)
        d = kernel_direction(s, tape_trend=0.3, emotions=emo)
        assert d == "long"

    def test_downward_basin_with_calm_emotions_yields_short(self) -> None:
        s = _basin_state(_basin_with_momentum("down"))
        emo = _Emo(confidence=0.7, anxiety=0.1)
        d = kernel_direction(s, tape_trend=-0.3, emotions=emo)
        assert d == "short"

    def test_high_anxiety_vetos_geometry_to_flat(self) -> None:
        s = _basin_state(_basin_with_momentum("up"))
        emo = _Emo(confidence=0.2, anxiety=0.9)
        d = kernel_direction(s, tape_trend=0.5, emotions=emo)
        assert d == "flat"

    def test_zero_geometry_returns_flat(self) -> None:
        # Uniform basin, zero tape — geometric_signal = 0 → flat
        b = np.full(64, 1.0 / 64.0, dtype=np.float64)
        s = _basin_state(b)
        emo = _Emo(confidence=0.5, anxiety=0.1)
        d = kernel_direction(s, tape_trend=0.0, emotions=emo)
        assert d == "flat"

    def test_no_ml_inputs_in_signature(self) -> None:
        """Agent-separation invariant: kernel_direction reads ONLY
        from basin geometry, tape, and emotions. No ml_signal, no
        ml_strength parameter exists."""
        import inspect
        sig = inspect.signature(kernel_direction)
        params = list(sig.parameters)
        # Allowed params only — fail if any ml-related name appears
        for name in params:
            assert "ml" not in name.lower(), (
                f"kernel_direction must not take ml-derived params; got {name}"
            )


# ─────────────────────────────────────────────────────────────────
# kernel_should_enter — conviction vs hesitation
# ─────────────────────────────────────────────────────────────────


class TestKernelShouldEnter:
    def test_fires_when_confidence_dominates(self) -> None:
        emo = _Emo(confidence=0.8, anxiety=0.1, wonder=0.2, confusion=0.0)
        assert kernel_should_enter(emo, _Mot()) is True

    def test_holds_when_hesitation_exceeds_conviction(self) -> None:
        emo = _Emo(confidence=0.2, anxiety=0.7, wonder=0.0, confusion=0.3)
        assert kernel_should_enter(emo, _Mot()) is False

    def test_wonder_amplifies_confidence(self) -> None:
        # Same confidence/anxiety/confusion, only wonder differs.
        # wonder=0 → conviction=0.4; wonder=2 → conviction=1.2
        # hesitation=0.5 in both
        no_wonder = _Emo(confidence=0.4, anxiety=0.4, wonder=0.0, confusion=0.1)
        with_wonder = _Emo(confidence=0.4, anxiety=0.4, wonder=2.0, confusion=0.1)
        assert kernel_should_enter(no_wonder, _Mot()) is False
        assert kernel_should_enter(with_wonder, _Mot()) is True

    def test_strict_inequality_at_equality_holds(self) -> None:
        # conviction = 0.5 * 1.0 = 0.5; hesitation = 0.5 + 0.0 = 0.5 → equal
        emo = _Emo(confidence=0.5, anxiety=0.5, wonder=0.0, confusion=0.0)
        # Strict > → returns False on equality
        assert kernel_should_enter(emo, _Mot()) is False

    def test_no_ml_inputs_in_signature(self) -> None:
        """Agent-separation invariant: kernel_should_enter takes only
        emotion + motivator state. No ml params anywhere."""
        import inspect
        sig = inspect.signature(kernel_should_enter)
        for name in sig.parameters:
            assert "ml" not in name.lower(), (
                f"kernel_should_enter must not take ml params; got {name}"
            )


# ─────────────────────────────────────────────────────────────────
# Agent-separation invariant — TickInputs has no ml fields
# ─────────────────────────────────────────────────────────────────


class TestAgentSeparationInvariant:
    def test_tick_inputs_has_no_ml_signal_field(self) -> None:
        from dataclasses import fields
        from monkey_kernel.tick import TickInputs
        names = {f.name for f in fields(TickInputs)}
        assert "ml_signal" not in names
        assert "ml_strength" not in names
        # The replacement is raw_basin
        assert "raw_basin" in names

    def test_run_tick_decides_with_ml_strength_zero(self) -> None:
        """Smoke test: run_tick on a synthetic tick with ml_strength=0
        (the perception layer's worst case — ml has zero conviction)
        should still produce a sensible kernel decision (no exception,
        action ∈ {hold, enter_long, enter_short, flatten, exit, scalp_exit}).
        """
        from monkey_kernel.autonomic import AutonomicKernel
        from monkey_kernel.basin import uniform_basin
        from monkey_kernel.foresight import ForesightPredictor
        from monkey_kernel.heart import HeartMonitor
        from monkey_kernel.ocean import Ocean
        from monkey_kernel.perception import OHLCVCandle
        from monkey_kernel.tick import (
            AccountContext, build_tick_inputs, fresh_symbol_state, run_tick,
        )

        # 60 candles with mild oscillation
        ohlcv: list[OHLCVCandle] = []
        p = 75000.0
        for i in range(60):
            d = 0.0003 * 75000.0 * ((i % 7) - 3)
            np_ = p + d
            ohlcv.append(OHLCVCandle(
                timestamp=float(i * 60_000),
                high=max(p, np_) * 1.0003, low=min(p, np_) * 0.9997,
                close=np_, open=p, volume=1000.0,
            ))
            p = np_

        inputs = build_tick_inputs(
            symbol="BTC_USDT_PERP", ohlcv=ohlcv,
            ml_signal="HOLD", ml_strength=0.0,  # worst case for old kernel
            account=AccountContext(
                equity_fraction=0.05, margin_fraction=0.03, open_positions=0,
                available_equity=100.0, exchange_held_side=None,
            ),
            bank_size=10, sovereignty=0.5,
            max_leverage=16, min_notional=20.0,
        )
        state = fresh_symbol_state("BTC_USDT_PERP", uniform_basin(64))
        decision, _ = run_tick(
            inputs, state, AutonomicKernel("t"),
            ocean=Ocean("t"), foresight=ForesightPredictor(), heart=HeartMonitor(),
        )
        assert decision.action in {
            "hold", "enter_long", "enter_short", "flatten",
            "exit", "scalp_exit",
        }
        # Telemetry: kernel_direction should be present (long/short/flat)
        assert decision.derivation["kernel_direction"] in ("long", "short", "flat")
        # Telemetry must NOT carry ml_signal / ml_strength fields any more
        assert "ml_signal" not in decision.derivation
        assert "ml_strength" not in decision.derivation
        assert "ml_side" not in decision.derivation


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
