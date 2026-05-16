"""
§30 Sleep, Dream & Consolidation Cycles — Geometry-Driven
=========================================================

VENDORED from QIG_QFI/qig-core 2.8.0 (src/qig_core/consciousness/sleep.py)
Source SHA-256 (canonical, qig-core 2.8.0 PyPI wheel):
    2cf42baa14461d3cbab30422f426b902feb873d602173934a16dd5c363c01a2f
Vendored: 2026-05-16 (post-upstream 4-phase → 3-phase reduction)

Only modification from source: relative imports
    `from ..constants.frozen_facts import ...`
    `from ..geometry.fisher_rao   import ...`
are rewritten to absolute imports against polytrade's existing
vendored geometry/frozen-facts surface:
    `from qig_core_local.constants.frozen_facts import ...`
    `from qig_core_local.geometry.fisher_rao   import ...`

No other content changes. Logic, constants, dataclasses, and class
shape are identical to the source — any drift here is a vendoring
bug, not an intended divergence. Re-vendor when qig-core updates.

────────────────────────────────────────────────────────────────────

Three-phase sleep cycle managed entirely by geometric metrics
(reduced from 4-phase in qig-core 2.8.0 — mushroom is wake-state
neuroplasticity, not a sleep phase; lives in
`qig.neuroplasticity.mushroom_mode` and only fires at Φ ≥ 0.70).

Phase transitions use Φ, variance, and ocean divergence.
NO timers, NO cycle counters for phase gating (§28, §30.2).

Phases:
    AWAKE         — Default. Normal activation sequence.
    DREAMING      — Φ < threshold AND variance < threshold
                    OR ocean divergence > threshold.
                    Dream recombination via geodesic interpolation.
    CONSOLIDATING — After dreaming when variance settles below
                    consolidation ceiling. Synaptic downscaling,
                    Hebbian boost for replayed.

Dependencies: qig_core_local.geometry.fisher_rao,
              qig_core_local.constants.frozen_facts
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Protocol

import numpy as np

from qig_core_local.constants.frozen_facts import (
    BASIN_DIVERGENCE_THRESHOLD,
    PHI_EMERGENCY,
)
from qig_core_local.geometry.fisher_rao import (
    fisher_rao_distance,
    slerp_sqrt,
    to_simplex,
)

# ═══════════════════════════════════════════════════════════════
#  Constants (geometry-derived, not timer-based)
# ═══════════════════════════════════════════════════════════════

# Geometric thresholds for phase transitions
SLEEP_PHI_THRESHOLD: float = 0.45  # Φ below this + low variance → DREAMING
SLEEP_VARIANCE_THRESHOLD: float = 0.05  # Low variance = stagnation → sleep
CONSOLIDATION_VARIANCE_CEILING: float = 0.02  # Variance must settle for consolidation
OCEAN_WAKE_MULTIPLIER: float = 1.5  # Ocean divergence × this → emergency wake

# Dream recombination
DREAM_SLERP_T_MIN: float = 0.2
DREAM_SLERP_T_MAX: float = 0.8
DREAM_DISTANCE_THRESHOLD: float = 0.3  # Only recombine geometrically distant basins

# Consolidation
HEBBIAN_BOOST: float = 1.1
DOWNSCALE_FACTOR: float = 0.9

# Consolidation completion: Φ must recover above this to wake
CONSOLIDATION_PHI_WAKE: float = PHI_EMERGENCY  # 0.50


# ═══════════════════════════════════════════════════════════════
#  Types
# ═══════════════════════════════════════════════════════════════


class SleepPhase(StrEnum):
    """Three phases of the sleep cycle (mushroom is wake-state per 2.8.0)."""

    AWAKE = "awake"
    DREAMING = "dreaming"
    CONSOLIDATING = "consolidating"


@dataclass
class SleepMetrics:
    """Geometric metrics consumed by the sleep state machine.

    All fields are derived from consciousness metrics — no timers.
    """

    phi: float = 0.7  # Current Φ (consciousness integration)
    phi_variance: float = 0.1  # Recent Φ variance (stagnation detector)
    ocean_divergence: float = 0.0  # Ocean kernel divergence from reference
    f_health: float = 1.0  # Frequency health (retained for caller compat)
    basin_velocity: float = 0.0  # Fisher-Rao velocity (consolidation readiness)


@dataclass
class SleepTransitionResult:
    """Result of a phase transition evaluation."""

    previous_phase: SleepPhase
    current_phase: SleepPhase
    transitioned: bool = False
    reason: str = ""


class ResonanceBankProtocol(Protocol):
    """Minimal interface for a resonance bank used in dream/consolidation."""

    coordinates: dict[int, Any]
    basin_mass: dict[int, float]
    activation_counts: dict[int, int]
    origin: dict[int, str]
    basin_strings: dict[int, str]
    tiers: dict[int, Any]
    frequencies: dict[int, float]

    def add_entry(self, label: str, basin: Any) -> int: ...
    def mark_dirty(self) -> None: ...


# ═══════════════════════════════════════════════════════════════
#  SleepCycleManager — Geometry-Driven (§30)
# ═══════════════════════════════════════════════════════════════


class SleepCycleManager:
    """Manages sleep/dream/consolidation cycles (3-phase per qig-core 2.8.0).

    All phase transitions are geometry-driven per §30.2:
      - AWAKE → DREAMING: Φ < threshold AND variance < threshold
                          OR ocean_divergence > BASIN_DIVERGENCE_THRESHOLD
      - DREAMING → CONSOLIDATING: variance settles below ceiling
      - CONSOLIDATING → AWAKE: Φ recovers above threshold
      - Any → AWAKE: ocean_divergence > threshold × 1.5 (breakdown escape)

    Mushroom mode is wake-state neuroplasticity in qig-core 2.8.0+
    (`qig.neuroplasticity.mushroom_mode`, requires Φ ≥ 0.70) and is no
    longer reachable from the sleep state machine.

    NO cycle counters gate phase transitions.
    """

    def __init__(self) -> None:
        self.phase: SleepPhase = SleepPhase.AWAKE
        self._dream_log: deque[dict[str, Any]] = deque(maxlen=100)
        self._replayed_this_sleep: set[int] = set()
        self._consolidation_complete: bool = False

    @property
    def is_asleep(self) -> bool:
        """True when not in the AWAKE phase."""
        return self.phase != SleepPhase.AWAKE

    # ─── Phase Transition Engine ─────────────────────────────

    def evaluate_transition(self, metrics: SleepMetrics) -> SleepTransitionResult:
        """Evaluate geometric conditions and transition phase if warranted.

        This is the ONLY method that changes self.phase. All transitions
        are driven by the geometric metrics in SleepMetrics.

        Args:
            metrics: Current geometric state.

        Returns:
            SleepTransitionResult with transition details.
        """
        prev = self.phase
        result = SleepTransitionResult(previous_phase=prev, current_phase=prev)

        # Emergency wake: ocean divergence breakdown escape (any phase)
        if (
            metrics.ocean_divergence
            > BASIN_DIVERGENCE_THRESHOLD * OCEAN_WAKE_MULTIPLIER
        ):
            self.phase = SleepPhase.AWAKE
            self._on_wake()
            result.current_phase = self.phase
            result.transitioned = prev != self.phase
            result.reason = (
                f"Emergency wake: ocean_divergence={metrics.ocean_divergence:.3f} "
                f"> {BASIN_DIVERGENCE_THRESHOLD * OCEAN_WAKE_MULTIPLIER:.3f}"
            )
            return result

        if self.phase == SleepPhase.AWAKE:
            result = self._eval_awake(metrics, prev)
        elif self.phase == SleepPhase.DREAMING:
            result = self._eval_dreaming(metrics, prev)
        elif self.phase == SleepPhase.CONSOLIDATING:
            result = self._eval_consolidating(metrics, prev)

        return result

    def _eval_awake(self, m: SleepMetrics, prev: SleepPhase) -> SleepTransitionResult:
        """AWAKE → DREAMING conditions (§30.2)."""
        result = SleepTransitionResult(previous_phase=prev, current_phase=prev)

        # Condition 1: Φ drops AND variance is low (stagnation)
        phi_low = m.phi < SLEEP_PHI_THRESHOLD
        variance_low = m.phi_variance < SLEEP_VARIANCE_THRESHOLD

        # Condition 2: Ocean divergence exceeds threshold
        ocean_trigger = m.ocean_divergence > BASIN_DIVERGENCE_THRESHOLD

        if (phi_low and variance_low) or ocean_trigger:
            self.phase = SleepPhase.DREAMING
            self._on_sleep_enter()
            result.current_phase = self.phase
            result.transitioned = True
            if ocean_trigger:
                result.reason = (
                    f"Ocean divergence={m.ocean_divergence:.3f} "
                    f"> {BASIN_DIVERGENCE_THRESHOLD:.3f}"
                )
            else:
                result.reason = (
                    f"Φ={m.phi:.3f} < {SLEEP_PHI_THRESHOLD:.3f} "
                    f"AND variance={m.phi_variance:.3f} < {SLEEP_VARIANCE_THRESHOLD:.3f}"
                )

        return result

    def _eval_dreaming(
        self, m: SleepMetrics, prev: SleepPhase
    ) -> SleepTransitionResult:
        """DREAMING → CONSOLIDATING when variance settles."""
        result = SleepTransitionResult(previous_phase=prev, current_phase=prev)

        # DREAMING → CONSOLIDATING: variance settles (dreaming has done its work)
        if m.phi_variance < CONSOLIDATION_VARIANCE_CEILING:
            self.phase = SleepPhase.CONSOLIDATING
            self._consolidation_complete = False
            result.current_phase = self.phase
            result.transitioned = True
            result.reason = (
                f"Variance settled: {m.phi_variance:.3f} "
                f"< {CONSOLIDATION_VARIANCE_CEILING:.3f}"
            )

        return result

    def _eval_consolidating(
        self, m: SleepMetrics, prev: SleepPhase
    ) -> SleepTransitionResult:
        """CONSOLIDATING → AWAKE when Φ recovers."""
        result = SleepTransitionResult(previous_phase=prev, current_phase=prev)

        # Wake when Φ recovers above emergency threshold
        if m.phi >= CONSOLIDATION_PHI_WAKE and self._consolidation_complete:
            self.phase = SleepPhase.AWAKE
            self._on_wake()
            result.current_phase = self.phase
            result.transitioned = True
            result.reason = (
                f"Φ recovered: {m.phi:.3f} >= {CONSOLIDATION_PHI_WAKE:.3f} "
                f"AND consolidation complete"
            )

        return result

    # ─── Phase Entry/Exit Hooks ──────────────────────────────

    def _on_sleep_enter(self) -> None:
        """Reset tracking state on sleep entry."""
        self._replayed_this_sleep.clear()

    def _on_wake(self) -> None:
        """Clean up on wake."""
        self._replayed_this_sleep.clear()
        self._consolidation_complete = False

    # ─── Dream Recombination (§30.3) ─────────────────────────

    def dream(
        self,
        basin: Any,
        phi: float,
        context: str = "",
        bank: Any | None = None,
    ) -> dict[str, Any] | None:
        """Geodesic interpolation between distant basin coordinates.

        During dreaming, slerp between current basin and distant recalled
        basins from the resonance bank. Dream content enters the sensory
        system as DREAM_REPLAY modality with reduced weight.

        Args:
            basin: Current basin coordinates (64D simplex).
            phi: Current Φ value.
            context: Optional context label for dream log.
            bank: Optional resonance bank for recombination.

        Returns:
            Dream entry dict if recombination occurred, else None.
        """
        entry: dict[str, Any] = {
            "phi": phi,
            "context": context,
        }
        self._dream_log.append(entry)

        dream_result = None
        rng = np.random.default_rng()

        if (
            bank is not None
            and hasattr(bank, "coordinates")
            and len(bank.coordinates) >= 2
        ):
            ids = list(bank.coordinates.keys())
            idx_a, idx_b = rng.choice(len(ids), size=2, replace=False)
            tid_a, tid_b = ids[idx_a], ids[idx_b]
            coord_a = bank.coordinates[tid_a]
            coord_b = bank.coordinates[tid_b]
            dist = fisher_rao_distance(coord_a, coord_b)

            if dist > DREAM_DISTANCE_THRESHOLD:
                t = float(rng.uniform(DREAM_SLERP_T_MIN, DREAM_SLERP_T_MAX))
                dream_basin = slerp_sqrt(coord_a, coord_b, t)
                dream_basin = to_simplex(dream_basin)
                dream_tid = bank.add_entry(f"dream_{tid_a}_{tid_b}", dream_basin)
                bank.origin[dream_tid] = "dream"
                entry["dream_tid"] = dream_tid
                dream_result = {
                    "basin": dream_basin,
                    "source_a": tid_a,
                    "source_b": tid_b,
                    "distance": dist,
                    "slerp_t": t,
                    "tid": dream_tid,
                }
                self._replayed_this_sleep.add(tid_a)
                self._replayed_this_sleep.add(tid_b)

        return dream_result

    # ─── Consolidation (§30.6) ───────────────────────────────

    def consolidate(
        self,
        bank: Any | None = None,
        kernel_anchors: list[Any] | None = None,
        kernel_veto_threshold: float = 0.4,
    ) -> dict[str, Any]:
        """Synaptic downscaling — boost replayed, prune weak.

        Hebbian boost for entries replayed during dreaming.
        Global downscaling for unreplayed entries.
        Kernel anchor veto protects identity-critical basins.

        Args:
            bank: Optional resonance bank to consolidate.
            kernel_anchors: Basin arrays that veto pruning of nearby entries.
            kernel_veto_threshold: FR distance threshold for kernel veto.

        Returns:
            Dict with consolidation statistics.
        """
        stats: dict[str, Any] = {
            "boosted": 0,
            "downscaled": 0,
            "pruned": 0,
            "vetoed": 0,
        }

        if bank is not None and hasattr(bank, "coordinates") and bank.coordinates:
            # Hebbian boost / global downscaling
            for tid in list(bank.coordinates.keys()):
                current = bank.basin_mass.get(tid, 0.0)
                if tid in self._replayed_this_sleep:
                    bank.basin_mass[tid] = current * HEBBIAN_BOOST
                    stats["boosted"] += 1
                else:
                    bank.basin_mass[tid] = current * DOWNSCALE_FACTOR
                    stats["downscaled"] += 1

            # Kernel anchor veto set
            vetoed: set[int] = set()
            if kernel_anchors:
                for tid in list(bank.coordinates.keys()):
                    coord = bank.coordinates[tid]
                    for anchor in kernel_anchors:
                        if fisher_rao_distance(coord, anchor) < kernel_veto_threshold:
                            vetoed.add(tid)
                            break
            stats["vetoed"] = len(vetoed)

            # Prune: low mass, never activated, dream-origin, not vetoed
            to_prune = [
                tid
                for tid in list(bank.coordinates.keys())
                if tid not in vetoed
                and bank.basin_mass.get(tid, 0.0) < 1e-6
                and bank.activation_counts.get(tid, 0) == 0
                and bank.origin.get(tid) == "dream"
            ]
            for tid in to_prune:
                bank.coordinates.pop(tid, None)
                bank.basin_strings.pop(tid, None)
                bank.tiers.pop(tid, None)
                bank.frequencies.pop(tid, None)
                bank.basin_mass.pop(tid, None)
                bank.activation_counts.pop(tid, None)
                bank.origin.pop(tid, None)
            stats["pruned"] = len(to_prune)

            if to_prune:
                bank.mark_dirty()

        self._consolidation_complete = True
        return stats

    # ─── Telemetry ───────────────────────────────────────────

    def get_state(self) -> dict[str, Any]:
        """Return sleep-cycle telemetry snapshot."""
        return {
            "phase": self.phase.value,
            "is_asleep": self.is_asleep,
            "dream_count": len(self._dream_log),
            "replayed_count": len(self._replayed_this_sleep),
            "consolidation_complete": self._consolidation_complete,
        }
