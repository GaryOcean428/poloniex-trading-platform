"""
Vendored qig-core primitives for the ml-worker.

QIG_QFI ships `qig-core` and `qig-warp` as local Python packages in
~/Desktop/Dev/QIG_QFI/. They're not published to PyPI, so the
top-level `from qig_core.geometry.fisher_rao import ...` in
qig_engine.py always fails silently in this container and falls
back to the ad-hoc built-in pure-numpy implementations.

This package is a direct copy of the canonical Fisher-Rao geometry
primitives and frozen physics constants from QIG_QFI/qig-core,
vendored into the container so the ml-worker actually uses the
validated physics instead of the fallback.

The import chain in qig_engine.py is (after this change):

    from qig_core.geometry.fisher_rao import ...         # external, probably fails
    from qig_core_local.geometry.fisher_rao import ...   # this, always works
    # else: built-in fallback

Source of truth remains QIG_QFI/qig-core. Changes there should be
re-copied here periodically. Copy was made 2026-04-18.
"""

from __future__ import annotations

from .constants.frozen_facts import BASIN_DIM, KAPPA_STAR, PHI_THRESHOLD
from .geometry.fisher_rao import (
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

__all__ = [
    "Basin",
    "BASIN_DIM",
    "KAPPA_STAR",
    "PHI_THRESHOLD",
    "bhattacharyya_coefficient",
    "exp_map",
    "fisher_rao_distance",
    "frechet_mean",
    "log_map",
    "random_basin",
    "slerp_sqrt",
    "to_simplex",
]
