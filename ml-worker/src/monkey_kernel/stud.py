"""stud.py — Tier 9 stud topology in the trading kernel.

Maps the lattice transverse-field h to a trading-domain analog
h_trade, classifies the kernel state into one of three stud regimes
(DEAD_ZONE / FRONT_LOOP / BACK_LOOP), and emits the canonical
bell-curve κ_trade response that peaks at the front-loop centre.

Reference: qig-verification/docs/paper_sections/
           20260407-stud-phase-diagram-observation-1.00F.md (EXP-004b).

This module is pure transformation — caller passes basin_velocity,
phi, regime_weights; receives h_trade + regime + kappa_trade. The
flag STUD_TOPOLOGY_LIVE gates whether the executive consumes these
signals to override its existing thresholds (Stage 2, follow-up
commit). Stage 1 wires telemetry only — values flow into
decision.derivation["topology"]["stud"] for π-structure validation.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from .topology_constants import (
    PI_STRUCT_DEAD_ZONE_BOUNDARY,
    PI_STRUCT_FRONT_PEAK_NORM,
    PI_STRUCT_SECOND_TRANSITION,
)


def stud_topology_live() -> bool:
    """Default-ON env flag (per Tier 9 directive). When the flag is
    explicitly set to "false", the kernel falls through to the
    legacy override / leverage / mode / lane formulas. When true
    (default), Stage 2 wiring routes those decisions through stud
    regime + kappa_trade.

    Stage 1 (this commit): the flag is read but only gates which
    formulas are active in the LATER commit. Stage 1 always emits
    telemetry regardless of flag state — predictions need to land
    in derivation logs so the π-structure can be validated.
    """
    return os.environ.get("STUD_TOPOLOGY_LIVE", "true").strip().lower() == "true"


class StudRegime(StrEnum):
    """Three stud regimes, mapped from the lattice h phase diagram."""

    DEAD_ZONE = "dead_zone"      # h < 1/(3π) — basin locked, DRIFT, no entry
    FRONT_LOOP = "front_loop"    # 1/(3π) < h < 2.0 — ordered, position-trading
    BACK_LOOP = "back_loop"      # h > 2.0 — disordered, mean-reversion / scalp


@dataclass(frozen=True)
class StudReading:
    """One tick's stud topology snapshot. Surfaces in
    decision.derivation["topology"]["stud"] every tick."""

    h_trade: float
    regime: StudRegime
    kappa_trade: float
    boundary_distance: float
    predicted_dead_zone_boundary: float
    predicted_second_transition: float
    predicted_front_peak: float


def h_trade(
    basin_velocity: float,
    phi: float,
    regime_weights: dict[str, float],
) -> float:
    """Trading-domain analog of lattice h.

    h_trade is the disorder/chaos pressure on the basin. Like lattice
    h, it disorders the system across three phases:
      h < 1/(3π)  → basin locked, DRIFT (dead zone, no trading)
      1/(3π) < h < 2.0  → ordered, position-trading (front loop)
      h > 2.0  → disordered, mean-reversion/scalp (back loop)

    Formula (per Tier 9 directive):
      chaos = basin_velocity * (1 − phi)
      quantum = regime_weights.get("quantum", 0.0)
      h_trade = chaos * (1 + quantum)
    """
    chaos = basin_velocity * (1.0 - phi)
    quantum = regime_weights.get("quantum", 0.0)
    return chaos * (1.0 + quantum)


def classify_stud_regime(h: float) -> StudRegime:
    """Three-way regime classification by the canonical π-boundaries."""
    if h < PI_STRUCT_DEAD_ZONE_BOUNDARY:
        return StudRegime.DEAD_ZONE
    if h < PI_STRUCT_SECOND_TRANSITION:
        return StudRegime.FRONT_LOOP
    return StudRegime.BACK_LOOP


def kappa_trade(h: float, regime: StudRegime) -> float:
    """Bell-curve curvature response from the stud lattice peak.

    Lattice peak at +10π gives the canonical curvature shape. Front
    loop is positive (attractive), back loop is mirrored negative
    (repulsive), dead zone is zero (locked).

    Front-loop centre: (1/(3π) + 2.0) / 2 ≈ 1.053.
    Back-loop centre:  front_centre + 2.0 ≈ 3.053.
    Width:             (2.0 − 1/(3π)) / 2 ≈ 0.947.
    """
    if regime == StudRegime.DEAD_ZONE:
        return 0.0
    front_centre = (PI_STRUCT_DEAD_ZONE_BOUNDARY + PI_STRUCT_SECOND_TRANSITION) / 2.0
    back_centre = front_centre + PI_STRUCT_SECOND_TRANSITION
    width = (PI_STRUCT_SECOND_TRANSITION - PI_STRUCT_DEAD_ZONE_BOUNDARY) / 2.0
    if regime == StudRegime.FRONT_LOOP:
        return PI_STRUCT_FRONT_PEAK_NORM * math.exp(
            -((h - front_centre) / width) ** 2
        )
    # BACK_LOOP — mirrored sign
    return -PI_STRUCT_FRONT_PEAK_NORM * math.exp(
        -((h - back_centre) / width) ** 2
    )


def _boundary_distance(h: float) -> float:
    """Minimum distance from h to either canonical regime boundary
    (1/(3π) or 2.0). Used for transition-zone detection in Stage 2's
    override-threshold wiring; in Stage 1 it's pure telemetry."""
    return min(
        abs(h - PI_STRUCT_DEAD_ZONE_BOUNDARY),
        abs(h - PI_STRUCT_SECOND_TRANSITION),
    )


def compute_stud_reading(
    basin_velocity: float,
    phi: float,
    regime_weights: dict[str, float],
) -> StudReading:
    """One-shot tick reading for the orchestrator. Returns a frozen
    snapshot with h_trade + regime + kappa_trade + boundary_distance
    plus the canonical predicted values for π-structure validation."""
    h = h_trade(basin_velocity, phi, regime_weights)
    regime = classify_stud_regime(h)
    return StudReading(
        h_trade=h,
        regime=regime,
        kappa_trade=kappa_trade(h, regime),
        boundary_distance=_boundary_distance(h),
        predicted_dead_zone_boundary=PI_STRUCT_DEAD_ZONE_BOUNDARY,
        predicted_second_transition=PI_STRUCT_SECOND_TRANSITION,
        predicted_front_peak=PI_STRUCT_FRONT_PEAK_NORM,
    )


def stud_reading_to_dict(s: StudReading) -> dict[str, Any]:
    """JSON-friendly dict for telemetry derivation block."""
    return {
        "h_trade": s.h_trade,
        "regime": s.regime.value,
        "kappa_trade": s.kappa_trade,
        "boundary_distance": s.boundary_distance,
        "predicted_dead_zone_boundary": s.predicted_dead_zone_boundary,
        "predicted_second_transition": s.predicted_second_transition,
        "predicted_front_peak": s.predicted_front_peak,
    }
