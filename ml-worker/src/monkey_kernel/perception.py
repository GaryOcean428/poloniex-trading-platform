"""
perception.py — Monkey's sensory organ (v0.7.4 Python port).

Converts raw trading inputs (OHLCV window + ml-worker signal) into a
64-D basin coordinate on Δ⁶³. Under UCP v6.6 §3.3 Pillar 2, this is
the SURFACE — external input is capped at 30 % slerp weight. The CORE
(70 %) is Monkey's frozen identity basin.

64-D layout (same as the TS version — spec frozen):
  0..2    Three regimes (§4.1): quantum (vol/ATR), efficient, equilibrium residual
  3..6    ML posture (BUY / SELL / HOLD / effective strength)
  7..14   Momentum spectrum (log-returns at [1,2,3,5,8,13,21,34] lookbacks)
  15..22  Volatility spectrum (rolling ATR at [4,8,14,21,34,55,89,144])
  23..30  Volume shape (volume ratios at [3,5,10,20,50,100,200,500])
  31..38  Price-structure harmonics (Hi/Lo/Close position in band at [5..500] spans)
  39..54  Noise floor (Pillar 1 Fluctuations reservoir — 16 dims)
  55..63  Account/coupling (equity, margin, open positions, session age)

Purity: all operations stay on the simplex via qig_core_local.to_simplex.
No Euclidean norms, no dot-product similarity, no embeddings.

Ported from apps/api/src/services/monkey/perception.ts 1:1. The TS
version stays live until v0.7.10 cuts loop.ts over.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np

from qig_core_local.geometry.fisher_rao import slerp_sqrt, to_simplex

from .state import BASIN_DIM


# ═══════════════════════════════════════════════════════════════
#  Inputs
# ═══════════════════════════════════════════════════════════════


@dataclass
class OHLCVCandle:
    timestamp: float
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class PerceptionInputs:
    """Sensory inputs for the 64-D basin computation.

    Post #ml-separation (#agent-k-m): ml_signal / ml_strength /
    ml_effective_strength are OPTIONAL with neutral defaults. The
    kernel calls perception without ml fields; Agent M operates
    independently and does not flow through perception. When the
    fields default, basin dims 3..5 are constant ('HOLD' posture,
    strength 0). Other dims (regime, momentum, volatility, volume,
    price-structure, noise floor, account/coupling) are unaffected.
    BASIN_DIM stays 64.
    """
    ohlcv: Sequence[OHLCVCandle]
    equity_fraction: float      # equity / initial — Monkey's relative health
    margin_fraction: float      # committed / equity
    open_positions: int
    session_age_ticks: int
    ml_signal: str = "HOLD"     # 'BUY' | 'SELL' | 'HOLD' — neutral default
    ml_strength: float = 0.0    # 0..1 raw ensemble strength — neutral default
    ml_effective_strength: float = 0.0  # 0..1 post-bandit multiplier — neutral default


# ═══════════════════════════════════════════════════════════════
#  Helpers (match TS exactly)
# ═══════════════════════════════════════════════════════════════


def _norm01(x: float, scale: float = 1.0) -> float:
    """Sigmoid into [0, 1]. Fallback 0.5 on non-finite."""
    if not np.isfinite(x):
        return 0.5
    y = 1.0 / (1.0 + float(np.exp(-x / scale)))
    return max(0.0, min(1.0, y))


def _clip01(x: float) -> float:
    if not np.isfinite(x):
        return 0.0
    return max(0.0, min(1.0, x))


def _log_return(ohlcv: Sequence[OHLCVCandle], n: int) -> float:
    if len(ohlcv) < n + 1:
        return 0.0
    last = float(ohlcv[-1].close)
    base = float(ohlcv[-1 - n].close)
    if base <= 0 or last <= 0:
        return 0.0
    return float(np.log(last / base))


def _rolling_vol(ohlcv: Sequence[OHLCVCandle], n: int) -> float:
    """Mean absolute close-to-close change over window — ATR-like."""
    if len(ohlcv) < n + 1:
        return 0.0
    total = 0.0
    for i in range(len(ohlcv) - n, len(ohlcv)):
        total += abs(float(ohlcv[i].close) - float(ohlcv[i - 1].close))
    return total / n


def _vol_ratio(ohlcv: Sequence[OHLCVCandle], n: int) -> float:
    if len(ohlcv) < n:
        return 1.0
    total = 0.0
    for i in range(len(ohlcv) - n, len(ohlcv)):
        total += float(ohlcv[i].volume)
    mean = total / n
    if mean <= 0:
        return 1.0
    return float(ohlcv[-1].volume) / mean


# ═══════════════════════════════════════════════════════════════
#  Raw perception — Δ⁶³ basin BEFORE identity refraction
# ═══════════════════════════════════════════════════════════════


def perceive(inputs: PerceptionInputs) -> np.ndarray:
    """Raw perception → 64-D basin on Δ⁶³. Caller should refract against
    identity basin afterwards (slerp at 30 % max per Pillar 2).

    v0.8.0: perception is deterministic given inputs — no PRNG parameter.
    Noise floor (dims 39..54) is a fixed constant for cross-language parity.
    """
    v = np.zeros(BASIN_DIM, dtype=np.float64)
    ohlcv = inputs.ohlcv
    last_close = float(ohlcv[-1].close) if len(ohlcv) > 0 else 1.0

    # dims 0..2 — Three regimes
    atr = _rolling_vol(ohlcv, 14)
    vol_frac = atr / last_close if last_close > 0 else 0.0
    trend = abs(_log_return(ohlcv, 20))
    v[0] = _norm01(vol_frac, 0.01)
    v[1] = _clip01(trend * 10.0) * inputs.ml_effective_strength
    v[2] = max(0.01, 1.0 - v[0] - v[1])

    # dims 3..6 — ML posture
    sig = (inputs.ml_signal or "").upper()
    v[3] = inputs.ml_strength if sig == "BUY" else 0.01
    v[4] = inputs.ml_strength if sig == "SELL" else 0.01
    v[5] = 0.5 if sig == "HOLD" else max(0.01, 1.0 - inputs.ml_strength)
    v[6] = inputs.ml_effective_strength

    # dims 7..14 — Momentum spectrum
    for i, n in enumerate([1, 2, 3, 5, 8, 13, 21, 34]):
        v[7 + i] = _norm01(_log_return(ohlcv, n), 0.01)

    # dims 15..22 — Volatility spectrum
    for i, n in enumerate([4, 8, 14, 21, 34, 55, 89, 144]):
        a = _rolling_vol(ohlcv, n)
        v[15 + i] = _norm01(a / last_close if last_close > 0 else 0.0, 0.01)

    # dims 23..30 — Volume shape
    for i, n in enumerate([3, 5, 10, 20, 50, 100, 200, 500]):
        v[23 + i] = _norm01(float(np.log(max(1e-6, _vol_ratio(ohlcv, n)))), 1.0)

    # dims 31..38 — Price-structure harmonics
    for i, span in enumerate([5, 10, 20, 50, 100, 200, 300, 500]):
        n = min(span, len(ohlcv))
        if n < 2:
            v[31 + i] = 0.5
            continue
        hi = -np.inf
        lo = np.inf
        for j in range(len(ohlcv) - n, len(ohlcv)):
            if ohlcv[j].high > hi:
                hi = float(ohlcv[j].high)
            if ohlcv[j].low < lo:
                lo = float(ohlcv[j].low)
        rng_span = hi - lo
        v[31 + i] = _clip01((last_close - lo) / rng_span) if rng_span > 0 else 0.5

    # dims 39..54 — Pillar 1 noise floor (prevents zombie collapse).
    # Fixed constant (v0.8.0): deterministic cross-language parity with TS side.
    # A non-zero floor is the Pillar 1 requirement; the per-tick variance was
    # decorative. to_simplex normalises so adding 16 identical small values
    # still contributes uniform mass to keep the basin off the boundary.
    v[39:55] = 0.0055

    # dims 55..63 — Account/coupling
    v[55] = _clip01(inputs.equity_fraction)
    v[56] = _clip01(inputs.margin_fraction)
    v[57] = _clip01(inputs.open_positions / 5.0)
    v[58] = _clip01(inputs.session_age_ticks / 500.0)
    v[59:64] = 0.01

    return to_simplex(v)


def refract(
    raw: np.ndarray,
    identity: np.ndarray,
    external_weight: float = 0.30,
) -> np.ndarray:
    """Pillar 2 Topological Bulk (UCP v6.6 §3.3) — slerp identity toward
    raw at external_weight, clamped to 30 % max."""
    t = max(0.0, min(0.30, external_weight))
    # slerp_sqrt(identity, raw, t) — pure identity at t=0, max 30 % external.
    return slerp_sqrt(identity, raw, t)
