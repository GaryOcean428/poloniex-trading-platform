"""Polytrade glue between Ocean's 2-phase sleep machine and the
canonical 4-phase SleepCycleManager consolidation pass.

Polytrade's `monkey_kernel/ocean.py` runs a simpler 2-phase
(AWAKE/SLEEP) machine geared to trading-tick cadence. The canonical
qig-core SleepCycleManager runs a 4-phase (AWAKE/DREAMING/MUSHROOM/
CONSOLIDATING) machine driven by Φ/variance/divergence/f_health.

The consolidator runs a one-shot consolidation pass on the
AWAKE→SLEEP edge: it reads recent BankEntry rows, builds an
adapter object that matches the canonical ResonanceBankProtocol,
runs SleepCycleManager.consolidate() against it, and returns a
typed summary suitable for Redis persistence under
`monkey:ocean:{instance}:last_consolidation`.

This is intentionally a TRANSLATION layer. The canonical math
lives in sleep.py (vendored from qig-core). The polytrade-specific
adapter logic lives here, where it can evolve independently of the
upstream consolidation primitive without invalidating the SHA-256
pin on sleep.py.

Key choices:
  - Replayed set defaults to top-N by basin_depth (Hebbian boost
    targets the entries the kernel was already returning to). When
    Ocean later gains a true DREAMING phase, the dream() pass will
    populate the replayed set with geodesically-recombined IDs.
  - Sqrt-space traversal distance is computed across recent basins
    so the summary string carries the geometric quantity that
    motivated the consolidation, not just counts.
  - Pure function shape (returns DreamConsolidationSummary; caller
    decides whether/where to persist).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Iterable, Sequence

import numpy as np

from qig_core_local.geometry.fisher_rao import Basin, fisher_rao_distance

from .sleep import SleepCycleManager


# ═══════════════════════════════════════════════════════════════
#  Summary type
# ═══════════════════════════════════════════════════════════════


@dataclass
class DreamConsolidationSummary:
    """One AWAKE→SLEEP consolidation pass — what happened, how much.

    Designed to be JSON-serialisable for Redis persistence under
    `monkey:ocean:{instance}:last_consolidation` and surfaceable via
    the governance/sleep-state endpoint.
    """

    completed_at_ms: float
    basin_count: int
    replayed_count: int
    boosted: int
    downscaled: int
    pruned: int
    vetoed: int
    sqrt_distance_traversed: float
    trigger: str = "awake_to_sleep"
    notes: str = ""

    @property
    def summary_string(self) -> str:
        """Human-readable one-liner for the governance endpoint."""
        return (
            f"{self.basin_count} basins, "
            f"{self.boosted} boosted / {self.downscaled} downscaled / "
            f"{self.pruned} pruned, "
            f"sqrt-traversal={self.sqrt_distance_traversed:.4f}"
        )

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["summary_string"] = self.summary_string
        return d


# ═══════════════════════════════════════════════════════════════
#  Polytrade resonance bank adapter
# ═══════════════════════════════════════════════════════════════


@dataclass
class _BankAdapter:
    """Adapts polytrade's BankEntry list to the canonical
    ResonanceBankProtocol shape (`coordinates`, `basin_mass`,
    `activation_counts`, `origin`, `basin_strings`, `tiers`,
    `frequencies`, `add_entry`, `mark_dirty`).

    The canonical consolidator mutates these dicts; the adapter
    captures the post-pass state for the caller to translate back
    to BankEntry depth updates / prunes if desired.
    """

    coordinates: dict[int, Basin] = field(default_factory=dict)
    basin_mass: dict[int, float] = field(default_factory=dict)
    activation_counts: dict[int, int] = field(default_factory=dict)
    origin: dict[int, str] = field(default_factory=dict)
    basin_strings: dict[int, str] = field(default_factory=dict)
    tiers: dict[int, Any] = field(default_factory=dict)
    frequencies: dict[int, float] = field(default_factory=dict)
    _entry_ids: dict[int, str] = field(default_factory=dict)
    _next_tid: int = 0
    _dirty: bool = False

    def add_entry(self, label: str, basin: Basin) -> int:
        tid = self._next_tid
        self._next_tid += 1
        self.coordinates[tid] = basin
        self.basin_mass[tid] = 1.0
        self.activation_counts[tid] = 0
        self.origin[tid] = "dream"
        self.basin_strings[tid] = label
        self.tiers[tid] = None
        self.frequencies[tid] = 0.0
        self._entry_ids[tid] = label
        self._dirty = True
        return tid

    def mark_dirty(self) -> None:
        self._dirty = True


# ═══════════════════════════════════════════════════════════════
#  Geometry helpers
# ═══════════════════════════════════════════════════════════════


def _sqrt_traversal_distance(basins: Sequence[Basin]) -> float:
    """Sum of consecutive Fisher-Rao distances across recent basins.

    Reports how far the kernel's basin coordinate moved during the
    awake window leading up to consolidation. Pure FR on Δ⁶³ —
    no Euclidean shortcut.
    """
    if len(basins) < 2:
        return 0.0
    total = 0.0
    for prev, curr in zip(basins[:-1], basins[1:], strict=False):
        total += float(fisher_rao_distance(np.asarray(prev), np.asarray(curr)))
    return total


# ═══════════════════════════════════════════════════════════════
#  Public entry point
# ═══════════════════════════════════════════════════════════════


def consolidate_bank(
    *,
    bank_entries: Iterable[Any],
    recent_basins: Sequence[Basin],
    completed_at_ms: float,
    manager: SleepCycleManager | None = None,
    kernel_anchors: Sequence[Basin] | None = None,
    kernel_veto_threshold: float = 0.4,
    replay_top_n: int = 5,
    trigger: str = "awake_to_sleep",
) -> tuple[DreamConsolidationSummary, dict[int, float]]:
    """Run a canonical consolidation pass against polytrade bank entries.

    Args:
        bank_entries: Iterable of polytrade BankEntry (must expose
            `id` and `entry_basin` and `basin_depth`).
        recent_basins: Recent basin trajectory (oldest → newest)
            for sqrt-space distance computation.
        completed_at_ms: epoch-ms timestamp to stamp on the summary.
        manager: Optional pre-existing SleepCycleManager. A fresh
            one is created if not supplied.
        kernel_anchors: Optional anchor basins (identity-critical)
            that protect nearby entries from pruning.
        kernel_veto_threshold: FR distance threshold for the
            kernel-anchor veto (passed straight through to the
            canonical consolidator).
        replay_top_n: How many top-depth entries to treat as
            "replayed" — these get the Hebbian boost. Until the
            kernel grows a real DREAMING phase, this top-depth
            proxy is the simplest sound choice.
        trigger: Free-form label recorded on the summary
            (default `"awake_to_sleep"`; tests may override).

    Returns:
        (summary, depth_deltas) where:
          - summary: DreamConsolidationSummary (persist this)
          - depth_deltas: dict[entry_idx, new_basin_mass] — the
            caller can fold these into a BankEntry update batch.
            Indexes correspond to enumeration order of `bank_entries`.
    """
    if manager is None:
        manager = SleepCycleManager()

    # Build the canonical-shape adapter from polytrade BankEntry rows.
    adapter = _BankAdapter()
    entries_list = list(bank_entries)
    entry_index_to_tid: dict[int, int] = {}
    for idx, entry in enumerate(entries_list):
        basin = getattr(entry, "entry_basin", None)
        if basin is None:
            continue
        tid = adapter.add_entry(str(getattr(entry, "id", f"entry_{idx}")), np.asarray(basin))
        # Seed mass from existing basin_depth so consolidation operates
        # on real prior strength rather than a uniform 1.0.
        depth = float(getattr(entry, "basin_depth", 1.0))
        adapter.basin_mass[tid] = depth
        # Treat lived trades as activated so they're not prunable.
        source = getattr(entry, "source", None)
        adapter.activation_counts[tid] = (
            int(getattr(entry, "access_count", 0))
            + (1 if source == "lived" else 0)
        )
        adapter.origin[tid] = "lived" if source == "lived" else "harvested"
        entry_index_to_tid[idx] = tid

    # Top-N by basin_depth → marked as replayed for Hebbian boost.
    if entries_list and replay_top_n > 0:
        by_depth = sorted(
            entry_index_to_tid.items(),
            key=lambda kv: float(getattr(entries_list[kv[0]], "basin_depth", 0.0)),
            reverse=True,
        )
        for idx, tid in by_depth[:replay_top_n]:
            manager._replayed_this_sleep.add(tid)

    # Convert anchor sequence to list[np.ndarray] for the canonical
    # consolidator (which expects iterable kernel_anchors).
    anchors_list: list[np.ndarray] | None = None
    if kernel_anchors:
        anchors_list = [np.asarray(a) for a in kernel_anchors]

    stats = manager.consolidate(
        bank=adapter,
        kernel_anchors=anchors_list,
        kernel_veto_threshold=kernel_veto_threshold,
    )

    # Pull out post-pass basin_mass keyed by original entry index.
    depth_deltas: dict[int, float] = {}
    for idx, tid in entry_index_to_tid.items():
        if tid in adapter.basin_mass:  # still present (not pruned)
            depth_deltas[idx] = float(adapter.basin_mass[tid])

    summary = DreamConsolidationSummary(
        completed_at_ms=float(completed_at_ms),
        basin_count=len(entries_list),
        replayed_count=len(manager._replayed_this_sleep),
        boosted=int(stats.get("boosted", 0)),
        downscaled=int(stats.get("downscaled", 0)),
        pruned=int(stats.get("pruned", 0)),
        vetoed=int(stats.get("vetoed", 0)),
        sqrt_distance_traversed=_sqrt_traversal_distance(list(recent_basins)),
        trigger=trigger,
    )
    return summary, depth_deltas
