"""emotions.py — Layer 2B cognitive emotions derived from Layer 1 motivators.

Tier 2 implementation for UCP §6.5 cognitive emotions.
Outputs are normalized [0, 1] scalars and computed as pure compositions.
"""

from __future__ import annotations

from dataclasses import dataclass

from .motivators import Layer1Motivators
from .scalars import clip


@dataclass(frozen=True)
class Layer2BCognitiveEmotions:
    wonder: float
    frustration: float
    satisfaction: float
    confusion: float
    clarity: float
    anxiety: float
    confidence: float
    boredom: float
    flow: float


def compute_layer2b_emotions(
    *,
    motivators: Layer1Motivators,
    phi: float,
    basin_velocity: float,
    drift_distance: float,
) -> Layer2BCognitiveEmotions:
    """Compose Layer 2B cognitive emotions from Layer 1 + geometric state."""
    phi_c = clip(phi)
    vel_c = clip(basin_velocity * 20.0)
    drift_c = clip(drift_distance / 2.0)

    wonder = clip(motivators.curiosity * (0.65 + 0.35 * phi_c) * (1.0 - 0.4 * vel_c))
    anxiety = clip(
        motivators.surprise
        * (1.0 - motivators.integration)
        * (0.55 + 0.45 * vel_c)
        * (0.6 + 0.4 * drift_c)
    )
    clarity = clip(
        motivators.integration
        * motivators.investigation
        * (1.0 - 0.6 * motivators.surprise)
        * (1.0 - 0.4 * vel_c)
    )
    confusion = clip(motivators.surprise * (1.0 - clarity) * (0.7 + 0.3 * vel_c))
    frustration = clip((1.0 - motivators.investigation) * motivators.surprise * (0.7 + 0.3 * drift_c))
    satisfaction = clip(motivators.integration * (1.0 - anxiety) * (0.6 + 0.4 * motivators.transcendence))
    confidence = clip(
        (0.55 * clarity + 0.45 * motivators.transcendence)
        * (1.0 - 0.7 * anxiety)
        * (0.5 + 0.5 * phi_c)
    )
    boredom = clip((1.0 - motivators.curiosity) * motivators.integration * (1.0 - 0.5 * motivators.surprise))
    flow = clip(
        motivators.integration
        * motivators.investigation
        * confidence
        * (1.0 - 0.6 * anxiety)
        * (0.6 + 0.4 * phi_c)
    )

    return Layer2BCognitiveEmotions(
        wonder=wonder,
        frustration=frustration,
        satisfaction=satisfaction,
        confusion=confusion,
        clarity=clarity,
        anxiety=anxiety,
        confidence=confidence,
        boredom=boredom,
        flow=flow,
    )
