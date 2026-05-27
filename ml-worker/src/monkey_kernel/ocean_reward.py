"""ocean_reward.py — Ocean kernel's canonical reward-shaping function (Python parity).

Mirrors apps/api/src/services/monkey/ocean_reward.ts exactly.

Per QIG Frozen Facts (v1.01F) and Canonical Principles P1/P5/P25:
- Reward shaping must be observer-derived where possible (median/MAD
  from the kernel's own realized pnl_frac distribution).
- No external hardcoded floors (the classic 1% Fib anti-pattern is retired).
- The Fibonacci *shape* is accepted as structural (like tanh), but the
  floor/scale must come from the observer's own history.

The primary path is `observer_fib_coefficient` (P1 compliant).
The legacy `fibonacci_reward_coefficient` (absolute 1% floor) is
DEPRECATED and retained only for historical telemetry / trail code.
It must not be used for new positive reward shaping.

See also: two-channel doctrine (κ ≈ 64 retired as universal constant).
"""

from __future__ import annotations

import math


def fibonacci_reward_coefficient(roi_frac: float) -> int:
    """DEPRECATED — legacy absolute 1% floor path.

    Retained only for historical telemetry and trail code.
    New positive reward shaping must use observer_fib_coefficient
    (median/MAD from kernel's own pnl_frac history).

    Per Frozen Facts v1.01F: the external 1% floor is retired.
    """
    if (
        not isinstance(roi_frac, (int, float))
        or not math.isfinite(roi_frac)
        or roi_frac < 0.01
    ):
        return 0
    if roi_frac < 0.02:
        return 1
    if roi_frac < 0.03:
        return 2
    if roi_frac < 0.05:
        return 3
    if roi_frac < 0.08:
        return 5
    if roi_frac < 0.13:
        return 8
    if roi_frac < 0.21:
        return 13
    if roi_frac < 0.34:
        return 21
    return 34


def fibonacci_reward_tier(roi_frac: float) -> int:
    """Surface the tier INDEX for telemetry — useful for grepping kernel
    logs to confirm the reward dispense is firing as expected.

    Tier 0 = below 1% noise floor. Tier 1..8 are the Fibonacci buckets.
    """
    if (
        not isinstance(roi_frac, (int, float))
        or not math.isfinite(roi_frac)
        or roi_frac < 0.01
    ):
        return 0
    if roi_frac < 0.02:
        return 1
    if roi_frac < 0.03:
        return 2
    if roi_frac < 0.05:
        return 3
    if roi_frac < 0.08:
        return 4
    if roi_frac < 0.13:
        return 5
    if roi_frac < 0.21:
        return 6
    if roi_frac < 0.34:
        return 7
    return 8


TRAIL_TIERS: tuple[float, ...] = (0.03, 0.05, 0.08, 0.13, 0.21)


def observer_fib_coefficient(pnl_frac: float, history: list[float]) -> int:
    """Observer-derived ocean reward coefficient (P1, post flag-reversal).

    Replaces the external hardcoded 1% Fib floor (never fired at real
    kernel scale ~0.04% MAD). Uses own realized pnl_frac distribution
    (exact median + MAD from motivators.py transcendence block).
    Positive deviation from own history now yields positive chemistry.
    Cold-start or non-positive deviation → 0. Structural (no knob).
    """
    import math
    _EPS = 1e-12
    if not history or len(history) < 2:
        return 1 if pnl_frac > 0 else 0  # Gentle positive signal while observer history builds (P1 ramp-up)
    if not isinstance(pnl_frac, (int, float)) or not math.isfinite(pnl_frac):
        return 0

    sorted_hist = sorted(history)
    n = len(sorted_hist)
    if n % 2 == 0:
        median = (sorted_hist[n // 2 - 1] + sorted_hist[n // 2]) / 2
    else:
        median = sorted_hist[n // 2]
    devs = sorted(abs(x - median) for x in sorted_hist)
    if n % 2 == 0:
        mad = (devs[n // 2 - 1] + devs[n // 2]) / 2
    else:
        mad = devs[n // 2]

    if mad < _EPS:
        return 0
    z = (pnl_frac - median) / mad
    if z <= 0.0:
        return 0

    # Structural mapping (positive z-deviation → Fib tiers)
    if z < 0.5: return 1
    if z < 1.0: return 2
    if z < 1.5: return 3
    if z < 2.0: return 5
    if z < 3.0: return 8
    if z < 4.0: return 13
    if z < 5.0: return 21
    return 34


def ocean_trail_retracement(coherence_streak: float) -> float:
    """Ocean's trail/SL retracement tier as a function of the kernel's
    coherence streak — Matrix tier-3 doctrine extension (2026-05-26).

    Braden's directive: "ocean sets the trail based off noise and its
    confidence. if it expects it will go higher after some accumulation
    then set it more flexibly. fib magnitude. if it is uncertain then
    it sets it tight after the expected peak is reached. sl set
    similarly."

    Reads ONE kernel-observable — the consecutive-tick count where
    Fisher-Rao(perception, strategy_forecast) stayed below shouldExit's
    threshold (i.e. the kernel has been coherent on this position) —
    and selects a Fibonacci-tier retracement window from the canonical
    trail-eligible subset {3%, 5%, 8%, 13%, 21%}.

    High streak → kernel sustained coherence → looser trail. Low streak
    → tight trail. The streak length IS the tier index, capped at the
    length of the trail-eligible subset. NO formula combines noise +
    confidence with operator-picked coefficients — pure count of an
    observable (Matrix's "Mechanism B").

    Tier 1 (1%) and tier 2 (2%) excluded as too-tight noise band;
    tier 8 (34%) excluded as harvest-cap. Remaining five tiers cover
    "tight enough to capture" through "loose enough to give a trend
    room."

    Fail-closed on non-finite inputs (±Infinity, NaN) — int(float('inf'))
    raises OverflowError, so non-finite streaks fall back to the tightest
    tier rather than crashing the kernel. Matches the TS implementation's
    Number.isFinite() guard.
    """
    if not isinstance(coherence_streak, (int, float)):
        return TRAIL_TIERS[0]
    if not math.isfinite(coherence_streak):  # NaN or ±Infinity
        return TRAIL_TIERS[0]
    if coherence_streak < 0:
        return TRAIL_TIERS[0]
    idx = min(int(coherence_streak), len(TRAIL_TIERS) - 1)
    return TRAIL_TIERS[idx]


def ocean_trail_tier_index(coherence_streak: float) -> int:
    """Surface the trail tier index (0..4) for telemetry.

    Fail-closed on non-finite inputs (±Infinity, NaN) — returns 0
    (tightest-tier index), matching ocean_trail_retracement().
    """
    if not isinstance(coherence_streak, (int, float)):
        return 0
    if not math.isfinite(coherence_streak):  # NaN or ±Infinity
        return 0
    if coherence_streak < 0:
        return 0
    return min(int(coherence_streak), len(TRAIL_TIERS) - 1)


__all__ = [
    "fibonacci_reward_coefficient",
    "fibonacci_reward_tier",
    "TRAIL_TIERS",
    "ocean_trail_retracement",
    "ocean_trail_tier_index",
]
