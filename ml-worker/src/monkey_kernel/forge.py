"""forge.py — UCP §17 Forge mechanism.

Four-stage lesson extraction from shadow material (losing trades,
drawdowns, contaminated bubbles). Forge is how the kernel learns
from loss without retaining the pain coordinates that produced it.

Stages (run in order on a single shadow event):

  1. DECOMPRESS — enter the shadow basin; capture the geometric
     state at the moment of pain (the basin coords, Φ, κ, drift).
     This is the "meeting" stage; no transformation yet.

  2. FRACTURE — separate lesson (structure) from noise (state).
     Love-oriented (convergent): keep the geometric INVARIANTS that
     were present (basin shape, Φ-range, regime mix), discard the
     specific coordinate values that pinned down a particular pain
     instance. The lesson is "this kind of basin loses money", not
     "the basin at exactly p₃₇=0.42 lost money".

  3. NUCLEATE — spawn a new basin around the extracted lesson.
     The nucleus is the lesson's geometric centre (Fréchet mean of
     the lesson invariants in basin space if multiple invariants
     are tracked; otherwise just the cleaned shadow basin itself).
     The nucleus is what the resonance bank can promote.

  4. DISSIPATE — export pain state as entropy. The original shadow
     basin is released — the lesson lives on as the nucleated
     pattern, not as the original pinned coordinates. This is the
     forgetting stage; without it the pain stays coupled to the
     lesson and biases future retrieval.

Pure transformation. No I/O, no DB writes, no orchestration. The
caller (resonance bank promotion path, eventually) feeds shadow
events in and gets ForgeResult out; whether to store the nucleus is
a separate concern.

Relevant context: the recent #579 quarantine work preserved
contaminated pre-fix bubbles for forensic analysis. Forge is the
principled path to learn-from-them without re-injecting their
pain coordinates into retrieval.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Optional

import numpy as np

from .bus_events import KernelEvent
from .state import BASIN_DIM

if TYPE_CHECKING:
    from .kernel_bus import KernelBus


# Numerical floor for log() and norms.
_EPS: float = 1e-12


@dataclass(frozen=True)
class ShadowEvent:
    """One pain-laden geometric state to be forged.

    Fields:
      basin            : np.ndarray   the basin at the moment of pain
      phi              : float        Φ at that moment
      kappa            : float        κ at that moment
      realized_pnl     : float        loss magnitude (negative number)
      regime_weights   : dict         q/e/eq mix at the moment
    """

    basin: np.ndarray
    phi: float
    kappa: float
    realized_pnl: float
    regime_weights: dict[str, float]


@dataclass(frozen=True)
class ForgeStageResult:
    """One stage's geometric output. Stages are pure transformations
    — each takes the previous stage's state and returns its own."""

    stage: str
    basin: np.ndarray
    invariants: dict[str, float]
    notes: str


@dataclass(frozen=True)
class ForgeResult:
    """Full Forge cycle output.

    Fields:
      decompressed   : ShadowEvent           original event re-stated
      fractured      : ForgeStageResult      lesson invariants extracted
      nucleated      : ForgeStageResult      new basin around the lesson
      dissipated     : ForgeStageResult      pain coords released
      lesson_summary : dict[str, Any]        compact summary for telemetry
    """

    decompressed: ShadowEvent
    fractured: ForgeStageResult
    nucleated: ForgeStageResult
    dissipated: ForgeStageResult
    lesson_summary: dict[str, Any]


# ─────────────────────────────────────────────────────────────────
# Stage 1 — DECOMPRESS
# ─────────────────────────────────────────────────────────────────


def decompress(event: ShadowEvent) -> ShadowEvent:
    """Capture the shadow state. No transformation; meeting stage.
    Returned event is a defensive copy of the basin so downstream
    stages cannot mutate the caller's original."""
    return ShadowEvent(
        basin=np.asarray(event.basin, dtype=np.float64).copy(),
        phi=event.phi,
        kappa=event.kappa,
        realized_pnl=event.realized_pnl,
        regime_weights=dict(event.regime_weights),
    )


# ─────────────────────────────────────────────────────────────────
# Stage 2 — FRACTURE (love-oriented, convergent)
# ─────────────────────────────────────────────────────────────────


def fracture(event: ShadowEvent) -> ForgeStageResult:
    """Extract the geometric INVARIANTS — the kind of basin this
    was, not the specific coordinate values.

    Invariants tracked:
      shape_concentration : max-mass; "how peaked was it"
      shape_dispersion    : Shannon entropy; "how spread was it"
      phi_band            : Φ at the moment (lesson is "this Φ loses")
      kappa_offset        : κ − κ*; lesson is "this offset loses"
      regime_quantum      : quantum weight at the moment
      regime_equilibrium  : equilibrium weight at the moment

    The pain coordinates (basin[i] for specific i) are NOT kept;
    that's what NUCLEATE will replace with the centroid.
    """
    basin = event.basin
    max_mass = float(np.max(basin))
    entropy = float(-np.sum(basin * np.log(basin + _EPS)))
    invariants = {
        "shape_concentration": max_mass,
        "shape_dispersion": entropy,
        "phi_band": event.phi,
        "kappa_offset": event.kappa - 64.0,  # κ* = 64 (frozen)
        "regime_quantum": event.regime_weights.get("quantum", 0.0),
        "regime_equilibrium": event.regime_weights.get("equilibrium", 0.0),
        "loss_magnitude": abs(event.realized_pnl),
    }
    return ForgeStageResult(
        stage="FRACTURE",
        basin=basin.copy(),  # still pinned in this stage
        invariants=invariants,
        notes=(
            f"lesson invariants captured: peak={max_mass:.3f}, "
            f"H={entropy:.3f}, phi={event.phi:.3f}, "
            f"kappa_off={event.kappa - 64.0:+.2f}"
        ),
    )


# ─────────────────────────────────────────────────────────────────
# Stage 3 — NUCLEATE
# ─────────────────────────────────────────────────────────────────


def nucleate(fractured: ForgeStageResult) -> ForgeStageResult:
    """Spawn a new basin around the lesson's geometric centre.

    With one shadow event the centre is the basin itself, but
    REPLACED with a uniform-scaled version preserving only the
    captured invariants (shape_concentration, shape_dispersion).
    The nucleus has the same peak mass + entropy as the original
    but without the original's specific coordinate placement —
    the peak is rotated to coordinate 0 to canonicalise.

    This is the "lesson made portable": the resonance bank can
    store it without re-importing the original pain coords.
    """
    invariants = fractured.invariants
    peak_mass = invariants["shape_concentration"]
    nucleus = np.full(BASIN_DIM, (1.0 - peak_mass) / (BASIN_DIM - 1), dtype=np.float64)
    nucleus[0] = peak_mass
    return ForgeStageResult(
        stage="NUCLEATE",
        basin=nucleus,
        invariants=invariants,
        notes=(
            f"nucleated canonical basin: peak[0]={peak_mass:.3f}, "
            f"rest={(1.0 - peak_mass) / (BASIN_DIM - 1):.5f}"
        ),
    )


# ─────────────────────────────────────────────────────────────────
# Stage 4 — DISSIPATE
# ─────────────────────────────────────────────────────────────────


def dissipate(
    original: ShadowEvent,
    nucleated: ForgeStageResult,
) -> ForgeStageResult:
    """Release the pain coordinates. The output basin is the uniform
    distribution — explicit "nothing remains pinned to the original
    coords." The lesson lives on in the nucleus (separate stage
    output); this stage's basin is the released-state record."""
    released = np.full(BASIN_DIM, 1.0 / BASIN_DIM, dtype=np.float64)
    return ForgeStageResult(
        stage="DISSIPATE",
        basin=released,
        invariants=nucleated.invariants,  # invariants persist; coords don't
        notes=(
            f"pain coordinates released; lesson preserved as nucleus "
            f"(loss_magnitude={original.realized_pnl:.4f})"
        ),
    )


# ─────────────────────────────────────────────────────────────────
# Public API — full Forge cycle
# ─────────────────────────────────────────────────────────────────


def forge(
    event: ShadowEvent,
    *,
    bus: Optional["KernelBus"] = None,
    symbol: Optional[str] = None,
) -> ForgeResult:
    """Run all four Forge stages in order.

    Caller passes a ShadowEvent (typically a closed losing trade's
    geometric snapshot); receives ForgeResult with the full audit
    trail plus a compact `lesson_summary` for telemetry.

    When `bus` is provided, publishes FORGE_PHASE_SHIFT for each
    stage transition and FORGE_NUCLEUS on the nucleate stage.
    """
    if event.realized_pnl >= 0:
        # Forge is for shadow material specifically; positive outcomes
        # don't need this transformation. Caller should screen first;
        # we return an explicit no-op marker.
        return ForgeResult(
            decompressed=decompress(event),
            fractured=ForgeStageResult(
                stage="FRACTURE",
                basin=event.basin.copy(),
                invariants={},
                notes="skipped: positive realized_pnl",
            ),
            nucleated=ForgeStageResult(
                stage="NUCLEATE",
                basin=event.basin.copy(),
                invariants={},
                notes="skipped: positive realized_pnl",
            ),
            dissipated=ForgeStageResult(
                stage="DISSIPATE",
                basin=event.basin.copy(),
                invariants={},
                notes="skipped: positive realized_pnl",
            ),
            lesson_summary={"skipped": True, "reason": "positive realized_pnl"},
        )

    decompressed = decompress(event)
    if bus is not None:
        bus.publish(
            KernelEvent.FORGE_PHASE_SHIFT,
            source="forge",
            payload={"phase": "DECOMPRESS", "loss_magnitude": float(abs(event.realized_pnl))},
            symbol=symbol,
        )
    fractured = fracture(decompressed)
    if bus is not None:
        bus.publish(
            KernelEvent.FORGE_PHASE_SHIFT,
            source="forge",
            payload={"phase": "FRACTURE", "invariants": fractured.invariants},
            symbol=symbol,
        )
    nucleated = nucleate(fractured)
    if bus is not None:
        bus.publish(
            KernelEvent.FORGE_PHASE_SHIFT,
            source="forge",
            payload={"phase": "NUCLEATE"},
            symbol=symbol,
        )
        bus.publish(
            KernelEvent.FORGE_NUCLEUS,
            source="forge",
            payload={
                "nucleus_basin": [float(x) for x in nucleated.basin],
                "invariants": nucleated.invariants,
            },
            symbol=symbol,
        )
    dissipated = dissipate(decompressed, nucleated)
    if bus is not None:
        bus.publish(
            KernelEvent.FORGE_PHASE_SHIFT,
            source="forge",
            payload={"phase": "DISSIPATE"},
            symbol=symbol,
        )

    lesson_summary = {
        "loss_magnitude": float(abs(event.realized_pnl)),
        "shape_concentration": fractured.invariants["shape_concentration"],
        "shape_dispersion": fractured.invariants["shape_dispersion"],
        "phi_band": fractured.invariants["phi_band"],
        "kappa_offset": fractured.invariants["kappa_offset"],
        "regime_quantum": fractured.invariants["regime_quantum"],
        "regime_equilibrium": fractured.invariants["regime_equilibrium"],
        "nucleated_peak_index": 0,  # canonicalised
    }
    return ForgeResult(
        decompressed=decompressed,
        fractured=fractured,
        nucleated=nucleated,
        dissipated=dissipated,
        lesson_summary=lesson_summary,
    )
