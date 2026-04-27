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
    negative = downtrend; magnitude = conviction. Independent of
    ml-worker's opinion — Monkey's own directional reading.

    BUG FIX (2026-04-24): the original code centred each dim at 0.5
    (raw-sigmoid neutral). The basin is post-toSimplex normalised, so a
    flat-momentum dim reads ≈ 0.5/Σ(v) ≈ 0.023, not 0.5. Subtracting 0.5
    produced basinDir ≈ −1.0 on every tick — verified across 21,458
    consecutive decisions on the TS side (2026-04-21 → 04-24), which
    structurally killed DRIFT mode and forced OVERRIDE_REVERSE to a
    permanent SHORT bias. Same symmetry as the TS fix: compare the
    simplex mass in dims 7..14 to its uniform expectation 8/BASIN_DIM.
    """
    BASIN_DIM = 64
    MOM_NEUTRAL = 8 / BASIN_DIM  # 0.125 — uniform mass on 8 momentum dims
    DIRECTION_GAIN = 16.0
    mom_mass = float(np.sum(basin[7:15]))
    return float(np.tanh((mom_mass - MOM_NEUTRAL) * DIRECTION_GAIN))


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
