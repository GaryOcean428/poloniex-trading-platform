"""
basin.py — Fisher-Rao simplex primitives (v0.7.5).

This module is a THIN RE-EXPORT of qig_core_local.geometry.fisher_rao
for callers inside monkey_kernel. We do NOT reimplement — the whole
point of moving to Python is to use the validated primitives directly.

If anything in here starts to LOOK like a reimplementation instead of
a re-export, that's a purity smell. The allowed shape is:

    from qig_core_local.geometry.fisher_rao import fn as fn

Plus maybe a very-thin Dirichlet noise helper (NOT a distance / metric)
that callers can use to perturb a basin for exploration. That's the only
thing here beyond re-exports.

All metric operations go through qig_core_local. No Euclidean. Simplex only.
"""

from __future__ import annotations

import numpy as np

from qig_core_local.geometry.fisher_rao import (
    Basin,
    bhattacharyya_coefficient,
    exp_map,
    fisher_rao_distance,
    frechet_mean,
    log_map,
    random_basin,
    slerp_sqrt,
    to_simplex,
)

from .state import BASIN_DIM, KAPPA_STAR


def inject_dirichlet_noise(
    basin: Basin,
    concentration: float = 100.0,
    *,
    rng: np.random.Generator | None = None,
) -> Basin:
    """Perturb a simplex point with Dirichlet noise centered on `basin`.

    Higher concentration = less perturbation. Used for exploration
    during newborn phase when identity basin is still uniform and we
    want the mode detector to see tick-to-tick variation.

    NOT a distance. NOT a metric. Just a sampling primitive that stays
    on Δ⁶³ by construction (Dirichlet samples sum to 1, are non-negative).
    """
    rng = rng or np.random.default_rng()
    # Dirichlet with alpha = basin * concentration has expected value
    # == basin and variance proportional to 1/concentration.
    alpha = np.clip(basin * concentration, 1e-6, None)
    return np.asarray(rng.dirichlet(alpha), dtype=np.float64)


# ── Helpers on simplex that aren't metrics but are convenient ──


def uniform_basin(dim: int = BASIN_DIM) -> Basin:
    """Max-entropy point on Δ^{dim-1}."""
    return np.full(dim, 1.0 / dim, dtype=np.float64)


def normalized_entropy(basin: Basin) -> float:
    """Shannon entropy normalized to [0, 1]. 1 = uniform, 0 = one-hot."""
    p = np.clip(basin, 1e-12, 1.0)
    h = float(-np.sum(p * np.log(p)))
    h_max = float(np.log(len(basin)))
    return h / h_max if h_max > 0 else 0.0


def max_mass(basin: Basin) -> float:
    """Maximum coordinate mass. 1 = one-hot, 1/N = uniform."""
    return float(np.max(basin))


def velocity(prev: Basin, curr: Basin) -> float:
    """Fisher-Rao velocity per tick. Just a named wrapper around the
    FR distance for clarity in call sites."""
    return float(fisher_rao_distance(prev, curr))


__all__ = [
    "BASIN_DIM",
    "Basin",
    "KAPPA_STAR",
    "bhattacharyya_coefficient",
    "exp_map",
    "fisher_rao_distance",
    "frechet_mean",
    "inject_dirichlet_noise",
    "log_map",
    "max_mass",
    "normalized_entropy",
    "random_basin",
    "slerp_sqrt",
    "to_simplex",
    "uniform_basin",
    "velocity",
]
