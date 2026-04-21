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

from dataclasses import dataclass, field
from typing import Iterable

from .modes import MonkeyMode

Side = str  # 'long' | 'short'
ALL_MODES: tuple[MonkeyMode, ...] = (
    MonkeyMode.EXPLORATION,
    MonkeyMode.INVESTIGATION,
    MonkeyMode.INTEGRATION,
    MonkeyMode.DRIFT,
)
SIDES: tuple[Side, ...] = ("long", "short")

MIN_SAMPLE_FOR_BIAS: int = 3
MAX_BIAS_SWING: float = 0.30  # ±30% from neutral 1.0


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
    """Map win rate in [0, 1] to bias in [1-MAX, 1+MAX], centred at 0.5 → 1.0."""
    centred = win_rate - 0.5
    raw = 1.0 - centred * 2 * MAX_BIAS_SWING
    return max(1.0 - MAX_BIAS_SWING, min(1.0 + MAX_BIAS_SWING, raw))


def _normalise_mode(raw: str) -> MonkeyMode:
    try:
        return MonkeyMode(raw)
    except ValueError:
        return MonkeyMode.INVESTIGATION


def _normalise_side(raw: str) -> Side:
    r = (raw or "").lower()
    return "short" if r in ("sell", "short") else "long"


# ─── Public API ───


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

    bias = _neutral_bias()
    for mode in ALL_MODES:
        for side in SIDES:
            bucket = by_ms[mode][side]
            if bucket.trades >= MIN_SAMPLE_FOR_BIAS:
                bias[mode][side] = _win_rate_to_bias(bucket.win_rate)
            elif mode_pooled[mode]["trades"] >= MIN_SAMPLE_FOR_BIAS:
                bias[mode][side] = _win_rate_to_bias(mode_pooled[mode]["win_rate"])
            elif side_pooled[side]["trades"] >= MIN_SAMPLE_FOR_BIAS:
                bias[mode][side] = _win_rate_to_bias(side_pooled[side]["win_rate"])
            elif all_t >= MIN_SAMPLE_FOR_BIAS:
                bias[mode][side] = _win_rate_to_bias(global_win_rate)

    return SelfObservation(
        lookback_hours=lookback_hours,
        by_mode_side=by_ms,
        entry_bias=bias,
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
