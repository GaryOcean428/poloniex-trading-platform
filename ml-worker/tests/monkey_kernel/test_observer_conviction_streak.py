"""test_observer_conviction_streak.py — Commit 4 (Cascade brief 2026-05-27).

Pins the observer-derived conviction streak requirement on the Py side.
Mirrors observerConvictionStreakRequired in apps/api/src/services/monkey/loop.ts.

Floor 2 (HISTORY_MIN_SAMPLES sentinel), cap 12, window 20.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

import pytest  # noqa: E402

from monkey_kernel.tick import (  # noqa: E402
    _observer_conviction_streak_required,
    _CONVICTION_STREAK_FLOOR,
    _CONVICTION_HESITATION_WINDOW,
    _CONVICTION_STREAK_CAP,
)


class TestConstants:
    def test_floor_is_2(self) -> None:
        assert _CONVICTION_STREAK_FLOOR == 2

    def test_window_is_20(self) -> None:
        assert _CONVICTION_HESITATION_WINDOW == 20

    def test_cap_is_12(self) -> None:
        assert _CONVICTION_STREAK_CAP == 12


class TestBoundaryInputs:
    def test_empty_history_returns_floor(self) -> None:
        assert _observer_conviction_streak_required([]) == 2

    def test_single_sample_returns_floor(self) -> None:
        assert _observer_conviction_streak_required([0.5]) == 2


class TestMonotonicCollapse:
    def test_all_positive_no_flips_returns_floor(self) -> None:
        history = [0.1, 0.2, 0.3, 0.4, 0.5]
        assert _observer_conviction_streak_required(history) == 2

    def test_all_negative_no_flips_returns_floor(self) -> None:
        history = [-0.1, -0.2, -0.3, -0.4, -0.5]
        assert _observer_conviction_streak_required(history) == 2


class TestOscillation:
    def test_every_tick_sign_flip_returns_cap(self) -> None:
        # max oscillation — flip every adjacent pair
        history = [0.1, -0.1, 0.1, -0.1, 0.1, -0.1, 0.1, -0.1, 0.1, -0.1]
        assert _observer_conviction_streak_required(history) == 12

    def test_moderate_flip_rate_returns_mid_range(self) -> None:
        # 10 samples, 2 flips → flip rate ~0.22
        history = [0.1, 0.2, 0.3, -0.1, -0.2, 0.1, 0.2, 0.3, 0.4, 0.5]
        result = _observer_conviction_streak_required(history)
        assert 2 <= result <= 8


class TestZeroCrossings:
    def test_zero_treated_as_neutral_no_flip(self) -> None:
        # positive → zero → positive: should not count as flips
        history = [0.5, 0, 0.5, 0, 0.5]
        assert _observer_conviction_streak_required(history) == 2


class TestTSParity:
    """The TS side observerConvictionStreakRequired mirrors this exactly.
    These inputs match the TS tests at observerConvictionStreak.test.ts.
    """
    def test_matches_ts_empty(self) -> None:
        assert _observer_conviction_streak_required([]) == 2

    def test_matches_ts_max_oscillation(self) -> None:
        history = [0.1, -0.1, 0.1, -0.1, 0.1, -0.1, 0.1, -0.1, 0.1, -0.1]
        assert _observer_conviction_streak_required(history) == 12
