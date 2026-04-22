"""
working_memory.py — qig-cache bubble lifecycle (v0.7.9).

Pure Fisher-Rao working memory. Port of working_memory.ts. Per P25
Canonical Principles v2.1, pop/merge/promote thresholds are DERIVED
from running Φ / FR-distance distributions each tick — not set as
constants.

Bubble structure:
  id, center (64-D basin), phi, createdAt, lifetimeMs, payload,
  status (alive | merged | popped | promoted), metadata

Each tick:
  1. Pop expired (Φ-based pop threshold OR age)
  2. Merge pairwise-close bubbles (FR distance < adaptive merge threshold)
  3. Promote Φ-strong bubbles (above adaptive promote threshold)
  4. Compact (bound total count)

Purity: all merge decisions via qig_core_local.fisher_rao_distance.
No Euclidean. Merge centers via Fréchet mean — Karcher mean on Δ⁶³.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

import numpy as np

from qig_core_local.geometry.fisher_rao import (
    Basin,
    fisher_rao_distance,
    frechet_mean,
)

from .parameters import get_registry

_registry = get_registry()

# Pre-registry defaults. Match v0.8.1/v0.8.6 migration seed values
# exactly so behaviour is byte-identical registry-on vs -off.
_DEFAULT_PHI_HISTORY_MAX = 200
_DEFAULT_MAX_BUBBLES = 500
_DEFAULT_BUBBLE_LIFETIME_MS = 15 * 60 * 1000.0
_DEFAULT_BOOTSTRAP_POP = 0.15
_DEFAULT_BOOTSTRAP_PROMOTE = 0.70
_DEFAULT_BOOTSTRAP_MERGE = 0.15

BubbleStatus = Literal["alive", "merged", "popped", "promoted"]


@dataclass
class BubblePayload:
    symbol: Optional[str] = None
    signal: Optional[str] = None
    realized_pnl: Optional[float] = None
    entry_basin: Optional[Basin] = None
    order_id: Optional[str] = None


@dataclass
class Bubble:
    id: str
    center: Basin
    phi: float
    created_at_ms: float
    lifetime_ms: float
    payload: Optional[BubblePayload] = None
    status: BubbleStatus = "alive"
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class WorkingMemoryStats:
    alive: int
    popped: int
    merged: int
    promoted: int
    phi_mean: float
    phi_max: float
    age_mean_ms: float
    pop_threshold: float
    promote_threshold: float
    merge_threshold: float


class WorkingMemory:
    """FOAM-phase working memory. One instance per perception kernel.

    Adaptive thresholds (P25):
      pop threshold    = 25th percentile of recent Φ
      promote threshold = 75th percentile of recent Φ
      merge threshold  = median pairwise FR distance of alive bubbles
    Bootstrap defaults (permissive) until we have ≥ 10 samples.
    """

    # Registry-backed class attribute — read at init so each kernel
    # instance picks up the current governance setting.
    PHI_HISTORY_MAX: int = _DEFAULT_PHI_HISTORY_MAX

    def __init__(
        self,
        *,
        default_lifetime_ms: Optional[float] = None,
        max_bubbles: Optional[int] = None,
    ) -> None:
        # All three knobs honour caller override first, then registry,
        # then the hardcoded default. Caller override is only used by
        # tests that need a deterministic fixture; production paths
        # leave them None to let the registry govern.
        self.bubbles: list[Bubble] = []
        self.default_lifetime_ms = (
            float(default_lifetime_ms) if default_lifetime_ms is not None
            else float(_registry.get(
                "wm.default_bubble_lifetime_ms",
                default=_DEFAULT_BUBBLE_LIFETIME_MS,
            ))
        )
        self.max_bubbles = (
            int(max_bubbles) if max_bubbles is not None
            else int(_registry.get("wm.max_bubbles", default=_DEFAULT_MAX_BUBBLES))
        )
        self.PHI_HISTORY_MAX = int(_registry.get(
            "wm.phi_history_max", default=_DEFAULT_PHI_HISTORY_MAX,
        ))
        self._phi_history: list[float] = []

    # ─── adaptive thresholds (P25) ───

    def _adaptive_thresholds(self) -> dict[str, float]:
        if len(self._phi_history) < 10:
            # Bootstrap phase — registry-backed SAFETY_BOUND fallbacks.
            # These only apply until enough Φ history accumulates to
            # derive the 25th/75th percentiles.
            return {
                "pop": _registry.get(
                    "wm.bootstrap_pop_threshold", default=_DEFAULT_BOOTSTRAP_POP,
                ),
                "promote": _registry.get(
                    "wm.bootstrap_promote_threshold",
                    default=_DEFAULT_BOOTSTRAP_PROMOTE,
                ),
                "merge": _registry.get(
                    "wm.bootstrap_merge_threshold",
                    default=_DEFAULT_BOOTSTRAP_MERGE,
                ),
            }

        sorted_phi = sorted(self._phi_history)

        def q(p: float) -> float:
            i = min(len(sorted_phi) - 1, int(len(sorted_phi) * p))
            return sorted_phi[i]

        # Merge threshold: 25th percentile of alive pairwise FR distances.
        alive = [b for b in self.bubbles if b.status == "alive"]
        merge_thr = 0.15
        if len(alive) >= 2:
            distances: list[float] = []
            for i in range(len(alive)):
                for j in range(i + 1, len(alive)):
                    distances.append(
                        fisher_rao_distance(alive[i].center, alive[j].center)
                    )
            if distances:
                distances.sort()
                merge_thr = distances[min(len(distances) - 1, int(len(distances) * 0.25))]

        return {"pop": q(0.25), "promote": q(0.75), "merge": merge_thr}

    # ─── public API ───

    def add(
        self,
        center: Basin,
        phi: float,
        *,
        now_ms: float,
        metadata: Optional[dict[str, Any]] = None,
        lifetime_ms: Optional[float] = None,
    ) -> Bubble:
        b = Bubble(
            id=f"b-{int(now_ms)}-{uuid.uuid4().hex[:6]}",
            center=center,
            phi=phi,
            created_at_ms=now_ms,
            lifetime_ms=lifetime_ms or self.default_lifetime_ms,
            status="alive",
            metadata=metadata or {},
        )
        self.bubbles.append(b)
        self._phi_history.append(phi)
        if len(self._phi_history) > self.PHI_HISTORY_MAX:
            self._phi_history.pop(0)
        return b

    def reinforce(self, bubble_id: str, delta: float) -> None:
        for b in self.bubbles:
            if b.id == bubble_id and b.status == "alive":
                b.phi = max(0.0, min(1.0, b.phi + delta))
                return

    def tick(self, *, now_ms: float) -> WorkingMemoryStats:
        """Advance one cycle: pop → merge → promote → compact.
        Returns stats + adaptive thresholds used this cycle.

        Promotion callbacks: this module is pure — the TS / FastAPI
        adapter calls promote hooks AFTER reading the returned list of
        promoted bubble ids.
        """
        th = self._adaptive_thresholds()
        popped = merged = promoted = 0

        # 1. Pop expired / weak
        for b in self.bubbles:
            if b.status != "alive":
                continue
            if now_ms - b.created_at_ms > b.lifetime_ms or b.phi < th["pop"]:
                b.status = "popped"
                popped += 1

        # 2. Merge similar (greedy pairwise)
        alive = [b for b in self.bubbles if b.status == "alive"]
        merged_indices: set[int] = set()
        new_merges: list[Bubble] = []
        for i in range(len(alive)):
            if i in merged_indices:
                continue
            group: list[Bubble] = [alive[i]]
            for j in range(i + 1, len(alive)):
                if j in merged_indices:
                    continue
                d = fisher_rao_distance(alive[i].center, alive[j].center)
                if d <= th["merge"]:
                    group.append(alive[j])
                    merged_indices.add(j)
            if len(group) >= 2:
                # Fréchet mean as new center (Karcher on Δ⁶³ — NOT Euclidean)
                new_center = frechet_mean([g.center for g in group])
                new_phi = max(g.phi for g in group)
                oldest = min(g.created_at_ms for g in group)
                for g in group:
                    g.status = "merged"
                merged += len(group) - 1
                new_merges.append(
                    Bubble(
                        id=f"b-{int(now_ms)}-{uuid.uuid4().hex[:6]}",
                        center=new_center,
                        phi=new_phi,
                        created_at_ms=oldest,
                        lifetime_ms=self.default_lifetime_ms,
                        status="alive",
                        metadata={"merged_from": [g.id for g in group]},
                    )
                )
        self.bubbles.extend(new_merges)

        # 3. Promote strong
        for b in self.bubbles:
            if b.status != "alive":
                continue
            if b.phi >= th["promote"]:
                b.status = "promoted"
                promoted += 1

        # 4. Compact (FIFO-evict non-alive beyond max)
        if len(self.bubbles) > self.max_bubbles:
            kept_alive = [b for b in self.bubbles if b.status == "alive"]
            kept_dead = [b for b in self.bubbles if b.status != "alive"]
            self.bubbles = kept_alive + kept_dead[-max(1, self.max_bubbles // 4):]

        return self._stats_with_counts(
            popped=popped, merged=merged, promoted=promoted, thresholds=th,
            now_ms=now_ms,
        )

    def _stats_with_counts(
        self,
        *,
        popped: int, merged: int, promoted: int,
        thresholds: dict[str, float], now_ms: float,
    ) -> WorkingMemoryStats:
        alive = [b for b in self.bubbles if b.status == "alive"]
        phis = [b.phi for b in alive]
        ages = [now_ms - b.created_at_ms for b in alive]
        return WorkingMemoryStats(
            alive=len(alive),
            popped=popped,
            merged=merged,
            promoted=promoted,
            phi_mean=(sum(phis) / len(phis)) if phis else 0.0,
            phi_max=max(phis) if phis else 0.0,
            age_mean_ms=(sum(ages) / len(ages)) if ages else 0.0,
            pop_threshold=thresholds["pop"],
            promote_threshold=thresholds["promote"],
            merge_threshold=thresholds["merge"],
        )

    def alive_bubbles(self) -> list[Bubble]:
        return [b for b in self.bubbles if b.status == "alive"]

    def promoted_bubbles(self) -> list[Bubble]:
        return [b for b in self.bubbles if b.status == "promoted"]
