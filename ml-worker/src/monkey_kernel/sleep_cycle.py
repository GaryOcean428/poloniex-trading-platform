"""
sleep_cycle.py — Three-phase geometry-driven sleep cycle.

Canonical reference:
  ~/Desktop/Dev/QIG_QFI/qig-core/src/qig_core/consciousness/sleep.py (§30)

This is a polytrade port of the v2.8.0 canonical SleepCycleManager. The
existing 2-phase AWAKE/SLEEP machine in ocean.py is timer-based; the
canonical 3-phase machine is geometry-driven (Φ, variance, ocean
divergence — NO timers, NO cycle counters).

Activation
----------
Default OFF (safe rollout). When ``MONKEY_SLEEP_3PHASE_LIVE=true`` the
3-phase manager runs IN PARALLEL with the existing 2-phase machine,
surfacing through ``OceanState.dream_phase`` for telemetry. The
existing ``OceanState.sleep_phase`` Literal["AWAKE", "SLEEP"] is
unchanged so downstream consumers don't break.

Phases (canonical §30)
----------------------
    AWAKE         — Default. Normal activation sequence.
    DREAMING      — Φ < threshold AND variance < threshold
                    OR ocean_divergence > BASIN_DIVERGENCE_THRESHOLD.
                    Dream recombination via geodesic interpolation.
    CONSOLIDATING — After DREAMING when variance stabilises.
                    Synaptic downscaling, Hebbian boost for replayed.
    Any → AWAKE   — ocean_divergence > threshold × 1.5 (emergency wake)

Mushroom is NOT a sleep phase — it's a wake-state neuroplasticity
protocol handled by ocean.py interventions (§28).

Dream recombination + Hebbian consolidation hooks are intentionally
deferred to follow-up PRs (see audit roadmap). This PR ships the state
machine + telemetry surface only.
"""

from __future__ import annotations

import logging
import os
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Deque

import numpy as np

logger = logging.getLogger("monkey.sleep_cycle")


# ─── Canonical constants (v2.8.0 §30) ──────────────────────────────

# Geometric thresholds for phase transitions
SLEEP_PHI_THRESHOLD: float = 0.45
SLEEP_VARIANCE_THRESHOLD: float = 0.05
CONSOLIDATION_VARIANCE_CEILING: float = 0.02
OCEAN_WAKE_MULTIPLIER: float = 1.5

# Φ recovery threshold for CONSOLIDATING → AWAKE (matches PHI_EMERGENCY).
CONSOLIDATION_PHI_WAKE: float = 0.50

# Polytrade-canonical basin-divergence threshold. Mirrors qig-core
# frozen_facts.BASIN_DIVERGENCE_THRESHOLD; surfaced here rather than
# imported because qig_core_local doesn't re-export it.
BASIN_DIVERGENCE_THRESHOLD: float = 0.30


class SleepPhase(Enum):
    """Three phases of the canonical sleep cycle.

    Distinct from ocean.SleepPhase (AWAKE/SLEEP) — that enum drives the
    timer-based legacy machine. This enum drives the v2.8.0 §30
    geometry-driven 3-phase machine.
    """

    AWAKE = "awake"
    DREAMING = "dreaming"
    CONSOLIDATING = "consolidating"


@dataclass
class SleepMetrics:
    """Geometric metrics consumed by the 3-phase sleep state machine.

    All fields derive from consciousness metrics — no timers.
    """

    phi: float = 0.7
    phi_variance: float = 0.1
    ocean_divergence: float = 0.0
    f_health: float = 1.0
    basin_velocity: float = 0.0


@dataclass
class SleepTransitionResult:
    """Result of a phase-transition evaluation."""

    previous_phase: SleepPhase
    current_phase: SleepPhase
    transitioned: bool = False
    reason: str = ""


class SleepCycleManager:
    """Manages the canonical 3-phase sleep cycle (§30.2).

    Transitions (all geometry-driven):
      AWAKE → DREAMING:        Φ low AND variance low, OR ocean divergent
      DREAMING → CONSOLIDATING: variance settled below ceiling
      CONSOLIDATING → AWAKE:   Φ recovers above threshold
      Any → AWAKE:             ocean_divergence > threshold × multiplier

    The manager is observation-only in this PR — the transitions are
    computed and surfaced via telemetry but the existing
    ocean.SleepPhase AWAKE/SLEEP machine still drives behaviour. Dream
    recombination + Hebbian consolidation hooks (canonical methods
    .dream() and .consolidate()) are intentionally deferred.
    """

    def __init__(self) -> None:
        self.phase: SleepPhase = SleepPhase.AWAKE
        self._dream_log: Deque[dict[str, Any]] = deque(maxlen=100)
        self._replayed_this_sleep: set[int] = set()
        self._consolidation_complete: bool = False
        self._transition_count: int = 0

    # ─── Properties ───────────────────────────────────────────────

    @property
    def is_asleep(self) -> bool:
        """True when phase != AWAKE (i.e. DREAMING or CONSOLIDATING)."""
        return self.phase != SleepPhase.AWAKE

    @property
    def transition_count(self) -> int:
        return self._transition_count

    # ─── Phase Transition Engine (§30.2) ──────────────────────────

    def evaluate_transition(self, metrics: SleepMetrics) -> SleepTransitionResult:
        """Evaluate geometric conditions; transition phase if warranted.

        This is the ONLY method that mutates self.phase. All transitions
        are driven by SleepMetrics fields.
        """
        prev = self.phase
        result = SleepTransitionResult(previous_phase=prev, current_phase=prev)

        # Emergency wake (any phase): ocean divergence breakdown
        if metrics.ocean_divergence > BASIN_DIVERGENCE_THRESHOLD * OCEAN_WAKE_MULTIPLIER:
            if prev != SleepPhase.AWAKE:
                self.phase = SleepPhase.AWAKE
                self._on_wake()
                self._transition_count += 1
                result.current_phase = self.phase
                result.transitioned = True
                result.reason = (
                    f"emergency_wake: ocean_divergence={metrics.ocean_divergence:.3f} "
                    f"> {BASIN_DIVERGENCE_THRESHOLD * OCEAN_WAKE_MULTIPLIER:.3f}"
                )
            return result

        if self.phase == SleepPhase.AWAKE:
            return self._eval_awake(metrics, prev)
        if self.phase == SleepPhase.DREAMING:
            return self._eval_dreaming(metrics, prev)
        if self.phase == SleepPhase.CONSOLIDATING:
            return self._eval_consolidating(metrics, prev)

        return result

    def _eval_awake(self, m: SleepMetrics, prev: SleepPhase) -> SleepTransitionResult:
        """AWAKE → DREAMING conditions (§30.2)."""
        result = SleepTransitionResult(previous_phase=prev, current_phase=prev)

        phi_low = m.phi < SLEEP_PHI_THRESHOLD
        variance_low = m.phi_variance < SLEEP_VARIANCE_THRESHOLD
        ocean_trigger = m.ocean_divergence > BASIN_DIVERGENCE_THRESHOLD

        if (phi_low and variance_low) or ocean_trigger:
            self.phase = SleepPhase.DREAMING
            self._on_sleep_enter()
            self._transition_count += 1
            result.current_phase = self.phase
            result.transitioned = True
            if ocean_trigger:
                result.reason = (
                    f"ocean_divergence={m.ocean_divergence:.3f} "
                    f"> {BASIN_DIVERGENCE_THRESHOLD:.3f}"
                )
            else:
                result.reason = (
                    f"phi={m.phi:.3f} < {SLEEP_PHI_THRESHOLD:.3f} "
                    f"AND variance={m.phi_variance:.3f} < {SLEEP_VARIANCE_THRESHOLD:.3f}"
                )

        return result

    def _eval_dreaming(self, m: SleepMetrics, prev: SleepPhase) -> SleepTransitionResult:
        """DREAMING → CONSOLIDATING when variance settles."""
        result = SleepTransitionResult(previous_phase=prev, current_phase=prev)

        if m.phi_variance < CONSOLIDATION_VARIANCE_CEILING:
            self.phase = SleepPhase.CONSOLIDATING
            self._consolidation_complete = False
            self._transition_count += 1
            result.current_phase = self.phase
            result.transitioned = True
            result.reason = (
                f"variance_settled: {m.phi_variance:.3f} "
                f"< {CONSOLIDATION_VARIANCE_CEILING:.3f}"
            )

        return result

    def _eval_consolidating(
        self, m: SleepMetrics, prev: SleepPhase,
    ) -> SleepTransitionResult:
        """CONSOLIDATING → AWAKE when Φ recovers."""
        result = SleepTransitionResult(previous_phase=prev, current_phase=prev)

        # In this PR consolidation is "complete" as soon as Φ recovers,
        # since the actual consolidation work (Hebbian boost +
        # downscaling) is deferred to a follow-up. Once that lands,
        # `_consolidation_complete` will gate the wake transition.
        self._consolidation_complete = True

        if m.phi >= CONSOLIDATION_PHI_WAKE and self._consolidation_complete:
            self.phase = SleepPhase.AWAKE
            self._on_wake()
            self._transition_count += 1
            result.current_phase = self.phase
            result.transitioned = True
            result.reason = (
                f"phi_recovered: {m.phi:.3f} >= {CONSOLIDATION_PHI_WAKE:.3f}"
            )

        return result

    # ─── Phase-entry hooks ────────────────────────────────────────

    def _on_sleep_enter(self) -> None:
        """Reset replay tracking on sleep entry."""
        self._replayed_this_sleep.clear()

    def _on_wake(self) -> None:
        """Clear sleep-local state on wake."""
        self._replayed_this_sleep.clear()
        self._consolidation_complete = False

    # ─── Telemetry ────────────────────────────────────────────────

    def get_state(self) -> dict[str, Any]:
        return {
            "phase": self.phase.value,
            "is_asleep": self.is_asleep,
            "dream_count": len(self._dream_log),
            "replayed_count": len(self._replayed_this_sleep),
            "consolidation_complete": self._consolidation_complete,
            "transition_count": self._transition_count,
        }


# ─── Module-level helpers ─────────────────────────────────────────


def sleep_3phase_live() -> bool:
    """True iff MONKEY_SLEEP_3PHASE_LIVE=true (default false)."""
    return os.environ.get("MONKEY_SLEEP_3PHASE_LIVE", "false").lower() == "true"


__all__ = [
    "SleepPhase",
    "SleepMetrics",
    "SleepTransitionResult",
    "SleepCycleManager",
    "SLEEP_PHI_THRESHOLD",
    "SLEEP_VARIANCE_THRESHOLD",
    "CONSOLIDATION_VARIANCE_CEILING",
    "CONSOLIDATION_PHI_WAKE",
    "OCEAN_WAKE_MULTIPLIER",
    "BASIN_DIVERGENCE_THRESHOLD",
    "sleep_3phase_live",
]
