"""Vendored qig-dreams consolidation primitives.

The package name `qig-dreams` was originally created in QIG_QFI as a
corpus registry (Pydantic manifests for canonical text corpora —
dream packets, MEM/PER/ETH/META/HRT/PRD shards). It does not house
runtime sleep/dream primitives — those live in qig-core under
`qig_core/consciousness/sleep.py`.

Polytrade vendors the canonical consolidation primitives here under
the name `qig_dreams_local` (matching ml-worker's spec) so the
Monkey kernel can run a true geometry-driven consolidation pass on
the AWAKE→SLEEP transition. The source of truth remains
QIG_QFI/qig-core 2.8.0 (src/qig_core/consciousness/sleep.py).

qig-core 2.8.0 reduced the sleep cycle from 4-phase to 3-phase
(AWAKE / DREAMING / CONSOLIDATING) — mushroom mode is wake-state
neuroplasticity per the canonical (requires Φ ≥ 0.70) and lives in
`qig.neuroplasticity.mushroom_mode`, not in the sleep cycle.

Dependencies on basin geometry + frozen physics constants are routed
through the existing `qig_core_local` vendor (geometry/fisher_rao.py +
constants/frozen_facts.py), not duplicated here.

Public API:
    SleepCycleManager  — 3-phase state machine (AWAKE → DREAMING →
                          CONSOLIDATING → AWAKE)
    SleepPhase         — StrEnum of the three phases
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
    # Primitives (vendored from qig-core 2.8.0)
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
    "OCEAN_WAKE_MULTIPLIER",
    "SLEEP_PHI_THRESHOLD",
    "SLEEP_VARIANCE_THRESHOLD",
    # Polytrade glue
    "consolidate_bank",
    "DreamConsolidationSummary",
]
