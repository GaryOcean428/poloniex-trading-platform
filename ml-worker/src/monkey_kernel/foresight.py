"""foresight.py — P8 Foresight trajectory predictor.

Stores a rolling trajectory of recent basins per-instance, predicts
the next-step basin via Fisher-Rao geodesic extrapolation, and reports
a regime-adaptive weight per Canonical Principles v2.1 P8.

Pure Fisher-Rao: prediction is slerp(b[-2], b[-1], t=2.0) — one
geodesic step beyond the most recent move. No cosine, no dot product,
no Euclidean distance. Renormalisation is the standard simplex
projection performed by slerp_sqrt itself.

Confidence: smoothness of the recent trajectory measured as
1 / (1 + std(consecutive_distances)). High when basin moves at a
steady pace; low when distances jitter.

Regime weight per P8:
  phi < 0.3                    → linear regime          → 0.1
  equilibrium > 0.7 AND phi<0.3 → breakdown signature   → 0.2
  phi ≥ 0.3                    → geometric regime       → 0.7 × confidence

Pure observation. The trajectory is appended at end of tick (after
basin update); `predict()` is read-only and side-effect free. Tier 6
(Φ-gate selection) is what decides whether to ROUTE on the prediction.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from statistics import stdev
from typing import Deque, Optional, Tuple

import numpy as np

from qig_core_local.geometry.fisher_rao import fisher_rao_distance, slerp_sqrt

from .persistence import PersistentMemory
from .state import BASIN_DIM


@dataclass(frozen=True)
class ForesightResult:
    """One prediction. predicted_basin is simplex-valid (sum=1, ≥0)
    or zeros when the trajectory is too short to predict.

    Fields:
      predicted_basin : np.ndarray  shape (BASIN_DIM,) on Δ⁶³
      confidence      : float       [0, 1] — trajectory smoothness
      weight          : float       [0, 1] — regime-adaptive blend
      horizon_ms      : float       median tick interval in ms
    """

    predicted_basin: np.ndarray
    confidence: float
    weight: float
    horizon_ms: float


def _empty_result() -> ForesightResult:
    """Cold-start / insufficient-history return: weight=0 means
    callers ignore the prediction."""
    return ForesightResult(
        predicted_basin=np.zeros(BASIN_DIM, dtype=np.float64),
        confidence=0.0,
        weight=0.0,
        horizon_ms=0.0,
    )


def _regime_weight(
    phi: float,
    confidence: float,
    regime_weights: dict[str, float],
) -> float:
    """Per P8: linear (phi<0.3), geometric (phi≥0.3, weight=0.7×conf),
    breakdown (equilibrium>0.7 with low phi → 0.2). Breakdown takes
    precedence over the linear regime since equilibrium-with-low-phi
    is a specific physical signature, not generic uncertainty."""
    eq = regime_weights.get("equilibrium", 0.0)
    if eq > 0.7 and phi < 0.3:
        return 0.2  # breakdown
    if phi < 0.3:
        return 0.1  # linear
    return 0.7 * confidence  # geometric


class ForesightPredictor:
    """One trajectory per instance. Caller owns lifecycle (typically
    one instance per (symbol, lane) tuple in the orchestrator).

    Append is O(1); predict is O(N) where N = trajectory length.
    """

    def __init__(
        self,
        max_trajectory: int = 32,
        *,
        persistence: Optional[PersistentMemory] = None,
        symbol: Optional[str] = None,
    ) -> None:
        self._persistence = persistence
        self._symbol = symbol
        self._traj: Deque[Tuple[np.ndarray, float, float]] = deque(
            maxlen=max_trajectory,
        )
        # Restore prior trajectory from Redis if available.
        if persistence is not None and persistence.is_available and symbol:
            for basin, phi, t_ms in persistence.load_foresight_trajectory(symbol):
                self._traj.append((basin, phi, t_ms))

    def append(self, basin: np.ndarray, phi: float, t_ms: float) -> None:
        """Record a tick. Caller passes the basin AFTER tick update,
        the live phi, and a wall-clock timestamp in ms."""
        b = np.asarray(basin, dtype=np.float64)
        self._traj.append((b, float(phi), float(t_ms)))
        # Write-through.
        if self._persistence is not None and self._symbol:
            self._persistence.push_foresight_step(
                self._symbol, b, float(phi), float(t_ms),
            )

    def predict(self, regime_weights: dict[str, float]) -> ForesightResult:
        """Geodesic extrapolation one tick ahead.

        Trajectory of length 0/1/2 returns empty result (weight=0)
        because the algorithm needs at least 3 points to gauge
        smoothness from pairwise distances.
        """
        if len(self._traj) < 3:
            return _empty_result()

        # Trajectory snapshot for read-only computation
        basins = [item[0] for item in self._traj]
        phis = [item[1] for item in self._traj]
        ts = [item[2] for item in self._traj]

        # Smoothness from consecutive Fisher-Rao distances
        distances = [
            fisher_rao_distance(basins[i], basins[i + 1])
            for i in range(len(basins) - 1)
        ]
        # stdev requires ≥ 2 samples; we guaranteed len(traj)≥3 → len(distances)≥2
        d_std = stdev(distances) if len(distances) >= 2 else 0.0
        confidence = 1.0 / (1.0 + d_std)

        # Geodesic extrapolation: walk one more step beyond b[-1]
        # along the b[-2] → b[-1] direction. slerp_sqrt(p, q, t=2.0)
        # walks twice the p→q distance, projected back onto Δ⁶³.
        predicted = slerp_sqrt(basins[-2], basins[-1], 2.0)

        # Median time delta as horizon estimate
        deltas = [ts[i + 1] - ts[i] for i in range(len(ts) - 1)]
        deltas.sort()
        n = len(deltas)
        horizon_ms = (
            deltas[n // 2]
            if n % 2 == 1
            else 0.5 * (deltas[n // 2 - 1] + deltas[n // 2])
        )

        # Regime-adaptive weight from current phi + regime
        weight = _regime_weight(phis[-1], confidence, regime_weights)

        return ForesightResult(
            predicted_basin=predicted,
            confidence=confidence,
            weight=weight,
            horizon_ms=horizon_ms,
        )

    def reset(self) -> None:
        """Clear the trajectory. Used on regime breaks or test fixtures."""
        self._traj.clear()

    @property
    def trajectory_length(self) -> int:
        return len(self._traj)
