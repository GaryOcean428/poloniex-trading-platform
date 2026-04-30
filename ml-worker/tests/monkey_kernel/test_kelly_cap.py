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

    def test_break_even_returns_min(self):
        # 50% win rate, equal payoff -> f* = 0 -> cap = 1.
        cap = kelly_leverage_cap(p_win=0.5, avg_win=1.0, avg_loss=-1.0, max_lev=40)
        assert cap == 1.0

    def test_negative_expectancy_returns_min(self):
        # Win rate too low for the payoff.
        cap = kelly_leverage_cap(p_win=0.30, avg_win=1.0, avg_loss=-1.0, max_lev=40)
        assert cap == 1.0

    def test_no_losses_returns_max(self):
        # Edge: no losses recorded -> Kelly is unbounded; defer to
        # geometric formula by returning max_lev.
        cap = kelly_leverage_cap(p_win=1.0, avg_win=2.0, avg_loss=0.0, max_lev=40)
        assert cap == 40.0

    def test_no_wins_returns_min(self):
        cap = kelly_leverage_cap(p_win=0.0, avg_win=2.0, avg_loss=-1.0, max_lev=40)
        assert cap == 1.0

    def test_zero_avg_win_returns_min(self):
        cap = kelly_leverage_cap(p_win=0.5, avg_win=0.0, avg_loss=-1.0, max_lev=40)
        assert cap == 1.0

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

    def test_loss_dominated_session(self):
        # avg_loss > avg_win, p=0.5 -> negative expectancy -> 1.
        cap = kelly_leverage_cap(p_win=0.50, avg_win=0.05, avg_loss=-0.50, max_lev=40)
        assert cap == 1.0

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
        cap = kelly_leverage_cap(p_win=0.5, avg_win=1.0, avg_loss=-1.0, max_lev=10)
        # Break-even -> f* = 0 -> cap = 1.
        assert cap == 1.0

    @pytest.mark.parametrize(
        "p,avg_win,avg_loss,expected_le",
        [
            (0.99, 10.0, -0.1, 40.0),  # max
            (0.5, 1.0, -1.0, 1.0),     # break-even
            (0.0, 1.0, -1.0, 1.0),     # no wins
            (0.6, 1.5, -1.0, 40.0),
        ],
    )
    def test_never_exceeds_max(self, p, avg_win, avg_loss, expected_le):
        cap = kelly_leverage_cap(p_win=p, avg_win=avg_win, avg_loss=avg_loss, max_lev=40)
        assert cap <= expected_le

    def test_monotonic_in_winrate(self):
        # Holding payoff fixed, higher winrate -> higher cap.
        prev = kelly_leverage_cap(p_win=0.0, avg_win=2.0, avg_loss=-1.0, max_lev=40)
        for p in [0.2, 0.4, 0.6, 0.8, 1.0]:
            cur = kelly_leverage_cap(p_win=p, avg_win=2.0, avg_loss=-1.0, max_lev=40)
            assert cur >= prev
            prev = cur


class TestCurrentLeverageWithKellyCap:
    """End-to-end: verify that ``current_leverage`` honors the cap."""

    def test_kelly_cap_lowers_leverage_when_winrate_low(self):
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
        # No rolling stats -> kelly_cap = max_lev, no extra clamp.
        no_kelly = current_leverage(s, max_leverage_boundary=40)
        # With break-even rolling stats -> kelly_cap = 1.
        kelly_clamped = current_leverage(
            s, max_leverage_boundary=40,
            rolling_win_rate=0.5, rolling_avg_win=1.0, rolling_avg_loss=-1.0,
        )
        assert kelly_clamped["value"] <= no_kelly["value"]
        assert kelly_clamped["value"] >= 1
        assert "kelly_cap" in kelly_clamped["derivation"]

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
