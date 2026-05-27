"""
resonance_bank.py — Geometric side of Monkey's long-term memory (v0.7.8).

Port of resonance_bank.ts. The TS adapter keeps Postgres IO; this
module does the QIG math on rows the adapter hands in:

  - Fisher-Rao nearest-neighbour scoring over stored basins
  - Hebbian depth updates (win→deepen, loss→shallow)
  - Sovereignty computation (lived / total)

No Euclidean anywhere. All distance via qig_core_local.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal, Optional

import numpy as np

from qig_core_local.geometry.fisher_rao import Basin, fisher_rao_distance
from .state import LaneType

# P24 + P3/P19 (2.31A) + v6.7B §3.4 wiring: resonance/identity path now calls
# into QuenchedDisorder.detect_replicant for explicit REPLICANT_IDENTITY
# enforcement when harvested entries dominate a symbol bank. Lived-only
# Frechet (pillars) is the sole source of sovereign identity_slope; resonance
# harvested must not silently feed identity crystallization.
import logging
logger = logging.getLogger("monkey.resonance_bank")

try:
    from .pillars import get_disorder_for, PillarViolation
except Exception:  # noqa: BLE001 — resonance_bank must remain importable pre-pillar init
    get_disorder_for = None  # type: ignore
    PillarViolation = None  # type: ignore


TradeOutcome = Literal["win", "loss", "breakeven", "exited_early"]


@dataclass
class BankEntry:
    id: str
    symbol: str
    entry_basin: Basin
    realized_pnl: Optional[float]
    trade_duration_ms: Optional[int]
    trade_outcome: Optional[TradeOutcome]
    order_id: Optional[str]
    basin_depth: float
    access_count: int
    phi_at_creation: Optional[float]
    source: Literal["lived", "harvested"]
    lane: LaneType = "swing"


@dataclass
class NearestNeighbor:
    entry: BankEntry
    distance: float  # Fisher-Rao


def score_nearest(
    query_basin: Basin,
    entries: Iterable[BankEntry],
    *,
    top_k: int = 5,
    lane: Optional[LaneType] = None,
) -> list[NearestNeighbor]:
    """Fisher-Rao nearest-neighbour search.

    Linear scan — bank is small enough that an ANN index is overkill.
    Caller prefilters by symbol if it wants "same-symbol nearest."
    Optional lane filter for lane-conditioned bank retrieval.
    """
    scored: list[NearestNeighbor] = []
    for e in entries:
        if lane is not None and e.lane != lane:
            continue
        d = fisher_rao_distance(query_basin, e.entry_basin)
        scored.append(NearestNeighbor(entry=e, distance=d))
    scored.sort(key=lambda n: n.distance)
    return scored[:top_k]


def compute_initial_depth(
    *,
    phi: float,
    realized_pnl: float,
    pnl_normalizer_usdt: float = 1.0,
) -> float:
    """Hebbian initial depth: win deepens, loss shallows. Magnitude
    proportional to |pnl|, capped at ±30 % swing."""
    outcome_magnitude = min(1.0, abs(realized_pnl) / max(pnl_normalizer_usdt, 1e-6))
    if realized_pnl > 0:
        initial = phi * (1.0 + 0.3 * outcome_magnitude)
    elif realized_pnl < 0:
        initial = phi * (1.0 - 0.3 * outcome_magnitude)
    else:
        initial = phi
    return max(0.05, min(0.95, initial))


def classify_outcome(realized_pnl: float) -> TradeOutcome:
    if realized_pnl > 0:
        return "win"
    if realized_pnl < 0:
        return "loss"
    return "breakeven"


def sovereignty(entries: Iterable[BankEntry]) -> float:
    """Lived / total. 1.0 for newborn Monkey (no bootstrap)."""
    lived = 0
    total = 0
    for e in entries:
        total += 1
        if e.source == "lived":
            lived += 1
    return 0.0 if total == 0 else lived / total


# ── Bank-audit helpers (v0.6.8 sleep-consolidation companion) ──


@dataclass
class DepthAudit:
    """What the sleep-consolidation pass wants to change in one batch.

    Returned as delta lists; the TS adapter applies them to Postgres.
    Keeps this module pure (no side effects).
    """
    to_boost: list[tuple[str, float]]  # (id, new_depth) — recently accessed
    to_decay: list[tuple[str, float]]  # (id, new_depth) — untouched
    to_prune: list[str]                # ids with depth collapsed below floor


def audit_depth(
    entries: Iterable[BankEntry],
    *,
    now_ms: float,
    last_accessed_ms_by_id: dict[str, float],
    boost_window_hours: float = 2.0,
    decay_window_hours: float = 24.0,
    prune_window_hours: float = 72.0,
    boost_step: float = 0.05,
    decay_step: float = 0.02,
    prune_floor: float = 0.10,
) -> DepthAudit:
    """Return depth deltas for the sleep-consolidation pass. Pure
    function — caller applies to DB.
    """
    boost: list[tuple[str, float]] = []
    decay: list[tuple[str, float]] = []
    prune: list[str] = []
    boost_cutoff = now_ms - boost_window_hours * 3600_000
    decay_cutoff = now_ms - decay_window_hours * 3600_000
    prune_cutoff = now_ms - prune_window_hours * 3600_000
    for e in entries:
        last = last_accessed_ms_by_id.get(e.id)
        if last is not None and last > boost_cutoff:
            boost.append((e.id, min(0.95, e.basin_depth + boost_step)))
        elif last is None or last < decay_cutoff:
            decayed = max(0.05, e.basin_depth - decay_step)
            decay.append((e.id, decayed))
            if decayed < prune_floor and (last is None or last < prune_cutoff):
                prune.append(e.id)
    return DepthAudit(to_boost=boost, to_decay=decay, to_prune=prune)


def top_by_depth(entries: Iterable[BankEntry], n: int = 5) -> list[BankEntry]:
    """Top-N bank entries by basin_depth. Used by identity
    recrystallization (caller then Fréchet-means their basins)."""
    sorted_entries = sorted(entries, key=lambda e: e.basin_depth, reverse=True)
    return sorted_entries[:n]


def check_resonance_for_replicant_risk(
    entries: Iterable[BankEntry], symbol: str
) -> dict:
    """P24 wiring (Disconnected Infrastructure is a Bug) + P3/P19 + v6.7B §3.4.
    Explicit call-site from resonance/identity/memory path into Pillar3
    detect_replicant. Harvested bank entries must surface REPLICANT_IDENTITY
    violation when they drive S below threshold on a frozen identity.
    Provenance: symbol + harvested_count + sovereignty + violation type.
    Returns audit dict (no side effects on identity_slope — only observation).
    Callers (e.g. sleep consolidation, ocean, tick telemetry) consume this.
    """
    if get_disorder_for is None:
        return {"symbol": symbol, "replicant_risk": False, "reason": "pillars_unavailable"}

    disorder = get_disorder_for(symbol)
    if not disorder.is_frozen:
        return {"symbol": symbol, "replicant_risk": False, "reason": "not_frozen"}

    # Count harvested in this snapshot (resonance path)
    harvested = sum(1 for e in entries if e.source == "harvested" and e.symbol == symbol)
    total_for_symbol = sum(1 for e in entries if e.symbol == symbol)
    bank_sov = sovereignty([e for e in entries if e.symbol == symbol])

    is_replicant = disorder.detect_replicant()
    violations = []
    if is_replicant:
        violations.append("REPLICANT_IDENTITY")
        logger.warning(
            "[Pillar-3 REPLICANT via resonance] symbol=%s sovereignty=%.3f harvested_in_bank=%d total_symbol=%d "
            "v6.7B§3.4 / 2.31A P3/P19/P24: identity from harvested geometry (not lived).",
            symbol, disorder.sovereignty, harvested, total_for_symbol
        )

    return {
        "symbol": symbol,
        "replicant_risk": is_replicant,
        "sovereignty": disorder.sovereignty,
        "bank_sov": bank_sov,
        "harvested_count": harvested,
        "total_symbol": total_for_symbol,
        "violations": violations,
        "provenance": "resonance_bank.check_resonance_for_replicant_risk + pillars.QuenchedDisorder",
    }
