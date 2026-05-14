"""regime_sizing.py — regime-conditioned position sizing.

Python port of apps/api/src/services/monkey/regimeSizing.ts (PRs #667,
#672). Maps the kernel's QIG-derived regime score r in [0, 1] onto
trade parameters (leverage, size fraction, hold horizon, stop bps,
margin headroom floor).

  r -> 1  = FLAT regime (orbit, low FR velocity, low coherence, near-
           critical k). High-frequency, high-leverage, small notional,
           short hold, tight stop.

  r -> 0  = TRENDING regime (geodesic traversal, high FR velocity, high
           coherence, far-from-critical k). Low-frequency, lower
           leverage, large notional, long hold, wide stop.

Risk-per-trade in DOLLAR terms stays roughly constant; the bot
participates in both market modes with comparable downside, just by
different mechanisms.

QIG purity: composes existing basin / perception primitives only
(fisher_rao_distance, frechet_mean, velocity, basin_direction). No
banned ops.

Pure functions. The integration layer (tick.py) calls these to get
sizing parameters per tick.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional, Sequence

import numpy as np

from qig_core_local.geometry.fisher_rao import (
    fisher_rao_distance,
    frechet_mean,
)

from .basin import velocity
from .perception_scalars import basin_direction

Basin = np.ndarray
RegimeScore = float
RegimeLabel = Literal["flat", "transitioning", "trending"]


@dataclass(frozen=True)
class RegimeComponents:
    """Per-component scores in [0, 1] for telemetry."""

    velocity_flatness: float
    """Mean FR velocity over the window, normalised into [0, 1].
    HIGH velocity -> score near 0 (trending);
    LOW velocity -> score near 1 (flat)."""

    directional_chop: float
    """Directional persistence — |mean(direction)| / mean(|direction|).
    HIGH persistence (near 1) -> near 0 (trending);
    LOW persistence (near 0) -> near 1 (chop)."""

    kappa_criticality: float
    """Distance from the critical kappa band. Closer to k* -> near 1
    (flat, near-critical); further away -> near 0 (trending).
    Falls back to 0.5 (neutral) when kappa unavailable."""


@dataclass(frozen=True)
class RegimeReading:
    """Composite regime score plus its component breakdown."""

    r: RegimeScore
    components: RegimeComponents
    label: RegimeLabel


@dataclass(frozen=True)
class RegimeConfig:
    """Hyperparameters for the regime score. Tunable, but defaults are
    calibrated for the basin coordinates produced by perceive() at the
    30s tick cadence."""

    window: int = 60
    """Lookback window in ticks for velocity + direction history.
    60 = 30 min on 30s ticks."""

    velocity_saturate: float = 0.10
    """Velocity at which the score saturates to 0 (full trending).
    0.10 = empirical for Delta-63 basins at 30s cadence."""

    kappa_critical: float = 64.0
    """Critical kappa target."""

    kappa_critical_band_half_width: float = 16.0
    """+/- band around kappa_critical considered near-critical."""

    weight_velocity: float = 0.4
    weight_directional: float = 0.4
    weight_kappa: float = 0.2
    """Component weights — should sum to 1 for clean interpretation."""

    flat_at: float = 0.65
    """Label threshold: r >= flat_at -> 'flat'."""

    trend_at: float = 0.35
    """Label threshold: r <= trend_at -> 'trending'."""


DEFAULT_REGIME_CONFIG = RegimeConfig()


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def regime_score(
    basin_history: Sequence[Basin],
    kappa: Optional[float],
    config: RegimeConfig = DEFAULT_REGIME_CONFIG,
) -> Optional[RegimeReading]:
    """Compute the regime score from recent basin history + current kappa.

    Returns None when there's insufficient history (< 2 basins; need
    at least one velocity sample). Caller treats None as "regime
    unknown" and falls back to neutral sizing.
    """
    if len(basin_history) < 2:
        return None

    window = min(config.window, len(basin_history) - 1)
    # Need N+1 samples for N velocities.
    recent = list(basin_history[-(window + 1):])

    # Component 1 — velocity flatness.
    vel_sum = 0.0
    vel_count = 0
    for i in range(1, len(recent)):
        vel_sum += velocity(recent[i - 1], recent[i])
        vel_count += 1
    mean_vel = vel_sum / vel_count if vel_count > 0 else 0.0
    velocity_flatness = _clamp01(1.0 - mean_vel / config.velocity_saturate)

    # Component 2 — directional chop.
    sum_signed_dir = 0.0
    sum_abs_dir = 0.0
    for basin in recent:
        d = basin_direction(basin)
        sum_signed_dir += d
        sum_abs_dir += abs(d)
    persistence = (
        abs(sum_signed_dir) / sum_abs_dir if sum_abs_dir > 0 else 0.0
    )
    directional_chop = _clamp01(1.0 - persistence)

    # Component 3 — kappa criticality.
    if kappa is None or not np.isfinite(kappa):
        kappa_criticality = 0.5
    else:
        dist_from_critical = abs(kappa - config.kappa_critical)
        kappa_criticality = _clamp01(
            1.0 - dist_from_critical / (2.0 * config.kappa_critical_band_half_width)
        )

    w_sum = max(
        config.weight_velocity + config.weight_directional + config.weight_kappa,
        1e-9,
    )
    r = (
        config.weight_velocity * velocity_flatness
        + config.weight_directional * directional_chop
        + config.weight_kappa * kappa_criticality
    ) / w_sum

    label: RegimeLabel
    if r >= config.flat_at:
        label = "flat"
    elif r <= config.trend_at:
        label = "trending"
    else:
        label = "transitioning"

    return RegimeReading(
        r=r,
        components=RegimeComponents(
            velocity_flatness=velocity_flatness,
            directional_chop=directional_chop,
            kappa_criticality=kappa_criticality,
        ),
        label=label,
    )


@dataclass(frozen=True)
class SizingResult:
    """Sizing parameters output by regime_sizing()."""

    leverage: int
    """Leverage multiplier (1..max)."""

    size_fraction: float
    """Fraction of allocated capital to deploy as margin on this entry."""

    hold_ms: int
    """Hold horizon in ms. Exit at this if no re-confirmation, regardless
    of PnL."""

    stop_bps: float
    """Stop-loss in basis points of notional. 100 bps = 1%."""

    margin_headroom_floor: float
    """Margin headroom floor (fraction of equity) to require before
    entry. Tighter on flat (need headroom for rapid scalp cycles);
    looser on trend (one slow large position is OK)."""


@dataclass(frozen=True)
class SizingConfig:
    """Rails for the flat-to-trend interpolation."""

    flat_leverage: int = 50
    trend_leverage: int = 8
    flat_size_fraction: float = 0.25
    trend_size_fraction: float = 0.85
    flat_hold_ms: int = 10 * 60_000           # 10 min
    trend_hold_ms: int = 4 * 60 * 60_000      # 4 h
    flat_stop_bps: float = 30.0
    trend_stop_bps: float = 150.0
    flat_headroom_floor: float = 0.35
    trend_headroom_floor: float = 0.15


DEFAULT_SIZING_CONFIG = SizingConfig()


def _lerp(flat_val: float, trend_val: float, r: float) -> float:
    """Linear interpolation between flat (r=1) and trend (r=0) values."""
    t = _clamp01(r)
    return trend_val + (flat_val - trend_val) * t


def compute_regime_sizing(
    r: RegimeScore,
    config: SizingConfig = DEFAULT_SIZING_CONFIG,
) -> SizingResult:
    """Map a regime score to a sizing parameter bundle.

    Continuous interpolation — no discrete "now flat / now trending"
    cliff. r=0.7 yields a leverage between flat and trend proportional
    to where 0.7 falls on the rail.

    Pure function. Caller takes the result and applies it to the entry
    order builder. Sizing is per-entry, not per-symbol-state — each
    entry recomputes against the current r.
    """
    return SizingResult(
        leverage=round(_lerp(config.flat_leverage, config.trend_leverage, r)),
        size_fraction=_lerp(config.flat_size_fraction, config.trend_size_fraction, r),
        hold_ms=int(_lerp(config.flat_hold_ms, config.trend_hold_ms, r)),
        stop_bps=_lerp(config.flat_stop_bps, config.trend_stop_bps, r),
        margin_headroom_floor=_lerp(
            config.flat_headroom_floor, config.trend_headroom_floor, r,
        ),
    )


def trailing_regime_stop(
    r_at_entry: RegimeScore,
    r_now: RegimeScore,
    adverse_delta: float = 0.30,
) -> bool:
    """Held positions must exit on adverse regime transition.

    If the regime score has shifted (in either direction) by more than
    `adverse_delta` since position open, the regime hypothesis that
    justified the size has ended. Symmetric: a flat-side bet exits if
    regime turns trending; a trend-side bet exits if it goes flat.

    Returns True -> caller should close the position.
    """
    return abs(r_at_entry - r_now) > adverse_delta


def basin_alignment_to_window(
    current: Basin,
    window: Sequence[Basin],
) -> float:
    """Fisher-Rao distance between the current basin and the Frechet
    mean of a recent window. Low distance = "current state agrees with
    recent mean"; high distance = "current state is an outlier."

    Not used by regime_score() directly today, but exposed because it's
    useful for higher-order regime composition (e.g. MTF coherence).
    """
    if len(window) == 0:
        return 0.0
    mean = frechet_mean(list(window))
    return fisher_rao_distance(current, mean)
