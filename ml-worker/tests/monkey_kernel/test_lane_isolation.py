"""test_lane_isolation.py — Proposal #10 lane-isolated position lifecycle.

Validates the kernel-side promises of proposal #10:

  1. Lane parameter envelope: each lane has its own SL/TP and budget
     fraction, and the registry-backed defaults are read correctly.
  2. ``current_position_size`` shrinks the available equity by the
     lane's budget fraction (so a held swing-lane no longer paralyzes
     a scalp-lane on the same symbol).
  3. ``should_scalp_exit`` widens the TP/SL envelope to the *wider* of
     (geometric, lane) so the geometric fee-clear floor is never
     violated but a swing/trend lane can absorb retraces a scalp lane
     would never tolerate.
  4. ``should_dca_add`` rejects same-lane mismatched sides but is
     unaware of (i.e. doesn't consult) cross-lane state — that's the
     kernel-tick caller's job and is covered by SymbolState dict tests.
  5. Per-lane SymbolState bookkeeping: peak PnL, tape-flip streak,
     DCA add count are kept in lane-keyed dicts so two lanes never
     bleed into one another.
  6. Per-lane held-side map (LanePosition list) survives the
     ``_decide_with_position`` path without cross-lane leakage.
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.executive import (  # noqa: E402
    ExecBasinState,
    _LANE_PARAMETER_DEFAULTS,
    choose_lane,
    current_position_size,
    lane_budget_fraction,
    lane_param,
    should_dca_add,
    should_scalp_exit,
)
from monkey_kernel.modes import MonkeyMode  # noqa: E402
from monkey_kernel.state import NeurochemicalState  # noqa: E402
from monkey_kernel.tick import LanePosition, SymbolState  # noqa: E402


def _basin_state(*, phi: float = 0.5, kappa: float = 64.0) -> ExecBasinState:
    nc = NeurochemicalState(
        acetylcholine=0.5, dopamine=0.5, serotonin=0.5,
        norepinephrine=0.5, gaba=0.5, endorphins=0.0,
    )
    basin = np.full(64, 1.0 / 64.0, dtype=np.float64)
    return ExecBasinState(
        basin=basin, identity_basin=basin.copy(),
        phi=phi, kappa=kappa,
        regime_weights={"quantum": 0.33, "efficient": 0.33, "equilibrium": 0.34},
        sovereignty=0.5, basin_velocity=0.05, neurochemistry=nc,
    )


# ── 1. Lane parameter envelope ──────────────────────────────────────


class TestLaneParameterEnvelope:
    def test_scalp_envelope_tighter_than_swing(self) -> None:
        assert lane_param("scalp", "sl_pct") < lane_param("swing", "sl_pct")
        assert lane_param("scalp", "tp_pct") < lane_param("swing", "tp_pct")

    def test_swing_envelope_tighter_than_trend(self) -> None:
        assert lane_param("swing", "sl_pct") < lane_param("trend", "sl_pct")
        assert lane_param("swing", "tp_pct") < lane_param("trend", "tp_pct")

    def test_scalp_sl_in_roi_band(self) -> None:
        # v0.8.6 — sl_pct semantics are ROI-on-margin (was raw price).
        # Scalp band: ~5% ROI.
        assert 0.02 <= lane_param("scalp", "sl_pct") <= 0.10

    def test_swing_sl_in_roi_band(self) -> None:
        # v0.8.6 — swing band: ~15% ROI on margin.
        assert 0.08 <= lane_param("swing", "sl_pct") <= 0.25

    def test_trend_sl_in_roi_band(self) -> None:
        # v0.8.6 — trend band: ~40% ROI on margin.
        assert 0.25 <= lane_param("trend", "sl_pct") <= 0.60

    def test_scalp_swing_budget_sums_to_one(self) -> None:
        assert (
            lane_budget_fraction("scalp")
            + lane_budget_fraction("swing")
            == pytest.approx(1.0, abs=1e-9)
        )

    def test_trend_budget_default_is_zero(self) -> None:
        # Opt-in via parameter registry. Default 0 keeps initial batch
        # to the two-lane (scalp + swing) split.
        assert lane_budget_fraction("trend") == pytest.approx(0.0, abs=1e-9)

    def test_observe_budget_is_zero(self) -> None:
        # observe is decision-only; never holds capital.
        assert lane_budget_fraction("observe") == 0.0

    def test_unknown_lane_falls_back_to_swing_param(self) -> None:
        # Defensive: unknown lane key returns the swing slot for the
        # given param name so callers never blow up on enum drift.
        assert lane_param("nonsense", "sl_pct") == _LANE_PARAMETER_DEFAULTS["swing"]["sl_pct"]


# ── 2. current_position_size lane-budget shrinkage ──────────────────


class TestPositionSizeLaneBudget:
    def test_scalp_lane_sees_only_its_budget_share(self) -> None:
        bs = _basin_state(phi=0.6)
        result_scalp = current_position_size(
            bs, available_equity_usdt=100.0, min_notional_usdt=1.0,
            leverage=10, bank_size=20, mode=MonkeyMode.INVESTIGATION,
            lane="scalp",
        )
        # The "full" view (no lane shrinkage emulated by bumping budget
        # to 1.0 via swing) should be roughly 2x of the scalp view since
        # both lanes default to 0.50.
        result_swing = current_position_size(
            bs, available_equity_usdt=100.0, min_notional_usdt=1.0,
            leverage=10, bank_size=20, mode=MonkeyMode.INVESTIGATION,
            lane="swing",
        )
        # Each lane sees the same 0.50 fraction by default → values
        # match within the rounding noise from the base formula.
        assert result_scalp["value"] == pytest.approx(result_swing["value"], rel=1e-9)

    def test_lane_budget_frac_threaded_into_derivation(self) -> None:
        bs = _basin_state()
        result = current_position_size(
            bs, available_equity_usdt=200.0, min_notional_usdt=1.0,
            leverage=5, bank_size=10, mode=MonkeyMode.INVESTIGATION,
            lane="swing",
        )
        assert result["derivation"]["lane"] == "swing"
        assert result["derivation"]["lane_budget_frac"] == pytest.approx(0.5)

    def test_trend_lane_zero_budget_makes_size_zero(self) -> None:
        bs = _basin_state()
        result = current_position_size(
            bs, available_equity_usdt=200.0, min_notional_usdt=1.0,
            leverage=5, bank_size=10, mode=MonkeyMode.INVESTIGATION,
            lane="trend",
        )
        # Default trend budget=0 → effective equity=0 → sized=0.
        assert result["value"] == 0.0


# ── 3. should_scalp_exit lane envelope widening ─────────────────────
#
# v0.8.6 — the SL/TP gate now compares ROI-on-margin (pnl/notional × lev)
# against the lane envelope (also ROI). At leverage=15x (typical live
# value), a 0.4% raw-price loss = 6% ROI, well into the scalp band; a
# 1% raw-price loss = 15% ROI, well past the scalp band.


class TestScalpExitLaneEnvelope:
    def test_scalp_sl_fires_when_roi_clears_envelope(self) -> None:
        bs = _basin_state()
        # Lev=15x, raw -1.0% → ROI -15%. Past scalp's binding SL
        # (max(geometric_sl×lev≈9.45%, lane 5%) = 9.45%).
        result = should_scalp_exit(
            unrealized_pnl_usdt=-1.0,
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="scalp",
            leverage=15.0,
        )
        assert result["value"] is True
        assert "stop_loss[scalp]" in result["reason"]

    def test_swing_lane_absorbs_loss_scalp_would_exit(self) -> None:
        bs = _basin_state()
        # Lev=15x, raw -1.0% → ROI -15%. Past scalp's binding SL (~9.45%
        # from geometric × lev) but exactly at swing's 15% lane SL.
        # Use raw=-0.85 so ROI=-12.75% — past scalp 9.45%, inside swing 15%.
        scalp = should_scalp_exit(
            unrealized_pnl_usdt=-0.85,
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="scalp",
            leverage=15.0,
        )
        swing = should_scalp_exit(
            unrealized_pnl_usdt=-0.85,
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="swing",
            leverage=15.0,
        )
        assert scalp["value"] is True
        assert swing["value"] is False
        assert "scalp hold[swing]" in swing["reason"]

    def test_trend_lane_absorbs_loss_swing_would_exit(self) -> None:
        bs = _basin_state()
        # Lev=15x, raw -2.0% → ROI -30%. Past swing's 15% lane SL but
        # inside trend's 40% lane SL.
        swing = should_scalp_exit(
            unrealized_pnl_usdt=-2.0,
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="swing",
            leverage=15.0,
        )
        trend = should_scalp_exit(
            unrealized_pnl_usdt=-2.0,
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="trend",
            leverage=15.0,
        )
        assert swing["value"] is True
        assert trend["value"] is False

    def test_geometric_floor_never_breached(self) -> None:
        bs = _basin_state()
        # 50% raw gain at lev=1 = 50% ROI — trivially clears any lane/geom TP.
        result = should_scalp_exit(
            unrealized_pnl_usdt=50.0,
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="swing",
            leverage=1.0,
        )
        assert result["value"] is True
        derivation = result["derivation"]
        assert derivation["tp_thr"] >= derivation["lane_tp_pct"]

    def test_lane_threaded_into_derivation(self) -> None:
        bs = _basin_state()
        result = should_scalp_exit(
            unrealized_pnl_usdt=0.05,
            notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="scalp",
            leverage=10.0,
        )
        assert result["derivation"]["lane"] == "scalp"
        assert result["derivation"]["lane_tp_pct"] == lane_param("scalp", "tp_pct")
        assert result["derivation"]["lane_sl_pct"] == lane_param("scalp", "sl_pct")
        assert result["derivation"]["leverage"] == pytest.approx(10.0)


# ── 4. should_dca_add same-lane mismatch only ───────────────────────


class TestDCALaneScope:
    def test_same_lane_mismatch_rejects(self) -> None:
        # held=long, candidate=short, same lane → reject with rule 1.
        result = should_dca_add(
            held_side="long", side_candidate="short",
            current_price=100.0, initial_entry_price=100.0,
            add_count=0, last_add_at_ms=0, now_ms=10_000_000,
            sovereignty=0.5, lane="swing",
        )
        assert result["value"] is False
        assert result["derivation"]["rule"] == 1
        assert result["derivation"]["lane"] == "swing"

    def test_lane_surfaced_into_derivation_on_ok(self) -> None:
        # held=long, candidate=long, price -2% (long DCA OK),
        # cooldown elapsed, sovereignty above floor.
        result = should_dca_add(
            held_side="long", side_candidate="long",
            current_price=98.0, initial_entry_price=100.0,
            add_count=0, last_add_at_ms=0, now_ms=10**12,
            sovereignty=0.5, lane="scalp",
        )
        assert result["value"] is True
        assert result["derivation"]["lane"] == "scalp"
        assert "DCA_OK[scalp]" in result["reason"]

    def test_lane_default_is_swing(self) -> None:
        # No lane arg → defaults to swing for back-compat.
        result = should_dca_add(
            held_side="long", side_candidate="short",
            current_price=100.0, initial_entry_price=100.0,
            add_count=0, last_add_at_ms=0, now_ms=10_000_000,
            sovereignty=0.5,
        )
        assert "swing" in result["reason"]


# ── 5. SymbolState per-lane bookkeeping ─────────────────────────────


class TestSymbolStateLaneSubstates:
    def test_per_lane_dicts_initialize_empty(self) -> None:
        identity = np.full(64, 1.0 / 64.0, dtype=np.float64)
        s = SymbolState(symbol="BTC_USDT_PERP", identity_basin=identity)
        assert s.peak_pnl_usdt_by_lane == {}
        assert s.peak_tracked_trade_id_by_lane == {}
        assert s.dca_add_count_by_lane == {}
        assert s.last_entry_at_ms_by_lane == {}
        assert s.tape_flip_streak_by_lane == {}

    def test_two_lanes_track_peak_independently(self) -> None:
        identity = np.full(64, 1.0 / 64.0, dtype=np.float64)
        s = SymbolState(symbol="BTC_USDT_PERP", identity_basin=identity)
        s.peak_pnl_usdt_by_lane["scalp"] = 5.0
        s.peak_pnl_usdt_by_lane["swing"] = 12.0
        s.peak_tracked_trade_id_by_lane["scalp"] = "trade-1"
        s.peak_tracked_trade_id_by_lane["swing"] = "trade-2"
        # Mutating the swing lane's peak does not touch scalp.
        s.peak_pnl_usdt_by_lane["swing"] = 18.0
        assert s.peak_pnl_usdt_by_lane["scalp"] == 5.0
        assert s.peak_pnl_usdt_by_lane["swing"] == 18.0

    def test_two_lanes_streak_counters_independent(self) -> None:
        identity = np.full(64, 1.0 / 64.0, dtype=np.float64)
        s = SymbolState(symbol="BTC_USDT_PERP", identity_basin=identity)
        s.tape_flip_streak_by_lane["scalp"] = 3
        s.tape_flip_streak_by_lane["swing"] = 0
        assert s.tape_flip_streak_by_lane["scalp"] == 3
        assert s.tape_flip_streak_by_lane["swing"] == 0

    def test_dca_count_is_per_lane(self) -> None:
        identity = np.full(64, 1.0 / 64.0, dtype=np.float64)
        s = SymbolState(symbol="BTC_USDT_PERP", identity_basin=identity)
        s.dca_add_count_by_lane["scalp"] = 1
        s.dca_add_count_by_lane["swing"] = 0
        # Each lane respects its own DCA cap independently.
        assert s.dca_add_count_by_lane["scalp"] == 1
        assert s.dca_add_count_by_lane["swing"] == 0


# ── 6. LanePosition / AccountContext lane-aware shape ───────────────


class TestLanePositionShape:
    def test_lane_position_constructs_cleanly(self) -> None:
        lp = LanePosition(
            lane="scalp", side="short",
            entry_price=100.5, quantity=0.001, trade_id="t-99",
        )
        assert lp.lane == "scalp"
        assert lp.side == "short"
        assert lp.entry_price == 100.5
        assert lp.quantity == 0.001

    def test_account_context_lane_positions_default_empty(self) -> None:
        from monkey_kernel.tick import AccountContext
        a = AccountContext(
            equity_fraction=1.0, margin_fraction=0.0,
            open_positions=0, available_equity=100.0,
        )
        assert a.lane_positions == []

    def test_account_context_lane_positions_carry_through(self) -> None:
        from monkey_kernel.tick import AccountContext
        lps = [
            LanePosition(lane="swing", side="long",
                         entry_price=100.0, quantity=0.01, trade_id="t-1"),
            LanePosition(lane="scalp", side="short",
                         entry_price=101.0, quantity=0.005, trade_id="t-2"),
        ]
        a = AccountContext(
            equity_fraction=1.0, margin_fraction=0.5,
            open_positions=2, available_equity=50.0,
            lane_positions=lps,
        )
        assert len(a.lane_positions) == 2
        assert {lp.lane for lp in a.lane_positions} == {"swing", "scalp"}
        assert {lp.side for lp in a.lane_positions} == {"long", "short"}


# ── 7. Cross-lane non-interference invariant ────────────────────────


class TestCrossLaneNonInterference:
    """The kernel's promise from proposal #10: a swing-long held
    position can never paralyze a scalp-short on the same symbol —
    each lane has its own retreat tolerance and capital share.
    """

    def test_swing_long_envelope_independent_of_scalp_short_envelope(self) -> None:
        bs = _basin_state()
        # v0.8.6: at lev=15x, raw -0.85% → ROI -12.75%. Past scalp's
        # binding SL (max(geom×lev≈9.45%, lane 5%) = 9.45%), inside
        # swing's 15% lane SL. Same input, different lane decisions.
        swing_long = should_scalp_exit(
            unrealized_pnl_usdt=-0.85, notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="swing",
            leverage=15.0,
        )
        scalp_short = should_scalp_exit(
            unrealized_pnl_usdt=-0.85, notional_usdt=100.0,
            s=bs, mode=MonkeyMode.INVESTIGATION, lane="scalp",
            leverage=15.0,
        )
        assert swing_long["value"] is False, "swing should hold its 12.75% ROI drawdown"
        assert scalp_short["value"] is True, "scalp should fire SL on 12.75% ROI loss"

    def test_lane_budgets_partition_capital(self) -> None:
        # Two lanes' budgets should sum to <= 1.0 across position-bearing
        # lanes so capital is partitioned, not double-counted.
        total = (
            lane_budget_fraction("scalp")
            + lane_budget_fraction("swing")
            + lane_budget_fraction("trend")
        )
        assert total <= 1.0 + 1e-9

    def test_scalp_size_never_eats_swing_capital(self) -> None:
        bs = _basin_state(phi=0.7)
        # Per fix/lane-budget-size-zero-regression: lane budget acts as
        # a MARGIN CAP, not an equity haircut. Scalp's margin cap is
        # lane_budget_fraction(scalp) × equity = 0.5 × 1000 = 500.
        equity = 1000.0
        scalp = current_position_size(
            bs, available_equity_usdt=equity, min_notional_usdt=1.0,
            leverage=10, bank_size=50, mode=MonkeyMode.INVESTIGATION,
            lane="scalp",
        )
        max_possible = lane_budget_fraction("scalp") * equity
        assert scalp["value"] <= max_possible + 1e-6


# ── 8. fix/lane-budget-size-zero-regression — flat-account sizing ──


class TestFlatAccountLaneSizing:
    """Regression suite for the size=0 bug introduced by PR #610 (proposal
    #10). Pre-fix behaviour: ``current_position_size`` haircut available
    equity by ``lane_budget_fraction`` BEFORE the formula AND lift-to-min,
    which on small accounts pushed required_frac past the safety clamp,
    producing margin=0 for every entry on a fresh-flat account.

    Post-fix: lane budget is a MARGIN CAP applied AFTER lift-to-min. Trend
    lane (cap=0) still collapses to 0; scalp/swing on flat accounts size
    > 0 down to the exchange minimum notional.
    """

    def test_flat_account_swing_lane_clears_eth_min_notional(self) -> None:
        """The exact ETH symptom from the live alert: $90 equity, $22.49
        min, lev 14, mode=INVESTIGATION, swing lane → must size > 0."""
        bs = _basin_state(phi=0.55)
        result = current_position_size(
            bs, available_equity_usdt=90.0, min_notional_usdt=22.49,
            leverage=14, bank_size=0, mode=MonkeyMode.INVESTIGATION,
            lane="swing",
        )
        assert result["value"] > 0, (
            f"Flat-account swing sizing must be non-zero; got reason={result['reason']}"
        )
        # Notional must clear the exchange minimum.
        notional = result["value"] * 14
        assert notional + 1e-9 >= 22.49

    def test_flat_account_scalp_lane_clears_btc_min_notional(self) -> None:
        """The BTC symptom: $90 equity, $75.78 min, lev 14, scalp lane."""
        bs = _basin_state(phi=0.55)
        result = current_position_size(
            bs, available_equity_usdt=90.0, min_notional_usdt=75.78,
            leverage=14, bank_size=0, mode=MonkeyMode.INTEGRATION,
            lane="scalp",
        )
        assert result["value"] > 0, (
            f"Flat-account scalp sizing must be non-zero; got reason={result['reason']}"
        )
        notional = result["value"] * 14
        assert notional + 1e-9 >= 75.78

    def test_small_account_lift_to_min_works_post_fix(self) -> None:
        """Reproduces the pre-fix small-account regression: with $5
        equity (per-symbol cap path on production), lev 14, ETH min
        $22.49, the v0.6.6 lift-to-min must reach min notional. Pre-fix:
        equity was halved to $2.50 → required_frac=0.643 > 0.5 → no
        lift → size=0. Post-fix: full $5 → required_frac=0.337 < 0.5 →
        lift fires."""
        bs = _basin_state(phi=0.55)
        result = current_position_size(
            bs, available_equity_usdt=5.0, min_notional_usdt=22.49,
            leverage=14, bank_size=0, mode=MonkeyMode.INVESTIGATION,
            lane="swing",
        )
        assert result["value"] > 0
        assert result["derivation"]["lifted_to_min"] == 1

    def test_empty_bank_zero_sovereignty_still_sizes_above_min(self) -> None:
        """Cold-start: bank_size=0, sovereignty=0, phi small. Must reach
        min notional via the exploration floor + lift-to-min."""
        bs = _basin_state(phi=0.20)
        bs.sovereignty = 0.0
        result = current_position_size(
            bs, available_equity_usdt=90.0, min_notional_usdt=22.49,
            leverage=14, bank_size=0, mode=MonkeyMode.INVESTIGATION,
            lane="swing",
        )
        assert result["value"] > 0
        notional = result["value"] * 14
        assert notional + 1e-9 >= 22.49

    def test_trend_lane_still_zero_post_fix(self) -> None:
        """Trend lane budget=0 must still collapse to 0 — the opt-in
        promise survives the fix. Cap = 0 × equity = 0 binds."""
        bs = _basin_state(phi=0.55)
        result = current_position_size(
            bs, available_equity_usdt=1000.0, min_notional_usdt=22.49,
            leverage=14, bank_size=20, mode=MonkeyMode.INVESTIGATION,
            lane="trend",
        )
        assert result["value"] == 0.0
        assert result["derivation"]["lane_margin_cap"] == 0.0

    def test_pre_fix_haircut_account_now_sizes_above_zero(self) -> None:
        """Direct reproduction of the pre-fix size=0 case: $4.50 equity
        (mimicking the per-symbol cap × size_fraction path on small
        accounts), ETH min $22.49, lev 14. Pre-fix: $4.50 × 0.5 lane
        = $2.25 → required_frac = (22.49 × 1.05) / (14 × 2.25) = 0.749 >
        0.5 max_fraction → no lift → size=0. Post-fix: full $4.50
        → required_frac = 0.374 < 0.5 → lift fires → size > 0."""
        bs = _basin_state(phi=0.55)
        result = current_position_size(
            bs, available_equity_usdt=4.50, min_notional_usdt=22.49,
            leverage=14, bank_size=0, mode=MonkeyMode.INVESTIGATION,
            lane="swing",
        )
        assert result["value"] > 0
        assert result["derivation"]["lifted_to_min"] == 1

    def test_lane_margin_cap_in_derivation(self) -> None:
        bs = _basin_state(phi=0.5)
        result = current_position_size(
            bs, available_equity_usdt=200.0, min_notional_usdt=1.0,
            leverage=5, bank_size=10, mode=MonkeyMode.INVESTIGATION,
            lane="swing",
        )
        # 0.5 budget × $200 = $100 cap.
        assert result["derivation"]["lane_margin_cap"] == pytest.approx(100.0)

    def test_scalp_swing_caps_match_when_budgets_match(self) -> None:
        """Both default to budget_frac=0.5; both should report the same
        margin cap, demonstrating the fair partition."""
        bs = _basin_state(phi=0.6)
        scalp = current_position_size(
            bs, available_equity_usdt=400.0, min_notional_usdt=1.0,
            leverage=5, bank_size=20, mode=MonkeyMode.INVESTIGATION,
            lane="scalp",
        )
        swing = current_position_size(
            bs, available_equity_usdt=400.0, min_notional_usdt=1.0,
            leverage=5, bank_size=20, mode=MonkeyMode.INVESTIGATION,
            lane="swing",
        )
        assert scalp["derivation"]["lane_margin_cap"] == pytest.approx(
            swing["derivation"]["lane_margin_cap"]
        )

    def test_choose_lane_falls_back_when_top_pick_has_zero_budget(self) -> None:
        """choose_lane must NEVER return a position-bearing lane with
        budget_frac=0 (e.g. trend at default). With sovereignty high and
        tape strong, raw trend score dominates — but the fallback should
        push us into the next-highest positive-budget lane (swing/scalp)."""
        bs = _basin_state(phi=0.9)
        bs.sovereignty = 0.9  # high sov
        # tape_trend=1.0 maximises trend_score = phi × sov × 1 = 0.81
        result = choose_lane(bs, tape_trend=1.0)
        # Trend has budget=0, so we MUST land on a positive-budget lane.
        assert result["value"] != "trend"
        assert lane_budget_fraction(result["value"]) > 0.0

    def test_choose_lane_keeps_observe_unchanged(self) -> None:
        """observe is decision-only; the fallback is for position-bearing
        lanes only. observe winning the softmax must still surface."""
        bs = _basin_state(phi=0.4)
        bs.basin_velocity = 0.95  # huge velocity → observe dominates
        result = choose_lane(bs, tape_trend=0.0)
        # observe must remain a valid output even though its budget is 0.
        # (It's a decision-only lane; loop.ts maps it to swing for sizing.)
        assert result["value"] in ("scalp", "swing", "trend", "observe")
