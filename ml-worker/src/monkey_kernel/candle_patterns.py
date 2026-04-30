"""candle_patterns.py — OHLCV pattern recognition (proposal #9).

Pattern detectors for the most actionable single- and multi-candle
patterns. Each detector returns ``PatternReading`` with:

* ``pattern_name``: canonical name
* ``strength`` ∈ [0, 1]: how strong the pattern fires (0 = no fire,
  1 = textbook example)
* ``direction``: +1 bullish, -1 bearish, 0 neutral

The aggregator ``detect_strongest`` returns the highest-strength
pattern fired on the latest candle (or a "no_pattern" reading if
nothing fires).

Two integration paths (proposal #9 spec):
  1. ``pattern_basin_dim`` — pattern_strength * pattern_direction is
     surfaced as a perception input. Pure (OHLCV-derived
     observation). The basin layer can fold it in alongside the
     existing momentum dims.
  2. ``sl_defer_ticks`` — when a hammer/shooting-star is detected
     against the about-to-fire SL direction, defer the SL by N
     ticks. Heuristic gate; documented impurity scoped to the
     SL-defer path only (see ``hammer_against_long_sl``).

QIG note: the pattern detectors themselves are NumPy on raw OHLCV.
They live at the perception input boundary — the same place ml-
signal / ml-strength enter. The kernel's geometric basin remains
pure; patterns are an INPUT observation, not a Fisher-Rao operation
on basin coordinates.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Literal, Optional, Sequence

import numpy as np


PatternDirection = Literal[-1, 0, 1]


@dataclass
class OHLCVRow:
    open: float
    high: float
    low: float
    close: float
    volume: float

    @property
    def body(self) -> float:
        return abs(self.close - self.open)

    @property
    def range(self) -> float:
        return max(self.high - self.low, 1e-12)

    @property
    def upper_wick(self) -> float:
        return self.high - max(self.open, self.close)

    @property
    def lower_wick(self) -> float:
        return min(self.open, self.close) - self.low

    @property
    def is_bullish(self) -> bool:
        return self.close > self.open

    @property
    def is_bearish(self) -> bool:
        return self.close < self.open


@dataclass
class PatternReading:
    pattern_name: str
    strength: float
    direction: PatternDirection

    def as_dict(self) -> dict:
        return {
            "pattern_name": self.pattern_name,
            "strength": self.strength,
            "direction": self.direction,
        }


def _row(c) -> OHLCVRow:
    if isinstance(c, OHLCVRow):
        return c
    if hasattr(c, "open"):
        return OHLCVRow(
            open=float(c.open), high=float(c.high), low=float(c.low),
            close=float(c.close), volume=float(getattr(c, "volume", 0.0)),
        )
    if isinstance(c, dict):
        return OHLCVRow(
            open=float(c["open"]), high=float(c["high"]),
            low=float(c["low"]), close=float(c["close"]),
            volume=float(c.get("volume", 0.0)),
        )
    raise TypeError(f"Cannot coerce {type(c).__name__} to OHLCVRow")


# ── Single-candle patterns ────────────────────────────────────────


def detect_hammer(candles: Sequence) -> PatternReading:
    """Hammer: small body near the top, long lower wick, little/no
    upper wick. Bullish reversal pattern (especially after a
    downtrend).
    """
    if not candles:
        return PatternReading("none", 0.0, 0)
    c = _row(candles[-1])
    if c.range <= 1e-12:
        return PatternReading("none", 0.0, 0)
    body = c.body
    lower = c.lower_wick
    upper = c.upper_wick
    # Hammer criteria: lower wick >= 2 * body, upper wick <= 0.3 * body
    body_ratio = body / c.range
    if body_ratio > 0.4:
        return PatternReading("hammer", 0.0, 0)
    if body == 0:
        body = 1e-9
    lower_ratio = lower / c.range
    upper_ratio = upper / c.range
    if lower_ratio < 0.55 or upper_ratio > 0.15:
        return PatternReading("hammer", 0.0, 0)
    # Strength: combination of long lower wick + small upper wick.
    # Use lower_ratio (in [0.55, 1.0]) mapped to [0, 1].
    strength = float(np.clip((lower_ratio - 0.55) / 0.45, 0.0, 1.0))
    # Bias up if a prior downtrend preceded — examine prior 5 closes.
    if len(candles) >= 6:
        prev = [_row(x).close for x in list(candles)[-6:-1]]
        if prev[-1] < prev[0]:  # downtrend leading to the hammer
            strength = float(min(1.0, strength * 1.2))
    return PatternReading("hammer", strength, 1)


def detect_inverted_hammer(candles: Sequence) -> PatternReading:
    """Inverted Hammer: small body near the bottom, long upper wick,
    little lower wick. Bullish reversal at the bottom of a downtrend.
    """
    if not candles:
        return PatternReading("none", 0.0, 0)
    c = _row(candles[-1])
    if c.range <= 1e-12:
        return PatternReading("none", 0.0, 0)
    body_ratio = c.body / c.range
    upper_ratio = c.upper_wick / c.range
    lower_ratio = c.lower_wick / c.range
    if body_ratio > 0.4:
        return PatternReading("inverted_hammer", 0.0, 0)
    if upper_ratio < 0.55 or lower_ratio > 0.15:
        return PatternReading("inverted_hammer", 0.0, 0)
    strength = float(np.clip((upper_ratio - 0.55) / 0.45, 0.0, 1.0))
    if len(candles) >= 6:
        prev = [_row(x).close for x in list(candles)[-6:-1]]
        if prev[-1] < prev[0]:
            strength = float(min(1.0, strength * 1.2))
    return PatternReading("inverted_hammer", strength, 1)


def detect_shooting_star(candles: Sequence) -> PatternReading:
    """Shooting Star: small body near the bottom, long upper wick,
    little lower wick — at the top of an uptrend. Bearish reversal.
    Same shape as inverted hammer; differentiated by prior trend.
    """
    if not candles:
        return PatternReading("none", 0.0, 0)
    c = _row(candles[-1])
    if c.range <= 1e-12:
        return PatternReading("none", 0.0, 0)
    body_ratio = c.body / c.range
    upper_ratio = c.upper_wick / c.range
    lower_ratio = c.lower_wick / c.range
    if body_ratio > 0.4 or upper_ratio < 0.55 or lower_ratio > 0.15:
        return PatternReading("shooting_star", 0.0, 0)
    # Prior uptrend required for shooting star.
    if len(candles) < 6:
        return PatternReading("shooting_star", 0.0, 0)
    prev = [_row(x).close for x in list(candles)[-6:-1]]
    if prev[-1] <= prev[0]:
        return PatternReading("shooting_star", 0.0, 0)
    strength = float(np.clip((upper_ratio - 0.55) / 0.45, 0.0, 1.0))
    return PatternReading("shooting_star", strength, -1)


def detect_hanging_man(candles: Sequence) -> PatternReading:
    """Hanging Man: hammer shape after an uptrend. Bearish reversal
    signal."""
    if not candles:
        return PatternReading("none", 0.0, 0)
    c = _row(candles[-1])
    if c.range <= 1e-12:
        return PatternReading("none", 0.0, 0)
    body_ratio = c.body / c.range
    lower_ratio = c.lower_wick / c.range
    upper_ratio = c.upper_wick / c.range
    if body_ratio > 0.4 or lower_ratio < 0.55 or upper_ratio > 0.15:
        return PatternReading("hanging_man", 0.0, 0)
    if len(candles) < 6:
        return PatternReading("hanging_man", 0.0, 0)
    prev = [_row(x).close for x in list(candles)[-6:-1]]
    if prev[-1] <= prev[0]:
        return PatternReading("hanging_man", 0.0, 0)
    strength = float(np.clip((lower_ratio - 0.55) / 0.45, 0.0, 1.0))
    return PatternReading("hanging_man", strength, -1)


def detect_doji(candles: Sequence) -> PatternReading:
    """Doji: open == close (within tolerance). Indecision; neutral
    by itself. Direction = 0; strength reflects how clean the doji is.
    """
    if not candles:
        return PatternReading("none", 0.0, 0)
    c = _row(candles[-1])
    if c.range <= 1e-12:
        return PatternReading("none", 0.0, 0)
    body_ratio = c.body / c.range
    if body_ratio > 0.10:
        return PatternReading("doji", 0.0, 0)
    # Strength: cleaner (smaller body) = stronger doji.
    strength = float(np.clip(1.0 - body_ratio / 0.10, 0.0, 1.0))
    return PatternReading("doji", strength, 0)


# ── Two-candle patterns ───────────────────────────────────────────


def detect_bullish_engulfing(candles: Sequence) -> PatternReading:
    """Bullish Engulfing: a bearish candle followed by a bullish
    candle whose body fully engulfs the prior body.
    """
    if len(candles) < 2:
        return PatternReading("none", 0.0, 0)
    prev = _row(candles[-2])
    curr = _row(candles[-1])
    if not prev.is_bearish or not curr.is_bullish:
        return PatternReading("bullish_engulfing", 0.0, 0)
    if curr.open > prev.close:
        return PatternReading("bullish_engulfing", 0.0, 0)
    if curr.close < prev.open:
        return PatternReading("bullish_engulfing", 0.0, 0)
    # Engulf: curr.open <= prev.close AND curr.close >= prev.open.
    strength_a = (curr.close - prev.open) / max(prev.body, 1e-12)
    strength_b = (prev.close - curr.open) / max(prev.body, 1e-12)
    strength = float(np.clip((strength_a + strength_b) / 4.0, 0.0, 1.0))
    return PatternReading("bullish_engulfing", strength, 1)


def detect_bearish_engulfing(candles: Sequence) -> PatternReading:
    if len(candles) < 2:
        return PatternReading("none", 0.0, 0)
    prev = _row(candles[-2])
    curr = _row(candles[-1])
    if not prev.is_bullish or not curr.is_bearish:
        return PatternReading("bearish_engulfing", 0.0, 0)
    if curr.open < prev.close:
        return PatternReading("bearish_engulfing", 0.0, 0)
    if curr.close > prev.open:
        return PatternReading("bearish_engulfing", 0.0, 0)
    strength_a = (prev.open - curr.close) / max(prev.body, 1e-12)
    strength_b = (curr.open - prev.close) / max(prev.body, 1e-12)
    strength = float(np.clip((strength_a + strength_b) / 4.0, 0.0, 1.0))
    return PatternReading("bearish_engulfing", strength, -1)


# ── Three-candle patterns ─────────────────────────────────────────


def detect_morning_star(candles: Sequence) -> PatternReading:
    """Morning Star: bearish candle, small-body candle (ideally a
    doji), bullish candle that closes above the midpoint of candle 1.
    Bullish reversal."""
    if len(candles) < 3:
        return PatternReading("none", 0.0, 0)
    a = _row(candles[-3])
    b = _row(candles[-2])
    c = _row(candles[-1])
    if not a.is_bearish or not c.is_bullish:
        return PatternReading("morning_star", 0.0, 0)
    if b.body / max(b.range, 1e-12) > 0.30:
        return PatternReading("morning_star", 0.0, 0)
    midpoint = (a.open + a.close) / 2.0
    if c.close <= midpoint:
        return PatternReading("morning_star", 0.0, 0)
    # Strength: how far c penetrates into a's body.
    pen = (c.close - midpoint) / max(a.body, 1e-12)
    strength = float(np.clip(pen, 0.0, 1.0))
    return PatternReading("morning_star", strength, 1)


def detect_evening_star(candles: Sequence) -> PatternReading:
    if len(candles) < 3:
        return PatternReading("none", 0.0, 0)
    a = _row(candles[-3])
    b = _row(candles[-2])
    c = _row(candles[-1])
    if not a.is_bullish or not c.is_bearish:
        return PatternReading("evening_star", 0.0, 0)
    if b.body / max(b.range, 1e-12) > 0.30:
        return PatternReading("evening_star", 0.0, 0)
    midpoint = (a.open + a.close) / 2.0
    if c.close >= midpoint:
        return PatternReading("evening_star", 0.0, 0)
    pen = (midpoint - c.close) / max(a.body, 1e-12)
    strength = float(np.clip(pen, 0.0, 1.0))
    return PatternReading("evening_star", strength, -1)


# ── Aggregator ────────────────────────────────────────────────────


_DETECTORS = (
    detect_morning_star,
    detect_evening_star,
    detect_bullish_engulfing,
    detect_bearish_engulfing,
    detect_hammer,
    detect_inverted_hammer,
    detect_shooting_star,
    detect_hanging_man,
    detect_doji,
)


def detect_strongest(candles: Sequence) -> PatternReading:
    """Run every detector, return the strongest fire. Ties go to the
    earlier-listed detector (multi-candle reversals beat single-candle
    in case of equal strength)."""
    best = PatternReading("none", 0.0, 0)
    for det in _DETECTORS:
        r = det(candles)
        if r.strength > best.strength:
            best = r
    return best


# ── Integration helpers ──────────────────────────────────────────


def pattern_signal_scalar(reading: PatternReading) -> float:
    """Map a PatternReading to a single signed scalar in [-1, +1].

    Used by the perception layer (path 1 in the proposal): becomes a
    perception-input feature alongside ml_signal/ml_strength.
    """
    return float(reading.direction) * float(reading.strength)


def hammer_against_long_sl(candles: Sequence) -> bool:
    """Path 2 — SL defer signal. Returns True if a hammer or
    inverted-hammer is detected on the latest tick AND the position
    is long. Caller (tick.py SL-fire path) uses this to defer the SL
    by ``SL_DEFER_TICKS`` (default 2).

    This is heuristic; documented impurity is scoped to ONLY the SL
    defer path. The kernel's basin geometry remains untouched.
    """
    h = detect_hammer(candles)
    ih = detect_inverted_hammer(candles)
    return (h.strength > 0.5 and h.direction > 0) or (
        ih.strength > 0.5 and ih.direction > 0
    )
