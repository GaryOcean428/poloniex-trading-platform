"""ocean_sleep_trigger.py — Matrix tier-4 Phase C Python parity port.

Mirror of apps/api/src/services/monkey/ocean_sleep_trigger.ts.

Per [[polytrade-knob-free-recursive-doctrine]]:

    IF ocean.sovereignty_saturated() AND ocean.fluctuation_overrun():
        sleep()  # working context dissolves; QIGRAM basins persist;
                 # wake reconstructs

- **sovereignty_saturated**: kernel's current sovereignty ≥ 95th
  percentile of its rolling distribution (QIGRAM-weight saturated).
- **fluctuation_overrun**: rolling Φ variance lands beyond the Tukey
  outer fence (Q3 + 3·IQR) of past Φ-variance samples (topological
  instability sustained).

Both pure functions of the kernel's own observables. No knobs. Numeric
contract (95th percentile, Tukey 3·IQR, ddof=1 variance) is identical
TS↔Python.
"""
from __future__ import annotations

import math
from typing import Sequence

SOVEREIGNTY_TAIL_QUANTILE: float = 0.95
SOVEREIGNTY_MIN_SAMPLES: int = 30
FLUCTUATION_TUKEY_OUTER: float = 3.0
FLUCTUATION_MIN_BASELINE: int = 30
PHI_VARIANCE_WINDOW: int = 30


def quantile(xs: Sequence[float], q: float) -> float:
    """Hyndman-Fan type 7 quantile — same default as numpy.percentile
    (and the TS port). Does NOT mutate the input."""
    if len(xs) == 0:
        return 0.0
    if len(xs) == 1:
        return float(xs[0])
    sorted_xs = sorted(xs)
    pos = q * (len(sorted_xs) - 1)
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return float(sorted_xs[lo])
    frac = pos - lo
    return float(sorted_xs[lo]) * (1.0 - frac) + float(sorted_xs[hi]) * frac


def rolling_phi_variance(
    phi_history: Sequence[float],
    window_size: int = PHI_VARIANCE_WINDOW,
) -> float:
    """Unbiased sample variance (ddof=1) of the last `window_size`
    samples. Returns 0 below 2 samples."""
    if len(phi_history) < 2:
        return 0.0
    window = list(phi_history[-window_size:])
    n = len(window)
    mean = sum(window) / n
    sum_sq = 0.0
    for v in window:
        d = v - mean
        sum_sq += d * d
    return sum_sq / (n - 1)


def sovereignty_saturated(
    sovereignty_now: float,
    sovereignty_history: Sequence[float],
) -> bool:
    """True iff current sovereignty ≥ 95th percentile of own history.

    Returns False on cold-start (history below MIN_SAMPLES) — never
    trigger sleep without a baseline.
    """
    if not math.isfinite(sovereignty_now):
        return False
    if len(sovereignty_history) < SOVEREIGNTY_MIN_SAMPLES:
        return False
    cutoff = quantile(list(sovereignty_history), SOVEREIGNTY_TAIL_QUANTILE)
    return sovereignty_now >= cutoff


def fluctuation_overrun(
    phi_history: Sequence[float],
    phi_variance_history: Sequence[float],
) -> bool:
    """True iff current Φ variance > Q3 + 3·IQR of past Φ-variance
    samples. Cold-start safe: returns False below MIN_BASELINE.
    """
    if len(phi_history) < 2:
        return False
    if len(phi_variance_history) < FLUCTUATION_MIN_BASELINE:
        return False
    current_var = rolling_phi_variance(phi_history)
    if not math.isfinite(current_var) or current_var <= 0:
        return False
    sorted_var = sorted(phi_variance_history)
    q1 = quantile(sorted_var, 0.25)
    q3 = quantile(sorted_var, 0.75)
    iqr = q3 - q1
    if iqr <= 0:
        return False
    outer_fence = q3 + FLUCTUATION_TUKEY_OUTER * iqr
    return current_var > outer_fence


def doctrine_sleep_trigger(
    sovereignty_now: float,
    sovereignty_history: Sequence[float],
    phi_history: Sequence[float],
    phi_variance_history: Sequence[float],
) -> dict:
    """Combined trigger. Sleep iff BOTH predicates fire.

    Returns a dict with `should_sleep`, `sovereignty_saturated`,
    `fluctuation_overrun` for telemetry / parity inspection.
    """
    sov = sovereignty_saturated(sovereignty_now, sovereignty_history)
    flu = fluctuation_overrun(phi_history, phi_variance_history)
    return {
        "should_sleep": sov and flu,
        "sovereignty_saturated": sov,
        "fluctuation_overrun": flu,
    }
