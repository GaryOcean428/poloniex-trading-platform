"""regime_signal.py — qig-warp bridge-based signal direction (closes #725).

MIG-3 (2026-05-16). Replaces the hardcoded probe-window logic
(``_PROBE_WINDOWS = (3, 5, 10, 15, 60, 120)`` + largest-magnitude
tiebreaker) with the regime-aware bridge exponent from
``qig_warp.regime_constants``. The bridge law (τ ~ J^α) characterises
how trends scale with coupling — high α means the move scales and
persists; low α means the move dissipates. There is no probe-window
to tune.

Bridge regimes (from qig_warp.regime_constants):
  CRITICAL  → α = 0.86  → bridge strongest; trend persists → follow
  ORDERED   → α = 0.00  → spectrum flat; trend self-similar → follow
                          (J dominates h by construction of the
                          regime; the trend IS the structure)
  DISORDERED → α = 0.38 → bridge weak; trend dissipates → NEUTRAL

Issue #725 (the 2026-05-16T11:19Z ETH "BUY on bearish tape" incident)
was downstream of probe-window calibration. With bridge-based
classification, there is no window to mis-tune; the direction comes
from the sign of the mean return in regimes where the bridge says
trends persist, and is NEUTRAL otherwise.

Output shape unchanged: BULLISH / BEARISH / NEUTRAL (the strategy
selector in ``main._strategy_to_signal`` consumes this).
"""

from __future__ import annotations

import logging
from typing import Sequence

import numpy as np

logger = logging.getLogger(__name__)


# Bridge-exponent threshold for "trend will persist". qig_warp's
# regime-constants table emits α = 0.86 (CRITICAL), 0.00 (ORDERED),
# 0.38 (DISORDERED). A threshold at 0.50 cleanly separates CRITICAL
# (trust) from DISORDERED (fade). ORDERED is handled separately
# below — its α = 0 reflects flatness, not weakness; the regime is
# ORDERED because J dominates h, so the trend IS the structure.
_BRIDGE_PERSISTENCE_THRESHOLD = 0.50


def regime_to_direction(
    regime_label: str | None,
    prices: Sequence[float],
) -> str:
    """Return BULLISH / BEARISH / NEUTRAL using qig-warp bridge physics.

    Inputs:
      regime_label: ``creator`` / ``preserver`` / ``dissolver`` from the
        RegimeAdapter (MIG-2). Used as a fast pre-filter — DISSOLVER
        short-circuits to NEUTRAL without invoking qig-warp again.
      prices: recent close series. Log returns are derived here and
        re-fed to ``qig_warp.regime_constants(h, J, dim=2)``; we keep
        the recomputation local rather than threading the adapter's
        (h, J) through every caller.

    Failure modes (all return NEUTRAL — never raise from a tick handler):
      - prices too short (< 2 valid points)
      - degenerate prices (zero range / zero variance)
      - qig_warp unreachable or classifier raises
    """
    regime_lower = (regime_label or "").lower()
    if regime_lower == "dissolver":
        return "NEUTRAL"

    returns = _to_returns(prices)
    if len(returns) < 2:
        return "NEUTRAL"

    vol = float(np.std(returns))
    if vol < 1e-15:
        return "NEUTRAL"
    mean_ret = float(np.mean(returns))
    j_value = abs(mean_ret) / vol

    r_min, r_max = float(np.min(returns)), float(np.max(returns))
    if r_max - r_min < 1e-15:
        return "NEUTRAL"
    counts, _ = np.histogram(returns, bins=20, range=(r_min, r_max))
    probs = counts / counts.sum()
    probs = probs[probs > 0]
    h_value = float(-np.sum(probs * np.log2(probs)))

    try:
        from qig_warp import regime_constants  # type: ignore[import-not-found]
        rc = regime_constants(h=h_value, J=j_value, dim=2)
    except Exception as exc:  # noqa: BLE001 — fail-soft per tick contract
        logger.warning(
            "[regime_signal] regime_constants failed (h=%.3f J=%.3f): %s",
            h_value, j_value, exc,
        )
        return "NEUTRAL"

    warp_regime = getattr(rc.regime, "value", str(rc.regime)).lower()
    trust_trend = (
        rc.bridge_exponent >= _BRIDGE_PERSISTENCE_THRESHOLD
        or warp_regime == "ordered"
    )

    if not trust_trend:
        return "NEUTRAL"
    if mean_ret > 0:
        return "BULLISH"
    if mean_ret < 0:
        return "BEARISH"
    return "NEUTRAL"


def _to_returns(prices: Sequence[float]) -> np.ndarray:
    """Compute simple per-bar returns from a price sequence."""
    arr = np.asarray(prices, dtype=np.float64)
    if arr.size < 2:
        return np.empty(0, dtype=np.float64)
    positives = arr > 0
    if not bool(np.all(positives)):
        arr = arr[positives]
        if arr.size < 2:
            return np.empty(0, dtype=np.float64)
    return np.diff(arr) / arr[:-1]
