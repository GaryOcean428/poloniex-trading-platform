"""Vendored qig-dreams consolidation primitives.

The package name `qig-dreams` was originally created in QIG_QFI as a
corpus registry (Pydantic manifests for canonical text corpora —
dream packets, MEM/PER/ETH/META/HRT/PRD shards). It does not house
runtime sleep/dream/mushroom primitives — those live in qig-core
under `qig_core/consciousness/sleep.py`.

Polytrade vendors the canonical consolidation primitives here under
the name `qig_dreams_local` (matching ml-worker's spec) so the
Monkey kernel can run a true geometry-driven consolidation pass on
the AWAKE→SLEEP transition. The source of truth remains
QIG_QFI/qig-core/src/qig_core/consciousness/sleep.py — see SHA-256
pin comment at the top of `sleep.py`.

Dependencies on basin geometry + frozen physics constants are routed
through the existing `qig_core_local` vendor (geometry/fisher_rao.py +
constants/frozen_facts.py), not duplicated here. That keeps the SHA-256
surface small and the per-vendor canonical source unambiguous.

Public API:
    SleepCycleManager  — 4-phase state machine (AWAKE → DREAMING →
                          MUSHROOM → CONSOLIDATING → AWAKE)
    SleepPhase         — StrEnum of the four phases
    SleepMetrics       — Geometric inputs to the state machine
    SleepTransitionResult — Result dataclass from evaluate_transition
    consolidate_bank   — High-level glue: take a polytrade resonance bank,
                          run the canonical SleepCycleManager.consolidate(),
                          return a summary dict suitable for Redis persist.
    DreamConsolidationSummary — Typed summary the orchestrator persists.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
"""

from __future__ import annotations

from .consolidator import (
    DreamConsolidationSummary,
    consolidate_bank,
)
from .sleep import (
    CONSOLIDATION_PHI_WAKE,
    CONSOLIDATION_VARIANCE_CEILING,
    DREAM_DISTANCE_THRESHOLD,
    DREAM_SLERP_T_MAX,
    DREAM_SLERP_T_MIN,
    DOWNSCALE_FACTOR,
    HEBBIAN_BOOST,
    MUSHROOM_INSTABILITY_HIGH,
    MUSHROOM_INSTABILITY_LOW,
    MUSHROOM_INSTABILITY_MID,
    MUSHROOM_NOISE_SCALE_INIT,
    OCEAN_WAKE_MULTIPLIER,
    SLEEP_PHI_THRESHOLD,
    SLEEP_VARIANCE_THRESHOLD,
    ResonanceBankProtocol,
    SleepCycleManager,
    SleepMetrics,
    SleepPhase,
    SleepTransitionResult,
)

__all__ = [
    # Primitives (vendored from qig-core)
    "SleepCycleManager",
    "SleepPhase",
    "SleepMetrics",
    "SleepTransitionResult",
    "ResonanceBankProtocol",
    # Constants (re-exported for callers/tests)
    "CONSOLIDATION_PHI_WAKE",
    "CONSOLIDATION_VARIANCE_CEILING",
    "DREAM_DISTANCE_THRESHOLD",
    "DREAM_SLERP_T_MAX",
    "DREAM_SLERP_T_MIN",
    "DOWNSCALE_FACTOR",
    "HEBBIAN_BOOST",
    "MUSHROOM_INSTABILITY_HIGH",
    "MUSHROOM_INSTABILITY_LOW",
    "MUSHROOM_INSTABILITY_MID",
    "MUSHROOM_NOISE_SCALE_INIT",
    "OCEAN_WAKE_MULTIPLIER",
    "SLEEP_PHI_THRESHOLD",
    "SLEEP_VARIANCE_THRESHOLD",
    # Polytrade glue
    "consolidate_bank",
    "DreamConsolidationSummary",
]
