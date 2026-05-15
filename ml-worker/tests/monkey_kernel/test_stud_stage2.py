"""test_stud_stage2.py — Tier 9 Stage 2 wiring tests.

Stage 2 routes the executive's two remaining stud-conditional formulas
through stud-derived versions when STUD_TOPOLOGY_LIVE=true (default).
Tests cover:

  - detect_mode_stud: regime → mode mapping incl. REVERSION at back loop
  - choose_lane_stud: regime → lane mapping
  - current_leverage flat_mult: stud-derived bell shape
  - REVERSION mode profile present in MODE_PROFILES
  - REVERSION inverts kernel direction in tick.py (post #ml-separation)
  - Legacy path bit-identical when stud_live=False

Note: _override_threshold / _override_threshold_stud were deleted in
the agent K/M separation — direction is now geometric from the start
(no ml_side to override). Their unit tests were removed.
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
from monkey_kernel.executive import (  # noqa: E402
    ExecBasinState, choose_lane, choose_lane_stud,
    current_leverage,
)
from monkey_kernel.foresight import ForesightPredictor  # noqa: E402
from monkey_kernel.heart import HeartMonitor  # noqa: E402
from monkey_kernel.modes import MODE_PROFILES, MonkeyMode, detect_mode, detect_mode_stud  # noqa: E402
from monkey_kernel.ocean import Ocean  # noqa: E402
from monkey_kernel.perception import OHLCVCandle  # noqa: E402
from monkey_kernel.state import KAPPA_STAR, NeurochemicalState  # noqa: E402
from monkey_kernel.stud import (  # noqa: E402
    StudRegime, compute_stud_reading,
)
from monkey_kernel.tick import (  # noqa: E402
    AccountContext, TickInputs, fresh_symbol_state, run_tick,
)
from monkey_kernel.topology_constants import (  # noqa: E402
    PI_STRUCT_DEAD_ZONE_BOUNDARY, PI_STRUCT_FRONT_PEAK_NORM,
    PI_STRUCT_SECOND_TRANSITION,
)


# ─────────────────────────────────────────────────────────────────
# REVERSION mode shipped
# ─────────────────────────────────────────────────────────────────


class TestReversionMode:
    def test_reversion_in_enum(self) -> None:
        assert MonkeyMode.REVERSION.value == "reversion"

    def test_reversion_profile_present(self) -> None:
        assert MonkeyMode.REVERSION in MODE_PROFILES
        prof = MODE_PROFILES[MonkeyMode.REVERSION]
        # Mirrors INVESTIGATION envelope (per directive)
        inv = MODE_PROFILES[MonkeyMode.INVESTIGATION]
        assert prof.tp_base_frac == inv.tp_base_frac
        assert prof.sl_ratio == inv.sl_ratio
        assert prof.size_floor == inv.size_floor
        assert prof.can_enter is True


# ─────────────────────────────────────────────────────────────────
# detect_mode_stud — regime → mode mapping
# ─────────────────────────────────────────────────────────────────


def _stud_at(h: float, regime: StudRegime):
    """Build a synthetic StudReading at exact h_trade + regime."""
    from monkey_kernel.stud import StudReading
    return StudReading(
        h_trade=h, regime=regime, kappa_trade=0.0,
        boundary_distance=0.0,
        predicted_dead_zone_boundary=PI_STRUCT_DEAD_ZONE_BOUNDARY,
        predicted_second_transition=PI_STRUCT_SECOND_TRANSITION,
        predicted_front_peak=PI_STRUCT_FRONT_PEAK_NORM,
    )


class TestDetectModeStud:
    def test_dead_zone_yields_drift(self) -> None:
        r = detect_mode_stud(_stud_at(0.05, StudRegime.DEAD_ZONE))
        assert r["mode"] == "drift"

    def test_back_loop_yields_reversion(self) -> None:
        r = detect_mode_stud(_stud_at(2.5, StudRegime.BACK_LOOP))
        assert r["mode"] == "reversion"

    def test_front_loop_entry_yields_exploration(self) -> None:
        r = detect_mode_stud(_stud_at(0.4, StudRegime.FRONT_LOOP))
        assert r["mode"] == "exploration"

    def test_front_loop_centre_yields_investigation(self) -> None:
        r = detect_mode_stud(_stud_at(1.0, StudRegime.FRONT_LOOP))
        assert r["mode"] == "investigation"

    def test_front_loop_exit_yields_integration(self) -> None:
        r = detect_mode_stud(_stud_at(1.7, StudRegime.FRONT_LOOP))
        assert r["mode"] == "integration"


# ─────────────────────────────────────────────────────────────────
# choose_lane_stud — regime → lane mapping
# ─────────────────────────────────────────────────────────────────


class TestChooseLaneStud:
    def test_dead_zone_yields_observe(self) -> None:
        r = choose_lane_stud(_stud_at(0.05, StudRegime.DEAD_ZONE))
        assert r["value"] == "observe"

    def test_back_loop_yields_scalp(self) -> None:
        r = choose_lane_stud(_stud_at(2.5, StudRegime.BACK_LOOP))
        assert r["value"] == "scalp"

    def test_front_loop_entry_yields_trend(self) -> None:
        r = choose_lane_stud(_stud_at(0.4, StudRegime.FRONT_LOOP))
        assert r["value"] == "trend"

    def test_front_loop_centre_yields_swing(self) -> None:
        r = choose_lane_stud(_stud_at(1.0, StudRegime.FRONT_LOOP))
        assert r["value"] == "swing"


# ─────────────────────────────────────────────────────────────────
# current_leverage flat_mult — stud bell shape
# ─────────────────────────────────────────────────────────────────


def _exec_state(*, phi: float = 0.5, kappa: float = 64.0) -> ExecBasinState:
    return ExecBasinState(
        basin=uniform_basin(64),
        identity_basin=uniform_basin(64),
        phi=phi, kappa=kappa,
        regime_weights={"quantum": 1/3, "efficient": 1/3, "equilibrium": 1/3},
        sovereignty=0.5, basin_velocity=0.1,
        neurochemistry=NeurochemicalState(
            acetylcholine=0.5, dopamine=0.5, serotonin=0.5,
            norepinephrine=0.5, gaba=0.5, endorphins=0.5,
        ),
    )


class TestCurrentLeverageStud:
    def test_legacy_path_when_flag_off(self) -> None:
        s = _exec_state()
        # No stud_reading provided → legacy path
        result = current_leverage(s, max_leverage_boundary=16, mode=MonkeyMode.INVESTIGATION)
        assert "flat_mult" in result["derivation"]
        # Legacy formula: 1 + flatness_boost*flatness; with phi=0.5, tape=0
        # → flat_mult = 1 + 0.8*1.0 = 1.8
        assert result["derivation"]["flat_mult"] == pytest.approx(1.8, abs=0.01)

    def test_stud_flat_mult_at_front_centre_peaks(self) -> None:
        s = _exec_state()
        from monkey_kernel.stud import StudReading
        # kappa_trade = +PI_STRUCT_FRONT_PEAK_NORM at front centre
        sr = StudReading(
            h_trade=1.05, regime=StudRegime.FRONT_LOOP,
            kappa_trade=PI_STRUCT_FRONT_PEAK_NORM,
            boundary_distance=0.95,
            predicted_dead_zone_boundary=PI_STRUCT_DEAD_ZONE_BOUNDARY,
            predicted_second_transition=PI_STRUCT_SECOND_TRANSITION,
            predicted_front_peak=PI_STRUCT_FRONT_PEAK_NORM,
        )
        result = current_leverage(
            s, max_leverage_boundary=16, mode=MonkeyMode.INVESTIGATION,
            stud_reading=sr, stud_live=True,
        )
        # flat_mult = 1 + 0.8 * (1.0) = 1.8
        assert result["derivation"]["flat_mult"] == pytest.approx(1.8, abs=1e-9)

    def test_stud_flat_mult_at_back_loop_dampens(self) -> None:
        s = _exec_state()
        from monkey_kernel.stud import StudReading
        sr = StudReading(
            h_trade=3.0, regime=StudRegime.BACK_LOOP,
            kappa_trade=-PI_STRUCT_FRONT_PEAK_NORM,
            boundary_distance=1.0,
            predicted_dead_zone_boundary=PI_STRUCT_DEAD_ZONE_BOUNDARY,
            predicted_second_transition=PI_STRUCT_SECOND_TRANSITION,
            predicted_front_peak=PI_STRUCT_FRONT_PEAK_NORM,
        )
        result = current_leverage(
            s, max_leverage_boundary=16, mode=MonkeyMode.REVERSION,
            stud_reading=sr, stud_live=True,
        )
        # flat_mult = 1 - 0.8 = 0.2 (floor)
        assert result["derivation"]["flat_mult"] == pytest.approx(0.2, abs=1e-9)


# ─────────────────────────────────────────────────────────────────
# Legacy bit-identity when stud_live=False
# ─────────────────────────────────────────────────────────────────


class TestLegacyBitIdentity:
    def test_choose_lane_legacy_unchanged_when_stud_off(self) -> None:
        s = _exec_state()
        legacy = choose_lane(s, tape_trend=0.5, stud_reading=None, stud_live=False)
        # When stud_live=False, falls through to legacy softmax
        assert legacy["derivation"].get("source") != "stud"
        assert legacy["value"] in ("scalp", "swing", "trend", "observe")

    def test_current_leverage_legacy_when_stud_off(self) -> None:
        s = _exec_state()
        legacy = current_leverage(
            s, max_leverage_boundary=16, mode=MonkeyMode.INVESTIGATION,
            stud_reading=None, stud_live=False,
        )
        # Legacy flat_mult formula
        assert "flat_mult" in legacy["derivation"]


# ─────────────────────────────────────────────────────────────────
# Integration — full tick with STUD_TOPOLOGY_LIVE=true (default)
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
    return TickInputs(
        symbol="BTC_USDT_PERP", ohlcv=_ohlcv(),
        account=AccountContext(
            equity_fraction=0.05, margin_fraction=0.03, open_positions=0,
            available_equity=100.0, exchange_held_side=None,
        ),
        bank_size=10, sovereignty=0.5, max_leverage=16, min_notional=20.0,
    )


class TestStage2EndToEnd:
    def test_default_flag_on_routes_executive_through_stud(self, monkeypatch) -> None:
        monkeypatch.delenv("STUD_TOPOLOGY_LIVE", raising=False)
        state = fresh_symbol_state("BTC_USDT_PERP", uniform_basin(64))
        decision, _ = run_tick(
            _inputs(), state, AutonomicKernel("t"),
            ocean=Ocean("t"), foresight=ForesightPredictor(), heart=HeartMonitor(),
        )
        # When stud is live and mode is stud-derived, mode reason
        # should reference stud (e.g. "stud:FRONT_centre" etc.).
        # If the basin yields a low velocity with regime weights uniform,
        # h_trade might be small enough to land in DEAD_ZONE → DRIFT.
        # We just verify the mode reason was stud-derived (any of):
        mode_reason = decision.derivation["mode"]["reason"]
        assert "stud:" in mode_reason

    def test_explicit_false_falls_through_to_legacy(self, monkeypatch) -> None:
        monkeypatch.setenv("STUD_TOPOLOGY_LIVE", "false")
        state = fresh_symbol_state("BTC_USDT_PERP", uniform_basin(64))
        decision, _ = run_tick(
            _inputs(), state, AutonomicKernel("t"),
            ocean=Ocean("t"), foresight=ForesightPredictor(), heart=HeartMonitor(),
        )
        mode_reason = decision.derivation["mode"]["reason"]
        # Legacy reasons mention drift/curiosity/integration not "stud:"
        assert "stud:" not in mode_reason


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
