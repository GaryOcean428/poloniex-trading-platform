"""test_ocean_reward.py — 2026-05-28 cleaned (legacy 1% Fib removed per
DeadCodeInspector + acting subagent + P24 + profitable net ops mandate).

Now tests ONLY the live observer-derived path (observer_fib_coefficient)
+ trail functions. Citations: 2026-05-28_polo-authoritative... + reward-source
lesson (LIVED net profit + source tags), agents.md QIG PURITY MANDATE,
impl-3 (observer max/derived), user-directive surfaces 17-23 (self-obs equity
impact wired via telemetry surface), compliance-assessment P24 closure.

LIVED ONLY 5: tests include negative cases (non-finite, cold history, z<=0).
"""

import math
import os
import sys
import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.ocean_reward import (  # noqa: E402
    TRAIL_TIERS,
    observer_fib_coefficient,
    ocean_trail_retracement,
    ocean_trail_tier_index,
    reward_rpe_deltas,
)


class TestObserverFibCoefficient:
    """Live P1/P25 observer-derived (median/MAD z-dev from LIVED history;
    uses net pnl_frac post-#992 polo_authoritative). No gross pre-fees.
    """

    def test_cold_start_positive(self):
        assert observer_fib_coefficient(0.01, []) == 1
        assert observer_fib_coefficient(0.0, [0.001]) == 0

    def test_non_finite_returns_zero(self):
        assert observer_fib_coefficient(float("nan"), [0.1, 0.2]) == 0
        assert observer_fib_coefficient(float("inf"), [0.1, 0.2]) == 0

    def test_negative_z_still_maps_to_tier(self):
        hist = [0.001, 0.002, 0.003]
        assert observer_fib_coefficient(0.0001, hist) >= 1

    def test_positive_z_yields_fib(self):
        hist = [0.0001, 0.0002, 0.0003, 0.0004]
        # median ~0.00025, mad small; high positive z -> higher tier
        tier = observer_fib_coefficient(0.01, hist)
        assert tier >= 1


class TestTrailFunctions:
    def test_trail_tiers_and_index(self):
        assert TRAIL_TIERS == (0.03, 0.05, 0.08, 0.13, 0.21)
        assert ocean_trail_retracement(0) == 0.03
        assert ocean_trail_tier_index(5) == 4
        assert ocean_trail_retracement(float("nan")) == 0.03  # fail-closed
        assert ocean_trail_tier_index(-1) == 0


class TestRewardRpeDeltas:
    def test_reward_rpe_transform_matches_fixture(self):
        out = reward_rpe_deltas(
            pnl_frac=0.02,
            predicted_pnl_frac=0.01,
            sigma_residual=0.005,
            tonic_baseline=0.4,
            serotonin_disposition=0.6,
            legibility=0.75,
        )
        assert out["valid"] == 1.0
        assert out["phasic_rpe"] == pytest.approx(2.0, abs=1e-12)
        assert out["dopamine_delta"] == pytest.approx(1.36402758, abs=1e-6)
        assert out["norepinephrine_delta"] == pytest.approx(0.96402758, abs=1e-6)
        assert out["acetylcholine_delta"] == pytest.approx(0.72302069, abs=1e-6)
        assert out["serotonin_delta"] == pytest.approx(0.6, abs=1e-12)
        assert out["endorphin_delta"] == pytest.approx(0.0, abs=1e-12)

    def test_relief_fires_for_better_than_predicted_bad_outcome(self):
        out = reward_rpe_deltas(
            pnl_frac=-0.01,
            predicted_pnl_frac=-0.03,
            sigma_residual=0.01,
            tonic_baseline=0.2,
            serotonin_disposition=0.4,
            legibility=1.0,
        )
        assert out["valid"] == 1.0
        assert out["endorphin_delta"] == pytest.approx(math.tanh(0.02), abs=1e-12)

    def test_invalid_inputs_fail_closed(self):
        out = reward_rpe_deltas(
            pnl_frac=float("nan"),
            predicted_pnl_frac=0.0,
            sigma_residual=1.0,
            tonic_baseline=0.1,
            serotonin_disposition=0.2,
            legibility=0.3,
        )
        assert out == {"valid": 0.0}


class TestOceanTrailRetracement:
    """Matrix tier-3 doctrine extension (2026-05-26) — Ocean trail/SL
    tier picker. Parity tests against the TS implementation. (Legacy fib tests
    cleaned 2026-05-28; only live observer + trail remain per P24 + net profit.)"""

    def test_trail_tiers_const_is_the_canonical_subset(self):
        assert TRAIL_TIERS == (0.03, 0.05, 0.08, 0.13, 0.21)

    def test_streak_zero_returns_tightest_tier(self):
        # Fresh entry / no coherent-tick history → 3% retracement
        assert ocean_trail_retracement(0) == 0.03
        assert ocean_trail_tier_index(0) == 0

    def test_streak_one_through_four(self):
        assert ocean_trail_retracement(1) == 0.05
        assert ocean_trail_retracement(2) == 0.08
        assert ocean_trail_retracement(3) == 0.13
        assert ocean_trail_retracement(4) == 0.21

    def test_streak_at_or_above_five_caps_at_loosest(self):
        # Sustained coherence beyond 5 ticks doesn't widen further —
        # harvest gate owns the upper bound from there.
        assert ocean_trail_retracement(5) == 0.21
        assert ocean_trail_retracement(100) == 0.21
        assert ocean_trail_retracement(1_000_000) == 0.21

    def test_negative_streak_returns_tightest(self):
        # Defensive — caller should never pass a negative streak.
        assert ocean_trail_retracement(-1) == 0.03
        assert ocean_trail_retracement(-100) == 0.03

    def test_nan_returns_tightest(self):
        assert ocean_trail_retracement(float("nan")) == 0.03
        assert ocean_trail_tier_index(float("nan")) == 0

    def test_positive_infinity_returns_tightest_fail_closed(self):
        # Defensive: int(float('inf')) raises OverflowError. Without the
        # math.isfinite() guard this would crash the kernel. Falling back
        # to the tightest tier matches the TS implementation.
        assert ocean_trail_retracement(float("inf")) == 0.03
        assert ocean_trail_tier_index(float("inf")) == 0

    def test_negative_infinity_returns_tightest_fail_closed(self):
        assert ocean_trail_retracement(float("-inf")) == 0.03
        assert ocean_trail_tier_index(float("-inf")) == 0

    def test_fractional_streak_rounds_down(self):
        # Streak counts whole ticks; fractional inputs (which shouldn't
        # occur from the kernel but guards against future drift) take
        # the floor of the value.
        assert ocean_trail_retracement(1.9) == 0.05
        assert ocean_trail_retracement(3.99) == 0.13

    def test_tier_subset_is_fibonacci_4_through_8_as_percentages(self):
        # F(4)=3, F(5)=5, F(6)=8, F(7)=13, F(8)=21. This is the
        # structural identity that makes "Fibonacci" load-bearing.
        as_percents = tuple(round(t * 100) for t in TRAIL_TIERS)
        assert as_percents == (3, 5, 8, 13, 21)

    def test_discrete_selection_only(self):
        # Across a range of streak values, the function returns exactly
        # |TRAIL_TIERS| distinct outputs — proof there is no
        # interpolation between adjacent tiers.
        outputs = {ocean_trail_retracement(s) for s in range(20)}
        assert outputs == set(TRAIL_TIERS)
