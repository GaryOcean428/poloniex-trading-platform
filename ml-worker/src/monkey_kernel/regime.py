"""regime.py — kernel-faculty regime classifier (proposal #5).

A lightweight HMM-style state classifier that reads the basin
trajectory + tape volatility and emits a discrete regime label
plus confidence:

    TREND_UP     — strong uptrend, basin trajectory consistently
                   moving in the bullish direction on the simplex
    CHOP         — low directional persistence, basin oscillates
                   around its identity; small amplitude moves
    TREND_DOWN   — strong downtrend, basin trajectory consistently
                   moving in the bearish direction

Output is a small dataclass that the executive folds into entry
threshold + harvest tightness gating.

QIG purity rationale
--------------------
The classifier reads geometric inputs (basin trajectory) and emits
a discrete classification. The discrete state space is a quotient
on the continuous Δ⁶³ trajectory space — pure if state-transition
scores are computed on Fisher-Rao distances and signed direction
readings, impure if scored on Euclidean variance or std-dev of
returns.

Choice (per brief): Fisher-Rao formulation. State-transition
scoring uses:

  * ``basin_direction(basin)`` — already Fisher-Rao native (proposal #7)
  * ``fisher_rao_distance(basin_t, basin_t-k)`` — geodesic on Δ⁶³
  * Tape ``trend_proxy`` — derived from log-returns and tanh-squashed,
    lives at the perception input boundary, not in the geometric core

No standard-deviation on price returns. No Euclidean dispersion.
Volatility is modeled via the spread of recent ``basin_direction``
readings, which is itself derived from Fisher-Rao geometry on the
basin.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional, Sequence

import numpy as np

from .perception_scalars import basin_direction


# Discrete regime labels.
RegimeLabel = Literal["TREND_UP", "CHOP", "TREND_DOWN"]


@dataclass
class RegimeReading:
    """Output of ``classify_regime`` per tick.

    ``regime`` is one of TREND_UP / CHOP / TREND_DOWN.
    ``confidence`` ∈ [0, 1] — softmax-style score for the chosen
    state given the observation.
    ``trend_strength`` ∈ [-1, +1] — signed accumulated direction
    over the lookback window. Negative = bearish, positive = bullish.
    ``chop_score`` ∈ [0, 1] — variance-of-direction proxy. High =
    direction is mean-reverting (chop); low = direction is
    persistent.
    """
    regime: RegimeLabel
    confidence: float
    trend_strength: float
    chop_score: float

    def as_dict(self) -> dict:
        return {
            "regime": self.regime,
            "confidence": self.confidence,
            "trend_strength": self.trend_strength,
            "chop_score": self.chop_score,
        }


# Tunables. Conservative defaults; tested in tests/monkey_kernel/test_regime.py.
#
# TREND_THRESHOLD is calibrated to the post-proposal-#7 basin_direction
# magnitudes: in the Fisher-Rao reprojection a "strongly bullish"
# synthetic basin reads ≈ 0.07, and a typical mild bull reads ≈ 0.02.
# Setting the threshold at 0.04 gives us a useful-but-not-twitchy
# trend gate. Adjust if production calibration drifts.
DEFAULT_LOOKBACK = 16  # ticks of basin history to consider
TREND_THRESHOLD = 0.025  # |trend_strength| above this -> trend regime
CHOP_THRESHOLD = 0.55  # chop_score above this -> chop regime


def classify_regime(
    basin_history: Sequence[np.ndarray],
    *,
    lookback: int = DEFAULT_LOOKBACK,
    trend_threshold: float = TREND_THRESHOLD,
    chop_threshold: float = CHOP_THRESHOLD,
) -> RegimeReading:
    """Return the current regime reading from a basin trajectory.

    ``basin_history`` is the sequence of recent basins (most-recent
    last). Each entry must be a 64-dim simplex point.

    Algorithm
    ---------
    1. Take the last ``lookback`` basins. Below 3 entries → CHOP at
       low confidence (insufficient data).
    2. For each basin compute ``basin_direction`` — a signed
       Fisher-Rao reading in [-1, +1].
    3. Trend strength: mean of the directional readings.
    4. Chop score: 1 - |mean / max(eps, mean_abs)|.
       This is the "directional persistence inverse" — high when
       readings flip-flop around 0, low when they're consistently
       same-signed.
    5. Decision:
         * If |trend_strength| > trend_threshold AND chop_score < chop_threshold:
             TREND_UP if positive, TREND_DOWN if negative
         * Else: CHOP
    6. Confidence: simple softmax-style score derived from how far
       the trend_strength is past the threshold (or how high the
       chop_score is past its threshold).
    """
    n = len(basin_history)
    if n < 3:
        # Insufficient history — call it CHOP at low confidence so
        # downstream gating treats this as "be cautious".
        return RegimeReading(
            regime="CHOP",
            confidence=0.33,
            trend_strength=0.0,
            chop_score=1.0,
        )

    window = list(basin_history[-lookback:])
    dirs = np.array([basin_direction(b) for b in window], dtype=np.float64)
    trend_strength = float(np.mean(dirs))
    mean_abs = float(np.mean(np.abs(dirs)))
    if mean_abs <= 1e-12:
        chop_score = 1.0  # all readings ~ 0 → directionless
    else:
        # Persistence ratio: |mean| / mean_abs ∈ [0, 1]. 1 = perfectly
        # persistent (all same sign + magnitude); 0 = perfectly chop.
        persistence = abs(trend_strength) / mean_abs
        chop_score = 1.0 - persistence

    is_trend = (abs(trend_strength) > trend_threshold) and (chop_score < chop_threshold)
    if is_trend:
        regime: RegimeLabel = "TREND_UP" if trend_strength > 0 else "TREND_DOWN"
        # Confidence rises as |trend_strength| grows past threshold,
        # capped at ~1.0 when we hit twice the threshold.
        excess = (abs(trend_strength) - trend_threshold) / max(1e-9, trend_threshold)
        confidence = float(np.clip(0.5 + 0.5 * np.tanh(excess), 0.0, 1.0))
    else:
        regime = "CHOP"
        # Confidence rises as chop_score grows past its threshold.
        excess = (chop_score - chop_threshold) / max(1e-9, 1.0 - chop_threshold)
        confidence = float(np.clip(0.5 + 0.5 * np.tanh(excess), 0.0, 1.0))

    return RegimeReading(
        regime=regime,
        confidence=confidence,
        trend_strength=trend_strength,
        chop_score=chop_score,
    )


def regime_entry_threshold_modifier(reading: RegimeReading) -> float:
    """Return a multiplicative modifier on the entry threshold based
    on the regime. Tighter threshold (lower modifier) in chop, looser
    (higher modifier) in trends.

    Range: ~[0.85, 1.15].
    """
    if reading.regime == "CHOP":
        # In chop, raise the entry bar — fewer trades, more discipline.
        return 1.0 + 0.15 * reading.confidence
    # In trend regimes, slightly lower the bar — let conviction
    # entries through more easily.
    return 1.0 - 0.10 * reading.confidence


def regime_harvest_tightness(reading: RegimeReading) -> float:
    """Return a multiplicative modifier on the trailing-stop give-back
    fraction. Chop -> tighter (smaller give-back tolerance), trend ->
    looser (let winners run).

    Range: ~[0.7, 1.3].
    """
    if reading.regime == "CHOP":
        return 1.0 - 0.30 * reading.confidence  # tighter
    return 1.0 + 0.30 * reading.confidence  # looser


# ── CHOP regime entry suppression (issue #623) ───────────────────
#
# Conservative defaults; registry-overridable via propose_change().
# Thresholds live in monkey_parameters as:
#   regime.chop_suppress.trend_confidence  (default 0.70)
#   regime.chop_suppress.swing_confidence  (default 0.85)
#
# Scalp is the chop strategy by definition — never suppressed.
# Only new entries are affected; held-position re-justification
# (#619) owns those exits independently.

CHOP_SUPPRESS_TREND_CONFIDENCE_DEFAULT: float = 0.70
CHOP_SUPPRESS_SWING_CONFIDENCE_DEFAULT: float = 0.85


@dataclass
class ChopSuppressionResult:
    """Output of ``chop_suppress_entry`` per new-entry evaluation."""
    regime: str
    confidence: float
    lane: str
    suppressed: bool
    suppress_reason: Optional[str]

    def as_dict(self) -> dict:
        return {
            "regime": self.regime,
            "confidence": self.confidence,
            "lane": self.lane,
            "suppressed": self.suppressed,
            "suppress_reason": self.suppress_reason,
        }


def chop_suppress_entry(
    reading: RegimeReading,
    lane: str,
    *,
    trend_confidence_threshold: float = CHOP_SUPPRESS_TREND_CONFIDENCE_DEFAULT,
    swing_confidence_threshold: float = CHOP_SUPPRESS_SWING_CONFIDENCE_DEFAULT,
) -> ChopSuppressionResult:
    """Evaluate whether a new entry should be suppressed based on the
    current regime reading and the chosen execution lane.

    Rules:
      - scalp lane: never suppress (chop is the scalp environment)
      - trend lane: suppress when regime==CHOP and confidence >= trend_thr
      - swing lane: suppress when regime==CHOP and confidence >= swing_thr
      - TREND_UP / TREND_DOWN regimes: never suppress any lane

    Thresholds default to the module constants above and may be
    overridden by the caller (read from the parameter registry).
    """
    # Only CHOP regime triggers suppression.
    if reading.regime != "CHOP":
        return ChopSuppressionResult(
            regime=reading.regime,
            confidence=reading.confidence,
            lane=lane,
            suppressed=False,
            suppress_reason=None,
        )

    # Scalp: chop is its home regime — never suspend.
    if lane == "scalp":
        return ChopSuppressionResult(
            regime=reading.regime,
            confidence=reading.confidence,
            lane=lane,
            suppressed=False,
            suppress_reason=None,
        )

    if lane == "trend" and reading.confidence >= trend_confidence_threshold:
        return ChopSuppressionResult(
            regime=reading.regime,
            confidence=reading.confidence,
            lane=lane,
            suppressed=True,
            suppress_reason=(
                f"regime_suppress: chop confidence {reading.confidence:.3f}, lane trend"
            ),
        )

    if lane == "swing" and reading.confidence >= swing_confidence_threshold:
        return ChopSuppressionResult(
            regime=reading.regime,
            confidence=reading.confidence,
            lane=lane,
            suppressed=True,
            suppress_reason=(
                f"regime_suppress: chop confidence {reading.confidence:.3f}, lane swing"
            ),
        )

    return ChopSuppressionResult(
        regime=reading.regime,
        confidence=reading.confidence,
        lane=lane,
        suppressed=False,
        suppress_reason=None,
    )
