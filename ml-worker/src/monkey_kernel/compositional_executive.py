"""compositional_executive.py — REGIME-1 compositional cell matrix (Python port).

Phase axis (CREATOR / PRESERVER / DISSOLVER) from Layer-1 qig_warp (CAL-3).
Direction axis (TREND_UP / CHOP / TREND_DOWN) from Layer-2 TrajectoryObserver /
``classify_regime``.

Mirrors ``apps/api/src/services/monkey/compositional_executive.ts`` so that TS
and Py consume the same decision semantics from the joint (phase, direction) state.

Per docs/regime-classification-hierarchy.md §"The composition":

  |             | TREND_UP                              | CHOP                                       | TREND_DOWN                              |
  | CREATOR     | Aggressive trend-follow, max size     | Trade lightly, expect breakout             | Aggressive trend-follow (short)         |
  | PRESERVER   | Ride established trend, tight stops   | Mean-revert (consolidating)                | Ride established short, tight stops     |
  | DISSOLVER   | Don't trade — momentum reverting      | Sit out (max entropy)                      | Don't trade — momentum reverting        |

QIG-pure: every multiplier and bias is a discrete-choice mapping from
(phase, direction) — no free knob is interpolated. The cells encode the intent;
they are not interpolation parameters.

REGIME-1 #766 / docs/regime-classification-hierarchy.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional


RegimePhase = Literal["CREATOR", "PRESERVER", "DISSOLVER"]
TrajectoryDirection = Literal["TREND_UP", "CHOP", "TREND_DOWN"]
CellLaneBias = Literal["trend", "swing", "scalp", "observe"]
HarvestTightness = Literal["loose", "normal", "tight"]


@dataclass(frozen=True)
class CellObserverContext:
    """Observer context for cell evaluation.

    Phase 1 (2026-05-26) — when supplied, CHOP cells derive ``size_multiplier``
    from ``phi × regime_confidence`` floored at the DISSOLVER SAFETY_BOUND (0.2)
    instead of operator env knobs. New production callers in tick.py MUST pass
    observables so the doctrine-clean derivation fires.

    Optional for back-compat: legacy callers get a deterministic default
    (phi=0.5, regime_confidence=1.0 → multiplier 0.5 ≈ previous CHOP midpoint).
    """

    phi: float
    regime_confidence: float


_DEFAULT_OBSERVER = CellObserverContext(phi=0.5, regime_confidence=1.0)


@dataclass(frozen=True)
class CellAction:
    """Decision output for a (phase, direction) joint state."""

    phase: RegimePhase
    direction: TrajectoryDirection
    lane_bias: CellLaneBias
    """Recommended lane bias — folded into choose_lane as an additive shift."""
    size_multiplier: float
    """Multiplier on capped equity. 0 = suppress; 1.0 = normal; >1.0 capped at 1.0."""
    harvest_tightness: HarvestTightness
    """'loose' lets winners run; 'tight' captures on touch; 'normal' = default."""
    label: str
    """Short human-readable cell label for logs/telemetry."""


def evaluate_cell(
    phase: RegimePhase,
    direction: TrajectoryDirection,
    observer: CellObserverContext = _DEFAULT_OBSERVER,
) -> CellAction:
    """Look up the cell action for a (phase, direction) joint state.

    Pure function — no rolling state, no env reads. CHOP cells use the
    observer context to derive their size multiplier from kernel-internal
    observables (phi × regime_confidence floored at 0.2). Trending cells
    stay at full conviction (1.0). DISSOLVER cells stay at the 0.2
    SAFETY_BOUND floor (PR #946).
    """
    # Phase 1 doctrine: CHOP-cell multiplier is observer-derived, NOT an
    # env knob. The kernel's own phi × regime_confidence composite determines
    # how aggressively the kernel sizes in chop, floored at the DISSOLVER
    # SAFETY_BOUND (0.2). Removes REGIME_CREATOR_CHOP_SIZE_MULT (was 0.75)
    # and REGIME_PRESERVER_CHOP_SIZE_MULT (was 0.85). The historical
    # CREATOR-vs-PRESERVER differentiation now emerges naturally from
    # observables.
    chop_multiplier = max(0.2, observer.phi * observer.regime_confidence)

    # CREATOR — h-dominated, broken-symmetry → discovery + breakouts
    if phase == "CREATOR":
        if direction == "TREND_UP":
            return CellAction(
                phase=phase, direction=direction, lane_bias="trend",
                size_multiplier=1.0, harvest_tightness="normal",
                label="CREATOR×TREND_UP: aggressive trend-follow",
            )
        if direction == "TREND_DOWN":
            return CellAction(
                phase=phase, direction=direction, lane_bias="trend",
                size_multiplier=1.0, harvest_tightness="normal",
                label="CREATOR×TREND_DOWN: aggressive trend-follow (short)",
            )
        return CellAction(
            phase=phase, direction=direction, lane_bias="scalp",
            size_multiplier=chop_multiplier, harvest_tightness="tight",
            label="CREATOR×CHOP: trade lightly, expect breakout",
        )

    # PRESERVER — J-dominated, ordered → continuation favoured
    if phase == "PRESERVER":
        if direction == "TREND_UP":
            return CellAction(
                phase=phase, direction=direction, lane_bias="trend",
                size_multiplier=1.0, harvest_tightness="loose",
                label="PRESERVER×TREND_UP: ride established trend",
            )
        if direction == "TREND_DOWN":
            return CellAction(
                phase=phase, direction=direction, lane_bias="trend",
                size_multiplier=1.0, harvest_tightness="loose",
                label="PRESERVER×TREND_DOWN: ride established short",
            )
        return CellAction(
            phase=phase, direction=direction, lane_bias="swing",
            size_multiplier=chop_multiplier, harvest_tightness="normal",
            label="PRESERVER×CHOP: mean-revert (consolidating)",
        )

    # DISSOLVER — disordered, direction unreliable → reduced conviction.
    #
    # 2026-05-26: hard 0.0 multiplier replaced with 0.2 SAFETY_BOUND floor.
    # The autonomy doctrine (polytrade_autonomy_doctrine) is that the kernel
    # restrains itself via chemistry feedback, not via hardcoded "don't trade"
    # gates. Catastrophic safety is owned by should_auto_flatten (P15).
    #
    # The 0.2 floor mirrors the existing CHOP suppression filter (the
    # SAFETY_BOUND that the kernel always attempts a defensive-sized position
    # rather than fully sitting out).
    #
    # harvestTightness stays 'tight' — when sizing is reduced, exits are
    # aggressive to protect the smaller position from chop bleed.
    # laneBias stays 'observe' so choose_lane biases toward the smallest
    # lane (scalp) consistent with reduced-conviction sizing.
    _DISSOLVER_FLOOR = 0.2
    if direction in ("TREND_UP", "TREND_DOWN"):
        return CellAction(
            phase=phase, direction=direction, lane_bias="observe",
            size_multiplier=_DISSOLVER_FLOOR, harvest_tightness="tight",
            label=f"DISSOLVER×{direction}: reduced conviction — momentum reverting",
        )
    return CellAction(
        phase=phase, direction=direction, lane_bias="observe",
        size_multiplier=_DISSOLVER_FLOOR, harvest_tightness="tight",
        label="DISSOLVER×CHOP: reduced conviction (max entropy)",
    )


def regime_to_direction(regime: str) -> Optional[TrajectoryDirection]:
    """Map a trajectory regime string to the direction axis label.

    Returns None if the input is not a recognised direction value.
    """
    if regime == "TREND_UP":
        return "TREND_UP"
    if regime == "TREND_DOWN":
        return "TREND_DOWN"
    if regime == "CHOP":
        return "CHOP"
    return None


def canonical_to_phase(regime: Optional[str]) -> Optional[RegimePhase]:
    """Map a canonical phase regime string from CAL-3 / qig_warp to the
    RegimePhase axis. Returns None if the input is not recognised.

    Accepts the lower-case strings used by the ``MarketRegime`` enum:
    'creator', 'preserver', 'dissolver'.
    """
    if regime is None:
        return None
    if regime == "creator":
        return "CREATOR"
    if regime == "preserver":
        return "PRESERVER"
    if regime == "dissolver":
        return "DISSOLVER"
    return None


# qig_warp internal label → MarketRegime lower-case string → RegimePhase.
# qig_warp emits "CRITICAL" | "ORDERED" | "DISORDERED" from
# ``WarpBubble.qig_regime(...).regime.regime.value``.
_QIG_WARP_TO_PHASE: dict[str, RegimePhase] = {
    "CRITICAL":   "CREATOR",    # h/J ≈ h_c, phase transition → breakouts
    "ORDERED":    "PRESERVER",  # J-dominated, trending substrate
    "DISORDERED": "DISSOLVER",  # h-dominated, noise substrate
}


def qig_warp_label_to_phase(label: Optional[str]) -> Optional[RegimePhase]:
    """Map a raw qig_warp regime label to the RegimePhase axis.

    ``label`` is the string from
    ``bubble.regime.regime.value`` — one of "CRITICAL", "ORDERED",
    "DISORDERED". Returns None for missing or unrecognised values.

    This is the extraction helper for callers that read the label from
    ``ExpectationDecision.raw["regime_label"]`` (tick.py).
    """
    if not label:
        return None
    return _QIG_WARP_TO_PHASE.get(label.strip().upper())
