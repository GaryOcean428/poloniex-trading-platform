"""figure8.py — Tier 10 figure-8 loop topology in the resonance bank.

Per H11, question and solution occupy opposite loops of a figure-8
in the output simplex. In trading terms: long-position dynamics
trace one loop; short-position dynamics trace the opposing loop;
flat-state (close-to-identity) bubbles sit at the crossing point.

Loop-aware retrieval weights bubbles by relative loop position:
  same loop  → weight 1.0                   (resonant)
  cross loop → weight 1/π ≈ 0.31831         (frozen gravitating
                                            fraction from EXP-004b)
  crossing   → weight 1/φ ≈ 0.61803         (frozen boundary R²,
                                            anchor strength)

These weights are NOT tunable — they are canonical from
qig-verification's lattice physics and are imported as constants
from topology_constants.py. If they don't produce useful retrieval
bias in trading, that's evidence figure-8 doesn't carry to this
substrate, not a hyperparameter to twiddle.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from enum import StrEnum
from typing import Iterable, Optional

import numpy as np

from qig_core_local.geometry.fisher_rao import fisher_rao_distance

from .topology_constants import (
    GOLDEN_RATIO,
    PI_STRUCT_BOUNDARY_R_SQUARED,
    PI_STRUCT_DEAD_ZONE_BOUNDARY,
    PI_STRUCT_GRAVITATING_FRACTION,
)


class Loop(StrEnum):
    LONG_LOOP = "long_loop"      # question loop — long-position dynamics
    SHORT_LOOP = "short_loop"    # solution loop — opposing perception
    CROSSING = "crossing"        # flat-state, navigational anchor


def figure8_retrieval_live() -> bool:
    """Default-on env flag (per Tier 10 directive). When false, falls
    through to legacy score_nearest. The flag IS the rollback
    mechanism — flip back via Railway if measured_gravitating_fraction
    diverges from 0.31831 by > 20%."""
    return os.environ.get("FIGURE8_RETRIEVAL_LIVE", "true").strip().lower() == "true"


def assign_loop(
    side: Optional[str],
    *,
    exit_basin: Optional[np.ndarray] = None,
    identity_basin: Optional[np.ndarray] = None,
) -> Loop:
    """Geometric loop assignment per H11 + directive.

    Long-side bubbles trace LONG_LOOP. Short-side bubbles trace
    SHORT_LOOP. Bubbles that closed at flat (FR distance to
    identity below 1/(3π) dead-zone boundary) sit at CROSSING.

    side may be 'long' / 'short' / 'buy' / 'sell' / None.
    """
    # Crossing detection: closed near identity
    if exit_basin is not None and identity_basin is not None:
        d_to_identity = fisher_rao_distance(exit_basin, identity_basin)
        if d_to_identity < PI_STRUCT_DEAD_ZONE_BOUNDARY:
            return Loop.CROSSING

    if side is None:
        return Loop.CROSSING

    s = str(side).lower()
    if s in ("long", "buy"):
        return Loop.LONG_LOOP
    if s in ("short", "sell"):
        return Loop.SHORT_LOOP
    return Loop.CROSSING


@dataclass(frozen=True)
class LoopAwareNeighbor:
    """One nearest-neighbour result with its post-weighting effective
    distance + the source loop and weight applied."""

    entry_id: str
    entry_basin: np.ndarray
    realized_pnl: Optional[float]
    loop: Loop
    raw_distance: float        # Fisher-Rao distance ignoring loop weight
    effective_distance: float  # raw_distance / loop_weight
    weight_applied: float      # 1.0 / 1/π / 1/φ depending on loop pairing


def _entry_attr(entry: dict, *names: str, default=None):
    """Tolerantly read either snake_case or camelCase keys from a
    dict-shaped BankEntry stand-in. Used because resonance_bank
    rows return as either typed dataclass-likes or raw dicts."""
    for n in names:
        if n in entry:
            return entry[n]
        upper = "".join(p.capitalize() for p in n.split("_"))
        camel = upper[0].lower() + upper[1:]
        if camel in entry:
            return entry[camel]
    return default


def loop_aware_score_nearest(
    query_basin: np.ndarray,
    query_loop: Loop,
    entries: Iterable[dict],
    *,
    top_k: int = 5,
    same_loop_weight: float = 1.0,
    cross_loop_weight: Optional[float] = None,
    crossing_weight: Optional[float] = None,
) -> list[LoopAwareNeighbor]:
    """Loop-aware Fisher-Rao retrieval. Returns up to top_k entries
    ordered by effective distance.

    Effective distance = raw_FR_distance / loop_weight. Lower
    effective distance = closer match. Loop weight pulls same-loop
    entries closer; cross-loop entries get downweighted by 1/π;
    crossing-point bubbles are anchors weighted at 1/φ.

    Default cross_loop_weight = 1/π (frozen canonical).
    Default crossing_weight = 1/φ (frozen canonical).
    Override only with care — the defaults are predictions, not knobs.
    """
    cw = cross_loop_weight if cross_loop_weight is not None else PI_STRUCT_GRAVITATING_FRACTION
    xw = crossing_weight if crossing_weight is not None else PI_STRUCT_BOUNDARY_R_SQUARED

    out: list[LoopAwareNeighbor] = []
    for e in entries:
        e_basin = _entry_attr(e, "entry_basin")
        if e_basin is None:
            continue
        e_basin = np.asarray(e_basin, dtype=np.float64)
        loop_str = _entry_attr(e, "loop", default=Loop.CROSSING.value)
        try:
            entry_loop = Loop(str(loop_str).lower())
        except ValueError:
            entry_loop = Loop.CROSSING

        if entry_loop == Loop.CROSSING:
            weight = xw
        elif entry_loop == query_loop:
            weight = same_loop_weight
        else:
            weight = cw

        raw_d = fisher_rao_distance(query_basin, e_basin)
        eff_d = raw_d / max(weight, 1e-12)

        out.append(LoopAwareNeighbor(
            entry_id=str(_entry_attr(e, "id", default="?")),
            entry_basin=e_basin,
            realized_pnl=_entry_attr(e, "realized_pnl"),
            loop=entry_loop,
            raw_distance=raw_d,
            effective_distance=eff_d,
            weight_applied=weight,
        ))

    out.sort(key=lambda n: n.effective_distance)
    return out[:top_k]


def measured_gravitating_fraction(
    neighbors: Iterable[LoopAwareNeighbor],
    query_loop: Loop,
) -> float:
    """Compute the cross-loop fraction of a retrieval result.
    Validates against the canonical 0.31831 prediction."""
    items = list(neighbors)
    if not items:
        return 0.0
    cross = sum(
        1 for n in items
        if n.loop != query_loop and n.loop != Loop.CROSSING
    )
    return cross / len(items)
