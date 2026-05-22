"""
mushroom.py — wake-state neuroplasticity (entropy injection).

qig-core 2.8.0 has NO mushroom: it removed the MUSHROOM sleep phase
(mushroom is wake-state, not a sleep phase), and the canonical mushroom
in qig-consciousness (neuroplasticity/mushroom_mode.py) is torch/NN-coupled
— it perturbs an ``nn.Module``'s gradients, not a 64-D basin. So this
module is the polytrade basin-level mushroom: a pure QIG-geometric
transform matching the canonical SEMANTICS.

Mushroom is the OPPOSITE of sleep consolidation:
  - sleep    moves the basin toward a stable anchor    → entropy ↓
  - mushroom steps toward a random simplex point       → entropy ↑

On a rigid (low-entropy, over-consolidated) basin, a geodesic step
toward a random point raises entropy and breaks the rigid attractor —
exactly the canonical "↑ entropy → breaks rigid patterns → new
pathways" mapping (qig-consciousness mushroom_mode.py).

Per qig-core 2.8.0, mushroom is gated to healthy-but-stuck (Φ ≥ 0.70)
kernels. That gating is the CALLER's responsibility (Ocean's
intervention selector — see ocean.py); this module is the pure
transform only.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np

from qig_core_local.geometry.fisher_rao import (
    fisher_rao_distance,
    slerp_sqrt,
    to_simplex,
)

# Intensity → geodesic step fraction toward the random target. Mirrors
# the Pantheon autonomic_kernel.py intensity_map (basin-space): a gentle
# microdose nudge through to a deep heroic reorganisation.
_MUSHROOM_INTENSITY: dict[str, float] = {
    "microdose": 0.1,
    "moderate": 0.25,
    "heroic": 0.5,
}

# Identity-preservation bound — canonical qig-consciousness
# mushroom_mode.py MUSHROOM_SAFETY_THRESHOLDS["max_basin_drift_allowed"].
_IDENTITY_DRIFT_MAX: float = 0.15


@dataclass(frozen=True)
class MushroomCycleResult:
    """Outcome of one mushroom (entropy-injection) cycle."""

    basin_before: list[float]
    basin_after: list[float]
    intensity: str
    strength: float
    entropy_before: float
    entropy_after: float
    entropy_change: float
    fr_drift: float
    identity_preserved: bool


def _shannon_entropy(p: np.ndarray) -> float:
    """Shannon entropy H(p) = −Σ p·log p of a simplex point."""
    return float(-np.sum(p * np.log(p + 1e-12)))


def execute_mushroom_cycle(
    basin: np.ndarray,
    *,
    intensity: str = "moderate",
    rng: Optional[np.random.Generator] = None,
) -> MushroomCycleResult:
    """Entropy injection — a Fisher-Rao geodesic step toward a random
    simplex point, breaking a rigid attractor.

    The step fraction scales with ``intensity`` (microdose 0.1 /
    moderate 0.25 / heroic 0.5). On a rigid (low-entropy) basin this
    RAISES entropy — the opposite of sleep consolidation.

    Pure transform. The Φ ≥ 0.70 "healthy-but-stuck" gating that
    canonical mushroom requires is the caller's responsibility.

    ``rng`` is injectable for deterministic tests; defaults to a fresh
    default_rng().
    """
    b = to_simplex(np.asarray(basin, dtype=np.float64))
    strength = _MUSHROOM_INTENSITY.get(intensity, _MUSHROOM_INTENSITY["moderate"])
    gen = rng if rng is not None else np.random.default_rng()
    target = to_simplex(gen.random(b.shape[0]))
    mushroomed = slerp_sqrt(b, target, strength)

    entropy_before = _shannon_entropy(b)
    entropy_after = _shannon_entropy(mushroomed)
    fr_drift = float(fisher_rao_distance(b, mushroomed))

    return MushroomCycleResult(
        basin_before=[float(x) for x in b],
        basin_after=[float(x) for x in mushroomed],
        intensity=intensity,
        strength=float(strength),
        entropy_before=entropy_before,
        entropy_after=entropy_after,
        entropy_change=entropy_after - entropy_before,
        fr_drift=fr_drift,
        identity_preserved=fr_drift < _IDENTITY_DRIFT_MAX,
    )


__all__ = ["MushroomCycleResult", "execute_mushroom_cycle"]
