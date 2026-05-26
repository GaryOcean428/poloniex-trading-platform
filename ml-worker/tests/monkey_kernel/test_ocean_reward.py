"""test_ocean_reward.py — Issue #948 Python parity tests.

Pins identical Fibonacci shape + 1% noise floor on the Python side.
"""

import math
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.ocean_reward import (  # noqa: E402
    TRAIL_TIERS,
    fibonacci_reward_coefficient,
    fibonacci_reward_tier,
    ocean_trail_retracement,
    ocean_trail_tier_index,
)


class TestOneNoiseFloor:
    def test_zero_below_one_percent(self):
        assert fibonacci_reward_coefficient(0.0) == 0
        assert fibonacci_reward_coefficient(0.001) == 0
        assert fibonacci_reward_coefficient(0.005) == 0
        assert fibonacci_reward_coefficient(0.0099) == 0

    def test_zero_on_losses(self):
        # Negative ROI falls through to the gaba path in autonomic.push_reward;
        # this function returns 0 for negative inputs so it never accidentally
        # amplifies a loss into the positive-chemistry channel.
        assert fibonacci_reward_coefficient(-0.01) == 0
        assert fibonacci_reward_coefficient(-0.5) == 0

    def test_zero_on_nan(self):
        assert fibonacci_reward_coefficient(float("nan")) == 0

    def test_zero_on_inf_ts_parity(self):
        # TS uses Number.isFinite() which rejects +/-inf -> return 0.
        # math.isnan() alone would let +inf fall through to the 34 cap,
        # which is a cross-kernel parity violation (TS returns 0).
        assert fibonacci_reward_coefficient(float("inf")) == 0
        assert fibonacci_reward_coefficient(float("-inf")) == 0
        assert fibonacci_reward_tier(float("inf")) == 0
        assert fibonacci_reward_tier(float("-inf")) == 0

    def test_first_nonzero_tier_at_one_percent(self):
        assert fibonacci_reward_coefficient(0.01) == 1


class TestFibonacciBoundaries:
    def test_bucket_1_to_2_percent_returns_1(self):
        assert fibonacci_reward_coefficient(0.01) == 1
        assert fibonacci_reward_coefficient(0.015) == 1
        assert fibonacci_reward_coefficient(0.019) == 1

    def test_bucket_2_to_3_percent_returns_2(self):
        assert fibonacci_reward_coefficient(0.02) == 2
        assert fibonacci_reward_coefficient(0.025) == 2

    def test_bucket_3_to_5_percent_returns_3(self):
        assert fibonacci_reward_coefficient(0.03) == 3
        assert fibonacci_reward_coefficient(0.045) == 3

    def test_bucket_5_to_8_percent_returns_5(self):
        assert fibonacci_reward_coefficient(0.05) == 5
        assert fibonacci_reward_coefficient(0.075) == 5

    def test_bucket_8_to_13_percent_returns_8(self):
        assert fibonacci_reward_coefficient(0.08) == 8
        assert fibonacci_reward_coefficient(0.12) == 8

    def test_bucket_13_to_21_percent_returns_13(self):
        assert fibonacci_reward_coefficient(0.13) == 13
        assert fibonacci_reward_coefficient(0.20) == 13

    def test_bucket_21_to_34_percent_returns_21(self):
        assert fibonacci_reward_coefficient(0.21) == 21
        assert fibonacci_reward_coefficient(0.33) == 21

    def test_above_34_percent_capped_at_34(self):
        # Beyond 34% is lucky tape; don't over-train on outliers.
        assert fibonacci_reward_coefficient(0.34) == 34
        assert fibonacci_reward_coefficient(0.50) == 34
        assert fibonacci_reward_coefficient(1.0) == 34
        assert fibonacci_reward_coefficient(10.0) == 34


class TestSequenceIdentity:
    def test_coefficient_sequence_is_fibonacci(self):
        # The structural identity that makes "Fibonacci" load-bearing.
        coefficients = [
            fibonacci_reward_coefficient(roi)
            for roi in (0.01, 0.02, 0.03, 0.05, 0.08, 0.13, 0.21, 0.34)
        ]
        assert coefficients == [1, 2, 3, 5, 8, 13, 21, 34]

    def test_each_bucket_opens_at_its_own_fibonacci_number(self):
        # Reading at the boundary value (1%, 2%, 3%, 5%, 8%, 13%, 21%, 34%)
        # returns the SAME Fibonacci number. The boundaries and the
        # magnitudes share the sequence.
        assert fibonacci_reward_coefficient(0.01) == 1
        assert fibonacci_reward_coefficient(0.02) == 2
        assert fibonacci_reward_coefficient(0.03) == 3
        assert fibonacci_reward_coefficient(0.05) == 5
        assert fibonacci_reward_coefficient(0.08) == 8
        assert fibonacci_reward_coefficient(0.13) == 13
        assert fibonacci_reward_coefficient(0.21) == 21
        assert fibonacci_reward_coefficient(0.34) == 34


class TestTierIndex:
    def test_tier_zero_below_one_percent(self):
        assert fibonacci_reward_tier(0.0) == 0
        assert fibonacci_reward_tier(0.005) == 0

    def test_tiers_one_through_eight(self):
        assert fibonacci_reward_tier(0.01) == 1
        assert fibonacci_reward_tier(0.02) == 2
        assert fibonacci_reward_tier(0.03) == 3
        assert fibonacci_reward_tier(0.05) == 4
        assert fibonacci_reward_tier(0.08) == 5
        assert fibonacci_reward_tier(0.13) == 6
        assert fibonacci_reward_tier(0.21) == 7
        assert fibonacci_reward_tier(0.34) == 8
        assert fibonacci_reward_tier(1.0) == 8


class TestOceanTrailRetracement:
    """Matrix tier-3 doctrine extension (2026-05-26) — Ocean trail/SL
    tier picker. Parity tests against the TS implementation."""

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
