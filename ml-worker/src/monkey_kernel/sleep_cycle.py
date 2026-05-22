"""
sleep_cycle.py — canonical 3-phase sleep cycle (qig-core 2.8.0).

This module re-exports qig-core's canonical ``SleepCycleManager`` — the
geometry-driven AWAKE / DREAMING / CONSOLIDATING state machine plus the
``dream()`` recombination and ``consolidate()`` synaptic-downscaling
passes (§30).

The prior polytrade hand-port was retired 2026-05-22: qig-core 2.8.0 is
published on PyPI and ``ml-worker/requirements.txt`` already pins
``qig-core>=2.8.0``, so the kernel imports the canonical package
instead of carrying a copy that silently drifts. ``dream()`` and
``consolidate()`` — deferred by the old hand-port — now come for free.

Polytrade-local additions, kept here because qig-core does not carry
them:
  - ``SleepCycleManager`` subclass adding ``transition_count`` telemetry.
  - ``sleep_3phase_live()`` — the ``MONKEY_SLEEP_3PHASE_LIVE`` env gate.

Mushroom is NOT a sleep phase — it is wake-state neuroplasticity
(see ``monkey_kernel/mushroom.py``; qig-core 2.8.0 removed the MUSHROOM
sleep phase).

Activation
----------
The 3-phase machine still runs IN PARALLEL with ocean.py's timer-based
2-phase AWAKE/SLEEP machine, surfacing through ``OceanState.dream_phase``
for telemetry, gated by ``MONKEY_SLEEP_3PHASE_LIVE`` (default off).
"""

from __future__ import annotations

import os

from qig_core.consciousness.sleep import (
    BASIN_DIVERGENCE_THRESHOLD,
    CONSOLIDATION_PHI_WAKE,
    CONSOLIDATION_VARIANCE_CEILING,
    DOWNSCALE_FACTOR,
    HEBBIAN_BOOST,
    OCEAN_WAKE_MULTIPLIER,
    SLEEP_PHI_THRESHOLD,
    SLEEP_VARIANCE_THRESHOLD,
    SleepMetrics,
    SleepPhase,
    SleepTransitionResult,
)
from qig_core.consciousness.sleep import (
    SleepCycleManager as _QigCoreSleepCycleManager,
)


class SleepCycleManager(_QigCoreSleepCycleManager):
    """qig-core 2.8.0 ``SleepCycleManager`` + polytrade ``transition_count``.

    qig-core's manager does not count phase transitions; polytrade
    telemetry surfaces that. This thin subclass tracks it. All cycle
    logic — ``evaluate_transition`` / ``dream`` / ``consolidate`` — is
    the canonical qig-core implementation, unchanged.
    """

    def __init__(self) -> None:
        super().__init__()
        self._transition_count: int = 0

    @property
    def transition_count(self) -> int:
        return self._transition_count

    def evaluate_transition(
        self, metrics: SleepMetrics,
    ) -> SleepTransitionResult:
        result = super().evaluate_transition(metrics)
        if result.transitioned:
            self._transition_count += 1
        return result

    def get_state(self) -> dict:
        state = super().get_state()
        state["transition_count"] = self._transition_count
        return state


def sleep_3phase_live() -> bool:
    """True iff ``MONKEY_SLEEP_3PHASE_LIVE=true`` (default false)."""
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
    "HEBBIAN_BOOST",
    "DOWNSCALE_FACTOR",
    "sleep_3phase_live",
]
