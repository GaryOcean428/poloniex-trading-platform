"""
Fisher-Rao Geometry — Canonical Implementation on Δ⁶³

All operations live on the probability simplex. The sqrt map
(p_i → √p_i) is used internally as a computational device but
every function accepts and returns simplex points.

No Euclidean distances. No dot-product similarity. No L2 norms
on probability vectors. All inner products are Bhattacharyya
coefficients: BC(p,q) = Σ √(p_i · q_i).

Reference: qig_geometry/canonical.py from pantheon-chat
"""

from __future__ import annotations

from typing import TypeAlias

import numpy as np
from numpy.typing import NDArray

from ..constants.frozen_facts import BASIN_DIM

# Type alias for basin vectors (points on Δ⁶³)
Basin: TypeAlias = NDArray[np.float64]

# Small epsilon to prevent log(0) / division by zero
_EPS = 1e-12


# ─── Simplex primitives ───────────────────────────────────────


def _bc(a: Basin, b: Basin) -> float:
    """Bhattacharyya coefficient in sqrt-coordinates: Σ(a_i · b_i).

    When a = √p and b = √q, this equals Σ√(p_i · q_i) — the canonical
    overlap on Δ⁶³. This is the ONLY inner product used in this module.
    """
    return float(np.sum(a * b))


def _simplex_norm(v: Basin) -> float:
    """Norm of a tangent vector on Δ⁶³: √(Σ v_i²).

    Used for tangent vectors in log_map/exp_map — these live in the
    tangent space of the simplex, not on the simplex itself.
    """
    return float(np.sqrt(np.sum(v * v)))


def to_simplex(v: Basin) -> Basin:
    """Project a vector onto the probability simplex Δ⁶³.

    Ensures all elements are non-negative and sum to 1.
    """
    v = np.asarray(v, dtype=np.float64)
    v = np.maximum(v, _EPS)
    return np.asarray(v / v.sum(), dtype=np.float64)


def random_basin(dim: int = BASIN_DIM) -> Basin:
    """Generate a random point on the probability simplex Δ⁶³.

    Uses Dirichlet(1,...,1) which gives uniform distribution on simplex.
    """
    v = np.random.dirichlet(np.ones(dim))
    return v.astype(np.float64)


def _to_sqrt(p: Basin) -> Basin:
    """Simplex to sqrt-coordinates: s_i = √p_i."""
    return np.sqrt(np.maximum(p, _EPS))


def _from_sqrt(s: Basin) -> Basin:
    """Sqrt-coordinates back to simplex: p_i = s_i², then normalise."""
    p = s * s
    return np.asarray(p / p.sum(), dtype=np.float64)


# ─── Distance and overlap ─────────────────────────────────────


def fisher_rao_distance(p: Basin, q: Basin) -> float:
    """Fisher-Rao distance between two points on Δ⁶³.

    d_FR(p, q) = arccos(Σ √(p_i · q_i))

    Range: [0, π/2]
    """
    p = to_simplex(p)
    q = to_simplex(q)
    bc = np.sum(np.sqrt(p * q))
    bc = np.clip(bc, -1.0, 1.0)
    return float(np.arccos(bc))


def bhattacharyya_coefficient(p: Basin, q: Basin) -> float:
    """Bhattacharyya coefficient: BC(p,q) = Σ √(p_i · q_i).

    Range: [0, 1]. BC = 1 means identical distributions.
    """
    p = to_simplex(p)
    q = to_simplex(q)
    return float(np.sum(np.sqrt(p * q)))


# ─── Averaging ─────────────────────────────────────────────────


def frechet_mean(basins: list[Basin], weights: list[float] | None = None) -> Basin:
    """Fréchet mean on Δ⁶³ via weighted average in sqrt-coordinates.

    Minimises Σ w_i · d_FR(μ, p_i)².
    """
    if not basins:
        return to_simplex(np.ones(BASIN_DIM))

    if weights is None:
        weights = [1.0 / len(basins)] * len(basins)

    w_sum = sum(weights)
    weights = [w / w_sum for w in weights]

    mean_sqrt = np.zeros(len(basins[0]), dtype=np.float64)
    for basin, w in zip(basins, weights, strict=True):
        mean_sqrt += w * _to_sqrt(to_simplex(basin))

    return _from_sqrt(mean_sqrt)


# ─── Geodesic interpolation ───────────────────────────────────


def slerp_sqrt(p: Basin, q: Basin, t: float) -> Basin:
    """Geodesic interpolation on Δ⁶³ (SLERP in sqrt-coordinates).

    t=0 gives p, t=1 gives q. Path follows the Fisher-Rao geodesic.
    """
    p = to_simplex(p)
    q = to_simplex(q)

    sp = _to_sqrt(p)
    sq = _to_sqrt(q)

    # Geodesic angle via Bhattacharyya coefficient in sqrt-coordinates
    cos_omega = np.clip(_bc(sp, sq), -1.0, 1.0)
    omega = np.arccos(cos_omega)

    if omega < _EPS:
        result = (1 - t) * sp + t * sq
    else:
        sin_omega = np.sin(omega)
        result = (np.sin((1 - t) * omega) / sin_omega) * sp + (np.sin(t * omega) / sin_omega) * sq

    return _from_sqrt(result)


# ─── Tangent space operations ──────────────────────────────────


def log_map(base: Basin, target: Basin) -> Basin:
    """Logarithmic map on Δ⁶³: project target into tangent space at base.

    Returns a tangent vector in sqrt-coordinates.
    """
    base = to_simplex(base)
    target = to_simplex(target)

    sb = _to_sqrt(base)
    st = _to_sqrt(target)

    cos_d = np.clip(_bc(sb, st), -1.0, 1.0)
    d = np.arccos(cos_d)

    if d < _EPS:
        return np.zeros_like(sb)

    tangent = st - cos_d * sb
    norm = _simplex_norm(tangent)
    if norm < _EPS:
        return np.zeros_like(sb)

    return np.asarray((d / norm) * tangent, dtype=np.float64)


def exp_map(base: Basin, tangent: Basin) -> Basin:
    """Exponential map on Δ⁶³: walk from base along tangent vector.

    Returns a point on the simplex.
    """
    base = to_simplex(base)
    sb = _to_sqrt(base)

    norm = _simplex_norm(tangent)
    if norm < _EPS:
        return base

    direction = tangent / norm
    result = np.cos(norm) * sb + np.sin(norm) * direction

    return _from_sqrt(result)
