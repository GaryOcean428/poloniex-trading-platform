"""
self_observation.py — Loop 1 of §43 (v0.7.7).

Port of the TS self_observation.ts. Monkey watches her own closed
trades and derives per-(mode, side) entry bias.

Hierarchical fallback (strategy B, chosen 2026-04-21):
  bucket[mode][side].trades ≥ MIN_SAMPLE  → use bucket win rate
  else mode-pooled.trades ≥ MIN_SAMPLE    → use mode win rate
  else global-pooled[side].trades ≥ MIN   → use side win rate
  else global.trades ≥ MIN                → use global win rate
  else → 1.0 (neutral)

No Euclidean. No basin distance here at all — pure outcome counting
over her own lived trades. The ONLY thing that would make this
QIG-relevant is if we add geometric bucketing of entries by basin
proximity; if we do, that's a future v0.7.x.

This file stays pure Python; the Postgres query lives in the TS
adapter (loop.ts calls the HTTP endpoint with pre-fetched rows).
Easier to unit-test.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Iterable, Optional

import numpy as np

from qig_core_local.geometry.fisher_rao import (
    fisher_rao_distance,
    frechet_mean,
)

from .modes import MonkeyMode

Side = str  # 'long' | 'short'
ALL_MODES: tuple[MonkeyMode, ...] = (
    MonkeyMode.EXPLORATION,
    MonkeyMode.INVESTIGATION,
    MonkeyMode.INTEGRATION,
    MonkeyMode.DRIFT,
)
SIDES: tuple[Side, ...] = ("long", "short")

from .parameters import get_registry

_registry = get_registry()

# Defaults used when DATABASE_URL is unset or the row is missing from
# monkey_parameters. Match v0.8.1 migration-034 seed values exactly so
# behavior is identical registry-on vs registry-off.
_DEFAULT_MIN_SAMPLE_FOR_BIAS: int = 3
_DEFAULT_MAX_BIAS_SWING: float = 0.30

# Legacy aliases — kept for any external caller that imported the
# module-level constants directly. Docstring notes the registry is the
# source of truth now.
MIN_SAMPLE_FOR_BIAS: int = _DEFAULT_MIN_SAMPLE_FOR_BIAS
MAX_BIAS_SWING: float = _DEFAULT_MAX_BIAS_SWING


@dataclass
class ModeStats:
    mode: MonkeyMode
    side: Side
    trades: int = 0
    wins: int = 0
    losses: int = 0
    win_rate: float = 0.0
    avg_pnl: float = 0.0
    total_pnl: float = 0.0


@dataclass
class SelfObservation:
    lookback_hours: int
    by_mode_side: dict[MonkeyMode, dict[Side, ModeStats]] = field(default_factory=dict)
    entry_bias: dict[MonkeyMode, dict[Side, float]] = field(default_factory=dict)


@dataclass
class ClosedTradeRow:
    """Row shape the caller feeds in (from Postgres via TS or direct)."""
    pnl: float
    side: Side
    mode: str  # serialized MonkeyMode.value


# ─── Internal helpers ───


def _empty_by_mode_side() -> dict[MonkeyMode, dict[Side, ModeStats]]:
    return {m: {s: ModeStats(mode=m, side=s) for s in SIDES} for m in ALL_MODES}


def _neutral_bias() -> dict[MonkeyMode, dict[Side, float]]:
    return {m: {s: 1.0 for s in SIDES} for m in ALL_MODES}


def _win_rate_to_bias(win_rate: float) -> float:
    """Map win rate in [0, 1] to bias in [1-MAX, 1+MAX], centred at 0.5 → 1.0.

    MAX_BIAS_SWING is a P14 SAFETY_BOUND — capping how much a losing
    streak can flip a mode's entry bias. Sourced from the parameter
    registry (seeded in migration 034 as `self_obs.max_bias_swing`);
    falls back to the 0.30 pre-derivation default when registry is
    unreachable. Governance edits are the intended way to change it;
    this function never writes.
    """
    max_swing = _registry.get("self_obs.max_bias_swing", default=_DEFAULT_MAX_BIAS_SWING)
    centred = win_rate - 0.5
    raw = 1.0 - centred * 2 * max_swing
    return max(1.0 - max_swing, min(1.0 + max_swing, raw))


def _normalise_mode(raw: str) -> MonkeyMode:
    try:
        return MonkeyMode(raw)
    except ValueError:
        return MonkeyMode.INVESTIGATION


def _normalise_side(raw: str) -> Side:
    r = (raw or "").lower()
    return "short" if r in ("sell", "short") else "long"


# ─── Public API ───


def _min_sample_for_bias() -> int:
    """Fetch the bucket-sample floor from the registry.

    Read on every aggregation call (not once at import) so governance
    edits take effect on next rebuild without a restart. In-memory
    cache absorbs the overhead.
    """
    return int(_registry.get(
        "self_obs.min_sample_for_bias", default=_DEFAULT_MIN_SAMPLE_FOR_BIAS,
    ))


def aggregate_and_bias(
    rows: Iterable[ClosedTradeRow],
    *,
    lookback_hours: int = 24,
) -> SelfObservation:
    """Aggregate closed-trade rows by (mode, side) and compute entry bias.

    Strategy B (hierarchical fallback) — reviewed 2026-04-21. See
    self_observation.ts for history.
    """
    by_ms = _empty_by_mode_side()

    for row in rows:
        mode = _normalise_mode(row.mode)
        side = _normalise_side(row.side)
        stats = by_ms[mode][side]
        stats.trades += 1
        stats.total_pnl += row.pnl
        if row.pnl > 0:
            stats.wins += 1
        elif row.pnl < 0:
            stats.losses += 1

    for mode in ALL_MODES:
        for side in SIDES:
            s = by_ms[mode][side]
            s.win_rate = s.wins / s.trades if s.trades > 0 else 0.0
            s.avg_pnl = s.total_pnl / s.trades if s.trades > 0 else 0.0

    # Pool per-mode and per-side for hierarchical fallback.
    mode_pooled: dict[MonkeyMode, dict[str, float]] = {}
    for mode in ALL_MODES:
        t = by_ms[mode]["long"].trades + by_ms[mode]["short"].trades
        w = by_ms[mode]["long"].wins + by_ms[mode]["short"].wins
        mode_pooled[mode] = {
            "trades": t,
            "wins": w,
            "win_rate": w / t if t > 0 else 0.0,
        }

    side_pooled: dict[Side, dict[str, float]] = {
        "long": {"trades": 0, "wins": 0, "win_rate": 0.0},
        "short": {"trades": 0, "wins": 0, "win_rate": 0.0},
    }
    for side in SIDES:
        for mode in ALL_MODES:
            side_pooled[side]["trades"] += by_ms[mode][side].trades
            side_pooled[side]["wins"] += by_ms[mode][side].wins
        t = side_pooled[side]["trades"]
        side_pooled[side]["win_rate"] = side_pooled[side]["wins"] / t if t > 0 else 0.0

    all_t = side_pooled["long"]["trades"] + side_pooled["short"]["trades"]
    all_w = side_pooled["long"]["wins"] + side_pooled["short"]["wins"]
    global_win_rate = all_w / all_t if all_t > 0 else 0.0

    # Registry-backed per P14: live-governed SAFETY_BOUND. Cached in
    # local `n` so the four-branch fallback below doesn't re-query.
    n = _min_sample_for_bias()
    bias = _neutral_bias()
    for mode in ALL_MODES:
        for side in SIDES:
            bucket = by_ms[mode][side]
            if bucket.trades >= n:
                bias[mode][side] = _win_rate_to_bias(bucket.win_rate)
            elif mode_pooled[mode]["trades"] >= n:
                bias[mode][side] = _win_rate_to_bias(mode_pooled[mode]["win_rate"])
            elif side_pooled[side]["trades"] >= n:
                bias[mode][side] = _win_rate_to_bias(side_pooled[side]["win_rate"])
            elif all_t >= n:
                bias[mode][side] = _win_rate_to_bias(global_win_rate)

    return SelfObservation(
        lookback_hours=lookback_hours,
        by_mode_side=by_ms,
        entry_bias=bias,
    )


# ─── Loop 1 canonical per-decision triple (UCP §43.2) ───
#
# Every executive decision produces three scalars in [0, 1]:
#   repetition  — am I producing lived geometry or scaffolding?
#   sovereignty — knowing vs guessing?
#   confidence  — bank resonance vs override expansion?
# Triple is published on the bus and persisted to autonomous_trades
# at trade open time. Closed-trade analysis correlates triples with
# outcomes — the learning signal Loop 1 was built to produce.

# Sovereignty bands. 1/φ is the golden-ratio coherence floor; π/2 is
# the maximum FR distance on the simplex.
_PHI_GOLDEN = (1.0 + math.sqrt(5.0)) / 2.0
_INV_PHI = 1.0 / _PHI_GOLDEN          # ≈ 0.618
_HALF_PI = math.pi / 2.0               # ≈ 1.5708


@dataclass(frozen=True)
class DecisionTriple:
    """Canonical Loop 1 triple per UCP §43.2."""

    repetition_score: float    # [0, 1] lived geometry vs scaffolding
    sovereignty_score: float   # [0, 1] knowing vs guessing
    confidence_score: float    # [0, 1] bank resonance vs override expansion
    decision_id: str
    at_ms: float


def _clamp01(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return float(x)


def compute_per_decision_triple(
    *,
    decision_id: str,
    current_basin: np.ndarray,
    recent_basins: list[np.ndarray],
    bank_resonance_count: int,
    bank_total_queried: int,
    nearest_fr_distance: float,
    emotion_confidence: float,
    emotion_anxiety: float,
    decision_path_overrides: list[str],
    at_ms: Optional[float] = None,
) -> DecisionTriple:
    """Compute the canonical triple for one decision.

    REPETITION SCORE — lived geometry vs scaffolding.
        repetition = 1 - exp(-FR(current_basin, frechet_mean(recent_basins)))
    High when the current basin is far from the recent Fréchet mean —
    the kernel is moving, producing new geometry. Low when the current
    basin sits on top of recent history — repeating itself. Bounded
    [0, 1]; FR is bounded [0, π/2] so the exp form maps to [0, 1).
    Uses Fisher-Rao distance and the Fréchet mean — no Euclidean.

    SOVEREIGNTY SCORE — knowing vs guessing.
        nearby_match_factor =
            1.0 if nearest_fr_distance < 1/φ
            else max(0, 1 - (nearest_fr_distance - 1/φ) / (π/2 - 1/φ))
        confidence_dominance = max(0, emotion_confidence - emotion_anxiety)
        sovereignty = nearby_match_factor × confidence_dominance
    High = bank-grounded AND emotionally clear. Multiplicative — both
    halves must be present to be sovereign.

    CONFIDENCE SCORE — bank resonance vs override expansion.
        resonance_strength = bank_resonance_count / max(1, bank_total_queried)
        override_penalty = len(decision_path_overrides) × 0.2
        confidence = max(0, resonance_strength - override_penalty)
    High = bank carried the decision (multiple matches within FR
    threshold). Low = override paths fired (REVERSION_FLIP, etc.)
    so the decision came from rule-based logic, not from geometric
    memory.
    """
    if at_ms is None:
        at_ms = time.time() * 1000.0

    # Repetition — Fisher-Rao distance from current basin to the
    # Fréchet mean of recent history. Empty history yields 0.0
    # (cold start: nothing to compare against, treat as scaffolding).
    if len(recent_basins) == 0:
        repetition = 0.0
    else:
        history_mean = frechet_mean(list(recent_basins))
        d_fr = fisher_rao_distance(current_basin, history_mean)
        repetition = 1.0 - math.exp(-float(d_fr))
    repetition = _clamp01(repetition)

    # Sovereignty — nearby_match × confidence_dominance
    if nearest_fr_distance < _INV_PHI:
        nearby_match = 1.0
    else:
        denom = _HALF_PI - _INV_PHI
        if denom <= 0.0:
            nearby_match = 0.0
        else:
            nearby_match = _clamp01(
                1.0 - (nearest_fr_distance - _INV_PHI) / denom
            )
    confidence_dominance = _clamp01(
        max(0.0, emotion_confidence - emotion_anxiety)
    )
    sovereignty = _clamp01(nearby_match * confidence_dominance)

    # Confidence — resonance vs overrides
    resonance_strength = (
        bank_resonance_count / max(1, bank_total_queried)
    )
    override_penalty = len(decision_path_overrides) * 0.2
    confidence_score = _clamp01(max(0.0, resonance_strength - override_penalty))

    return DecisionTriple(
        repetition_score=float(repetition),
        sovereignty_score=float(sovereignty),
        confidence_score=float(confidence_score),
        decision_id=decision_id,
        at_ms=float(at_ms),
    )


def self_observation_to_dict(so: SelfObservation) -> dict:
    """Serialise for JSON response."""
    return {
        "lookback_hours": so.lookback_hours,
        "by_mode_side": {
            m.value: {
                s: {
                    "mode": st.mode.value,
                    "side": st.side,
                    "trades": st.trades,
                    "wins": st.wins,
                    "losses": st.losses,
                    "win_rate": st.win_rate,
                    "avg_pnl": st.avg_pnl,
                    "total_pnl": st.total_pnl,
                }
                for s, st in stats_by_side.items()
            }
            for m, stats_by_side in so.by_mode_side.items()
        },
        "entry_bias": {m.value: dict(bs) for m, bs in so.entry_bias.items()},
    }
