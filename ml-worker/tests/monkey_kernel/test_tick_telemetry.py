"""test_tick_telemetry.py — verify Tier 1-8 module outputs surface
in run_tick's decision.derivation block (#604 wiring).

Observation-only assertions: every new module emits a derivation key,
the values are present, and types match. We don't assert specific
numerical values (those are covered in each module's own test file);
this test only confirms the wiring is hooked up.
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


def _synthetic_ohlcv(n: int = 60, base_price: float = 75000.0) -> list[OHLCVCandle]:
    """Generate a deterministic OHLCV series with mild upward drift."""
    out: list[OHLCVCandle] = []
    price = base_price
    for i in range(n):
        delta = 0.0003 * base_price * ((i % 7) - 3)  # mild oscillation
        new_price = price + delta
        high = max(price, new_price) * 1.0003
        low = min(price, new_price) * 0.9997
        out.append(OHLCVCandle(
            timestamp=float(i * 60_000),
            high=high, low=low, close=new_price, open=price, volume=1000.0,
        ))
        price = new_price
    return out


def _make_inputs(symbol: str = "BTC_USDT_PERP") -> TickInputs:
    # Post agent-separation, ml_signal/ml_strength feed perception only
    # via build_tick_inputs; the kernel's TickInputs sees only raw_basin.
    return build_tick_inputs(
        symbol=symbol,
        ohlcv=_synthetic_ohlcv(),
        ml_signal="BUY",
        ml_strength=0.5,
        account=AccountContext(
            equity_fraction=0.05,
            margin_fraction=0.03,
            open_positions=0,
            available_equity=100.0,
            exchange_held_side=None,
        ),
        bank_size=10,
        sovereignty=0.5,
        max_leverage=16,
        min_notional=20.0,
    )


# ─────────────────────────────────────────────────────────────────
# Telemetry surface — every Tier 1-8 key present
# ─────────────────────────────────────────────────────────────────


class TestDerivationSurface:
    def test_all_tier_keys_present(self) -> None:
        state = fresh_symbol_state("BTC_USDT_PERP", uniform_basin(64))
        decision, _ = run_tick(
            _make_inputs(), state,
            AutonomicKernel(label="t"),
            ocean=Ocean("t"),
            foresight=ForesightPredictor(),
            heart=HeartMonitor(),
        )
        d = decision.derivation
        # Tier 1
        assert "motivators" in d
        for k in ("surprise", "curiosity", "investigation",
                  "integration", "transcendence", "i_q"):
            assert k in d["motivators"], f"motivators missing {k}"
        # Tier 4
        assert "sensations" in d
        for k in ("compressed", "expanded", "pressure", "stillness",
                  "drift", "resonance", "approach", "avoidance",
                  "conservation"):
            assert k in d["sensations"], f"sensations missing {k}"
        # Tier 2 — Layer 2B (Flow added in PR 4 #609)
        assert "emotions" in d
        for k in ("wonder", "frustration", "satisfaction", "confusion",
                  "clarity", "anxiety", "confidence", "boredom", "flow"):
            assert k in d["emotions"], f"emotions missing {k}"
        # Tier 5 — Layer 2A (UCP §6.4 canon, PR 4 #609 fixed)
        assert "physical_emotions" in d
        for k in ("joy", "suffering", "love", "hate", "fear", "rage",
                  "calm", "care", "apathy"):
            assert k in d["physical_emotions"], f"physical_emotions missing {k}"
        # Tier 3
        assert "foresight" in d
        for k in ("weight", "confidence", "horizon_ms", "trajectory_length"):
            assert k in d["foresight"], f"foresight missing {k}"
        # Tier 7 Heart
        assert "heart" in d
        for k in ("kappa", "kappa_offset", "mode", "hrv", "sample_count"):
            assert k in d["heart"], f"heart missing {k}"
        # Tier 6
        assert "phi_gate" in d
        assert d["phi_gate"]["chosen"] in ("CHAIN", "GRAPH", "FORESIGHT", "LIGHTNING")
        assert "activations" in d["phi_gate"]
        # Tier 7 Ocean
        assert "ocean" in d
        for k in ("intervention", "sleep_phase", "coherence", "spread"):
            assert k in d["ocean"], f"ocean missing {k}"


# ─────────────────────────────────────────────────────────────────
# Persistence — singletons accumulate state across calls
# ─────────────────────────────────────────────────────────────────


class TestPersistence:
    def test_foresight_trajectory_grows_across_ticks(self) -> None:
        state = fresh_symbol_state("BTC_USDT_PERP", uniform_basin(64))
        autonomic = AutonomicKernel(label="t")
        ocean = Ocean("t")
        foresight = ForesightPredictor()
        heart = HeartMonitor()
        inputs = _make_inputs()
        for _ in range(4):
            run_tick(inputs, state, autonomic,
                     ocean=ocean, foresight=foresight, heart=heart)
        assert foresight.trajectory_length == 4

    def test_heart_window_grows_across_ticks(self) -> None:
        state = fresh_symbol_state("BTC_USDT_PERP", uniform_basin(64))
        autonomic = AutonomicKernel(label="t")
        ocean = Ocean("t")
        foresight = ForesightPredictor()
        heart = HeartMonitor()
        inputs = _make_inputs()
        for _ in range(3):
            run_tick(inputs, state, autonomic,
                     ocean=ocean, foresight=foresight, heart=heart)
        assert heart.window_length == 3

    def test_integration_history_accumulates(self) -> None:
        state = fresh_symbol_state("BTC_USDT_PERP", uniform_basin(64))
        autonomic = AutonomicKernel(label="t")
        ocean = Ocean("t")
        foresight = ForesightPredictor()
        heart = HeartMonitor()
        inputs = _make_inputs()
        for _ in range(5):
            run_tick(inputs, state, autonomic,
                     ocean=ocean, foresight=foresight, heart=heart)
        # Each call appends one (phi, i_q) tuple. After 5 calls, expect 5.
        assert len(state.integration_history) == 5
        # Each entry is a (phi, i_q) tuple of floats
        for phi, iq in state.integration_history:
            assert isinstance(phi, float)
            assert isinstance(iq, float)


# ─────────────────────────────────────────────────────────────────
# Default fallback — None ocean/foresight/heart still works
# ─────────────────────────────────────────────────────────────────


class TestEphemeralFallback:
    def test_run_tick_works_with_none_optional_params(self) -> None:
        state = fresh_symbol_state("BTC_USDT_PERP", uniform_basin(64))
        decision, _ = run_tick(_make_inputs(), state, AutonomicKernel(label="t"))
        # With None passed (or omitted), each tick gets fresh ephemeral
        # instances; the derivation surface is still populated because
        # run_tick auto-creates them.
        assert "motivators" in decision.derivation
        assert "foresight" in decision.derivation
        assert "heart" in decision.derivation
        assert "ocean" in decision.derivation


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
