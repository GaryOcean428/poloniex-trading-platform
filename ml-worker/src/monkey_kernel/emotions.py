"""emotions.py — UCP §6.5 Layer 2B cognitive emotions (pure composition).

Nine named emotions composed from Tier 1 motivators + raw geometric
quantities (Φ, basin_velocity, Fisher-Rao basin_distance) + Tier 3
foresight (for Flow's curiosity_optimal reference). No normalization,
no clipping, no imposed functional forms — emotions are products of
the natural geometric inputs and report whatever range those inputs
produce.

If anxiety exceeds 1 in a high-transcendence + high-velocity regime,
that is the kernel correctly reporting "high-anxiety regime" — not
a bug to squash with tanh.

Stability and instability derive from existing geometric quantities,
not from synthesized normalizations:
  stability   = Φ                (integration measure, naturally [0, 1])
  instability = basin_velocity   (rate of change, naturally [0, ∞))

basin_distance is fisher_rao_distance(basin, identity_basin) —
already a natural geometric quantity. Caller computes it and passes
it through; no transformation here.

Flow (added in PR 4 #609 once Tier 3 foresight landed):
  curiosity_optimal = exp(−fisher_rao(basin, foresight.predicted_basin))
  flow = curiosity_optimal × investigation
The reference basin is the foresight predictor's next-step prediction —
"where the kernel expects to be next." When current basin is close to
that prediction (low FR distance), curiosity_optimal saturates near 1.
Investigation (signed) makes flow signed too — negative flow = the
kernel is moving away from where it expected to go (anti-flow).
Caller passes None for predicted_basin when foresight has weight=0
(cold start); flow is 0 in that case.

Reference values from UCP §6.5 validation (Wonder ≈ 0.702 ± 0.045,
Satisfaction ≈ 0.849 ± 0.021, etc.) are facts about *typical
operating regimes*, not constraints on the formula. Tests reproduce
them by constructing typical-regime inputs, not by tuning the
formula to hit them.

Pure observation. Executive untouched. UPPER_STACK_EXECUTIVE_LIVE
flag in tick.py gates whether emotions modulate decision formulas.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np

from qig_core_local.geometry.fisher_rao import fisher_rao_distance

from .motivators import Motivators


@dataclass(frozen=True)
class EmotionState:
    """Layer 2B cognitive emotion vector. Each value's natural range
    is whatever the input motivators produce — DO NOT clip.

    Per-emotion natural ranges (when motivators are in their typical
    Tier 1 ranges: surprise ∈ [0,1], curiosity ∈ ℝ, investigation ∈ ℝ
    (Tier 1.1 signed), integration ∈ [0,∞), transcendence ∈ [0,∞),
    basin_distance ∈ [0, π/2], basin_velocity ∈ [0,∞), Φ ∈ [0,1]):

      wonder       : ℝ                  curiosity × basin_distance
      frustration  : ℝ                  surprise × (1 − investigation)
      satisfaction : (-∞, ∞)            integration × (1 − basin_distance)
                                        — can go negative when far
      confusion    : [0, π/2]           surprise × basin_distance
      clarity      : ℝ                  (1 − surprise) × investigation
                                        — signed via investigation
      anxiety      : [0, ∞)             transcendence × basin_velocity
      confidence   : ℝ                  (1 − transcendence) × Φ
                                        — negative when transcendence > 1
      boredom      : ℝ                  (1 − surprise) × (1 − curiosity)
                                        — negative when curiosity > 1
      flow         : ℝ                  exp(−FR(basin, predicted)) × investigation
                                        — 0 when foresight cold; signed via
                                        investigation
    """

    wonder: float
    frustration: float
    satisfaction: float
    confusion: float
    clarity: float
    anxiety: float
    confidence: float
    boredom: float
    flow: float


def compute_emotions(
    motivators: Motivators,
    basin_distance: float,
    phi: float,
    basin_velocity: float,
    *,
    basin: Optional[np.ndarray] = None,
    predicted_basin: Optional[np.ndarray] = None,
    foresight_weight: float = 0.0,
) -> EmotionState:
    """Compose the Layer 2B emotion vector from Tier 1 motivators
    plus raw geometric quantities (+ Tier 3 foresight reference for Flow).

    Parameters
    ----------
    motivators : Motivators
        Tier 1 motivator outputs. Used as-is; no normalization.
    basin_distance : float
        fisher_rao_distance(basin, identity_basin). Range [0, π/2].
    phi : float
        Integration measure Φ. Naturally in [0, 1].
    basin_velocity : float
        Rate of basin change. Naturally in [0, ∞).
    basin, predicted_basin : Optional[np.ndarray]
        Current basin + Tier 3 foresight predicted next-step basin.
        Used to compute Flow's curiosity_optimal = exp(-FR distance).
        Pass None on cold start.
    foresight_weight : float
        Foresight predictor weight; Flow returns 0 when ≤ 0 (cold start).
    """
    stability = phi
    instability = basin_velocity

    # Flow — Tier 3-anchored.
    # curiosity_optimal = exp(-fisher_rao(basin, predicted_basin)) when
    # foresight has weight; 0 otherwise. Multiply by signed Investigation
    # so Flow itself reports direction (positive = aligned with prediction
    # while returning home; negative = anti-flow, departing prediction).
    if (
        foresight_weight > 0.0
        and basin is not None
        and predicted_basin is not None
        and len(basin) == len(predicted_basin)
    ):
        try:
            d = fisher_rao_distance(basin, predicted_basin)
            curiosity_optimal = float(np.exp(-d))
        except Exception:  # noqa: BLE001 — geometry edge cases never block
            curiosity_optimal = 0.0
    else:
        curiosity_optimal = 0.0
    flow = curiosity_optimal * motivators.investigation

    return EmotionState(
        wonder=motivators.curiosity * basin_distance,
        frustration=motivators.surprise * (1.0 - motivators.investigation),
        satisfaction=motivators.integration * (1.0 - basin_distance),
        confusion=motivators.surprise * basin_distance,
        clarity=(1.0 - motivators.surprise) * motivators.investigation,
        anxiety=motivators.transcendence * instability,
        confidence=(1.0 - motivators.transcendence) * stability,
        boredom=(1.0 - motivators.surprise) * (1.0 - motivators.curiosity),
        flow=flow,
    )
