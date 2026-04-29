"""physical_emotions.py — UCP §6.4 Layer 2A physical emotions.

Nine physical-affect emotions composed over Tier 1 motivators + Tier 4
sensations + a single new geometric reading: grad(Φ) computed as the
time-derivative `phi_now − phi_prev` between consecutive ticks. Pure
observation — the executive does not consume these.

Audit (#593) gave four anchored derivations with examples:
  Joy       = (1 − Surprise) × (grad(Φ) > 0)      ← canonical
  Suffering = Surprise × (grad(Φ) < 0)             ← canonical
  Fear      = Surprise × Proximity(Separatrix)    ← canonical
  Rage      = Surprise × Stuck                    ← canonical

The remaining five (Sadness / Disgust / Desire / Care / Trust) are
the standard primary-affect set and ship with geometric derivations
that flow naturally from the same vocabulary the audited four use.
Each is documented with its grounding so the canonical UCP §6.4
list, when consulted, can swap individual formulas without touching
the dataclass shape.

Geometric anchors used here:
  grad_phi          = phi − phi_prev (per-tick Φ rate)
  proximity_separatrix = drift / (π/2)  — using Tier 4 sensations.drift
                                          normalised to the FR-simplex
                                          maximum diameter; high when
                                          basin sits close to leaving
                                          identity's attractor basin
  stuck             = stillness — Tier 4 sensations.stillness
                                  (1/(1+basin_velocity))

No clipping, no normalisation. Natural ranges report regime info.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .motivators import Motivators
from .sensations import Sensations


# Maximum Fisher-Rao distance between simplex points = arccos(0) = π/2.
# Used to normalise drift into a [0, 1] separatrix-proximity proxy.
_FR_DIAMETER: float = math.pi / 2.0


@dataclass(frozen=True)
class PhysicalEmotionState:
    """Layer 2A physical emotion vector. Per-emotion natural ranges:

      joy        ≥ 0   (1 − surprise) × max(grad_phi, 0)
      suffering  ≥ 0   surprise × max(−grad_phi, 0)
      fear       ≥ 0   surprise × proximity_separatrix
      rage       ≥ 0   surprise × stuck
      sadness    ≥ 0   (1 − surprise) × max(−grad_phi, 0)
      disgust    ≥ 0   surprise × resonance
      desire     ℝ     approach × max(grad_phi, 0)   (negative when GABA dominates)
      care       ℝ     conservation × (1 − surprise) (signed via conservation)
      trust      ℝ     (1 − avoidance) × resonance
    """

    joy: float
    suffering: float
    fear: float
    rage: float
    sadness: float
    disgust: float
    desire: float
    care: float
    trust: float


def compute_physical_emotions(
    motivators: Motivators,
    sensations: Sensations,
    phi_now: float,
    phi_prev: float,
) -> PhysicalEmotionState:
    """Compose the Layer 2A physical-emotion vector.

    Parameters
    ----------
    motivators : Motivators
        Tier 1 outputs. Surprise (= ne) is the dominant driver of the
        "negative" affects (Suffering / Fear / Rage / Disgust).
    sensations : Sensations
        Tier 4 outputs. Provides resonance, drift, stillness, approach,
        avoidance, conservation.
    phi_now, phi_prev : float
        Φ at this tick and the previous one. grad(Φ) = phi_now − phi_prev.
        On cold start the caller passes phi_prev == phi_now → grad = 0,
        which collapses Joy / Suffering / Sadness / Desire to 0.
    """
    grad_phi = phi_now - phi_prev
    grad_pos = max(grad_phi, 0.0)
    grad_neg = max(-grad_phi, 0.0)

    # Separatrix proximity — drift normalised by FR diameter. drift is
    # bounded to [0, π/2] by Fisher-Rao, so this lands in [0, 1].
    proximity_separatrix = sensations.drift / _FR_DIAMETER
    stuck = sensations.stillness

    surprise = motivators.surprise

    # Canonical four (per audit examples):
    joy = (1.0 - surprise) * grad_pos
    suffering = surprise * grad_neg
    fear = surprise * proximity_separatrix
    rage = surprise * stuck

    # Remaining five — geometrically grounded, awaiting canonical
    # name-mapping confirmation:
    sadness = (1.0 - surprise) * grad_neg            # Φ falling, no surprise
    disgust = surprise * sensations.resonance        # surprise at familiarity
    desire = sensations.approach * grad_pos          # reward pull while Φ rises
    care = sensations.conservation * (1.0 - surprise)  # returning home calmly
    trust = (1.0 - sensations.avoidance) * sensations.resonance

    return PhysicalEmotionState(
        joy=joy,
        suffering=suffering,
        fear=fear,
        rage=rage,
        sadness=sadness,
        disgust=disgust,
        desire=desire,
        care=care,
        trust=trust,
    )
