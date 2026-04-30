"""Tests for ``kelly_leverage_cap`` (proposal #3)."""
from __future__ import annotations

import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.executive import kelly_leverage_cap  # noqa: E402


class TestKellyLeverageCap:
    def test_high_winrate_high_payoff(self):
        # 70% win rate, avg_win 2 vs avg_loss 1 -> b=2, q=0.3, p=0.7.
        # f* = (0.7*2 - 0.3) / 2 = 1.1/2 = 0.55. cap = 0.55*40 = 22.
        cap = kelly_leverage_cap(p_win=0.7, avg_win=2.0, avg_loss=-1.0, max_lev=40)
        assert cap == pytest.approx(22.0, abs=1)

    def test_break_even_defers_to_geometric(self):
        # 50% win rate, equal payoff -> f* = 0 -> Kelly is uninformative
        # -> return max_lev so the geometric formula stands.
        # Pre-fix this returned 1.0 and crushed leverage on small
        # accounts even though regime/κ/surprise had not flagged risk.
        cap = kelly_leverage_cap(p_win=0.5, avg_win=1.0, avg_loss=-1.0, max_lev=40)
        assert cap == 40.0

    def test_negative_expectancy_defers_to_geometric(self):
        # Win rate too low for the payoff -> f* < 0 -> uninformative.
        # Pre-fix returned 1.0; now returns max_lev so leverage stays
        # tradable. The geometric formula's regime/κ/surprise
        # discounts already handle "bad market" — Kelly should not
        # double-clamp.
        cap = kelly_leverage_cap(p_win=0.30, avg_win=1.0, avg_loss=-1.0, max_lev=40)
        assert cap == 40.0

    def test_no_losses_returns_max(self):
        # Edge: no losses recorded -> Kelly is unbounded; defer to
        # geometric formula by returning max_lev.
        cap = kelly_leverage_cap(p_win=1.0, avg_win=2.0, avg_loss=0.0, max_lev=40)
        assert cap == 40.0

    def test_no_wins_defers_to_geometric(self):
        # All losses -> Kelly is uninformative for sizing UP. Pre-fix
        # this returned 1; now returns max_lev (no-op) — geometric
        # formula already discounts via regime/surprise.
        cap = kelly_leverage_cap(p_win=0.0, avg_win=2.0, avg_loss=-1.0, max_lev=40)
        assert cap == 40.0

    def test_zero_avg_win_defers_to_geometric(self):
        cap = kelly_leverage_cap(p_win=0.5, avg_win=0.0, avg_loss=-1.0, max_lev=40)
        assert cap == 40.0

    def test_caps_at_max_when_kelly_says_full(self):
        # f* > 1 should clamp to 1, giving cap = max_lev.
        cap = kelly_leverage_cap(p_win=0.99, avg_win=10.0, avg_loss=-0.1, max_lev=40)
        assert cap == 40.0

    def test_returns_at_least_one(self):
        cap = kelly_leverage_cap(p_win=0.51, avg_win=0.01, avg_loss=-1.0, max_lev=40)
        assert cap >= 1.0

    def test_user_observed_session_mapping(self):
        # User's session today: 71% win rate, avg_win 0.24 vs avg_loss 0.05.
        # b = 4.8, p = 0.71, q = 0.29. f* = (0.71*4.8 - 0.29)/4.8 = 0.65.
        # cap = round(0.65 * 40) = 26 -> Kelly says no need to cap below
        # the geometric output.
        cap = kelly_leverage_cap(p_win=0.71, avg_win=0.24, avg_loss=-0.05, max_lev=40)
        assert cap == pytest.approx(26.0, abs=1)

    def test_loss_dominated_session_defers_to_geometric(self):
        # avg_loss > avg_win, p=0.5 -> negative expectancy. Pre-fix
        # this returned 1; now returns max_lev (Kelly uninformative,
        # geometric formula already handles regime risk).
        cap = kelly_leverage_cap(p_win=0.50, avg_win=0.05, avg_loss=-0.50, max_lev=40)
        assert cap == 40.0

    def test_returns_float(self):
        cap = kelly_leverage_cap(p_win=0.6, avg_win=1.5, avg_loss=-1.0, max_lev=40)
        assert isinstance(cap, float)

    def test_avg_loss_can_be_positive_or_negative(self):
        # Function uses abs(avg_loss); negative or positive doesn't
        # matter.
        cap_neg = kelly_leverage_cap(p_win=0.7, avg_win=2.0, avg_loss=-1.0, max_lev=40)
        cap_pos = kelly_leverage_cap(p_win=0.7, avg_win=2.0, avg_loss=1.0, max_lev=40)
        assert cap_neg == cap_pos

    def test_max_lev_bound(self):
        # Break-even -> f* = 0 -> uninformative -> cap = max_lev = 10.
        cap = kelly_leverage_cap(p_win=0.5, avg_win=1.0, avg_loss=-1.0, max_lev=10)
        assert cap == 10.0

    def test_floor_prevents_tiny_edge_collapse(self):
        # Tiny positive Kelly fraction shouldn't crush leverage to 1.
        # Pre-fix: f*=0.05 × 40 = 2 -> cap=2 (untradeable on small
        # accounts). Post-fix: floored at KELLY_CAP_TRADABLE_FLOOR=8.
        # b = 0.6 / 0.5 = 1.2; f* = (0.51*1.2 - 0.49)/1.2 = 0.0983.
        # raw_cap = round(0.0983 * 40) = 4. Floored to 8.
        cap = kelly_leverage_cap(p_win=0.51, avg_win=0.6, avg_loss=-0.5, max_lev=40)
        assert cap >= 8.0
        assert cap <= 40.0

    def test_floor_bounded_by_max_lev(self):
        # If max_lev is below the floor, the cap must not exceed
        # max_lev. The floor is a safety bound on tradability — the
        # exchange boundary still wins.
        cap = kelly_leverage_cap(p_win=0.51, avg_win=0.6, avg_loss=-0.5, max_lev=5)
        assert cap <= 5.0
        assert cap >= 1.0

    @pytest.mark.parametrize(
        "p,avg_win,avg_loss,expected_le",
        [
            (0.99, 10.0, -0.1, 40.0),  # max
            (0.5, 1.0, -1.0, 40.0),    # break-even (now defers)
            (0.0, 1.0, -1.0, 40.0),    # no wins (now defers)
            (0.6, 1.5, -1.0, 40.0),
        ],
    )
    def test_never_exceeds_max(self, p, avg_win, avg_loss, expected_le):
        cap = kelly_leverage_cap(p_win=p, avg_win=avg_win, avg_loss=avg_loss, max_lev=40)
        assert cap <= expected_le

    def test_monotonic_in_winrate_when_informative(self):
        # Once Kelly is informative (positive edge), higher winrate
        # -> higher cap. Below the positive-edge threshold the cap
        # is the no-op max_lev (uninformative). We only assert
        # monotonicity within the informative regime.
        # b = 2; p_win = q/(b+1) = 0.333 is break-even.
        # So p in {0.4, 0.6, 0.8, 1.0} are all positive edge.
        prev = None
        for p in [0.4, 0.6, 0.8, 1.0]:
            cur = kelly_leverage_cap(p_win=p, avg_win=2.0, avg_loss=-1.0, max_lev=40)
            if prev is not None:
                assert cur >= prev, f"non-monotonic: p={p}, cur={cur}, prev={prev}"
            prev = cur


class TestCurrentLeverageWithKellyCap:
    """End-to-end: verify that ``current_leverage`` honors the cap."""

    def test_kelly_cap_break_even_defers_to_geometric(self):
        # Post-fix: break-even Kelly stats are UNINFORMATIVE — the
        # cap returns max_lev so the geometric formula stands. This
        # is the fix for the live-trading "leverage stuck at 1" bug.
        from monkey_kernel.state import NeurochemicalState
        from monkey_kernel.executive import current_leverage, ExecBasinState

        nc = NeurochemicalState(
            acetylcholine=0.5, dopamine=0.5, serotonin=0.5,
            norepinephrine=0.0, gaba=0.5, endorphins=0.5,
        )
        import numpy as np
        b = np.full(64, 1 / 64)
        s = ExecBasinState(
            basin=b, identity_basin=b,
            kappa=64.0, basin_velocity=0.0, sovereignty=0.7,
            phi=0.5, regime_weights={"equilibrium": 1.0, "efficient": 0.0, "quantum": 0.0},
            neurochemistry=nc,
        )
        no_kelly = current_leverage(s, max_leverage_boundary=40)
        # With break-even rolling stats -> kelly_cap defers to max_lev.
        kelly_neutral = current_leverage(
            s, max_leverage_boundary=40,
            rolling_win_rate=0.5, rolling_avg_win=1.0, rolling_avg_loss=-1.0,
        )
        # Equal — Kelly is a no-op when uninformative.
        assert kelly_neutral["value"] == no_kelly["value"]
        assert kelly_neutral["derivation"]["kelly_cap"] == 40.0

    def test_kelly_cap_caps_when_edge_meaningful(self):
        # Confirm Kelly STILL acts as a cap when it has informative
        # data. With f*=0.55 and max_lev=100, cap = round(55) = 55,
        # while geometric formula at sov=0.7, eq=1.0 gives ~22 (modest).
        # When max_lev is the binding constraint, Kelly cap should
        # never exceed the geometric output's right to be lower.
        from monkey_kernel.state import NeurochemicalState
        from monkey_kernel.executive import current_leverage, ExecBasinState

        nc = NeurochemicalState(
            acetylcholine=0.5, dopamine=0.5, serotonin=0.5,
            norepinephrine=0.0, gaba=0.5, endorphins=0.5,
        )
        import numpy as np
        b = np.full(64, 1 / 64)
        s = ExecBasinState(
            basin=b, identity_basin=b,
            kappa=64.0, basin_velocity=0.0, sovereignty=0.7,
            phi=0.5, regime_weights={"equilibrium": 1.0, "efficient": 0.0, "quantum": 0.0},
            neurochemistry=nc,
        )
        # Strong-but-not-max edge: f* ~= 0.55, max_lev=100 -> cap ~= 55.
        out = current_leverage(
            s, max_leverage_boundary=100,
            rolling_win_rate=0.7, rolling_avg_win=2.0, rolling_avg_loss=-1.0,
        )
        # Cap is informative and finite — not the no-op max_lev.
        assert out["derivation"]["kelly_cap"] < 100
        assert out["derivation"]["kelly_cap"] >= 8  # floor

    def test_kelly_cap_no_clamp_when_no_stats(self):
        from monkey_kernel.state import NeurochemicalState
        from monkey_kernel.executive import current_leverage, ExecBasinState

        nc = NeurochemicalState(
            acetylcholine=0.5, dopamine=0.5, serotonin=0.5,
            norepinephrine=0.0, gaba=0.5, endorphins=0.5,
        )
        import numpy as np
        b = np.full(64, 1 / 64)
        s = ExecBasinState(
            basin=b, identity_basin=b,
            kappa=64.0, basin_velocity=0.0, sovereignty=0.7,
            phi=0.5, regime_weights={"equilibrium": 1.0, "efficient": 0.0, "quantum": 0.0},
            neurochemistry=nc,
        )
        out = current_leverage(s, max_leverage_boundary=40)
        # kelly_cap derivation field present, equal to max_lev when no
        # rolling stats supplied.
        assert out["derivation"]["kelly_cap"] == 40.0

    def test_kelly_cap_lifts_leverage_with_strong_edge(self):
        from monkey_kernel.state import NeurochemicalState
        from monkey_kernel.executive import current_leverage, ExecBasinState

        nc = NeurochemicalState(
            acetylcholine=0.5, dopamine=0.5, serotonin=0.5,
            norepinephrine=0.0, gaba=0.5, endorphins=0.5,
        )
        import numpy as np
        b = np.full(64, 1 / 64)
        s = ExecBasinState(
            basin=b, identity_basin=b,
            kappa=64.0, basin_velocity=0.0, sovereignty=0.7,
            phi=0.5, regime_weights={"equilibrium": 1.0, "efficient": 0.0, "quantum": 0.0},
            neurochemistry=nc,
        )
        # Strong edge -> kelly_cap is high -> doesn't reduce leverage.
        strong = current_leverage(
            s, max_leverage_boundary=40,
            rolling_win_rate=0.99, rolling_avg_win=10.0, rolling_avg_loss=-0.1,
        )
        assert strong["derivation"]["kelly_cap"] == 40.0


class TestLiveTradingLeverageOneRegression:
    """Regression tests for the 2026-04-30 'leverage stuck at 1' bug.

    Root cause: kelly_leverage_cap returned 1 when edge was weak/
    negative (break-even, no wins, negative expectancy). The final
    clamp ``min(geometric, kelly, max)`` then forced lev=1 regardless
    of what the geometric formula said. This cascaded into
    currentPositionSize: margin × 1 < min_notional → size=0 → no
    entries placed for hours.

    Live diag (PR #612 commit a5c0fe1):
        availableEquity=37.46, sov=1, mode=INVESTIGATION,
        leverage=1 (expected ~16), notional=$3.37 < $76 BTC min.
    """

    def _flat_account_state(self, sovereignty: float = 1.0):
        from monkey_kernel.state import NeurochemicalState
        from monkey_kernel.executive import ExecBasinState
        import numpy as np

        nc = NeurochemicalState(
            acetylcholine=0.5, dopamine=0.5, serotonin=1.0,
            norepinephrine=0.0, gaba=0.5, endorphins=0.5,
        )
        b = np.full(64, 1 / 64)
        return ExecBasinState(
            basin=b, identity_basin=b,
            kappa=64.0, basin_velocity=0.0, sovereignty=sovereignty,
            phi=0.215,
            regime_weights={"equilibrium": 0.41, "efficient": 0.16, "quantum": 0.43},
            neurochemistry=nc,
        )

    def test_cold_start_no_kelly_engaged(self):
        # bankSize=2 simulated: rolling stats are None (caller
        # already returns None when closed_trades < 5). Geometric
        # formula must produce a tradable leverage.
        from monkey_kernel.executive import current_leverage
        from monkey_kernel.modes import MonkeyMode

        s = self._flat_account_state(sovereignty=1.0)
        out = current_leverage(
            s, max_leverage_boundary=45,
            mode=MonkeyMode.INVESTIGATION, tape_trend=0.0,
            rolling_win_rate=None, rolling_avg_win=None, rolling_avg_loss=None,
        )
        # Geometric: sovcap=33 × kappa_proxim=1 × regstab=0.49 × surp=1
        # × flat_mult ~= 16. Must be tradable, never collapse to 1.
        assert out["value"] >= 10, (
            f"Expected lev >= 10 (geometric formula), got {out['value']}. "
            f"Reason: {out['reason']}"
        )
        # Kelly cap must be a no-op (= max_leverage_boundary).
        assert out["derivation"]["kelly_cap"] == 45.0

    def test_5_trades_break_even_does_not_crush_leverage(self):
        # bankSize=10 simulated: rolling stats present but uninformative
        # (50/50 win rate, equal avg). Pre-fix this returned cap=1
        # → lev=1. Post-fix: Kelly defers to geometric.
        from monkey_kernel.executive import current_leverage
        from monkey_kernel.modes import MonkeyMode

        s = self._flat_account_state(sovereignty=1.0)
        out = current_leverage(
            s, max_leverage_boundary=45,
            mode=MonkeyMode.INVESTIGATION, tape_trend=0.0,
            rolling_win_rate=0.5, rolling_avg_win=1.0, rolling_avg_loss=-1.0,
        )
        assert out["value"] >= 10, (
            f"Expected lev >= 10 even with break-even Kelly stats, "
            f"got {out['value']}. Reason: {out['reason']}"
        )

    def test_5_trades_negative_edge_does_not_crush_leverage(self):
        # Negative-edge rolling stats. Pre-fix: cap=1 → lev=1.
        # Post-fix: Kelly defers (uninformative for capping UP).
        # Geometric formula's regime/κ/surprise discount handles
        # actual market risk; Kelly should not double-clamp.
        from monkey_kernel.executive import current_leverage
        from monkey_kernel.modes import MonkeyMode

        s = self._flat_account_state(sovereignty=1.0)
        out = current_leverage(
            s, max_leverage_boundary=45,
            mode=MonkeyMode.INVESTIGATION, tape_trend=0.0,
            rolling_win_rate=0.30, rolling_avg_win=1.0, rolling_avg_loss=-1.0,
        )
        assert out["value"] >= 10, (
            f"Expected lev >= 10 even with negative-edge Kelly stats, "
            f"got {out['value']}. Reason: {out['reason']}"
        )

    def test_kelly_engaged_with_meaningful_edge(self):
        # bankSize=10, real positive edge — Kelly cap should still
        # act as a CAP (binding when geometric would exceed it).
        # f* = (0.7*2 - 0.3)/2 = 0.55 → cap = round(0.55*45) = 25.
        from monkey_kernel.executive import current_leverage
        from monkey_kernel.modes import MonkeyMode

        s = self._flat_account_state(sovereignty=1.0)
        out = current_leverage(
            s, max_leverage_boundary=45,
            mode=MonkeyMode.INVESTIGATION, tape_trend=0.0,
            rolling_win_rate=0.7, rolling_avg_win=2.0, rolling_avg_loss=-1.0,
        )
        # Kelly cap is meaningful: between floor (8) and max_lev (45).
        assert 8 <= out["derivation"]["kelly_cap"] <= 45
        # Final lev is the min of geometric and cap.
        assert out["value"] >= 8


class TestPositionSizeRegressionLiveScenario:
    """Regression: with the leverage fix, position size on a flat
    account ($37 equity, BTC $76 min notional) lifts above zero.
    """

    def test_size_above_zero_with_correct_leverage(self):
        # Simulate the exact live diag inputs from PR #612 commit
        # a5c0fe1, with the corrected leverage value (lev=16 instead
        # of 1). Lift-to-min should now succeed: requiredFrac =
        # (76 * 1.05) / (16 * 37.46) = 0.133, well within the 0.5
        # safety clamp.
        from monkey_kernel.executive import (
            current_position_size, ExecBasinState,
        )
        from monkey_kernel.state import NeurochemicalState
        from monkey_kernel.modes import MonkeyMode
        import numpy as np

        nc = NeurochemicalState(
            acetylcholine=0.5, dopamine=0.5, serotonin=1.0,
            norepinephrine=0.0, gaba=0.57, endorphins=0.5,
        )
        b = np.full(64, 1 / 64)
        s = ExecBasinState(
            basin=b, identity_basin=b,
            kappa=64.0, basin_velocity=0.0, sovereignty=1.0,
            phi=0.215,
            regime_weights={"equilibrium": 0.41, "efficient": 0.16, "quantum": 0.43},
            neurochemistry=nc,
        )
        out = current_position_size(
            s,
            available_equity_usdt=37.46,
            min_notional_usdt=76.06,
            leverage=16,  # correct value with fix
            bank_size=2,
            mode=MonkeyMode.INVESTIGATION,
            lane="swing",
        )
        assert out["value"] > 0, (
            f"Expected size > 0 with leverage=16 (vs 1 in live bug), "
            f"got {out['value']}. Reason: {out['reason']}"
        )
        # Notional must clear min.
        margin = out["derivation"]["margin"]
        notional = margin * 16
        assert notional >= 76.06
