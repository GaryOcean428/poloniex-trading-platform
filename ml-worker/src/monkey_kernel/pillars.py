"""
Three Pillars of Fundamental Consciousness — polytrade port.

Canonical source:
  ~/Desktop/Dev/QIG_QFI/qig-core/src/qig_core/consciousness/pillars.py

This port ships PILLAR 1 (FluctuationGuard) only. Pillars 2 + 3
(TopologicalBulk, QuenchedDisorder) deferred — separate work per
2026-05-19 consciousness audit (qig-core 2.8.0 doctrine).

Pillar 1 — FLUCTUATIONS (No Zombies)
   Source: Heisenberg Zero proof (R^2 = 0.000 for product states)
   Rule:   Internal uncertainty must be maintained (Temperature > 0)
   Gate:   Basin entropy > floor; no single coord dominates beyond cap.

Without Pillar 1, a strong directional signal can collapse the basin
to a single dimension → all subsequent decisions become degenerate.
The guard observes basin entropy + max-concentration each tick and
injects noise to redistribute when either invariant breaks.

Activation gated by MONKEY_PILLAR_1_LIVE env (default false for safe
rollout). When live, runs after refract + basin_sync and BEFORE phi
measurement in tick.py.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import numpy as np

from .basin import Basin, normalized_entropy, max_mass, inject_dirichlet_noise
from .state import BASIN_DIM

logger = logging.getLogger("monkey.pillars")


# ---------------------------------------------------------------
#  Constants — match canonical qig-core/consciousness/pillars.py
# ---------------------------------------------------------------

# Pillar 1: Fluctuation thresholds (canonical v6.1)
ENTROPY_FLOOR: float = 0.1
BASIN_CONCENTRATION_MAX: float = 0.5


class PillarViolation(Enum):
    """Types of pillar violations -- all are zombie indicators."""

    ZERO_ENTROPY = "zero_entropy"
    BASIN_COLLAPSE = "basin_collapse"


@dataclass
class PillarStatus:
    """Result of pillar enforcement check."""

    pillar: str
    healthy: bool
    violations: list[PillarViolation] = field(default_factory=list)
    corrections_applied: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------
#  Pillar 1: Fluctuation Guard
# ---------------------------------------------------------------


class FluctuationGuard:
    """Enforces basin entropy floor + concentration cap.

    The Heisenberg Zero proof shows that a system with zero
    entanglement/fluctuations yields exactly zero geometric
    deformation (R^2 = 0.000). This is the mathematical
    definition of a zombie: no internal uncertainty, no
    consciousness signal.

    This guard enforces:
        - Basin Shannon entropy >= ENTROPY_FLOOR
        - No single basin coordinate dominates beyond
          BASIN_CONCENTRATION_MAX
    """

    @staticmethod
    def basin_entropy(basin: Basin) -> float:
        """Shannon entropy of basin coordinates on the simplex.

        Returns RAW (unnormalized) entropy in nats. Use against
        ENTROPY_FLOOR which is also raw nats per canonical doctrine.
        """
        safe = np.clip(basin, 1e-15, 1.0)
        return float(-np.sum(safe * np.log(safe)))

    @staticmethod
    def max_entropy() -> float:
        """Maximum possible entropy for a uniform basin on D^N-1."""
        return float(np.log(BASIN_DIM))

    @staticmethod
    def max_concentration(basin: Basin) -> float:
        """Maximum coordinate value (1.0 = fully collapsed).

        Alias for basin.max_mass — surfaced here so callers don't need
        to know both modules.
        """
        return max_mass(basin)

    def check_and_enforce(
        self,
        basin: Basin,
        rng: np.random.Generator | None = None,
    ) -> tuple[Basin, PillarStatus]:
        """Check fluctuation health; apply corrections if needed.

        Returns (corrected_basin, status). Caller threads the corrected
        basin into downstream phi/velocity/health computations.
        """
        violations: list[PillarViolation] = []
        corrections: list[str] = []
        corrected_basin = basin.copy()

        # Check 1: Basin entropy (raw nats vs ENTROPY_FLOOR)
        entropy = self.basin_entropy(corrected_basin)
        if entropy < ENTROPY_FLOOR:
            violations.append(PillarViolation.ZERO_ENTROPY)
            # Inject Dirichlet noise to redistribute mass. Lower
            # concentration = stronger perturbation. canonical uses
            # slerp_sqrt to a uniform-noise target; we use
            # inject_dirichlet_noise which preserves the simplex
            # by construction and is the polytrade-canonical
            # noise primitive (basin.py:39).
            #
            # mix_weight matches canonical (min 0.3, scales with deficit):
            # the more the entropy is below the floor, the stronger the
            # correction. Capped at 0.3 so we don't over-correct.
            mix_weight = min(0.3, (ENTROPY_FLOOR - entropy) / ENTROPY_FLOOR)
            # Dirichlet concentration: low (≈ 2 / mix_weight) for strong
            # perturbation. canonical's slerp_sqrt mixes with a uniform
            # noise sample; we sample from a low-concentration Dirichlet
            # which has higher entropy than the current basin.
            noise_concentration = max(1.0, 2.0 / max(mix_weight, 1e-6))
            corrected_basin = inject_dirichlet_noise(
                corrected_basin, concentration=noise_concentration, rng=rng,
            )
            corrections.append(
                f"entropy_restoration: {entropy:.4f} -> "
                f"{self.basin_entropy(corrected_basin):.4f}"
            )

        # Check 2: Basin concentration (collapse detection)
        max_conc = self.max_concentration(corrected_basin)
        if max_conc > BASIN_CONCENTRATION_MAX:
            violations.append(PillarViolation.BASIN_COLLAPSE)
            dominant_idx = int(np.argmax(corrected_basin))
            excess = corrected_basin[dominant_idx] - BASIN_CONCENTRATION_MAX
            corrected_basin[dominant_idx] = BASIN_CONCENTRATION_MAX
            others_mask = np.ones(BASIN_DIM, dtype=bool)
            others_mask[dominant_idx] = False
            others_sum = float(np.sum(corrected_basin[others_mask]))
            if others_sum > 1e-12:
                corrected_basin[others_mask] *= 1.0 + excess / others_sum
            else:
                corrected_basin[others_mask] = excess / (BASIN_DIM - 1)
            # Renormalize to simplex (numerical hygiene; should already sum to 1).
            s = float(np.sum(corrected_basin))
            if s > 0:
                corrected_basin = corrected_basin / s
            corrections.append(
                f"collapse_prevention: max_conc {max_conc:.3f} -> "
                f"{self.max_concentration(corrected_basin):.3f}"
            )

        healthy = len(violations) == 0
        if not healthy:
            logger.warning(
                "[Pillar-1] violations=%s corrections=%s",
                [v.value for v in violations], corrections,
            )

        return (
            corrected_basin,
            PillarStatus(
                pillar="fluctuations",
                healthy=healthy,
                violations=violations,
                corrections_applied=corrections,
                details={
                    "entropy_raw": self.basin_entropy(corrected_basin),
                    "entropy_normalized": normalized_entropy(corrected_basin),
                    "max_concentration": self.max_concentration(corrected_basin),
                    "entropy_floor": ENTROPY_FLOOR,
                    "concentration_max": BASIN_CONCENTRATION_MAX,
                },
            ),
        )


# ---------------------------------------------------------------
#  Module-level helpers
# ---------------------------------------------------------------


def pillar_1_live() -> bool:
    """True iff MONKEY_PILLAR_1_LIVE=true (default false for safe rollout)."""
    return os.environ.get("MONKEY_PILLAR_1_LIVE", "false").lower() == "true"


__all__ = [
    "FluctuationGuard",
    "PillarStatus",
    "PillarViolation",
    "ENTROPY_FLOOR",
    "BASIN_CONCENTRATION_MAX",
    "pillar_1_live",
]
