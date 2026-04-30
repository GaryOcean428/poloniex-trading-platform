"""Tests for ``monkey_kernel.candle_patterns`` (proposal #9).

Pattern coverage: hammer, inverted hammer, shooting star, hanging
man, doji, bullish/bearish engulfing, morning star, evening star.
Plus integration helpers: detect_strongest, pattern_signal_scalar,
hammer_against_long_sl.
"""
from __future__ import annotations

import os
import sys
from typing import List

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.candle_patterns import (  # noqa: E402
    OHLCVRow,
    PatternReading,
    detect_bearish_engulfing,
    detect_bullish_engulfing,
    detect_doji,
    detect_evening_star,
    detect_hammer,
    detect_hanging_man,
    detect_inverted_hammer,
    detect_morning_star,
    detect_shooting_star,
    detect_strongest,
    hammer_against_long_sl,
    pattern_signal_scalar,
)


def candle(o: float, h: float, l: float, c: float, v: float = 1.0) -> OHLCVRow:
    return OHLCVRow(open=o, high=h, low=l, close=c, volume=v)


def downtrend(n: int = 5, start: float = 100.0, step: float = 1.0) -> List[OHLCVRow]:
    return [candle(start - i * step + 0.4, start - i * step + 0.6,
                   start - i * step - 0.2, start - i * step) for i in range(n)]


def uptrend(n: int = 5, start: float = 100.0, step: float = 1.0) -> List[OHLCVRow]:
    return [candle(start + i * step - 0.4, start + i * step + 0.2,
                   start + i * step - 0.6, start + i * step) for i in range(n)]


# ── Hammer ──────────────────────────────────────────────────────


class TestHammer:
    def test_textbook_hammer_after_downtrend(self):
        ctx = downtrend(5)
        # Hammer: open=99, close=99.2, high=99.3, low=98.0
        ctx.append(candle(99.0, 99.3, 98.0, 99.2))
        r = detect_hammer(ctx)
        assert r.pattern_name == "hammer"
        assert r.strength > 0
        assert r.direction == 1

    def test_no_hammer_when_body_too_large(self):
        # Body ratio > 0.4 → not a hammer.
        c = candle(99.0, 100.0, 98.5, 99.95)  # body 0.95 of range 1.5 = 0.63
        r = detect_hammer([c])
        assert r.strength == 0

    def test_no_hammer_when_upper_wick_too_long(self):
        # Long upper wick disqualifies hammer.
        c = candle(99.0, 100.5, 98.0, 99.2)  # body 0.2, lower 1.0, upper 1.3
        r = detect_hammer([c])
        assert r.strength == 0

    def test_hammer_direction_is_bullish(self):
        c = candle(99.0, 99.3, 98.0, 99.2)
        r = detect_hammer([c])
        assert r.direction == 1

    def test_hammer_handles_zero_range_gracefully(self):
        c = candle(100.0, 100.0, 100.0, 100.0)
        r = detect_hammer([c])
        assert r.strength == 0


class TestInvertedHammer:
    def test_textbook_inverted_hammer(self):
        ctx = downtrend(5)
        # Inverted hammer: small body at bottom, long upper wick.
        ctx.append(candle(99.0, 100.5, 98.95, 99.1))
        r = detect_inverted_hammer(ctx)
        assert r.pattern_name == "inverted_hammer"
        assert r.strength > 0
        assert r.direction == 1


class TestShootingStar:
    def test_textbook_shooting_star_after_uptrend(self):
        ctx = uptrend(5)
        ctx.append(candle(100.5, 102.0, 100.45, 100.6))
        r = detect_shooting_star(ctx)
        assert r.pattern_name == "shooting_star"
        assert r.strength > 0
        assert r.direction == -1

    def test_no_shooting_star_without_prior_uptrend(self):
        ctx = downtrend(5)
        ctx.append(candle(100.5, 102.0, 100.45, 100.6))
        r = detect_shooting_star(ctx)
        assert r.strength == 0

    def test_no_shooting_star_with_short_history(self):
        ctx = [candle(100.5, 102.0, 100.45, 100.6)]
        r = detect_shooting_star(ctx)
        assert r.strength == 0


class TestHangingMan:
    def test_textbook_hanging_man_after_uptrend(self):
        ctx = uptrend(5)
        ctx.append(candle(100.5, 100.6, 99.0, 100.4))
        r = detect_hanging_man(ctx)
        assert r.pattern_name == "hanging_man"
        assert r.strength > 0
        assert r.direction == -1

    def test_no_hanging_man_without_prior_uptrend(self):
        ctx = downtrend(5)
        ctx.append(candle(100.5, 100.6, 99.0, 100.4))
        r = detect_hanging_man(ctx)
        assert r.strength == 0


class TestDoji:
    def test_textbook_doji(self):
        c = candle(100.0, 101.0, 99.0, 100.0)
        r = detect_doji([c])
        assert r.pattern_name == "doji"
        assert r.strength > 0
        assert r.direction == 0

    def test_doji_strength_increases_as_body_shrinks(self):
        a = candle(100.0, 101.0, 99.0, 100.05)
        b = candle(100.0, 101.0, 99.0, 100.0)
        ra = detect_doji([a])
        rb = detect_doji([b])
        assert rb.strength > ra.strength

    def test_no_doji_when_body_large(self):
        c = candle(100.0, 101.0, 99.0, 100.5)  # body 0.5 of range 2.0 = 0.25
        r = detect_doji([c])
        assert r.strength == 0


class TestBullishEngulfing:
    def test_textbook_bullish_engulfing(self):
        prev = candle(100.0, 100.5, 99.0, 99.5)  # bearish
        curr = candle(99.4, 101.0, 99.3, 100.7)  # bullish + engulfs
        r = detect_bullish_engulfing([prev, curr])
        assert r.pattern_name == "bullish_engulfing"
        assert r.strength > 0
        assert r.direction == 1

    def test_no_engulf_when_curr_is_bearish(self):
        prev = candle(100.0, 100.5, 99.0, 99.5)
        curr = candle(99.4, 100.0, 98.5, 98.7)
        r = detect_bullish_engulfing([prev, curr])
        assert r.strength == 0

    def test_no_engulf_when_curr_does_not_cover_prev(self):
        prev = candle(100.0, 100.5, 99.0, 99.5)
        curr = candle(99.4, 99.7, 99.3, 99.6)  # bullish but inside
        r = detect_bullish_engulfing([prev, curr])
        assert r.strength == 0

    def test_no_engulf_with_short_input(self):
        r = detect_bullish_engulfing([candle(100, 101, 99, 100)])
        assert r.strength == 0


class TestBearishEngulfing:
    def test_textbook_bearish_engulfing(self):
        prev = candle(99.5, 100.5, 99.0, 100.0)  # bullish
        curr = candle(100.2, 100.5, 98.5, 99.0)  # bearish + engulfs
        r = detect_bearish_engulfing([prev, curr])
        assert r.pattern_name == "bearish_engulfing"
        assert r.strength > 0
        assert r.direction == -1


class TestMorningStar:
    def test_textbook_morning_star(self):
        a = candle(100.0, 100.5, 98.0, 98.5)   # bearish
        b = candle(98.4, 98.6, 98.2, 98.5)     # small body
        c = candle(98.5, 99.7, 98.4, 99.5)     # bullish, closes past midpoint
        r = detect_morning_star([a, b, c])
        assert r.pattern_name == "morning_star"
        assert r.strength > 0
        assert r.direction == 1

    def test_no_morning_star_when_third_is_bearish(self):
        a = candle(100.0, 100.5, 98.0, 98.5)
        b = candle(98.4, 98.6, 98.2, 98.5)
        c = candle(98.5, 98.6, 97.5, 97.8)
        r = detect_morning_star([a, b, c])
        assert r.strength == 0


class TestEveningStar:
    def test_textbook_evening_star(self):
        a = candle(98.0, 100.5, 97.5, 100.0)
        b = candle(100.1, 100.3, 99.9, 100.0)  # small body
        c = candle(100.0, 100.1, 98.0, 98.5)   # bearish past midpoint
        r = detect_evening_star([a, b, c])
        assert r.pattern_name == "evening_star"
        assert r.strength > 0
        assert r.direction == -1


class TestDetectStrongest:
    def test_returns_no_pattern_on_empty(self):
        r = detect_strongest([])
        assert r.strength == 0
        assert r.pattern_name == "none"

    def test_returns_no_pattern_on_neutral_candle(self):
        # A small-body candle near range mid is borderline doji — assert
        # strength is at most a rounding-noise epsilon.
        r = detect_strongest([candle(100, 100.5, 99.5, 100.1)])
        assert r.strength < 0.01

    def test_picks_strongest_pattern(self):
        # Build a clear hammer.
        ctx = downtrend(5)
        ctx.append(candle(99.0, 99.3, 98.0, 99.2))
        r = detect_strongest(ctx)
        assert r.pattern_name == "hammer"

    def test_morning_star_beats_random_doji(self):
        a = candle(100.0, 100.5, 98.0, 98.5)
        b = candle(98.4, 98.6, 98.2, 98.5)
        c = candle(98.5, 99.7, 98.4, 99.5)
        r = detect_strongest([a, b, c])
        assert r.pattern_name == "morning_star"


class TestIntegrationHelpers:
    def test_pattern_signal_scalar_bullish(self):
        r = PatternReading(pattern_name="hammer", strength=0.8, direction=1)
        assert pattern_signal_scalar(r) == pytest.approx(0.8)

    def test_pattern_signal_scalar_bearish(self):
        r = PatternReading(pattern_name="evening_star", strength=0.6, direction=-1)
        assert pattern_signal_scalar(r) == pytest.approx(-0.6)

    def test_pattern_signal_scalar_neutral(self):
        r = PatternReading(pattern_name="doji", strength=0.5, direction=0)
        assert pattern_signal_scalar(r) == pytest.approx(0.0)

    def test_hammer_against_long_sl_fires_for_strong_hammer(self):
        ctx = downtrend(5)
        ctx.append(candle(99.0, 99.3, 98.0, 99.2))
        assert hammer_against_long_sl(ctx) is True

    def test_hammer_against_long_sl_does_not_fire_on_random(self):
        c = [candle(100, 100.5, 99.5, 100.1)] * 6
        assert hammer_against_long_sl(c) is False


class TestPatternRobustness:
    def test_handles_dict_input(self):
        c = {"open": 99.0, "high": 99.3, "low": 98.0, "close": 99.2, "volume": 1.0}
        r = detect_hammer([c])
        assert r.strength >= 0  # Doesn't crash.

    def test_handles_object_with_attributes(self):
        class C:
            open = 99.0
            high = 99.3
            low = 98.0
            close = 99.2
            volume = 1.0
        r = detect_hammer([C()])
        assert r.strength >= 0

    def test_strength_is_in_unit_interval(self):
        # Sweep across many synthetic candles; strength must always
        # be in [0, 1].
        import random
        rng = random.Random(42)
        for _ in range(100):
            o = 100 + rng.uniform(-2, 2)
            h = max(o, 100 + rng.uniform(0, 5))
            l = min(o, 100 + rng.uniform(-5, 0))
            c = o + rng.uniform(-2, 2)
            cand = candle(o, h, l, c)
            for det in (detect_hammer, detect_inverted_hammer, detect_doji):
                r = det([cand])
                assert 0.0 <= r.strength <= 1.0
                assert r.direction in (-1, 0, 1)


class TestPatternRegressions:
    def test_user_observed_hammer_bug(self):
        """Regression test for the user-observed bug: SL'd into a
        hammer reversal. A clear hammer with prior downtrend should
        fire ``hammer_against_long_sl`` so the SL-defer path engages.
        """
        ctx = downtrend(5)
        # Big lower wick, small body near top — classic hammer.
        ctx.append(candle(99.5, 99.7, 97.5, 99.6))
        assert hammer_against_long_sl(ctx) is True
        r = detect_strongest(ctx)
        assert r.pattern_name == "hammer"
        assert r.direction == 1

    def test_neutral_market_yields_no_pattern(self):
        # Random walk-y small-body candles → no pattern fires.
        ctx = [candle(100, 100.3, 99.7, 100.1) for _ in range(10)]
        r = detect_strongest(ctx)
        assert r.strength == 0


class TestPatternPurity:
    def test_no_euclidean_or_cosine(self):
        path = os.path.join(_SRC, "monkey_kernel", "candle_patterns.py")
        with open(path) as fh:
            src = fh.read()
        for tok in [
            "cosine_similarity",
            "scipy.spatial.distance.cosine",
            "scipy.spatial.distance.euclidean",
            "np.linalg.norm",
        ]:
            assert tok not in src
