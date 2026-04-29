"""test_upper_stack_executive.py — PR 4 UPPER_STACK_EXECUTIVE_LIVE flag.

Verifies that with the flag ON:
  current_entry_threshold *= (1 − 0.2*wonder + 0.2*anxiety)
  current_leverage        *= (1 − 0.3*anxiety + 0.2*confidence)
  current_position_size   *= (1 + 0.15*flow)
All multipliers re-clipped to existing SAFETY_BOUNDS. With flag OFF:
multipliers computed for telemetry but not applied.
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
    AccountContext, TickInputs, fresh_symbol_state, run_tick,
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


def _inputs() -> TickInputs:
    return TickInputs(
        symbol="BTC_USDT_PERP", ohlcv=_ohlcv(),
        account=AccountContext(
            equity_fraction=0.05, margin_fraction=0.03, open_positions=0,
            available_equity=100.0, exchange_held_side=None,
        ),
        bank_size=10, sovereignty=0.5, max_leverage=16, min_notional=20.0,
    )


@pytest.fixture
def env_clean():
    prev = os.environ.get("UPPER_STACK_EXECUTIVE_LIVE")
    yield
    if prev is None:
        os.environ.pop("UPPER_STACK_EXECUTIVE_LIVE", None)
    else:
        os.environ["UPPER_STACK_EXECUTIVE_LIVE"] = prev


def _instrumented_run() -> tuple:
    state = fresh_symbol_state("BTC_USDT_PERP", uniform_basin(64))
    return run_tick(
        _inputs(), state, AutonomicKernel("t"),
        ocean=Ocean("t"), foresight=ForesightPredictor(), heart=HeartMonitor(),
    )


# ─────────────────────────────────────────────────────────────────
# Flag default OFF
# ─────────────────────────────────────────────────────────────────


class TestFlagOff:
    def test_default_off_logs_multipliers_but_does_not_apply(self, env_clean) -> None:
        os.environ.pop("UPPER_STACK_EXECUTIVE_LIVE", None)
        decision, _ = _instrumented_run()
        tel = decision.derivation["upper_stack_executive"]
        assert tel["live"] is False
        # Multipliers always computed for telemetry
        assert "entry_threshold_mult" in tel
        assert "leverage_mult" in tel
        assert "size_mult" in tel
        assert tel["applied"] == []


# ─────────────────────────────────────────────────────────────────
# Flag ON — multipliers applied + clamped
# ─────────────────────────────────────────────────────────────────


class TestFlagOn:
    def test_flag_on_records_all_three_applications(self, env_clean) -> None:
        os.environ["UPPER_STACK_EXECUTIVE_LIVE"] = "true"
        decision, _ = _instrumented_run()
        tel = decision.derivation["upper_stack_executive"]
        assert tel["live"] is True
        assert any("entry_thr" in s for s in tel["applied"])
        assert any("leverage" in s for s in tel["applied"])
        assert any("size" in s for s in tel["applied"])

    def test_flag_on_with_low_anxiety_and_no_emotions_yields_unit_multipliers(
        self, env_clean,
    ) -> None:
        # Cold-start tick (no prev_basin) gives investigation=0 → flow=0
        # → anxiety=0 (transcendence ≈ 0 if κ at anchor) → wonder=0
        # → confidence might be 0.x. Multipliers should land near 1.
        os.environ["UPPER_STACK_EXECUTIVE_LIVE"] = "true"
        decision, _ = _instrumented_run()
        tel = decision.derivation["upper_stack_executive"]
        # The multipliers should be in a reasonable band around 1
        assert 0.3 <= tel["entry_threshold_mult"] <= 2.0
        assert 0.3 <= tel["leverage_mult"] <= 2.0
        assert 0.3 <= tel["size_mult"] <= 2.0


# ─────────────────────────────────────────────────────────────────
# Multiplier formulas — direct value checks
# ─────────────────────────────────────────────────────────────────


class TestMultiplierFormulas:
    def test_entry_threshold_mult_formula(self, env_clean) -> None:
        os.environ["UPPER_STACK_EXECUTIVE_LIVE"] = "true"
        decision, _ = _instrumented_run()
        tel = decision.derivation["upper_stack_executive"]
        emo = decision.derivation["emotions"]
        expected = 1.0 - 0.2 * emo["wonder"] + 0.2 * emo["anxiety"]
        assert abs(tel["entry_threshold_mult"] - expected) < 1e-12

    def test_leverage_mult_formula(self, env_clean) -> None:
        os.environ["UPPER_STACK_EXECUTIVE_LIVE"] = "true"
        decision, _ = _instrumented_run()
        tel = decision.derivation["upper_stack_executive"]
        emo = decision.derivation["emotions"]
        expected = 1.0 - 0.3 * emo["anxiety"] + 0.2 * emo["confidence"]
        assert abs(tel["leverage_mult"] - expected) < 1e-12

    def test_size_mult_formula(self, env_clean) -> None:
        os.environ["UPPER_STACK_EXECUTIVE_LIVE"] = "true"
        decision, _ = _instrumented_run()
        tel = decision.derivation["upper_stack_executive"]
        emo = decision.derivation["emotions"]
        expected = 1.0 + 0.15 * emo["flow"]
        assert abs(tel["size_mult"] - expected) < 1e-12


# ─────────────────────────────────────────────────────────────────
# Flow field added to emotions
# ─────────────────────────────────────────────────────────────────


class TestFlowAddedToEmotions:
    def test_emotions_now_carries_flow(self) -> None:
        decision, _ = _instrumented_run()
        assert "flow" in decision.derivation["emotions"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
