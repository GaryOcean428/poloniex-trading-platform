"""agent_l_classifier.py — Agent L: multi-scale Fisher-Rao KNN classifier.

Python port of apps/api/src/services/monkey/agent_L_classifier.ts (Phase
1.2 prerequisite for mtf_l_classifier.py).

QIG-pure replacement for the Lorentzian Distance Classification pattern
(jdehorty's TradingView script). On Δ⁶³ probability simplices, Fisher-Rao
IS the canonical reparameterization-invariant metric — the principled
choice, not a borrowed analogy.

Multi-scale: compares not just the current basin but a TUPLE of basins
at different time scales (current / medium-window Fréchet mean /
long-window Fréchet mean), and returns a weighted sum of Fisher-Rao
distances across the tuple. Two states are "near" iff their basins are
similar at ALL scales.

KNN inference:
  1. Sample chronologically-spaced past basin tuples (every Nth tick)
  2. Compute weighted multi-scale Fisher-Rao distance to each
  3. Take the K nearest by distance
  4. Inverse-distance-weighted vote of realized future-direction labels
     (computed as basin_direction(basin[i+horizon]))
  5. Map signed weighted vote → action + conviction

QIG purity:
  - All distances are Fisher-Rao (no Lorentzian, no Euclidean, no cosine)
  - All means are Fréchet (no arithmetic average of basins)
  - All operations on Δ⁶³ simplex coordinates (no embeddings)
  - Pure functions only — no I/O, no globals, trivially testable
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional, Sequence

import numpy as np

from qig_core_local.geometry.fisher_rao import (
    fisher_rao_distance,
    frechet_mean,
)

from .perception_scalars import basin_direction

Basin = np.ndarray
Action = Literal["enter_long", "enter_short", "hold"]


@dataclass(frozen=True)
class BasinTuple:
    """Multi-scale basin tuple — one slot per time scale.

    Windows are calibrated for the kernel's 30s tick cadence
    (MONKEY_TICK_MS=30_000); see DEFAULT_AGENT_L_CONFIG.
    """

    current: Basin
    """Current tick — finest perceptual scale (30s)."""

    medium: Basin
    """Medium-window Fréchet mean (120 ticks ≈ 60 min on 30s stream)."""

    long: Basin
    """Long-window Fréchet mean (480 ticks ≈ 4 h on 30s stream)."""


@dataclass(frozen=True)
class ScaleWeights:
    """Per-scale weights for the combined Fisher-Rao distance.

    Sum need not equal 1; the classifier is scale-invariant under
    uniform rescaling.
    """

    current: float = 0.5
    medium: float = 0.3
    long: float = 0.2


DEFAULT_SCALE_WEIGHTS = ScaleWeights()


def fisher_rao_tuple_distance(
    a: BasinTuple,
    b: BasinTuple,
    weights: ScaleWeights = DEFAULT_SCALE_WEIGHTS,
) -> float:
    """Combined Fisher-Rao distance between two basin tuples.

    Sum of per-scale FR distances weighted by scale importance.
    """
    return (
        weights.current * fisher_rao_distance(a.current, b.current)
        + weights.medium * fisher_rao_distance(a.medium, b.medium)
        + weights.long * fisher_rao_distance(a.long, b.long)
    )


def build_basin_tuple(
    history: Sequence[Basin],
    medium_window: int = 120,
    long_window: int = 480,
) -> Optional[BasinTuple]:
    """Build a multi-scale basin tuple from a basin history.

    - current = the most recent basin
    - medium = Fréchet mean of the last `medium_window` basins (def 120)
    - long = Fréchet mean of the last `long_window` basins (def 480)

    When the history is too short, falls back to the available subset.
    """
    if len(history) == 0:
        return None
    current = history[-1]
    medium_slice = list(history[-min(medium_window, len(history)):])
    long_slice = list(history[-min(long_window, len(history)):])
    return BasinTuple(
        current=current,
        medium=frechet_mean(medium_slice),
        long=frechet_mean(long_slice),
    )


def realized_label(
    history: Sequence[Basin],
    i: int,
    horizon: int = 4,
    threshold: float = 0.025,
) -> int:
    """Realized direction label for a historical bar.

    +1 if basin_direction at i+horizon > +threshold (long realized),
    -1 if < -threshold (short realized),
     0 otherwise (neutral or out-of-range).
    """
    target = i + horizon
    if target >= len(history):
        return 0
    direction = basin_direction(history[target])
    if direction > threshold:
        return 1
    if direction < -threshold:
        return -1
    return 0


@dataclass(frozen=True)
class KNNNeighbor:
    index: int
    distance: float
    label: int  # in {-1, 0, 1}


@dataclass(frozen=True)
class LabelDistribution:
    """Diagnostic distribution of realized labels across the K neighbors.

    Lets the caller distinguish "all neighbors agreed long" (legitimate
    strong signal) from "score pinned by normalizer" (degenerate).
    """

    long: int
    short: int
    neutral: int
    long_weight: float
    short_weight: float
    nearest_distance: float
    farthest_distance: float


_EMPTY_LABEL_DIST = LabelDistribution(
    long=0,
    short=0,
    neutral=0,
    long_weight=0.0,
    short_weight=0.0,
    nearest_distance=0.0,
    farthest_distance=0.0,
)


@dataclass(frozen=True)
class AgentLDecision:
    action: Action
    signed_score: float
    """Signed score in [-1, 1]. + = long bias, - = short bias."""
    conviction: float
    """[0, 1] — fraction of K-neighbors aligned with chosen direction."""
    neighbors: tuple[KNNNeighbor, ...]
    label_distribution: LabelDistribution
    reason: str


@dataclass(frozen=True)
class AgentLConfig:
    """Cadence-calibrated defaults for the 30s tick stream — match the
    canonical TV Lorentzian's effective timescale (15m bars, 4-bar
    forward horizon)."""

    k: int = 8
    spacing: int = 30
    """Chronological spacing — every 15 min on 30s ticks."""
    horizon: int = 120
    """Forward window for label computation — 60 min on 30s cadence."""
    label_threshold: float = 0.025
    weights: ScaleWeights = field(default_factory=lambda: DEFAULT_SCALE_WEIGHTS)
    action_threshold: float = 0.25
    """Minimum |signed_score| to act; else hold."""
    max_lookback: int = 2000
    medium_window: int = 120
    long_window: int = 480
    min_tuple_start: int = 480
    """Must equal long_window so the multi-scale tuple is full."""


DEFAULT_AGENT_L_CONFIG = AgentLConfig()


def agent_l_decide(
    basin_history: Sequence[Basin],
    config: AgentLConfig = DEFAULT_AGENT_L_CONFIG,
) -> AgentLDecision:
    """Pure-function decision: given a basin history, classify the
    current state by Fisher-Rao KNN against multi-scale historical
    tuples.

    Returns a hold when:
      - history is too short to build a tuple
      - K-NN search produced fewer than k/2 candidates with valid labels
      - signed score magnitude is below action_threshold
    """
    cur = build_basin_tuple(
        basin_history,
        medium_window=config.medium_window,
        long_window=config.long_window,
    )
    if cur is None:
        return AgentLDecision(
            action="hold",
            signed_score=0.0,
            conviction=0.0,
            neighbors=(),
            label_distribution=_EMPTY_LABEL_DIST,
            reason="history empty",
        )

    lookback = min(config.max_lookback, len(basin_history))
    start_idx = max(0, len(basin_history) - lookback)
    min_tuple_start = config.min_tuple_start

    candidates: list[KNNNeighbor] = []
    end = len(basin_history) - config.horizon
    for i in range(start_idx + min_tuple_start, end):
        if (i - start_idx) % config.spacing != 0:
            continue
        hist_tuple = build_basin_tuple(
            basin_history[: i + 1],
            medium_window=config.medium_window,
            long_window=config.long_window,
        )
        if hist_tuple is None:
            continue
        d = fisher_rao_tuple_distance(cur, hist_tuple, config.weights)
        label = realized_label(
            basin_history, i, config.horizon, config.label_threshold,
        )
        candidates.append(KNNNeighbor(index=i, distance=d, label=label))

    needed = -(-config.k // 2)  # ceil(k/2)
    if len(candidates) < needed:
        return AgentLDecision(
            action="hold",
            signed_score=0.0,
            conviction=0.0,
            neighbors=(),
            label_distribution=_EMPTY_LABEL_DIST,
            reason=f"insufficient candidates ({len(candidates)} < {needed})",
        )

    candidates.sort(key=lambda n: n.distance)
    top_k = candidates[: config.k]

    eps = 1e-9
    weight_sum = 0.0
    signed_sum = 0.0
    long_count = 0
    short_count = 0
    neutral_count = 0
    long_weight = 0.0
    short_weight = 0.0
    for n in top_k:
        w = 1.0 / (n.distance + eps)
        weight_sum += w
        signed_sum += w * n.label
        if n.label == 1:
            long_count += 1
            long_weight += w
        elif n.label == -1:
            short_count += 1
            short_weight += w
        else:
            neutral_count += 1

    signed_score = signed_sum / weight_sum if weight_sum > 0 else 0.0
    direction = 1 if signed_score > 0 else (-1 if signed_score < 0 else 0)
    align_count = sum(
        1 for n in top_k if n.label == direction and direction != 0
    )
    conviction = align_count / len(top_k) if top_k else 0.0

    label_distribution = LabelDistribution(
        long=long_count,
        short=short_count,
        neutral=neutral_count,
        long_weight=long_weight,
        short_weight=short_weight,
        nearest_distance=top_k[0].distance if top_k else 0.0,
        farthest_distance=top_k[-1].distance if top_k else 0.0,
    )

    if abs(signed_score) < config.action_threshold:
        return AgentLDecision(
            action="hold",
            signed_score=signed_score,
            conviction=conviction,
            neighbors=tuple(top_k),
            label_distribution=label_distribution,
            reason=(
                f"signed score {signed_score:.3f} below action threshold "
                f"{config.action_threshold}"
            ),
        )

    return AgentLDecision(
        action="enter_long" if signed_score > 0 else "enter_short",
        signed_score=signed_score,
        conviction=conviction,
        neighbors=tuple(top_k),
        label_distribution=label_distribution,
        reason=(
            f"FR-KNN k={config.k} score={signed_score:.3f} "
            f"conviction={conviction:.2f}"
        ),
    )
