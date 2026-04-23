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
# for state-modulated values. Direct reads of this table are only
# appropriate for mode-gates (e.g. `can_enter`) that do not depend
# on state.
MODE_PROFILES: dict[MonkeyMode, ModeProfile] = {
    MonkeyMode.EXPLORATION: ModeProfile(
        tp_base_frac=0.004,
        sl_ratio=0.6,
        entry_threshold_scale=0.9,
        size_floor=0.08,
        sovereign_cap_floor=15,
        tick_ms=15_000,
        can_enter=True,
        description="volatile / hunting — tight TP, fast cadence",
    ),
    MonkeyMode.INVESTIGATION: ModeProfile(
        tp_base_frac=0.008,
        sl_ratio=0.5,
        entry_threshold_scale=1.0,
        size_floor=0.10,
        sovereign_cap_floor=20,
        tick_ms=30_000,
        can_enter=True,
        description="trend forming — medium TP, full size",
    ),
    MonkeyMode.INTEGRATION: ModeProfile(
        tp_base_frac=0.020,
        sl_ratio=0.3,
        entry_threshold_scale=1.1,
        size_floor=0.12,
        sovereign_cap_floor=25,
        tick_ms=60_000,
        can_enter=True,
        description="trend confirmed — wide TP, let winners run",
    ),
    MonkeyMode.DRIFT: ModeProfile(
        tp_base_frac=0.005,
        sl_ratio=0.6,
        entry_threshold_scale=99.0,  # SAFETY_BOUND: DRIFT lockout
        size_floor=0.0,
        sovereign_cap_floor=1,
        tick_ms=60_000,
        can_enter=False,
        description="sideways noise — observe only",
    ),
}


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
) -> dict[str, Any]:
    """Classify current cognitive mode from derived state.

    Returns:
      {
        "mode": MonkeyMode,
        "reason": str,
        "derivation": { driftNow, fHealthNow, basinVelocity, motivators... }
      }
    """
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
