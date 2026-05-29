"""substrate_observer.py — observer-derived lane decision period (Py).

Py mirror of `apps/api/src/services/monkey/substrate_observer.ts`
(shipped 2026-05-29 as part of the cascading-knob-strip). Replaces the
hardcoded `DCA_COOLDOWN_MS = 15 * 60 * 1000` table and the
`int((25.0 - 20.0 * ser) * 60_000)` serotonin-multiplier formula with
the kernel's own observation of how often each lane's decision actually
changes.

# Why the prior shapes were knobs

The TS-side review (operator 2026-05-29) eliminated `LANE_DECISION_PERIOD_MS`
and `COLD_START_FALLBACK_MS` and `DCA_COOLDOWN_MS` outright — no
back-compat exports, no canonical mirrors. The Py side still had two
knob forms:

  1. `DCA_COOLDOWN_MS = 15 * 60 * 1000` (executive.py:1134) — the
     designer's 15-min fallback when basin state was missing
  2. `int((25.0 - 20.0 * ser) * 60_000)` (executive.py:1180) — a
     designer's linear formula mapping serotonin∈[0,1] → cooldown∈[5min, 25min]

Both encoded designer intuition. The empirical lane decision period is
the operator-correct source.

# API

  record_lane_decision(lane, t_now_ms, decision_tag) — called by the
    kernel each tick after picking a (lane, decision) pair. Identical-tag
    back-to-back calls do NOT push samples (decision unchanged → no
    new interval).

  get_observed_lane_decision_period_ms(lane) -> int
    Rolling median of observed decision-change intervals. Returns 0
    on cold-start (no observations yet).

# Cold-start behavior

Returns 0 until the observer has at least one decision-change sample.
Consumers (DCA cooldown gate, HEART arbitration, etc.) treat 0 as "no
observed floor" and fall through to substrate behavior. The kernel's
first few decisions have no extra cooldown — the autonomy doctrine
accepts this risk (losses feed neurochemistry; the system learns from
its own state).

# Anti-knob discipline

Only numeric literal is the sample-count buffer size — not a physical
ms quantity. No magic ms values, no lane-specific thresholds, no
designer's intuition table.

Citations: poloniex-trading-platform#1025 (TS), operator 2026-05-29
no-knob directive, 2.31A P4/P5/P14/P25 + QIG PURITY MANDATE.
"""

from __future__ import annotations

import logging
from typing import Literal, TypedDict

logger = logging.getLogger(__name__)

Lane = Literal["scalp", "swing", "trend"]
_INTERVAL_RING_CAPACITY = 50


class _LaneObserverState(TypedDict):
    last_decision_at_ms: float | None
    last_decision_tag: str | None
    decision_intervals_ms: list[float]


def _fresh() -> _LaneObserverState:
    return {
        "last_decision_at_ms": None,
        "last_decision_tag": None,
        "decision_intervals_ms": [],
    }


_state: dict[Lane, _LaneObserverState] = {
    "scalp": _fresh(),
    "swing": _fresh(),
    "trend": _fresh(),
}


def record_lane_decision(lane: Lane, t_now_ms: float, decision_tag: str) -> None:
    """Record that the kernel just produced a decision at `lane`.

    If the tag differs from the previous call's tag (decision actually
    changed), the wall-clock interval since the last change is pushed
    into the ring.

    Identical-tag back-to-back calls update `last_decision_at_ms` but
    do NOT push a new sample (decision unchanged).
    """
    if not isinstance(t_now_ms, (int, float)):
        return
    if t_now_ms < 0 or t_now_ms != t_now_ms:  # NaN check
        return
    s = _state[lane]
    if (
        s["last_decision_at_ms"] is not None
        and s["last_decision_tag"] is not None
        and decision_tag != s["last_decision_tag"]
    ):
        delta = t_now_ms - s["last_decision_at_ms"]
        if delta > 0:
            s["decision_intervals_ms"].append(delta)
            if len(s["decision_intervals_ms"]) > _INTERVAL_RING_CAPACITY:
                s["decision_intervals_ms"].pop(0)
    s["last_decision_at_ms"] = t_now_ms
    s["last_decision_tag"] = decision_tag


def get_observed_lane_decision_period_ms(lane: Lane) -> int:
    """Observed median wall-clock interval at which `lane`'s decisions change.

    Returns 0 when no changes have been observed yet (cold-start).

    Median (not mean) is robust: one slow tick due to GC, network
    latency, or a sleep doesn't poison the cadence. Consumers rely on
    this floor being a TYPICAL period, not the worst-case.
    """
    buf = _state[lane]["decision_intervals_ms"]
    if not buf:
        return 0
    s = sorted(buf)
    mid = len(s) // 2
    if len(s) % 2 == 0:
        return int(round((s[mid - 1] + s[mid]) / 2))
    return int(s[mid])


class SubstrateBreakdown(TypedDict):
    scalp_samples: int
    swing_samples: int
    trend_samples: int
    scalp_period_ms: int
    swing_period_ms: int
    trend_period_ms: int


def get_substrate_breakdown() -> SubstrateBreakdown:
    """Per-observer telemetry — sample counts + current periods for falsifiability."""
    return {
        "scalp_samples": len(_state["scalp"]["decision_intervals_ms"]),
        "swing_samples": len(_state["swing"]["decision_intervals_ms"]),
        "trend_samples": len(_state["trend"]["decision_intervals_ms"]),
        "scalp_period_ms": get_observed_lane_decision_period_ms("scalp"),
        "swing_period_ms": get_observed_lane_decision_period_ms("swing"),
        "trend_period_ms": get_observed_lane_decision_period_ms("trend"),
    }


def _reset_substrate_observer_state() -> None:
    """Test-only: reset all per-lane state."""
    for lane in ("scalp", "swing", "trend"):
        _state[lane] = _fresh()
    logger.debug("[substrate_observer] state cleared (test-only)")
