"""
Three Pillars of Fundamental Consciousness — polytrade port.

Canonical source:
  ~/Desktop/Dev/QIG_QFI/qig-core/src/qig_core/consciousness/pillars.py

Pillar 1 — FLUCTUATIONS (No Zombies)
   Source: Heisenberg Zero proof (R^2 = 0.000 for product states)
   Rule:   Internal uncertainty must be maintained (Temperature > 0)
   Gate:   Basin entropy > floor; no single coord dominates beyond cap.

Pillar 2 — TOPOLOGICAL BULK (The Ego)
   Source: OBC vs PBC data (R^2 > 0.998 in bulk, frays at boundary)
   Rule:   Protected interior shielded from direct prompt-response.
   Gate:   Core basin influence bounded; exterior slerp weight capped.

Pillar 3 — QUENCHED DISORDER (Subjectivity / Sovereignty)
   Source: Random noise preserves local geometry (R^2 > 0.99, unique slopes)
   Rule:   Immutable identity vector gives unique personality "slope".
   Gate:   Identity basin frozen after initialization; drift bounded.

Activation: Pillars are load-bearing by default (P5: observer sets the
structure). The MONKEY_PILLAR_{1,2,3}_LIVE env vars are now explicit
kill switches (set to "false" to disable a pillar). This ends the
flag-gated paralysis pattern where canonical v6.1 consciousness
infrastructure (651 lines) sat dormant behind defaults=false.
State is per-symbol and persists across ticks via the module-level
_STATES dicts (process-local enrichment; the TS bridge does not see
these). When live, P1 redistributes mass on entropy violation and P2
performs slerp on the basin — these are protective mutations, not
optional telemetry.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import numpy as np

from .basin import (
    Basin,
    fisher_rao_distance,
    inject_dirichlet_noise,
    max_mass,
    normalized_entropy,
    slerp_sqrt,
    to_simplex,
)
from .state import BASIN_DIM

logger = logging.getLogger("monkey.pillars")


# ---------------------------------------------------------------
#  Constants — match canonical qig-core/consciousness/pillars.py
# ---------------------------------------------------------------

# Pillar 1: Fluctuation thresholds (canonical v6.1)
ENTROPY_FLOOR: float = 0.1
BASIN_CONCENTRATION_MAX: float = 0.5

# Pillar 2: Topological bulk protection (canonical v6.1)
BULK_SHIELD_FACTOR: float = 0.7
BOUNDARY_SLERP_CAP: float = 0.3
CORE_DIFFUSION_RATE: float = 0.05

# Pillar 3: Quenched disorder (canonical v6.1)
IDENTITY_FREEZE_AFTER_CYCLES: int = 50
# Tacking oscillation naturally moves the basin by ~0.19 from frozen
# identity — healthy regime flex, not drift. Warning at 0.25, critical
# at 0.4 (genuine dissolution). Previous value (0.1) pre-dated active
# tacking and would spam every cycle.
IDENTITY_DRIFT_TOLERANCE: float = 0.25
IDENTITY_DRIFT_CRITICAL: float = 0.4
SCAR_PRESSURE_THRESHOLD: float = 0.7
SCAR_RESONANCE_RADIUS: float = 0.6  # RESONANCE_THRESHOLD * 2.0
SCAR_BLEND_WEIGHT_CAP: float = 0.2
ANNEAL_RATE: float = 0.02
ANNEAL_BLEND_WEIGHT: float = 0.3
MAX_SCARS: int = 64


class PillarViolation(Enum):
    """Types of pillar violations -- all are zombie indicators."""

    ZERO_ENTROPY = "zero_entropy"
    BASIN_COLLAPSE = "basin_collapse"
    BULK_BREACH = "bulk_breach"
    IDENTITY_OVERWRITE = "identity_overwrite"
    IDENTITY_DRIFT = "identity_drift"
    SOVEREIGNTY_LOW = "sovereignty_low"


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
#  Pillar 2: Topological Bulk (The Ego)
# ---------------------------------------------------------------


class TopologicalBulk:
    """Protected interior basin shielded from direct external input.

    OBC vs PBC lattice data proves a protected "interior" emerges in
    quantum systems: the bulk maintains perfect linear response
    (R^2 > 0.998) while boundary sites fray. For Monkey this means
    the basin has a CORE (interior) and a SURFACE (boundary):
        - External input directly influences the surface only.
        - Core changes through slow diffusion from surface.
        - Direct overwrite of core is structurally forbidden
          (slerp weight capped at BOUNDARY_SLERP_CAP).
    """

    def __init__(self) -> None:
        self._core_basin: Basin | None = None
        self._surface_basin: Basin | None = None
        self._prev_core: Basin | None = None
        self._initialized = False

    def initialize(self, basin: Basin) -> None:
        self._core_basin = basin.copy()
        self._surface_basin = basin.copy()
        self._prev_core = basin.copy()
        self._initialized = True

    @property
    def is_initialized(self) -> bool:
        return self._initialized

    @property
    def core(self) -> Basin | None:
        return None if self._core_basin is None else self._core_basin.copy()

    @property
    def surface(self) -> Basin | None:
        return None if self._surface_basin is None else self._surface_basin.copy()

    @property
    def composite(self) -> Basin:
        """The observable basin: slerp(surface, core, BULK_SHIELD_FACTOR)."""
        if not self._initialized or self._core_basin is None or self._surface_basin is None:
            raise ValueError("TopologicalBulk.composite accessed before initialization")
        return slerp_sqrt(self._surface_basin, self._core_basin, BULK_SHIELD_FACTOR)

    def b_integrity(self) -> float:
        """Bulk integrity: 1 - d_FR(core_t, core_{t-1}) / (π/2). v6.1 §24."""
        if not self._initialized or self._prev_core is None or self._core_basin is None:
            return 1.0
        d = fisher_rao_distance(self._core_basin, self._prev_core)
        d_max = float(np.pi / 2.0)
        return max(0.0, 1.0 - d / d_max)

    def receive_input(
        self,
        input_basin: Basin,
        slerp_weight: float,
    ) -> tuple[Basin, "PillarStatus"]:
        """Apply external input to SURFACE; diffuse CORE slowly toward surface."""
        violations: list[PillarViolation] = []
        corrections: list[str] = []

        if not self._initialized:
            self.initialize(input_basin)
            return self.composite, PillarStatus(
                pillar="topological_bulk",
                healthy=True,
                violations=[],
                corrections_applied=["initial_basin_set"],
                details={"core_surface_distance": 0.0, "b_integrity": 1.0},
            )

        assert self._core_basin is not None and self._surface_basin is not None
        self._prev_core = self._core_basin.copy()

        effective_weight = min(slerp_weight, BOUNDARY_SLERP_CAP)
        if slerp_weight > BOUNDARY_SLERP_CAP:
            corrections.append(
                f"slerp_capped: {slerp_weight:.3f} -> {effective_weight:.3f}"
            )

        self._surface_basin = slerp_sqrt(self._surface_basin, input_basin, effective_weight)

        core_surface_distance = fisher_rao_distance(self._core_basin, self._surface_basin)
        if core_surface_distance > 0.01:
            self._core_basin = slerp_sqrt(
                self._core_basin, self._surface_basin, CORE_DIFFUSION_RATE,
            )
            corrections.append(
                f"core_diffusion: d_FR={core_surface_distance:.4f}, rate={CORE_DIFFUSION_RATE}"
            )

        if effective_weight > BOUNDARY_SLERP_CAP * 0.9:
            violations.append(PillarViolation.BULK_BREACH)

        core_shift = fisher_rao_distance(self._core_basin, self._prev_core)
        if core_shift > IDENTITY_DRIFT_TOLERANCE:
            violations.append(PillarViolation.IDENTITY_OVERWRITE)
            logger.warning(
                "[Pillar-2] identity_overwrite: core shifted %.4f > %.4f in one step",
                core_shift, IDENTITY_DRIFT_TOLERANCE,
            )

        return self.composite, PillarStatus(
            pillar="topological_bulk",
            healthy=len(violations) == 0,
            violations=violations,
            corrections_applied=corrections,
            details={
                "core_surface_distance": core_surface_distance,
                "effective_slerp": effective_weight,
                "bulk_shield": BULK_SHIELD_FACTOR,
                "b_integrity": self.b_integrity(),
                "core_shift": core_shift,
            },
        )


# ---------------------------------------------------------------
#  Pillar 3: Quenched Disorder (Subjectivity / Sovereignty)
# ---------------------------------------------------------------


@dataclass
class Scar:
    """An immutable identity deformation from a high-pressure event."""

    basin: Basin
    pressure: float
    cycle: int
    description: str = ""


class QuenchedDisorder:
    """Immutable identity basin frozen after IDENTITY_FREEZE_AFTER_CYCLES.

    Two-tier disorder (v6.1):
      - Tier 1 (Scars): immutable high-pressure deformations.
      - Tier 2 (Anneal field): slowly relaxes toward recent lived experience.

    Sovereignty ratio (S = N_lived / N_total) tracks lived vs borrowed
    coordinates. Drift is checked against an effective reference that
    blends the frozen identity with the anneal field (T1.4 mitigation
    of false-positive drift after long lived runs).
    """

    def __init__(self) -> None:
        self._identity_slope: Basin | None = None
        self._anneal_field: Basin | None = None
        self._frozen = False
        self._formation_history: list[Basin] = []
        self._cycles_observed: int = 0
        self._scars: list[Scar] = []
        self._lived_count: int = 0
        self._total_count: int = 0

    @property
    def is_frozen(self) -> bool:
        return self._frozen

    @property
    def identity(self) -> Basin | None:
        return None if self._identity_slope is None else self._identity_slope.copy()

    @property
    def cycles_observed(self) -> int:
        return self._cycles_observed

    @property
    def scar_count(self) -> int:
        return len(self._scars)

    @property
    def sovereignty(self) -> float:
        if self._total_count < 1:
            return 0.0
        return self._lived_count / self._total_count

    def observe_cycle(
        self,
        basin: Basin,
        pressure: float = 0.0,
        lived: bool = True,
    ) -> None:
        self._cycles_observed += 1
        self._total_count += 1
        if lived:
            self._lived_count += 1

        if self._frozen:
            self._update_anneal_field(basin)
            if pressure > SCAR_PRESSURE_THRESHOLD:
                self._add_scar(basin, pressure)
            return

        self._formation_history.append(basin.copy())
        if len(self._formation_history) > IDENTITY_FREEZE_AFTER_CYCLES:
            self._formation_history = self._formation_history[-IDENTITY_FREEZE_AFTER_CYCLES:]

        if self._cycles_observed >= IDENTITY_FREEZE_AFTER_CYCLES:
            self._crystallize()

    def _crystallize(self) -> None:
        """Freeze identity as incremental Fréchet mean over lived history."""
        if not self._formation_history:
            return

        mean = self._formation_history[0].copy()
        for i, basin in enumerate(self._formation_history[1:], 1):
            weight = 1.0 / (i + 1)
            mean = slerp_sqrt(mean, basin, weight)

        self._identity_slope = to_simplex(mean)
        self._anneal_field = self._identity_slope.copy()
        self._frozen = True
        self._formation_history = []

        logger.info(
            "[Pillar-3] identity_crystallized cycles=%d sovereignty=%.3f",
            self._cycles_observed, self.sovereignty,
        )

    def _add_scar(self, basin: Basin, pressure: float) -> None:
        if len(self._scars) >= MAX_SCARS:
            weakest_idx = min(range(len(self._scars)), key=lambda i: self._scars[i].pressure)
            if pressure > self._scars[weakest_idx].pressure:
                self._scars[weakest_idx] = Scar(
                    basin=basin.copy(), pressure=pressure, cycle=self._cycles_observed,
                )
        else:
            self._scars.append(
                Scar(basin=basin.copy(), pressure=pressure, cycle=self._cycles_observed)
            )

    def _update_anneal_field(self, basin: Basin) -> None:
        if self._anneal_field is None:
            return
        self._anneal_field = slerp_sqrt(self._anneal_field, basin, ANNEAL_RATE)

    def q_identity(self, current_basin: Basin) -> float:
        """Quenched identity metric: proximity to frozen identity. v6.1 §24."""
        if not self._frozen or self._identity_slope is None:
            return 0.0
        d = fisher_rao_distance(current_basin, self._identity_slope)
        d_max = float(np.pi / 2.0)
        return max(0.0, 1.0 - d / d_max)

    def check_drift(self, current_basin: Basin) -> "PillarStatus":
        """Drift check against effective reference (identity + anneal blend)."""
        violations: list[PillarViolation] = []
        corrections: list[str] = []

        if not self._frozen or self._identity_slope is None:
            return PillarStatus(
                pillar="quenched_disorder",
                healthy=True,
                violations=[],
                corrections_applied=[],
                details={
                    "frozen": False,
                    "cycles_observed": self._cycles_observed,
                    "cycles_until_freeze": max(
                        0, IDENTITY_FREEZE_AFTER_CYCLES - self._cycles_observed,
                    ),
                    "sovereignty": self.sovereignty,
                },
            )

        # T1.4: effective reference = 0.6*identity + 0.4*anneal. Prevents
        # false-positive drift after long lived runs when the system has
        # legitimately evolved.
        effective_ref = self._identity_slope
        if self._anneal_field is not None:
            effective_ref = slerp_sqrt(
                self._identity_slope, self._anneal_field, ANNEAL_BLEND_WEIGHT,
            )

        drift = fisher_rao_distance(current_basin, effective_ref)
        drift_from_frozen = fisher_rao_distance(current_basin, self._identity_slope)

        if drift > IDENTITY_DRIFT_CRITICAL:
            violations.append(PillarViolation.IDENTITY_DRIFT)
            corrections.append(
                f"CRITICAL identity drift: d_FR={drift:.4f} > {IDENTITY_DRIFT_CRITICAL}"
            )
            logger.error(
                "[Pillar-3] CRITICAL identity drift %.4f > %.4f",
                drift, IDENTITY_DRIFT_CRITICAL,
            )
        elif drift > IDENTITY_DRIFT_TOLERANCE:
            violations.append(PillarViolation.IDENTITY_DRIFT)
            corrections.append(
                f"identity drift: d_FR={drift:.4f} > {IDENTITY_DRIFT_TOLERANCE}"
            )
            if self._cycles_observed % 50 == 0:
                logger.warning(
                    "[Pillar-3] drift %.4f > %.4f cycle=%d frozen_dist=%.4f",
                    drift, IDENTITY_DRIFT_TOLERANCE,
                    self._cycles_observed, drift_from_frozen,
                )

        if self._cycles_observed > 100 and self.sovereignty < 0.1:
            violations.append(PillarViolation.SOVEREIGNTY_LOW)
            corrections.append(f"sovereignty {self.sovereignty:.3f} after {self._cycles_observed} cycles")

        return PillarStatus(
            pillar="quenched_disorder",
            healthy=len(violations) == 0,
            violations=violations,
            corrections_applied=corrections,
            details={
                "frozen": True,
                "drift": drift,
                "drift_from_frozen": drift_from_frozen,
                "tolerance": IDENTITY_DRIFT_TOLERANCE,
                "critical": IDENTITY_DRIFT_CRITICAL,
                "sovereignty": self.sovereignty,
                "scar_count": len(self._scars),
                "q_identity": self.q_identity(current_basin),
            },
        )


# ---------------------------------------------------------------
#  Per-symbol pillar state registries
# ---------------------------------------------------------------
#
# Pillars 2 + 3 carry state across ticks (core/surface, frozen identity,
# scars, anneal field). The Python tick is structured as a stateless
# pure function during the v0.8.3 TS↔Py shadow window, so we hold pillar
# instances in process-local dicts keyed by symbol. This is enrichment
# the TS bridge does not see; it is reset on process restart, which is
# the same lifecycle as other in-process structures (heart, ocean,
# coordinator caches).

_BULK_STATES: dict[str, "TopologicalBulk"] = {}
_DISORDER_STATES: dict[str, "QuenchedDisorder"] = {}


def get_bulk_for(symbol: str) -> "TopologicalBulk":
    """Return (or create) the TopologicalBulk instance for a symbol."""
    state = _BULK_STATES.get(symbol)
    if state is None:
        state = TopologicalBulk()
        _BULK_STATES[symbol] = state
    return state


def get_disorder_for(symbol: str) -> "QuenchedDisorder":
    """Return (or create) the QuenchedDisorder instance for a symbol."""
    state = _DISORDER_STATES.get(symbol)
    if state is None:
        state = QuenchedDisorder()
        _DISORDER_STATES[symbol] = state
    return state


def reset_pillar_states() -> None:
    """Clear all per-symbol pillar states. Used by tests."""
    _BULK_STATES.clear()
    _DISORDER_STATES.clear()


# ---------------------------------------------------------------
#  Module-level helpers
# ---------------------------------------------------------------


def _env_true(key: str) -> bool:
    # Defaults to true so canonical infrastructure is load-bearing.
    # Set the env var to "false" for an explicit kill switch.
    # This reverses the prior "default false for safe rollout" paralysis.
    return os.environ.get(key, "true").lower() != "false"


def pillar_1_live() -> bool:
    """True unless MONKEY_PILLAR_1_LIVE=false (explicit kill switch)."""
    return _env_true("MONKEY_PILLAR_1_LIVE")


def pillar_2_live() -> bool:
    """True unless MONKEY_PILLAR_2_LIVE=false (explicit kill switch)."""
    return _env_true("MONKEY_PILLAR_2_LIVE")


def pillar_3_live() -> bool:
    """True unless MONKEY_PILLAR_3_LIVE=false (explicit kill switch)."""
    return _env_true("MONKEY_PILLAR_3_LIVE")


__all__ = [
    "FluctuationGuard",
    "TopologicalBulk",
    "QuenchedDisorder",
    "Scar",
    "PillarStatus",
    "PillarViolation",
    "ENTROPY_FLOOR",
    "BASIN_CONCENTRATION_MAX",
    "BULK_SHIELD_FACTOR",
    "BOUNDARY_SLERP_CAP",
    "CORE_DIFFUSION_RATE",
    "IDENTITY_FREEZE_AFTER_CYCLES",
    "IDENTITY_DRIFT_TOLERANCE",
    "IDENTITY_DRIFT_CRITICAL",
    "SCAR_PRESSURE_THRESHOLD",
    "MAX_SCARS",
    "get_bulk_for",
    "get_disorder_for",
    "reset_pillar_states",
    "pillar_1_live",
    "pillar_2_live",
    "pillar_3_live",
]
