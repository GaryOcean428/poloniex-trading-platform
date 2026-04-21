"""
perception_scalars.py — signed scalars read from basin + tape (v0.7.2).

These are NOT perception kernel internals — just the two scalar signals
the executive needs to gate direction: basinDirection (from the basin's
momentum spectrum dims 7..14) and trendProxy (log-return over last N
candles, tanh-squashed to [-1, 1]).

Both are computed server-side so the TS orchestrator doesn't have to
ship an OHLCV window AND basin for every tick — the Python side
receives the basin (required for QIG primitives) plus the most-recent
OHLCV window and derives both locally.
"""

from __future__ import annotations

from typing import Sequence

import numpy as np


def basin_direction(basin: np.ndarray) -> float:
    """Signed directional reading from the momentum-spectrum dims 7..14.

    Returns a scalar in [-1, 1]. Positive = recent uptrend seen in basin;
    negative = downtrend; magnitude = conviction. Computed by centering
    the 8 momentum-spectrum dims at 0.5 (their sigmoid-normalised
    neutral) and tanh-squashing the sum. Independent of ml-worker's
    opinion — Monkey's own directional reading.
    """
    # Sum of (dim - 0.5) across dims 7..14 (inclusive, 8 dims).
    centred_sum = float(np.sum(basin[7:15]) - 0.5 * 8)
    return float(np.tanh(centred_sum * 2.0))


def trend_proxy(closes: Sequence[float], lookback: int = 50) -> float:
    """Log-return over lookback candles, tanh-squashed to [-1, 1].

    With 15-minute candles and lookback=50 this sees ~12.5 hours of
    tape — long enough to filter scalp noise, short enough to pivot on
    real reversals. At K×log-return>>1, saturates near ±1.
    """
    if len(closes) < lookback + 1:
        return 0.0
    last = float(closes[-1])
    base = float(closes[-1 - lookback])
    if base <= 0 or last <= 0:
        return 0.0
    r = float(np.log(last / base))
    return float(np.tanh(r * 50.0))
