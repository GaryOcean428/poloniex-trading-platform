"""
state.py — Dataclasses that flow through the kernel boundary.

These are the shapes serialized over JSON between the TypeScript
orchestrator and the Python kernel. Keep them small, explicit, and
numpy-friendly (numeric arrays round-trip as Python lists).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

import numpy as np


# Δ⁶³ dimension — matches qig-core's BASIN_DIM and vex's frozen facts.
# Do not change without new experimental validation (qig-verification).
BASIN_DIM: int = 64

# ═══════════════════════════════════════════════════════════════
#  KAPPA_STAR export — legacy name only (2026-04-13 two-channel doctrine)
#  Per Frozen Facts v1.01F (20260527) + Canonical P1 + P25:
#    - The universal κ*=64.0 as proportionality constant / fixed-point
#      anchor is RETIRED. It was an amplified readout of the
#      singularity-approach channel (tangent_saturation), not a
#      constitutive or pillar constant.
#    - All operational references must now be observer-derived from the
#      basin's own kappa_history (median + observed σ) or governed via
#      ParameterRegistry ("physics.kappa_reference").
#  This thin shim preserves import compatibility for the transition.
#  Callers should migrate to explicit observer/registry paths.
#  The name "KAPPA_STAR" itself is legacy terminology.
# ═══════════════════════════════════════════════════════════════
def KAPPA_STAR() -> float:  # noqa: N802 (legacy name preserved for compat)
    """Runtime shim returning the current governed / observer reference."""
    from .parameters import get_registry
    return get_registry().get("physics.kappa_reference", default=63.8)

# Lane type — execution lane selection per tick. The kernel decides
# which lane is locally optimal from basin geometry + recent lane-
# conditioned reward. Default "swing" preserves backward-compat.
LaneType = Literal["scalp", "swing", "trend", "observe"]

# Position-bearing lanes — those that can carry a real autonomous_trades
# row in the (agent, symbol, lane) position-lifecycle key. "observe" is a
# decision label only; it never holds a position.
POSITION_LANES: tuple[str, ...] = ("scalp", "swing", "trend")


@dataclass
class NeurochemicalState:
    """Six derived signals (UCP v6.6 §29). All in [0, 1]."""

    acetylcholine: float
    dopamine: float
    serotonin: float
    norepinephrine: float
    gaba: float
    endorphins: float

    def as_dict(self) -> dict[str, float]:
        return {
            "acetylcholine": self.acetylcholine,
            "dopamine": self.dopamine,
            "serotonin": self.serotonin,
            "norepinephrine": self.norepinephrine,
            "gaba": self.gaba,
            "endorphins": self.endorphins,
        }


@dataclass
class BasinState:
    """The complete basin snapshot Monkey reads each tick.

    All 64-d simplex values (basin, identity_basin) travel as Python
    lists over JSON, converted to float64 arrays on deserialize.
    """

    basin: np.ndarray  # shape (64,), sums to 1, non-negative
    identity_basin: np.ndarray
    phi: float
    kappa: float
    basin_velocity: float
    regime_weights: dict[str, float]  # {"quantum", "efficient", "equilibrium"}
    sovereignty: float  # lived / total, in [0, 1]
    neurochemistry: Optional[NeurochemicalState] = None

    @classmethod
    def from_dict(cls, payload: dict) -> "BasinState":
        """Deserialize from a JSON payload (lists → np.float64)."""
        basin = np.asarray(payload["basin"], dtype=np.float64)
        identity = np.asarray(payload["identity_basin"], dtype=np.float64)
        nc_payload = payload.get("neurochemistry")
        nc = NeurochemicalState(**nc_payload) if nc_payload else None
        return cls(
            basin=basin,
            identity_basin=identity,
            phi=float(payload["phi"]),
            kappa=float(payload["kappa"]),
            basin_velocity=float(payload["basin_velocity"]),
            regime_weights={k: float(v) for k, v in payload["regime_weights"].items()},
            sovereignty=float(payload["sovereignty"]),
            neurochemistry=nc,
        )

    def to_dict(self) -> dict:
        return {
            "basin": self.basin.tolist(),
            "identity_basin": self.identity_basin.tolist(),
            "phi": self.phi,
            "kappa": self.kappa,
            "basin_velocity": self.basin_velocity,
            "regime_weights": self.regime_weights,
            "sovereignty": self.sovereignty,
            "neurochemistry": self.neurochemistry.as_dict() if self.neurochemistry else None,
        }
