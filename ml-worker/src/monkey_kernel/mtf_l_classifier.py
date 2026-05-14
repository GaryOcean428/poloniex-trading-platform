"""mtf_l_classifier.py — multi-timeframe Agent L (Phase 1).

Python port of apps/api/src/services/monkey/mtfLClassifier.ts (PR #670).

Runs three FR-KNN classifier instances in parallel on independently
down-sampled basin streams:

    15m    sample every 30 ticks  (15 min on 30s kernel cadence)
    1h     sample every 120 ticks (matches canonical Lorentzian 60min)
    4h     sample every 480 ticks

Each timeframe keeps its own history store. On each kernel tick we
append the current basin to each down-sampled stream when that
timeframe's "next sample" boundary has been crossed.

The combiner (option c from the design conversation): AGREEMENT COUNT.
Each classifier votes long / short / hold. The MTF decision is:
  - 3 votes same direction → enter at full size
  - 2 votes same direction → enter at reduced size
  - else                   → hold

Exit policy (longest-agreeing horizon): per-timeframe horizon clocks
track the most recent re-confirmation on each side. Position exits
when the LONGEST timeframe that agreed at entry stops agreeing
(= its clock expires).

QIG purity: each instance is a pure agent_l_decide() over its
timeframe's basin history. No new banned operations.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional, Sequence

import numpy as np

from .agent_l_classifier import (
    DEFAULT_AGENT_L_CONFIG,
    AgentLConfig,
    AgentLDecision,
    agent_l_decide,
)

Basin = np.ndarray
TimeframeLabel = Literal["15m", "1h", "4h"]
MTFAction = Literal["enter_long", "enter_short", "hold"]


@dataclass(frozen=True)
class TimeframeConfig:
    """Per-timeframe configuration."""

    label: TimeframeLabel
    ticks_per_sample: int
    """Sample every N kernel ticks. On 30s ticks: 30→15m, 120→1h, 480→4h."""
    config: AgentLConfig = field(default_factory=lambda: DEFAULT_AGENT_L_CONFIG)
    max_samples: int = 2000
    """Lookback cap in SAMPLES (not ticks). 2000 = canonical maxBarsBack."""


DEFAULT_TIMEFRAMES: tuple[TimeframeConfig, ...] = (
    TimeframeConfig(label="15m", ticks_per_sample=30),
    TimeframeConfig(label="1h", ticks_per_sample=120),
    TimeframeConfig(label="4h", ticks_per_sample=480),
)


@dataclass
class _PerTfDecision:
    label: TimeframeLabel
    warm: bool
    decision: Optional[AgentLDecision]


@dataclass(frozen=True)
class MTFDecision:
    action: MTFAction
    agreement_count: int
    total_tfs: int
    size_multiplier: float
    """3-of-3 = 1.00, 2-of-3 = 0.50, else 0 (hold)."""
    per_timeframe: tuple[_PerTfDecision, ...]
    longest_agreeing_label: Optional[TimeframeLabel]
    reason: str


@dataclass
class MTFState:
    """State for the MTF runner. Per-timeframe basin histories +
    last-sample-tick tracking. Owned by the caller."""

    histories_by_tf: Dict[TimeframeLabel, List[Basin]] = field(default_factory=dict)
    last_sample_tick_by_tf: Dict[TimeframeLabel, float] = field(default_factory=dict)
    last_agreement_by_tf_side: Dict[
        TimeframeLabel, Dict[str, Optional[float]]
    ] = field(default_factory=dict)


def new_mtf_state(
    timeframes: Sequence[TimeframeConfig] = DEFAULT_TIMEFRAMES,
) -> MTFState:
    s = MTFState()
    for tf in timeframes:
        s.histories_by_tf[tf.label] = []
        s.last_sample_tick_by_tf[tf.label] = -math.inf
        s.last_agreement_by_tf_side[tf.label] = {"long": None, "short": None}
    return s


def on_tick_append(
    state: MTFState,
    basin: Basin,
    tick_index: int,
    timeframes: Sequence[TimeframeConfig] = DEFAULT_TIMEFRAMES,
) -> None:
    """Append the current basin to each timeframe's history whose
    sampling boundary has been crossed. Pure in-place update."""
    for tf in timeframes:
        last = state.last_sample_tick_by_tf[tf.label]
        if tick_index - last >= tf.ticks_per_sample:
            hist = state.histories_by_tf[tf.label]
            hist.append(basin)
            if len(hist) > tf.max_samples:
                del hist[: len(hist) - tf.max_samples]
            state.last_sample_tick_by_tf[tf.label] = tick_index


def set_bootstrap_history(
    state: MTFState,
    label: TimeframeLabel,
    history: Sequence[Basin],
    timeframes: Sequence[TimeframeConfig] = DEFAULT_TIMEFRAMES,
) -> None:
    """Replace a timeframe's history with a pre-computed sequence
    (called once at startup after OHLCV bootstrap)."""
    tf = next((t for t in timeframes if t.label == label), None)
    if tf is None:
        return
    if len(history) > tf.max_samples:
        capped = list(history[-tf.max_samples:])
    else:
        capped = list(history)
    state.histories_by_tf[label] = capped


def mtf_decide(
    state: MTFState,
    timeframes: Sequence[TimeframeConfig] = DEFAULT_TIMEFRAMES,
) -> MTFDecision:
    """Compute the multi-timeframe agreement decision.

    Each timeframe whose history is warm enough produces an
    AgentLDecision. The aggregated action is decided by agreement
    count; size_multiplier scales with agreement strength.

    Pure function — no state mutation.
    """
    per_tf: list[_PerTfDecision] = []
    long_count = 0
    short_count = 0
    warm_count = 0

    for tf in timeframes:
        hist = state.histories_by_tf.get(tf.label, [])
        # Warm when history reaches the classifier's minimum
        # (long_window + horizon).
        min_samples = tf.config.min_tuple_start + tf.config.horizon
        warm = len(hist) >= min_samples
        decision: Optional[AgentLDecision] = None
        if warm:
            decision = agent_l_decide(hist, tf.config)
            if decision.action == "enter_long":
                long_count += 1
            elif decision.action == "enter_short":
                short_count += 1
            warm_count += 1
        per_tf.append(_PerTfDecision(label=tf.label, warm=warm, decision=decision))

    if warm_count == 0:
        return MTFDecision(
            action="hold",
            agreement_count=0,
            total_tfs=len(timeframes),
            size_multiplier=0.0,
            per_timeframe=tuple(per_tf),
            longest_agreeing_label=None,
            reason="no_warm_timeframes",
        )

    # Agreement-count combiner.
    if long_count > short_count and long_count >= 2:
        action: MTFAction = "enter_long"
    elif short_count > long_count and short_count >= 2:
        action = "enter_short"
    else:
        action = "hold"

    if action == "enter_long":
        agreement_count = long_count
    elif action == "enter_short":
        agreement_count = short_count
    else:
        agreement_count = 0

    if action == "hold":
        size_multiplier = 0.0
    elif agreement_count >= 3:
        size_multiplier = 1.0
    elif agreement_count == 2:
        size_multiplier = 0.5
    else:
        size_multiplier = 0.0

    # Longest-agreeing label — timeframes array is ascending (15m, 1h, 4h).
    longest_agreeing: Optional[TimeframeLabel] = None
    if action != "hold":
        want = action
        for entry in per_tf:
            if entry.decision is not None and entry.decision.action == want:
                longest_agreeing = entry.label  # last match wins

    return MTFDecision(
        action=action,
        agreement_count=agreement_count,
        total_tfs=len(timeframes),
        size_multiplier=size_multiplier,
        per_timeframe=tuple(per_tf),
        longest_agreeing_label=longest_agreeing,
        reason=f"mtf:{long_count}L/{short_count}S/{warm_count}warm",
    )


def record_agreement_timestamps(
    state: MTFState,
    decision: MTFDecision,
    now_ms: float,
) -> None:
    """Update per-TF per-side agreement clocks after mtf_decide.
    Used by the longest-agreeing-horizon exit policy."""
    if decision.action == "hold":
        return
    side = "long" if decision.action == "enter_long" else "short"
    for entry in decision.per_timeframe:
        if entry.decision is not None and entry.decision.action == decision.action:
            state.last_agreement_by_tf_side[entry.label][side] = now_ms


def is_longest_horizon_expired(
    state: MTFState,
    side: str,  # "long" | "short"
    longest_label_at_entry: Optional[TimeframeLabel],
    now_ms: float,
    tick_ms: float,
    timeframes: Sequence[TimeframeConfig] = DEFAULT_TIMEFRAMES,
) -> bool:
    """Check whether the longest-agreeing-at-entry timeframe's horizon
    has elapsed without re-confirmation.

    Returns True → caller (force_harvest path) should exit the position
    per the longest-agreeing-horizon policy.
    """
    if longest_label_at_entry is None:
        return False
    tf = next((t for t in timeframes if t.label == longest_label_at_entry), None)
    if tf is None:
        return False
    horizon_ms = tf.config.horizon * tf.ticks_per_sample * tick_ms
    last_agreement = state.last_agreement_by_tf_side.get(
        longest_label_at_entry, {}
    ).get(side)
    if last_agreement is None:
        return False
    return (now_ms - last_agreement) > horizon_ms
