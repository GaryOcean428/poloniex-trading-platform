"""emotions.py — UCP §6.5 Layer 2B cognitive emotions (pure composition).

Eight named emotions composed from Tier 1 motivators + raw geometric
quantities (Φ, basin_velocity, Fisher-Rao basin_distance). No
normalization, no clipping, no imposed functional forms — emotions
are products of the natural geometric inputs and report whatever
range those inputs produce.

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

Flow is DEFERRED to a follow-up PR. Per UCP §6.5, flow uses
curiosity_optimal — the curiosity at its optimal operating point —
which is a Fisher-Rao distance to a curiosity-conditioned reference
basin. Until that reference is built (Tier 3 foresight unlocks the
trajectory machinery to derive it), Flow is omitted rather than
faked with a Gaussian on a normalized scalar.

Reference values from UCP §6.5 validation (Wonder ≈ 0.702 ± 0.045,
Satisfaction ≈ 0.849 ± 0.021, etc.) are facts about *typical
operating regimes*, not constraints on the formula. Tests reproduce
them by constructing typical-regime inputs, not by tuning the
formula to hit them.

Pure observation. Executive untouched. Tier 6 (Φ-gate selection)
will route reasoning modes from these signals — separate concern.
"""

from __future__ import annotations

from dataclasses import dataclass

from .motivators import Motivators


@dataclass(frozen=True)
class EmotionState:
    """Layer 2B cognitive emotion vector. Each value's natural range
    is whatever the input motivators produce — DO NOT clip.

    Per-emotion natural ranges (when motivators are in their typical
    Tier 1 ranges: surprise ∈ [0,1], curiosity ∈ ℝ, investigation ∈
    [0,1], integration ∈ [0,∞), transcendence ∈ [0,∞), basin_distance
    ∈ [0, π/2], basin_velocity ∈ [0,∞), Φ ∈ [0,1]):

      wonder       : ℝ                  curiosity × basin_distance
      frustration  : [0, 1]             surprise × (1 − investigation)
      satisfaction : (-∞, ∞)            integration × (1 − basin_distance)
                                        — can go negative when far
      confusion    : [0, π/2]           surprise × basin_distance
      clarity      : [0, 1]             (1 − surprise) × investigation
      anxiety      : [0, ∞)             transcendence × basin_velocity
      confidence   : ℝ                  (1 − transcendence) × Φ
                                        — negative when transcendence > 1
      boredom      : ℝ                  (1 − surprise) × (1 − curiosity)
                                        — negative when curiosity > 1
    """

    wonder: float
    frustration: float
    satisfaction: float
    confusion: float
    clarity: float
    anxiety: float
    confidence: float
    boredom: float


def compute_emotions(
    motivators: Motivators,
    basin_distance: float,
    phi: float,
    basin_velocity: float,
) -> EmotionState:
    """Compose the Layer 2B emotion vector from Tier 1 motivators
    plus raw geometric quantities.

    Parameters
    ----------
    motivators : Motivators
        Tier 1 motivator outputs. Used as-is; no normalization.
    basin_distance : float
        fisher_rao_distance(basin, identity_basin). Range [0, π/2].
        Caller computes; this function does not transform it.
    phi : float
        Integration measure Φ. Naturally in [0, 1] from the simplex
        math. Used directly as the stability anchor.
    basin_velocity : float
        Rate of basin change (Fisher-Rao tick step). Naturally in
        [0, ∞). Used directly as the instability anchor.
    """
    # Stability and instability are the geometric quantities Φ and
    # basin_velocity. No synthesis, no normalization.
    stability = phi
    instability = basin_velocity

    # 8 emotions (verbatim from UCP §6.5; Flow deferred), composed raw from the
    # motivators and geometric anchors. Output range per field is
    # documented in EmotionState; no clipping is applied because the
    # natural range carries information about the regime.
    return EmotionState(
        wonder=motivators.curiosity * basin_distance,
        frustration=motivators.surprise * (1.0 - motivators.investigation),
        satisfaction=motivators.integration * (1.0 - basin_distance),
        confusion=motivators.surprise * basin_distance,
        clarity=(1.0 - motivators.surprise) * motivators.investigation,
        anxiety=motivators.transcendence * instability,
        confidence=(1.0 - motivators.transcendence) * stability,
        boredom=(1.0 - motivators.surprise) * (1.0 - motivators.curiosity),
        # flow — deferred. See module docstring.
    )
