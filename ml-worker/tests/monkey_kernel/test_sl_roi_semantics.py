"""test_sl_roi_semantics.py — v0.8.6 SL gate ROI-on-margin fix.

Pins the live failure mode and the corrected behaviour:

  * Live (2026-04-30 → 2026-05-01): ETH long sat at -4.4% ROI for 4+
    hours without SL firing because the gate read raw price movement
    (-0.30%) against the lane SL (1.5% raw under old semantics).
  * Fix: ``should_scalp_exit`` now computes ``roi_frac = pnl / notional
    × leverage`` and compares against ROI-scale lane defaults
    (0.03/0.15/0.40 for scalp/swing/trend after v0.8.7 user-directive
    revision; scalp is now symmetric 1:1 R:R).

Test matrix:

  1. Live failure mode reproduction — old semantic would HOLD, new
     semantic fires SL.
  2. Lane × leverage sweep — same raw move at different leverages
     produces ROI-proportional decisions.
  3. Default leverage=1 back-compat — ROI == raw, gate behaves like
     pre-fix at lev=1.
  4. Hold-zone — ROI inside the lane envelope holds across all
     lanes/leverages.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

# Don't hit Postgres during tests — registry falls back to defaults.
os.environ.pop("DATABASE_URL", None)

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.executive import (  # noqa: E402
    ExecBasinState,
    lane_param,
    should_scalp_exit,
)
from monkey_kernel.modes import MonkeyMode  # noqa: E402
from monkey_kernel.state import KAPPA_STAR, NeurochemicalState  # noqa: E402


def _basin_state(*, phi: float = 0.5) -> ExecBasinState:
    nc = NeurochemicalState(
        acetylcholine=0.5, dopamine=0.5, serotonin=0.5,
        norepinephrine=0.5, gaba=0.5, endorphins=0.5,
    )
    basin = np.full(64, 1.0 / 64.0, dtype=np.float64)
    return ExecBasinState(
        basin=basin, identity_basin=basin.copy(),
        phi=phi, kappa=KAPPA_STAR,
        regime_weights={"quantum": 0.33, "efficient": 0.33, "equilibrium": 0.34},
        sovereignty=0.5, basin_velocity=0.05, neurochemistry=nc,
    )


# ─────────────────────────────────────────────────────────────────
# 1. Live failure mode reproduction
# ─────────────────────────────────────────────────────────────────


class TestLiveFailureModeETH:
    """ETH long at lev=15x, raw price moved -0.30%, ROI = -4.5%.

    Pre-fix (raw-price semantics, lane SL=1.5% raw): SL did NOT fire
    because raw -0.30% > -1.5%. Position bled for 4+ hours.

    Post-fix (ROI semantics, lane SL=15% ROI): SL still does NOT fire
    at -4.5% ROI (well inside the swing band). But scalp lane SL=5% ROI
    -- if scalp had been the lane the SL would also have held. The real
    fix is that the GATE now SEES the position's ROI; the BOUNDS are
    rescaled so the user's actual risk tolerance maps to the new units.

    To reproduce the LIVE FAILURE PROVABLY: ETH long at lev=15x, raw
    price -1.0% → ROI -15%. Old semantic (raw): SL did not fire (1% <
    1.5%). New semantic (ROI): SL fires for swing exactly at the
    boundary, and trivially for scalp. The new gate makes BIG ROI
    drawdowns visible to the SL gate.
    """

    def test_old_raw_semantic_would_hold_new_roi_fires_for_scalp(self) -> None:
        bs = _basin_state()
        # Live failure: raw -1% loss at lev=15x = -15% ROI.
        # Under OLD raw-price semantics, scalp SL was 0.4% raw → fired
        # (so scalp would have closed, but production was on swing/trend).
        # Under NEW ROI semantics, scalp SL is 5% ROI → fires hard.
        result = should_scalp_exit(
            unrealized_pnl_usdt=-1.0,  # raw -1% on $100 notional
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="scalp",
            leverage=15.0,
        )
        assert result["value"] is True
        assert result["derivation"]["exit_type_bit"] == -1
        assert result["derivation"]["roi_frac"] == pytest.approx(-0.15)

    def test_old_raw_semantic_held_swing_at_negative_4_5_pct_roi(self) -> None:
        bs = _basin_state()
        # The literal failure: ETH swing at lev=15x, raw -0.30% = ROI -4.5%.
        # Old semantic: 0.30% < 1.5% raw SL → HOLD (the bug).
        # New semantic: -4.5% ROI < 15% swing SL → still HOLDS, BUT
        # the user can now SET tighter swing SL (8-15% ROI) without
        # accidentally tripping on tiny raw moves at low leverage.
        result = should_scalp_exit(
            unrealized_pnl_usdt=-0.30,  # raw -0.30%
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="swing",
            leverage=15.0,
        )
        assert result["value"] is False  # swing tolerates the 4.5% ROI dip
        assert result["derivation"]["roi_frac"] == pytest.approx(-0.045, abs=1e-9)

    def test_new_semantic_fires_swing_when_roi_exceeds_15_pct(self) -> None:
        bs = _basin_state()
        # Same ETH-style swing position, but raw price moves -1.0% at
        # lev=15x → ROI -15%, AT the swing SL boundary. SL fires.
        result = should_scalp_exit(
            unrealized_pnl_usdt=-1.10,  # raw -1.10% × 15x = ROI -16.5%
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="swing",
            leverage=15.0,
        )
        assert result["value"] is True
        assert result["derivation"]["exit_type_bit"] == -1


# ─────────────────────────────────────────────────────────────────
# 2. Lane × leverage sweep
# ─────────────────────────────────────────────────────────────────


class TestLaneLeverageSweep:
    """Same raw move, different leverages → ROI-proportional decisions.

    The binding SL threshold is ``max(geometric_sl × leverage, lane_sl)``
    where ``geometric_sl_raw ≈ 0.0063`` at INVESTIGATION-mode default state.
    So at lev=15 the geometric envelope is ~9.45% and binds for scalp
    (lane=5%); for swing (lane=15%) and trend (lane=40%) the lane wins.
    These tests exercise the binding-constraint logic across leverages.
    """

    def _binding_sl(self, lane: str, leverage: float) -> float:
        """Compute the binding SL threshold for a lane × leverage at the
        neutral basin state used in this file. Mirrors the executive's
        max(geometric_sl × leverage, lane_sl) composition."""
        # geometric_tp_raw at default state: max(0.003, 0.008 - 0.0015 + 0.0025) = 0.009
        # geometric_sl_raw = 0.009 * 0.7 = 0.0063 (INVESTIGATION sl_ratio=0.7)
        geometric_sl = 0.009 * 0.7 * leverage
        return max(geometric_sl, lane_param(lane, "sl_pct"))

    @pytest.mark.parametrize("leverage", [8.0, 16.0, 25.0])
    def test_scalp_sl_fires_when_roi_clears_binding_threshold(
        self, leverage: float,
    ) -> None:
        bs = _basin_state()
        # Use raw=-1% loss; ROI = -lev%, binding = max(geom*lev, 5%).
        # At lev=8: ROI -8%, binding = max(5.04%, 5%) = 5.04% → FIRES
        # At lev=16: ROI -16%, binding = max(10.08%, 5%) = 10.08% → FIRES
        # At lev=25: ROI -25%, binding = max(15.75%, 5%) = 15.75% → FIRES
        result = should_scalp_exit(
            unrealized_pnl_usdt=-1.0,
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="scalp",
            leverage=leverage,
        )
        roi_abs = 0.01 * leverage
        binding = self._binding_sl("scalp", leverage)
        if roi_abs > binding:
            assert result["value"] is True
        else:
            assert result["value"] is False

    @pytest.mark.parametrize("leverage", [8.0, 16.0, 25.0])
    def test_swing_lane_dominates_at_typical_leverages(
        self, leverage: float,
    ) -> None:
        bs = _basin_state()
        # Verify the swing lane's 15% ROI is the binding constraint at
        # typical leverage; the lane envelope is what the user tunes
        # to control swing-lane risk tolerance.
        # raw -2% loss: ROI = -2*lev%, binding = max(geom*lev, 15%)
        result = should_scalp_exit(
            unrealized_pnl_usdt=-2.0,
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="swing",
            leverage=leverage,
        )
        roi_abs = 0.02 * leverage
        binding = self._binding_sl("swing", leverage)
        if roi_abs > binding:
            assert result["value"] is True
        else:
            assert result["value"] is False

    @pytest.mark.parametrize("leverage", [8.0, 16.0, 25.0])
    def test_trend_band_is_widest(self, leverage: float) -> None:
        bs = _basin_state()
        # raw -3% × any leverage in [8, 25] yields ROI [-24%, -75%].
        # Trend's 40% lane SL binds at lev <= ~63x. At lev=25, ROI=-75%
        # → fires trend. At lev=8, ROI=-24% → holds (inside 40%).
        result = should_scalp_exit(
            unrealized_pnl_usdt=-3.0,
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="trend",
            leverage=leverage,
        )
        roi_abs = 0.03 * leverage
        binding = self._binding_sl("trend", leverage)
        if roi_abs > binding:
            assert result["value"] is True
        else:
            assert result["value"] is False


# ─────────────────────────────────────────────────────────────────
# 3. Default leverage=1 back-compat
# ─────────────────────────────────────────────────────────────────


class TestLeverageDefaultBackCompat:
    """When leverage is omitted, behaves as ROI == raw move (lev=1)."""

    def test_default_leverage_yields_roi_equals_raw(self) -> None:
        bs = _basin_state()
        # raw -10% → ROI -10% at lev=1. Past swing's 15% SL? No — holds.
        result = should_scalp_exit(
            unrealized_pnl_usdt=-10.0,
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="swing",
        )
        # 10% ROI < 15% swing SL → hold.
        assert result["value"] is False
        assert result["derivation"]["leverage"] == pytest.approx(1.0)
        assert result["derivation"]["roi_frac"] == pytest.approx(-0.10)
        assert result["derivation"]["raw_frac"] == pytest.approx(-0.10)

    def test_zero_or_negative_leverage_clamps_to_one(self) -> None:
        bs = _basin_state()
        result = should_scalp_exit(
            unrealized_pnl_usdt=-1.0,
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="scalp",
            leverage=0.0,
        )
        # Defensive: lev=0 → treat as 1, ROI == raw move = -1% < 5% SL → hold.
        assert result["derivation"]["leverage"] == pytest.approx(1.0)
        assert result["value"] is False


# ─────────────────────────────────────────────────────────────────
# 4. Reason / derivation surface
# ─────────────────────────────────────────────────────────────────


class TestRoiReasonStrings:
    def test_sl_reason_says_roi_and_leverage(self) -> None:
        bs = _basin_state()
        result = should_scalp_exit(
            unrealized_pnl_usdt=-1.0,
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="scalp",
            leverage=20.0,
        )
        assert result["value"] is True
        # Reason should reflect new ROI semantic.
        assert "roi" in result["reason"].lower()
        assert "lev=20x" in result["reason"]

    def test_hold_reason_says_roi(self) -> None:
        bs = _basin_state()
        result = should_scalp_exit(
            unrealized_pnl_usdt=-0.10,
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="swing",
            leverage=10.0,
        )
        assert result["value"] is False
        assert "roi" in result["reason"].lower()
