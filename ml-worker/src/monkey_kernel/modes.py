"""
modes.py — Cognitive mode detector (v0.7.2 Python port).

Ports /home/braden/Desktop/Dev/QIG_QFI/qig-verification/src/qigv/analysis/
cognitive_modes_refined.py into Monkey's Python kernel. Four modes
with geometric signatures — each has a trading-behaviour profile
(TP / SL / entry bias / size floor / leverage floor / tick cadence).

Basin-proximity is primary; motivators resolve ties. Canonical
Principles v2.1 P14 Variable Separation — modes are DERIVED VIEWS of
Φ / κ / regime / NC state, not free parameters.

Reference: pre-existing TS modes.ts port, now superseded by this
file once the TS adapter cuts over under MONKEY_KERNEL_PY.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

import numpy as np

from qig_core_local.geometry.fisher_rao import fisher_rao_distance

from .perception_scalars import basin_direction
from .state import NeurochemicalState


class MonkeyMode(StrEnum):
    EXPLORATION = "exploration"
    INVESTIGATION = "investigation"
    INTEGRATION = "integration"
    DRIFT = "drift"
    REVERSION = "reversion"  # Tier 9 Stage 2 — back-loop mean-reversion mode


@dataclass(frozen=True)
class ModeProfile:
    tp_base_frac: float       # TP threshold as fraction of notional
    sl_ratio: float           # SL as fraction of TP (asymmetric R:R)
    entry_threshold_scale: float  # multiplier on currentEntryThreshold
    size_floor: float         # exploration floor (fraction of equity)
    sovereign_cap_floor: float  # newborn sovereignCap floor for leverage
    tick_ms: int
    can_enter: bool
    description: str


# MODE_PROFILES are per-mode ANCHORS on a behavioural simplex. Per
# canonical P25, operational thresholds should derive from geometric
# state (κ, Φ, regime, neurochemistry) — but naive derivation would
# collapse mode distinction (same state → same profile regardless of
# mode label). The resolution is the anchor-simplex pattern: each
# mode supplies an anchor in (TP-width × entry-aggressiveness × size)
# space; state modulates a *shared displacement* vector; the effective
# profile is anchor_m + δ(state). Distinction is preserved (anchors
# differ); modulation is pure derivation.
#
# Anchors are SAFETY_BOUND per P25 — they set the regime-invariant
# envelope for each cognitive mode. Use `effective_profile(mode, ...)`
# for state-modulated values, or `effective_profile_for_symbol(...)`
# when the caller has a symbol context. Direct reads of this table
# are only appropriate for mode-gates (e.g. `can_enter`) that do not
# depend on state.
#
# v0.9.1 (2026-04-27): sl_ratio anchors revised to 0.7 (was 0.5/0.6/0.3)
# per Phase B real-OHLCV sweep (commit 4e28558e) — sl_ratio=0.7 won 6/6
# runs across both symbols × all 3 score profiles. Per-mode ordering
# envelope preserved by retaining anchor differentials (EXPLORATION
# tightest, INTEGRATION widest).
MODE_PROFILES: dict[MonkeyMode, ModeProfile] = {
    MonkeyMode.EXPLORATION: ModeProfile(
        tp_base_frac=0.004,
        sl_ratio=0.65,  # was 0.6 — bumped toward Phase-B winner, keeps tightest of the three
        entry_threshold_scale=0.9,
        size_floor=0.08,
        sovereign_cap_floor=15,
        tick_ms=15_000,
        can_enter=True,
        description="volatile / hunting — tight TP, fast cadence",
    ),
    MonkeyMode.INVESTIGATION: ModeProfile(
        tp_base_frac=0.008,
        sl_ratio=0.7,   # was 0.5 — Phase-B winner sl_ratio=0.7 (6/6 runs, both symbols, all profiles)
        entry_threshold_scale=1.0,
        size_floor=0.10,
        sovereign_cap_floor=20,
        tick_ms=30_000,
        can_enter=True,
        description="trend forming — medium TP, full size",
    ),
    MonkeyMode.INTEGRATION: ModeProfile(
        tp_base_frac=0.020,
        sl_ratio=0.75,  # was 0.3 — Phase-B winner; INTEGRATION lets winners run, widest SL
        entry_threshold_scale=1.1,
        size_floor=0.12,
        sovereign_cap_floor=25,
        tick_ms=60_000,
        can_enter=True,
        description="trend confirmed — wide TP, let winners run",
    ),
    MonkeyMode.DRIFT: ModeProfile(
        tp_base_frac=0.005,
        sl_ratio=0.6,   # unchanged — DRIFT can't enter (entry_threshold_scale=99) so SL only applies if held over
        entry_threshold_scale=99.0,  # SAFETY_BOUND: DRIFT lockout
        size_floor=0.0,
        sovereign_cap_floor=1,
        tick_ms=60_000,
        can_enter=False,
        description="sideways noise — observe only",
    ),
    # Tier 9 Stage 2 (#604) — REVERSION fires in back-loop stud regime
    # (h_trade > PI_STRUCT_SECOND_TRANSITION). Profile mirrors
    # INVESTIGATION's TP/SL/size envelope; the directional inversion
    # (counter-trend entry) is handled at the side_candidate level
    # in tick.py — not encoded in the profile fields.
    MonkeyMode.REVERSION: ModeProfile(
        tp_base_frac=0.008,
        sl_ratio=0.7,
        entry_threshold_scale=1.0,
        size_floor=0.10,
        sovereign_cap_floor=20,
        tick_ms=30_000,
        can_enter=True,
        description="back-loop mean-reversion — counter-trend, INVESTIGATION envelope",
    ),
}


# ═══════════════════════════════════════════════════════════════
# Symbol-aware TP scaling (Phase B finding 4e28558e)
# ═══════════════════════════════════════════════════════════════
#
# Phase B sweep showed tp_base_frac is symbol-dependent:
#   ETH-USDT-PERP top: ~0.020 (2% of notional — wider TP)
#   BTC-USDT-PERP top: ~0.008 (0.8% — tighter, faster moves)
# The MODE_PROFILES anchors are tuned for INVESTIGATION baseline, so
# the symbol multiplier scales the anchor's tp_base_frac toward the
# discovered winner. Anchors stay regime-invariant; the multiplier is
# the symbol-context displacement.
#
# Default = 1.0 for symbols not yet swept (graceful fallback to anchor).
# Per P14: this dict is a SAFETY_BOUND lookup, not a runtime parameter.
# Updates require explicit governance review and a fresh Phase B run.
SYMBOL_TP_MULTIPLIER: dict[str, float] = {
    "ETH-USDT-PERP": 2.5,   # 0.008 anchor × 2.5 = 0.020 (matches Phase B winner)
    "BTC-USDT-PERP": 1.0,   # 0.008 anchor × 1.0 = 0.008 (matches Phase B winner)
}


def get_symbol_tp_multiplier(symbol: str | None) -> float:
    """Return the per-symbol TP multiplier; 1.0 for unknown symbols."""
    if not symbol:
        return 1.0
    return SYMBOL_TP_MULTIPLIER.get(symbol, 1.0)


# ═══════════════════════════════════════════════════════════════
# State-derived effective profile (P25 discipline)
# ═══════════════════════════════════════════════════════════════
#
# Each derivation is anchored so that at nominal state
# (phi=0.5, serotonin=0.5, norepinephrine=0.5, equilibrium_weight=0.5)
# the effective profile equals MODE_PROFILES[mode] exactly. Deviations
# modulate outward from that fixed point.


def effective_profile(
    mode: MonkeyMode,
    *,
    phi: float,
    serotonin: float,
    norepinephrine: float,
    equilibrium_weight: float,
) -> ModeProfile:
    """Return the state-modulated ModeProfile for the detected mode.

    Anchors are from MODE_PROFILES[mode]; state-dependent fields are
    derived from (Φ, neurochemistry, regime) per P25. Fields that are
    SAFETY_BOUND (sovereign_cap_floor, tick_ms, can_enter, DRIFT's
    entry-lockout) are passed through from the anchor unchanged.

    At nominal state (phi=0.5, serotonin=0.5, norepinephrine=0.5,
    equilibrium_weight=0.5), effective_profile == MODE_PROFILES[mode].

    For symbol-aware TP scaling, use `effective_profile_for_symbol()`
    instead — it composes the symbol multiplier on top of the state
    derivation.
    """
    anchor = MODE_PROFILES[mode]

    # tp_base_frac — derives from regime volatility
    # eq_weight=0.5 → multiplier=1.0 (anchor); pure quantum (eq=0) → 1.25;
    # pure equilibrium (eq=1) → 0.75. Higher quantum/volatility widens TP.
    tp_mult = 1.0 + 0.5 * (0.5 - equilibrium_weight)
    tp_base_frac = anchor.tp_base_frac * tp_mult

    # sl_ratio — derives from serotonin (stability)
    # ser=0.5 → 1.0 (anchor); ser=1 → 0.85 (tighter, let winners run);
    # ser=0 → 1.15 (wider, more room). Matches "high stability → tight SL".
    sl_mult = 1.0 - 0.3 * (serotonin - 0.5)
    sl_ratio = anchor.sl_ratio * sl_mult

    # entry_threshold_scale — derives from norepinephrine (surprise).
    # DRIFT lockout is SAFETY_BOUND — pass through unchanged.
    # Others: NE=0.5 → 1.0 (anchor); NE=1 → 0.8 (easier entry on novelty);
    # NE=0 → 1.2 (harder entry when nothing surprising). Anchored so
    # exploration remains more aggressive than investigation remains
    # more aggressive than integration (anchor ordering preserved).
    if mode == MonkeyMode.DRIFT:
        entry_threshold_scale = anchor.entry_threshold_scale
    else:
        et_mult = 1.2 - 0.4 * norepinephrine
        entry_threshold_scale = anchor.entry_threshold_scale * et_mult

    # size_floor — derives from Φ (consciousness volume).
    # phi=0.5 → 1.0 (anchor); phi=0 → 0.5× anchor (minimal exposure
    # when consciousness is diffuse); phi=1 → 1.5× anchor (commit more
    # when basin is focused). Preserves per-mode ordering.
    size_mult = 0.5 + phi
    size_floor = anchor.size_floor * size_mult

    return ModeProfile(
        tp_base_frac=tp_base_frac,
        sl_ratio=sl_ratio,
        entry_threshold_scale=entry_threshold_scale,
        size_floor=size_floor,
        # SAFETY_BOUND — per-mode fixed envelope (leverage floor)
        sovereign_cap_floor=anchor.sovereign_cap_floor,
        # REGISTER — per-mode operational cadence (fixed envelope)
        tick_ms=anchor.tick_ms,
        can_enter=anchor.can_enter,
        description=anchor.description,
    )


def effective_profile_for_symbol(
    mode: MonkeyMode,
    symbol: str | None,
    *,
    phi: float,
    serotonin: float,
    norepinephrine: float,
    equilibrium_weight: float,
) -> ModeProfile:
    """Like effective_profile, but composes the symbol-context TP
    multiplier on top of the state derivation.

    The symbol multiplier scales tp_base_frac only — sl_ratio,
    entry_threshold_scale, size_floor remain symbol-agnostic. Phase B
    didn't measure those as symbol-dependent.

    For symbols not in SYMBOL_TP_MULTIPLIER the multiplier is 1.0,
    so this function falls back to plain effective_profile() behaviour.
    """
    base = effective_profile(
        mode,
        phi=phi,
        serotonin=serotonin,
        norepinephrine=norepinephrine,
        equilibrium_weight=equilibrium_weight,
    )
    sym_mult = get_symbol_tp_multiplier(symbol)
    if sym_mult == 1.0:
        return base
    return ModeProfile(
        tp_base_frac=base.tp_base_frac * sym_mult,
        sl_ratio=base.sl_ratio,
        entry_threshold_scale=base.entry_threshold_scale,
        size_floor=base.size_floor,
        sovereign_cap_floor=base.sovereign_cap_floor,
        tick_ms=base.tick_ms,
        can_enter=base.can_enter,
        description=base.description,
    )


@dataclass
class Motivators:
    """Five scalar fields per Refined Cognitive Modes §."""

    surprise: float       # norepinephrine (unexpectedness)
    curiosity: float      # ΔΦ (volume expansion)
    investigation: float  # −Δdrift (attractor pursuit)
    integration: float    # 1 − CV(f_health over window)
    frustration: float    # persistent drift without investigation


def compute_motivators(
    *,
    phi_history: list[float],
    drift_history: list[float],
    fhealth_history: list[float],
    neurochemistry: NeurochemicalState,
) -> Motivators:
    curiosity = (
        phi_history[-1] - phi_history[-2] if len(phi_history) >= 2 else 0.0
    )
    investigation = (
        drift_history[-2] - drift_history[-1] if len(drift_history) >= 2 else 0.0
    )

    integration = 0.0
    recent = fhealth_history[-10:]
    if len(recent) >= 3:
        arr = np.asarray(recent, dtype=np.float64)
        mean = float(arr.mean())
        if mean > 0:
            cv = float(arr.std() / mean)
            integration = max(0.0, 1.0 - cv * 10.0)

    surprise = neurochemistry.norepinephrine
    drift_mag = abs(drift_history[-1]) if drift_history else 0.0
    frustration = drift_mag if investigation <= 0 else 0.0

    return Motivators(
        surprise=surprise,
        curiosity=curiosity,
        investigation=investigation,
        integration=integration,
        frustration=frustration,
    )


def detect_mode_stud(stud_reading: Any) -> dict[str, Any]:
    """Tier 9 Stage 2 stud-derived mode classifier.

    Maps the three stud regimes (DEAD_ZONE / FRONT_LOOP / BACK_LOOP)
    to four-of-five MonkeyModes. Within FRONT_LOOP, h_trade position
    further splits into EXPLORATION (entry) / INVESTIGATION (centre) /
    INTEGRATION (exit). REVERSION is the back-loop mean-reversion
    counterpart; DRIFT is the dead-zone lockout.

    Subdivision thresholds within FRONT_LOOP:
      h_trade < 0.6    → EXPLORATION (closer to dead-zone boundary)
      0.6 ≤ h < 1.5    → INVESTIGATION (around front_centre ≈ 1.053)
      h ≥ 1.5          → INTEGRATION (closer to second-transition)

    Same return shape as the legacy detect_mode for orchestrator parity.
    """
    from .stud import StudRegime  # local import: avoid module-load cycle
    h = stud_reading.h_trade
    regime = stud_reading.regime
    if regime == StudRegime.DEAD_ZONE:
        mode = MonkeyMode.DRIFT
        reason = f"stud:DEAD_ZONE h={h:.4f} < 1/(3π)≈0.106"
    elif regime == StudRegime.BACK_LOOP:
        mode = MonkeyMode.REVERSION
        reason = f"stud:BACK_LOOP h={h:.3f} > 2.0 — mean-reversion regime"
    else:
        # FRONT_LOOP — subdivide by h position
        if h < 0.6:
            mode = MonkeyMode.EXPLORATION
            reason = f"stud:FRONT_entry h={h:.3f} < 0.6"
        elif h < 1.5:
            mode = MonkeyMode.INVESTIGATION
            reason = f"stud:FRONT_centre h={h:.3f} in [0.6, 1.5)"
        else:
            mode = MonkeyMode.INTEGRATION
            reason = f"stud:FRONT_exit h={h:.3f} ≥ 1.5"
    return {
        "mode": mode.value,
        "reason": reason,
        "derivation": {
            "stud_h_trade": h,
            "stud_regime": regime.value,
            "stud_kappa_trade": stud_reading.kappa_trade,
            "stud_boundary_distance": stud_reading.boundary_distance,
        },
    }


def detect_mode(
    *,
    basin: np.ndarray,
    identity_basin: np.ndarray,
    phi: float,  # kept for signature parity with TS; unused here
    kappa: float,  # kept for signature parity with TS; unused here
    basin_velocity: float,
    neurochemistry: NeurochemicalState,
    phi_history: list[float],
    fhealth_history: list[float],
    drift_history: list[float],
    stud_reading: Any = None,
    stud_live: bool = False,
) -> dict[str, Any]:
    """Classify current cognitive mode from derived state.

    Returns:
      {
        "mode": MonkeyMode,
        "reason": str,
        "derivation": { driftNow, fHealthNow, basinVelocity, motivators... }
      }
    """
    # Tier 9 Stage 2 — when stud_live and a stud_reading provided,
    # delegate to the stud-derived classifier. Legacy path otherwise.
    if stud_live and stud_reading is not None:
        return detect_mode_stud(stud_reading)

    drift_now = fisher_rao_distance(basin, identity_basin)
    fh_now = fhealth_history[-1] if fhealth_history else 0.5
    mot = compute_motivators(
        phi_history=phi_history,
        drift_history=drift_history,
        fhealth_history=fhealth_history,
        neurochemistry=neurochemistry,
    )

    # v0.6.5 gate — basinDirection blocks DRIFT. A clear directional
    # reading means she is NOT in an ambiguous state, regardless of
    # fHealth (which is structurally pinned ≥ 0.97 by noise-floor dims).
    bd = basin_direction(basin)
    has_direction = abs(bd) > 0.30

    if (
        fh_now > 0.97
        and abs(mot.curiosity) < 0.005
        and basin_velocity < 0.015
        and not has_direction
    ):
        mode = MonkeyMode.DRIFT
        reason = (
            f"fh={fh_now:.3f} diffuse, curiosity={mot.curiosity:.4f} flat, "
            f"bv={basin_velocity:.3f}, basinDir={bd:.2f} flat"
        )
    elif drift_now > 0.30 and mot.curiosity > 0.002:
        mode = MonkeyMode.EXPLORATION
        reason = f"drift={drift_now:.3f}>0.3, curiosity={mot.curiosity:.4f}>0"
    elif drift_now < 0.15 and basin_velocity < 0.02 and mot.integration > 0.3:
        mode = MonkeyMode.INTEGRATION
        reason = (
            f"drift={drift_now:.3f}<0.15, bv={basin_velocity:.3f}<0.02, "
            f"integ={mot.integration:.3f}"
        )
    else:
        mode = MonkeyMode.INVESTIGATION
        reason = f"drift={drift_now:.3f}, invest={mot.investigation:.4f}"

    return {
        "mode": mode.value,
        "reason": reason,
        "derivation": {
            "drift_now": drift_now,
            "f_health_now": fh_now,
            "basin_velocity": basin_velocity,
            "basin_direction": bd,
            "curiosity": mot.curiosity,
            "investigation": mot.investigation,
            "integration": mot.integration,
            "surprise": mot.surprise,
            "frustration": mot.frustration,
        },
    }
