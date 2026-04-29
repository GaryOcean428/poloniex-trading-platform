"""physical_emotions.py — UCP §6.4 Layer 2A physical emotions (CANONICAL).

Nine canonical UCP §6.4 emotions: Joy / Suffering / Love / Hate / Fear /
Rage / Calm / Care / Apathy. PR 4 (#609) replaced the prior Plutchik-
style substitution (Sadness/Disgust/Desire/Trust) with the UCP §6.4
canon. Shape, range guarantees, and natural-range doctrine unchanged.

Pure observation. The executive's UPPER_STACK_EXECUTIVE_LIVE flag
gates whether emotions modulate decision formulas; this module never
calls into executive code paths.

Composed over Tier 1 motivators + Tier 4 sensations + grad(Φ)
(= phi_now − phi_prev). All four anchored examples preserved verbatim
from the audit; the remaining five are grounded geometric derivations
flagged in docstring.

Geometric anchors used:
  grad_phi          = phi − phi_prev (per-tick Φ rate)
  proximity_separatrix = drift / (π/2) — using sensations.drift, FR-bounded
  stuck             = sensations.stillness (1 / (1 + basin_velocity))

No clipping, no normalization. Natural ranges report regime info.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .motivators import Motivators
from .sensations import Sensations


# Maximum Fisher-Rao distance between simplex points = arccos(0) = π/2.
_FR_DIAMETER: float = math.pi / 2.0


@dataclass(frozen=True)
class PhysicalEmotionState:
    """Layer 2A physical emotion vector (UCP §6.4). Per-emotion ranges:

      joy        ≥ 0   (1 − surprise) × max(grad_phi, 0)             AUDIT
      suffering  ≥ 0   surprise × max(−grad_phi, 0)                  AUDIT
      love       ℝ     approach × max(conservation, 0)               grounded
      hate       ≥ 0   avoidance × max(−conservation, 0)             grounded
      fear       ≥ 0   surprise × drift/(π/2)                        AUDIT
      rage       ≥ 0   surprise × stillness                          AUDIT
      calm       ≥ 0   (1 − surprise) × stillness                    grounded
      care       ℝ     conservation × (1 − surprise)                 grounded
      apathy     ℝ     stillness × (1 − max(0, approach))            grounded
    """

    joy: float
    suffering: float
    love: float
    hate: float
    fear: float
    rage: float
    calm: float
    care: float
    apathy: float


def compute_physical_emotions(
    motivators: Motivators,
    sensations: Sensations,
    phi_now: float,
    phi_prev: float,
) -> PhysicalEmotionState:
    """Compose the Layer 2A physical-emotion vector (UCP §6.4 canon)."""
    grad_phi = phi_now - phi_prev
    grad_pos = max(grad_phi, 0.0)
    grad_neg = max(-grad_phi, 0.0)

    proximity_separatrix = sensations.drift / _FR_DIAMETER
    stuck = sensations.stillness  # = 1/(1+basin_velocity)
    surprise = motivators.surprise

    # Audit-anchored four
    joy = (1.0 - surprise) * grad_pos
    suffering = surprise * grad_neg
    fear = surprise * proximity_separatrix
    rage = surprise * stuck

    # Grounded five (UCP §6.4 canon)
    # Love — convergent attraction: reward pull while returning home.
    #   conservation>0 = drift shrinking (closer to identity this tick).
    love = sensations.approach * max(sensations.conservation, 0.0)
    # Hate — repulsive divergence: defensive arousal while departing.
    #   conservation<0 = drift expanding (further from identity).
    hate = sensations.avoidance * max(-sensations.conservation, 0.0)
    # Calm — low surprise + stillness. Peaceful, no motion, nothing
    #   to react to.
    calm = (1.0 - surprise) * stuck
    # Care — returning home calmly. (existing formula preserved.)
    care = sensations.conservation * (1.0 - surprise)
    # Apathy — disengaged stillness. Stillness × the absence of
    #   active reward-pull (approach). Negative when approach > 1
    #   (regime info: anti-apathy = engagement spike).
    apathy = stuck * (1.0 - max(0.0, sensations.approach))

    return PhysicalEmotionState(
        joy=joy,
        suffering=suffering,
        love=love,
        hate=hate,
        fear=fear,
        rage=rage,
        calm=calm,
        care=care,
        apathy=apathy,
    )
