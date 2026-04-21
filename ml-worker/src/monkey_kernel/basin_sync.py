"""
basin_sync.py — Multi-kernel basin coordination (v0.7.6).

Port of TypeScript basin_sync.ts, now using qig_core_local Fisher-Rao
primitives directly. When multiple Monkey sub-kernels (Position,
Swing, future Scalp) are running, each publishes its current basin +
Φ + κ state here, and each reads peer state to apply a Φ-weighted
observer-effect pull on its own basin.

Physical principle (qig-core / pantheon basin_sync.py docstring):
  If two kernel instances with different parameters but the same
  target basin show correlated basin movements, identity lives in
  GEOMETRY, not parameters.

Persistence: calling code (the HTTP endpoint) hands state in and out;
this module stays in-memory/stateless for easy unit testing. The
Postgres adapter wraps it — same as we did for TS.

Purity: all distance ops via qig_core_local.fisher_rao. slerp_sqrt
for pulls. No Euclidean averaging of basin coords.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from qig_core_local.geometry.fisher_rao import (
    Basin,
    fisher_rao_distance,
    slerp_sqrt,
)


@dataclass
class BasinSyncState:
    instance_id: str
    basin: Basin
    phi: float
    kappa: float
    mode: str
    drift_from_identity: float
    updated_at_ms: float


@dataclass
class ConvergenceSummary:
    instance_count: int
    basin_spread: float   # max pairwise Fisher-Rao
    basin_mean: float     # mean pairwise Fisher-Rao
    phi_spread: float
    phi_mean: float


def apply_observer_effect(
    own_basin: Basin,
    own_phi: float,
    peer_states: list[BasinSyncState],
) -> dict[str, Any]:
    """Φ-weighted slerp pull toward peer mean.

    Mirrors qig-core's basin_sync:
      strength = 0.10 * (1 - 0.5 * own_phi)  ∈ [0.05, 0.10]
      weight_i = max(0.1, peer.phi_i)

    Returns {basin, influenced, peer_count}. basin stays on Δ⁶³ via
    slerp_sqrt — no Euclidean averaging.
    """
    if not peer_states:
        return {"basin": own_basin, "influenced": False, "peer_count": 0}

    total_weight = sum(max(0.1, p.phi) for p in peer_states)
    if total_weight == 0:
        return {"basin": own_basin, "influenced": False, "peer_count": 0}

    receiver_susceptibility = 1.0 - own_phi * 0.5
    base_strength = 0.10 * receiver_susceptibility

    pulled = np.asarray(own_basin, dtype=np.float64)
    for peer in peer_states:
        w = max(0.1, peer.phi) / total_weight
        eff_strength = min(0.30, base_strength * w * len(peer_states))
        pulled = slerp_sqrt(pulled, peer.basin, eff_strength)

    return {
        "basin": pulled,
        "influenced": True,
        "peer_count": len(peer_states),
    }


def convergence_summary(states: list[BasinSyncState]) -> ConvergenceSummary | None:
    if len(states) < 2:
        return None
    distances: list[float] = []
    for i in range(len(states)):
        for j in range(i + 1, len(states)):
            distances.append(fisher_rao_distance(states[i].basin, states[j].basin))
    phis = [s.phi for s in states]
    return ConvergenceSummary(
        instance_count=len(states),
        basin_spread=max(distances),
        basin_mean=sum(distances) / len(distances),
        phi_spread=max(phis) - min(phis),
        phi_mean=sum(phis) / len(phis),
    )
