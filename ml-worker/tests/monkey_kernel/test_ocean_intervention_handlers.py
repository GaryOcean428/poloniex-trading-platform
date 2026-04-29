"""test_ocean_intervention_handlers.py — PR 1 OCEAN_INTERVENTIONS_LIVE flag.

Verifies the orchestrator's branching on Ocean.intervention values
when the flag is true vs false. Flag-off path preserves existing
behaviour; flag-on path applies handlers (ESCAPE → flatten, DREAM →
hold, MUSHROOM_MICRO → +5 κ, SLEEP/WAKE → already handled by autonomic
is_awake passthrough).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.autonomic import AutonomicKernel  # noqa: E402
from monkey_kernel.basin import uniform_basin  # noqa: E402
from monkey_kernel.foresight import ForesightPredictor  # noqa: E402
from monkey_kernel.heart import HeartMonitor  # noqa: E402
from monkey_kernel.ocean import Ocean  # noqa: E402
from monkey_kernel.perception import OHLCVCandle  # noqa: E402
from monkey_kernel.tick import (  # noqa: E402
    AccountContext,
    SymbolState,
    TickInputs,
    build_tick_inputs,
    fresh_symbol_state,
    run_tick,
)


def _ohlcv(n: int = 60, base: float = 75000.0) -> list[OHLCVCandle]:
    out: list[OHLCVCandle] = []
    p = base
    for i in range(n):
        d = 0.0003 * base * ((i % 7) - 3)
        np_ = p + d
        out.append(OHLCVCandle(
            timestamp=float(i * 60_000),
            high=max(p, np_) * 1.0003, low=min(p, np_) * 0.9997,
            close=np_, open=p, volume=1000.0,
        ))
        p = np_
    return out


def _inputs(symbol: str = "BTC_USDT_PERP") -> TickInputs:
    return build_tick_inputs(
        symbol=symbol, ohlcv=_ohlcv(), ml_signal="BUY", ml_strength=0.5,
        account=AccountContext(
            equity_fraction=0.05, margin_fraction=0.03, open_positions=0,
            available_equity=100.0, exchange_held_side=None,
        ),
        bank_size=10, sovereignty=0.5, max_leverage=16, min_notional=20.0,
    )


@pytest.fixture
def env_clean():
    """Snapshot/restore OCEAN_INTERVENTIONS_LIVE so tests don't leak."""
    prev = os.environ.get("OCEAN_INTERVENTIONS_LIVE")
    yield
    if prev is None:
        os.environ.pop("OCEAN_INTERVENTIONS_LIVE", None)
    else:
        os.environ["OCEAN_INTERVENTIONS_LIVE"] = prev


# ─────────────────────────────────────────────────────────────────
# Flag default OFF — observation only
# ─────────────────────────────────────────────────────────────────


class TestFlagOff:
    def test_default_off_does_not_apply_intervention(self, env_clean) -> None:
        os.environ.pop("OCEAN_INTERVENTIONS_LIVE", None)
        # Force ESCAPE intervention by feeding a low Φ via a primed Ocean
        ocean = Ocean("t")
        # Pre-feed phi history so variance check doesn't fire MUSHROOM
        for _ in range(5):
            ocean.observe(
                phi=0.5, basin=uniform_basin(64),
                current_mode="investigation", is_flat=True, now_ms=0.0,
            )
        state = fresh_symbol_state("BTC_USDT_PERP", uniform_basin(64))
        # Even with kappa low (which would otherwise drive ESCAPE if phi
        # is also low), with the flag OFF the action should NOT be
        # forced to flatten by Ocean — it follows the normal tree.
        decision, _ = run_tick(
            _inputs(), state, AutonomicKernel("t"),
            ocean=ocean, foresight=ForesightPredictor(), heart=HeartMonitor(),
        )
        assert decision.derivation["ocean_handler"]["live"] is False
        # Even if intervention fired in ocean_state, applied list is empty
        applied = decision.derivation["ocean_handler"]["applied"]
        assert applied == [] or all("ESCAPE" not in a and "DREAM" not in a for a in applied)


# ─────────────────────────────────────────────────────────────────
# Flag ON — handlers actually fire
# ─────────────────────────────────────────────────────────────────


def _force_phi_below(target: float, ocean: Ocean, basin) -> None:
    """Prime ocean phi history so the next tick observes Φ at target."""
    for _ in range(5):
        ocean.observe(
            phi=target, basin=basin,
            current_mode="investigation", is_flat=True, now_ms=0.0,
        )


class TestFlagOnEscape:
    def test_escape_fires_flatten_when_phi_below_safety_bound(self, env_clean) -> None:
        os.environ["OCEAN_INTERVENTIONS_LIVE"] = "true"
        # Construct inputs that yield very low phi: large basin_velocity
        # +  high f_health → phi formula caps low. Easier path: prime
        # the ocean with low phi and simulate the tick. Need to also
        # nudge tick.py's computed phi down — that comes from
        # f_health (entropy) + bv. uniform basin gives high entropy →
        # low phi. Should be enough.
        # Build a tick whose computed phi will be near 0 — uniform basin
        # gives H = log(K), f_health=1.0, phi = max(0, 1 - 0.8) = 0.2.
        # That's > 0.15 ESCAPE bound. To get below 0.15 we need a
        # basin even more uniform — but uniform IS the maximum-entropy
        # state. The safest path: directly inspect the firing logic
        # by monkey-patching ocean.observe to force ESCAPE.
        ocean = Ocean("t")
        original_observe = ocean.observe

        def force_escape(**kwargs):
            result = original_observe(**kwargs)
            from dataclasses import replace
            return replace(result, intervention="ESCAPE")
        ocean.observe = force_escape  # type: ignore[method-assign]

        state = fresh_symbol_state("BTC_USDT_PERP", uniform_basin(64))
        decision, _ = run_tick(
            _inputs(), state, AutonomicKernel("t"),
            ocean=ocean, foresight=ForesightPredictor(), heart=HeartMonitor(),
        )
        assert decision.action == "flatten"
        assert "OCEAN.ESCAPE" in decision.reason
        assert "ESCAPE:flatten" in decision.derivation["ocean_handler"]["applied"]


class TestFlagOnDream:
    def test_dream_forces_hold(self, env_clean) -> None:
        os.environ["OCEAN_INTERVENTIONS_LIVE"] = "true"
        ocean = Ocean("t")
        original_observe = ocean.observe

        def force_dream(**kwargs):
            result = original_observe(**kwargs)
            from dataclasses import replace
            return replace(result, intervention="DREAM")
        ocean.observe = force_dream  # type: ignore[method-assign]

        state = fresh_symbol_state("BTC_USDT_PERP", uniform_basin(64))
        decision, _ = run_tick(
            _inputs(), state, AutonomicKernel("t"),
            ocean=ocean, foresight=ForesightPredictor(), heart=HeartMonitor(),
        )
        assert decision.action == "hold"
        assert "OCEAN.DREAM" in decision.reason
        assert "DREAM:hold" in decision.derivation["ocean_handler"]["applied"]


class TestFlagOnMushroomMicro:
    def test_mushroom_micro_perturbs_kappa_by_five(self, env_clean) -> None:
        os.environ["OCEAN_INTERVENTIONS_LIVE"] = "true"
        ocean = Ocean("t")
        original_observe = ocean.observe

        def force_mushroom(**kwargs):
            result = original_observe(**kwargs)
            from dataclasses import replace
            return replace(result, intervention="MUSHROOM_MICRO")
        ocean.observe = force_mushroom  # type: ignore[method-assign]

        state = fresh_symbol_state("BTC_USDT_PERP", uniform_basin(64))
        kappa_before = state.kappa
        decision, new_state = run_tick(
            _inputs(), state, AutonomicKernel("t"),
            ocean=ocean, foresight=ForesightPredictor(), heart=HeartMonitor(),
        )
        # tick.py also evolves κ via its own clamp formula; with the
        # +5 perturbation applied AFTER that evolution, the post-tick
        # κ should be at least kappa_before + 5 - clamp_drift (small).
        # Clamp formula: kappa = old*0.8 + (kappa_star+delta)*0.2.
        # On first tick with default state.kappa = 64 = kappa_star and
        # delta near 0, post-evolution κ ≈ 64. After +5 perturbation,
        # final κ ≈ 69.
        assert new_state.kappa >= kappa_before + 4.0
        assert "MUSHROOM_MICRO:+5kappa" in decision.derivation["ocean_handler"]["applied"]


# ─────────────────────────────────────────────────────────────────
# SLEEP/WAKE — flow through autonomic regardless of flag
# ─────────────────────────────────────────────────────────────────


class TestSleepWakeUnaffectedByFlag:
    def test_sleep_intervention_does_not_force_flatten_with_flag_on(
        self, env_clean,
    ) -> None:
        # SLEEP is reported by Ocean but the directive says it goes
        # through autonomic.is_awake — NOT through the OCEAN_INTERVENTIONS_LIVE
        # flag's ESCAPE/DREAM/MUSHROOM branch. Verify the flag-on
        # handler ignores SLEEP/WAKE.
        os.environ["OCEAN_INTERVENTIONS_LIVE"] = "true"
        ocean = Ocean("t")
        original_observe = ocean.observe

        def force_sleep(**kwargs):
            result = original_observe(**kwargs)
            from dataclasses import replace
            return replace(result, intervention="SLEEP", sleep_phase="SLEEP")
        ocean.observe = force_sleep  # type: ignore[method-assign]

        state = fresh_symbol_state("BTC_USDT_PERP", uniform_basin(64))
        decision, _ = run_tick(
            _inputs(), state, AutonomicKernel("t"),
            ocean=ocean, foresight=ForesightPredictor(), heart=HeartMonitor(),
        )
        # No ESCAPE/DREAM/MUSHROOM applied for SLEEP signal
        applied = decision.derivation["ocean_handler"]["applied"]
        assert "ESCAPE:flatten" not in applied
        assert "DREAM:hold" not in applied
        assert "MUSHROOM_MICRO:+5kappa" not in applied


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
