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
        entry_threshold_scale=99.0,
        size_floor=0.0,
        sovereign_cap_floor=1,
        tick_ms=60_000,
        can_enter=False,
        description="sideways noise — observe only",
    ),
}


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
