"""motivators.py — Layer 1 motivators derived from kernel state.

Tier 1 implementation for UCP §6.3 motivators.
Outputs are normalized scalars in [0, 1] and purely derived from the
existing kernel state surfaces (Φ, drift, basin velocity, regime, NC).
"""

from __future__ import annotations

from dataclasses import dataclass

from .scalars import clip
from .state import KAPPA_STAR, NeurochemicalState


@dataclass(frozen=True)
class Layer1Motivators:
    """Five Layer-1 motivators.

    surprise is already represented in-kernel via norepinephrine.
    curiosity/investigation/integration/transcendence are derived views.
    """

    surprise: float
    curiosity: float
    investigation: float
    integration: float
    transcendence: float


def compute_layer1_motivators(
    *,
    phi: float,
    kappa: float,
    basin_velocity: float,
    drift_distance: float,
    phi_delta: float,
    drift_delta: float,
    regime_weights: dict[str, float],
    neurochemistry: NeurochemicalState,
) -> Layer1Motivators:
    """Derive Layer 1 motivators from current geometric/neurochemical state.

    Inputs map to existing kernel surfaces already available in tick/executive
    flows. No free parameters are persisted; all outputs are closed-form.
    """
    surprise = clip(neurochemistry.norepinephrine)

    # Curiosity: positive Φ-expansion amplified by novelty, damped by rapid
    # basin movement (high movement = less coherent exploratory intent).
    novelty_drive = clip(phi_delta * 4.0)
    stillness = clip(1.0 - basin_velocity * 20.0)
    curiosity = clip(0.55 * novelty_drive + 0.35 * surprise + 0.10 * stillness)

    # Investigation: active attractor pursuit = shrinking drift + directional
    # novelty while avoiding pure noise-chasing under very high velocity.
    closing_on_identity = clip(-drift_delta * 3.0)
    stability = clip(1.0 - basin_velocity * 15.0)
    investigation = clip(0.60 * closing_on_identity + 0.25 * surprise + 0.15 * stability)

    # Integration: consolidated coherent state from Φ + serotonin + low motion.
    coherence = clip(phi) * clip(neurochemistry.serotonin)
    integration = clip(coherence * clip(1.0 - basin_velocity * 10.0))

    # Transcendence: κ* proximity + endorphin coupling + equilibrium tendency.
    kappa_proximity = clip(1.0 - abs(kappa - KAPPA_STAR) / KAPPA_STAR)
    eq_weight = clip(regime_weights.get("equilibrium", 0.5))
    transcendence = clip(
        neurochemistry.endorphins * (0.6 + 0.4 * eq_weight) * (0.5 + 0.5 * kappa_proximity)
    )

    # Extreme drift degrades integrative motivators.
    drift_penalty = clip(drift_distance / 2.0)
    integration = clip(integration * (1.0 - 0.5 * drift_penalty))
    transcendence = clip(transcendence * (1.0 - 0.35 * drift_penalty))

    return Layer1Motivators(
        surprise=surprise,
        curiosity=curiosity,
        investigation=investigation,
        integration=integration,
        transcendence=transcendence,
    )
