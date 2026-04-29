"""test_stud_topology.py — Tier 9 Stage 1 stud topology constants + classifier.

Stage 1 ships telemetry only; Stage 2 wires the four decision-path
replacements (_override_threshold / flat_mult / detect_mode /
choose_lane) behind STUD_TOPOLOGY_LIVE.

Tests:
  - π-structure constants match qig-verification source values
  - classify_stud_regime hits all three regimes at expected boundaries
  - kappa_trade peak/trough centred per directive
  - h_trade formula reproduces directive's chaos × (1+quantum) shape
  - Telemetry surface in tick.derivation
"""
from __future__ import annotations

import math
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
from monkey_kernel.stud import (  # noqa: E402
    StudRegime,
    classify_stud_regime,
    compute_stud_reading,
    h_trade,
    kappa_trade,
    stud_topology_live,
)
from monkey_kernel.tick import (  # noqa: E402
    AccountContext,
    TickInputs,
    build_tick_inputs,
    fresh_symbol_state,
    run_tick,
)
from monkey_kernel.topology_constants import (  # noqa: E402
    GOLDEN_RATIO,
    PI_STRUCT_BOUNDARY_R_SQUARED,
    PI_STRUCT_DEAD_ZONE_BOUNDARY,
    PI_STRUCT_FRONT_PEAK_NORM,
    PI_STRUCT_GRAVITATING_FRACTION,
    PI_STRUCT_L4_STUD_ARC,
    PI_STRUCT_SECOND_TRANSITION,
)


# ─────────────────────────────────────────────────────────────────
# Frozen π-structure constants
# ─────────────────────────────────────────────────────────────────


class TestPiStructureConstants:
    def test_dead_zone_boundary_equals_one_over_three_pi(self) -> None:
        assert PI_STRUCT_DEAD_ZONE_BOUNDARY == pytest.approx(1.0 / (3.0 * math.pi), abs=1e-12)
        assert PI_STRUCT_DEAD_ZONE_BOUNDARY == pytest.approx(0.10610, abs=1e-4)

    def test_gravitating_fraction_equals_one_over_pi(self) -> None:
        assert PI_STRUCT_GRAVITATING_FRACTION == pytest.approx(1.0 / math.pi, abs=1e-12)
        assert PI_STRUCT_GRAVITATING_FRACTION == pytest.approx(0.31831, abs=1e-4)

    def test_front_peak_norm_equals_ten_pi(self) -> None:
        assert PI_STRUCT_FRONT_PEAK_NORM == pytest.approx(10.0 * math.pi, abs=1e-12)
        assert PI_STRUCT_FRONT_PEAK_NORM == pytest.approx(31.416, abs=1e-3)

    def test_second_transition_exactly_two(self) -> None:
        assert PI_STRUCT_SECOND_TRANSITION == 2.0

    def test_boundary_r_squared_equals_one_over_phi(self) -> None:
        assert PI_STRUCT_BOUNDARY_R_SQUARED == pytest.approx(1.0 / GOLDEN_RATIO, abs=1e-12)
        assert PI_STRUCT_BOUNDARY_R_SQUARED == pytest.approx(0.61803, abs=1e-4)

    def test_l4_stud_arc_equals_three_halves_pi(self) -> None:
        assert PI_STRUCT_L4_STUD_ARC == pytest.approx(3.0 * math.pi / 2.0, abs=1e-12)
        assert PI_STRUCT_L4_STUD_ARC == pytest.approx(4.712, abs=1e-3)


# ─────────────────────────────────────────────────────────────────
# Regime classification at directive-listed test points
# ─────────────────────────────────────────────────────────────────


class TestClassifyStudRegime:
    @pytest.mark.parametrize(
        "h,expected",
        [
            (0.0,  StudRegime.DEAD_ZONE),
            (0.05, StudRegime.DEAD_ZONE),
            (0.10, StudRegime.DEAD_ZONE),  # below 0.10610
            (PI_STRUCT_DEAD_ZONE_BOUNDARY + 1e-9, StudRegime.FRONT_LOOP),
            (1.0, StudRegime.FRONT_LOOP),
            (PI_STRUCT_SECOND_TRANSITION - 1e-9, StudRegime.FRONT_LOOP),
            (PI_STRUCT_SECOND_TRANSITION + 1e-9, StudRegime.BACK_LOOP),
            (5.0, StudRegime.BACK_LOOP),
        ],
    )
    def test_classification_at_boundaries(self, h: float, expected: StudRegime) -> None:
        assert classify_stud_regime(h) == expected


# ─────────────────────────────────────────────────────────────────
# h_trade formula
# ─────────────────────────────────────────────────────────────────


class TestHTrade:
    def test_zero_velocity_yields_zero(self) -> None:
        assert h_trade(0.0, 0.5, {"quantum": 0.5}) == 0.0

    def test_unit_phi_zeros_h(self) -> None:
        # phi=1 → (1-phi) = 0 → chaos=0 → h_trade=0
        assert h_trade(1.0, 1.0, {"quantum": 0.5}) == 0.0

    def test_quantum_amplifies_h(self) -> None:
        h_no_q = h_trade(0.5, 0.5, {"quantum": 0.0})
        h_full_q = h_trade(0.5, 0.5, {"quantum": 1.0})
        assert h_full_q == pytest.approx(2.0 * h_no_q, abs=1e-12)

    def test_h_formula_chaos_times_one_plus_quantum(self) -> None:
        # chaos = 0.5 * (1 - 0.4) = 0.3; quantum = 0.6 → h = 0.3 * 1.6 = 0.48
        h = h_trade(0.5, 0.4, {"quantum": 0.6})
        assert h == pytest.approx(0.48, abs=1e-12)


# ─────────────────────────────────────────────────────────────────
# kappa_trade — bell curve in front loop, mirrored in back loop
# ─────────────────────────────────────────────────────────────────


class TestKappaTrade:
    def test_dead_zone_yields_zero(self) -> None:
        assert kappa_trade(0.05, StudRegime.DEAD_ZONE) == 0.0

    def test_front_loop_centre_peaks_at_ten_pi(self) -> None:
        front_centre = (PI_STRUCT_DEAD_ZONE_BOUNDARY + PI_STRUCT_SECOND_TRANSITION) / 2.0
        peak = kappa_trade(front_centre, StudRegime.FRONT_LOOP)
        assert peak == pytest.approx(PI_STRUCT_FRONT_PEAK_NORM, abs=1e-9)

    def test_front_loop_positive_back_loop_negative(self) -> None:
        front_centre = (PI_STRUCT_DEAD_ZONE_BOUNDARY + PI_STRUCT_SECOND_TRANSITION) / 2.0
        back_centre = front_centre + PI_STRUCT_SECOND_TRANSITION
        assert kappa_trade(front_centre, StudRegime.FRONT_LOOP) > 0
        assert kappa_trade(back_centre, StudRegime.BACK_LOOP) < 0

    def test_front_loop_falls_off_from_centre(self) -> None:
        front_centre = (PI_STRUCT_DEAD_ZONE_BOUNDARY + PI_STRUCT_SECOND_TRANSITION) / 2.0
        peak = kappa_trade(front_centre, StudRegime.FRONT_LOOP)
        edge = kappa_trade(0.2, StudRegime.FRONT_LOOP)
        assert peak > edge


# ─────────────────────────────────────────────────────────────────
# Stud reading dataclass
# ─────────────────────────────────────────────────────────────────


class TestStudReading:
    def test_compute_returns_all_fields(self) -> None:
        r = compute_stud_reading(0.5, 0.5, {"quantum": 0.3})
        assert r.h_trade == pytest.approx(0.5 * 0.5 * 1.3, abs=1e-12)
        assert r.regime in (StudRegime.DEAD_ZONE, StudRegime.FRONT_LOOP, StudRegime.BACK_LOOP)
        assert r.predicted_dead_zone_boundary == PI_STRUCT_DEAD_ZONE_BOUNDARY
        assert r.predicted_second_transition == PI_STRUCT_SECOND_TRANSITION
        assert r.predicted_front_peak == PI_STRUCT_FRONT_PEAK_NORM


# ─────────────────────────────────────────────────────────────────
# Flag default-on
# ─────────────────────────────────────────────────────────────────


class TestStudTopologyLiveFlag:
    def test_default_is_true(self, monkeypatch) -> None:
        monkeypatch.delenv("STUD_TOPOLOGY_LIVE", raising=False)
        assert stud_topology_live() is True

    def test_explicit_false(self, monkeypatch) -> None:
        monkeypatch.setenv("STUD_TOPOLOGY_LIVE", "false")
        assert stud_topology_live() is False


# ─────────────────────────────────────────────────────────────────
# tick.py telemetry surface
# ─────────────────────────────────────────────────────────────────


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
    return build_tick_inputs(
        symbol="BTC_USDT_PERP", ohlcv=_ohlcv(), ml_signal="BUY", ml_strength=0.5,
        account=AccountContext(
            equity_fraction=0.05, margin_fraction=0.03, open_positions=0,
            available_equity=100.0, exchange_held_side=None,
        ),
        bank_size=10, sovereignty=0.5, max_leverage=16, min_notional=20.0,
    )


class TestStudTelemetrySurface:
    def test_topology_block_present_in_derivation(self) -> None:
        state = fresh_symbol_state("BTC_USDT_PERP", uniform_basin(64))
        decision, _ = run_tick(
            _inputs(), state, AutonomicKernel("t"),
            ocean=Ocean("t"), foresight=ForesightPredictor(), heart=HeartMonitor(),
        )
        assert "topology" in decision.derivation
        stud_block = decision.derivation["topology"]["stud"]
        for k in (
            "h_trade", "regime", "kappa_trade", "boundary_distance",
            "predicted_dead_zone_boundary",
            "predicted_second_transition",
            "predicted_front_peak",
        ):
            assert k in stud_block

    def test_topology_includes_predicted_constants_for_validation(self) -> None:
        state = fresh_symbol_state("BTC_USDT_PERP", uniform_basin(64))
        decision, _ = run_tick(
            _inputs(), state, AutonomicKernel("t"),
            ocean=Ocean("t"), foresight=ForesightPredictor(), heart=HeartMonitor(),
        )
        stud_block = decision.derivation["topology"]["stud"]
        assert stud_block["predicted_dead_zone_boundary"] == pytest.approx(
            PI_STRUCT_DEAD_ZONE_BOUNDARY, abs=1e-12,
        )
        assert stud_block["predicted_second_transition"] == 2.0
        assert stud_block["predicted_front_peak"] == pytest.approx(
            PI_STRUCT_FRONT_PEAK_NORM, abs=1e-12,
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
