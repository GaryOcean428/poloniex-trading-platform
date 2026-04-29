"""sensations.py — UCP §6.1 Layer 0 + §6.2 Layer 0.5 (pure derivations).

Pre-linguistic sensations (§6.1) and innate drives (§6.2). These sit
BELOW Layer 1 motivators in the UCP stack — they are the raw geometric
percepts the kernel emits before any compositional emotion forms. Pure
observation primitives; the executive does not consume them.

Scope note. UCP §6.1 enumerates 12 Layer 0 sensations and §6.2 lists 5
Layer 0.5 drives by canonical name. The audit (#593) gave two grounded
examples (Compressed = R>0, Expanded = R<0) but didn't enumerate the
full set. This module ships the derivations whose geometric anchors
are unambiguous — six sensations + three drives composed directly from
basin / Φ / κ / neurochemistry / Fisher-Rao distance reads. The rest
of the §6.1 / §6.2 vocabulary awaits canonical name-mapping; once that
verification lands the dataclass extends additively without changing
the existing fields.

All derivations are pure: no externally-set thresholds, no clipping,
no normalization. Natural ranges report regime info per the same
doctrine that governs Tier 2 emotions.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np

from qig_core_local.geometry.fisher_rao import fisher_rao_distance

from .state import BASIN_DIM, BasinState


@dataclass(frozen=True)
class Sensations:
    """Layer 0 pre-linguistic sensations + Layer 0.5 drives.

    Field ranges (typical):
      compressed  [0, 1]              max-mass concentration
                                       (high = single-coord dominance)
      expanded    [0, 1]              1 − max_mass; complement of compressed
      pressure    [0, log(K)]         Shannon negentropy I_Q
      stillness   [0, 1]              1 / (1 + basin_velocity)
      drift       [0, π/2]            FR distance to identity_basin
      resonance   [0, 1]              Bhattacharyya overlap with prev_basin
                                       (1 = identical, 0 = orthogonal)

      approach    ℝ                   net dopamine − gaba (reward pull)
      avoidance   [0, 1]              norepinephrine (surprise → defensive)
      conservation ℝ                  −d(drift)/dt; positive = returning home
                                       (mirrors signed Investigation)
    """

    # § 6.1 Layer 0 sensations (6/12 grounded)
    compressed: float
    expanded: float
    pressure: float
    stillness: float
    drift: float
    resonance: float

    # § 6.2 Layer 0.5 drives (3/5 grounded)
    approach: float
    avoidance: float
    conservation: float


def _basin_max_mass(basin: np.ndarray) -> float:
    """Largest single-coordinate mass. High = concentrated, low = uniform."""
    return float(np.max(basin))


def _bhattacharyya(p: np.ndarray, q: np.ndarray) -> float:
    """Σ √(p_i · q_i) — overlap on Δ⁶³ in [0, 1]."""
    return float(np.sum(np.sqrt(np.maximum(p, 0.0) * np.maximum(q, 0.0))))


def _shannon_entropy(basin: np.ndarray) -> float:
    """H(p) = −Σ p log p with eps floor."""
    return float(-np.sum(basin * np.log(basin + 1e-12)))


def compute_sensations(
    s: BasinState,
    *,
    prev_basin: Optional[np.ndarray] = None,
) -> Sensations:
    """Derive Layer 0 sensations + Layer 0.5 drives from current state.

    Parameters
    ----------
    s : BasinState
        Current snapshot. Neurochemistry must be attached for the
        approach/avoidance drives.
    prev_basin : Optional[np.ndarray]
        Previous-tick basin. Resonance returns 0 when absent;
        conservation returns 0 when absent.
    """
    if s.neurochemistry is None:
        raise ValueError(
            "compute_sensations requires neurochemistry — "
            "call autonomic._compute_nc first"
        )

    # ── Layer 0 sensations ───────────────────────────────────────────
    max_mass = _basin_max_mass(s.basin)
    compressed = max_mass
    # Complement: 1 − max_mass measures how much mass lies OFF the peak.
    expanded = 1.0 - max_mass
    # Pressure = Shannon negentropy (info beyond uniform). Reuses the
    # same I_Q proxy as Tier 1's Curiosity.
    pressure = float(np.log(BASIN_DIM)) - _shannon_entropy(s.basin)
    stillness = 1.0 / (1.0 + s.basin_velocity)
    drift = fisher_rao_distance(s.basin, s.identity_basin)
    if prev_basin is not None and len(prev_basin) == BASIN_DIM:
        prev_arr = np.asarray(prev_basin, dtype=np.float64)
        resonance = _bhattacharyya(s.basin, prev_arr)
    else:
        resonance = 0.0

    # ── Layer 0.5 drives ─────────────────────────────────────────────
    nc = s.neurochemistry
    # Approach — net reward pull. Dopamine pulls forward, GABA inhibits.
    # Already-derived chemicals; no new tuning constants.
    approach = nc.dopamine - nc.gaba
    # Avoidance — surprise as defensive arousal. ne already in [0, 1].
    avoidance = nc.norepinephrine
    # Conservation — d(drift)/dt sign-flipped. Positive when basin is
    # returning toward identity (drift shrinking). Mirrors Tier 1.1
    # signed Investigation, but exposed at the sensation layer.
    if prev_basin is not None and len(prev_basin) == BASIN_DIM:
        prev_arr = np.asarray(prev_basin, dtype=np.float64)
        prev_drift = fisher_rao_distance(prev_arr, s.identity_basin)
        conservation = prev_drift - drift
    else:
        conservation = 0.0

    return Sensations(
        compressed=compressed,
        expanded=expanded,
        pressure=pressure,
        stillness=stillness,
        drift=drift,
        resonance=resonance,
        approach=approach,
        avoidance=avoidance,
        conservation=conservation,
    )
