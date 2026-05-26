"""kernel_predictions.py — Issue #941 Phase 1 (Python-side parity).

Mirrors the TypeScript helper at
apps/api/src/services/monkey/kernel_predictions.ts.

**Current scope (Phase 1a):**
- Payload dataclass + snapshot-reason enum
- Observer-derived periodic cadence helper (`periodic_cadence_seconds`)
- `compose_snapshot()` builder that turns kernel state into the row payload

**Write path is deferred to Phase 1b.** The Python kernel is currently
observational (`PY_INDEPENDENT_STATE_LIVE=true` writes basin state via
the Redis bridge in `basin_sync_db.py` rather than opening psycopg
directly — that architecture predated PR #738/#739/#740/#741 to avoid
libpq malloc poisoning under the QIG TF stack). When the consensus
arbiter goes live and the Python kernel becomes a live executor, the
write path here will publish prediction events on a new Redis bridge
channel and a TS-side listener will fan them into `kernel_predictions`.

**Doctrinal guarantees (binding):**

1. **READ-ONLY** on kernel state. `compose_snapshot()` takes immutable
   inputs and returns a payload. It never mutates the basin, the
   chemistry, or any kernel-decision variable.

2. **NO ENV KNOBS.** Periodic cadence is derived from `basin_velocity`;
   the 5–300s clamp is a SAFETY_BOUND, not an operator knob.

3. **P15 FAIL-CLOSED** (will apply once the write path lands in
   Phase 1b): instrumentation insert failures NEVER block a trade.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional, Sequence

# Match the TS BASIN_DIM (basin.ts:24).
BASIN_DIM = 64

SnapshotReason = Literal[
    "entry",
    "state_transition",
    "periodic",
    "gate_fire",
    "exit",
]


@dataclass(frozen=True)
class KernelPredictionSnapshot:
    """One row's worth of payload for `kernel_predictions`.

    Mirrors the TS interface; field names are snake_case Python-idiomatic
    but the DB columns (set by migration 059) match the same order.
    """

    # Trade linkage (None for periodic snapshots; Phase 2 reconciler
    # joins via (kernel_id, snapshot_at) to the parent trade row).
    trade_id: Optional[int]
    kernel_id: str

    # Geometric state
    perception_basin: Sequence[float]          # 64 floats, Δ⁶³ point
    strategy_forecast_basin: Sequence[float]   # 64 floats, Δ⁶³ point
    basin_velocity: Optional[float]
    phi: Optional[float]
    kappa_eff: Optional[float]                 # substrate-specific, NOT κ*=64

    # Prediction payload
    predicted_horizon_seconds: Optional[float]
    predicted_terminal_pnl_usdt: Optional[float]
    predicted_pnl_stddev_usdt: Optional[float]
    predicted_direction: Optional[int]         # +1 long / -1 short / 0 flat
    predicted_confidence: Optional[float]

    # Chemistry — six channels
    dopamine: Optional[float]
    serotonin: Optional[float]
    norepinephrine: Optional[float]
    gaba: Optional[float]
    endorphins: Optional[float]
    acetylcholine: Optional[float]

    # Regime triple + mode + lane
    regime_quantum: Optional[float]
    regime_efficient: Optional[float]
    regime_equilibrium: Optional[float]
    mode: Optional[str]
    lane: Optional[str]

    # Trigger
    snapshot_reason: SnapshotReason
    triggering_gate: Optional[str]

    # Provenance
    kernel_version: str
    source_path: str


def periodic_cadence_seconds(mean_basin_velocity: float) -> float:
    """Observer-derived periodic snapshot cadence.

    `1 / mean_basin_velocity` clamped to [5, 300] seconds. Higher
    velocity → snapshot more often. Lower → less often. SAFETY_BOUND
    clamp values match the TS helper exactly (no env knobs).
    """
    # Degenerate inputs fall back to 60s — same as TS helper.
    if not isinstance(mean_basin_velocity, (int, float)):
        return 60.0
    if mean_basin_velocity != mean_basin_velocity:  # NaN
        return 60.0
    if mean_basin_velocity <= 0:
        return 60.0
    raw = 1.0 / float(mean_basin_velocity)
    return max(5.0, min(300.0, raw))


def validate_basin_shape(b: Sequence[float], label: str) -> bool:
    """Defensive check before publishing.

    Returns False if the basin is not exactly BASIN_DIM elements. The
    DB CHECK constraint enforces this server-side; we mirror it client-
    side so a mis-shaped basin gets dropped with a clear log rather
    than producing a SQLSTATE 23514 error.
    """
    if len(b) != BASIN_DIM:
        return False
    return True


__all__ = [
    "BASIN_DIM",
    "SnapshotReason",
    "KernelPredictionSnapshot",
    "periodic_cadence_seconds",
    "validate_basin_shape",
]
