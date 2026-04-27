"""Regression tests for the 2026-04-24 basin_direction saturation bug.

Pre-fix the function centred each dim at 0.5 (raw-sigmoid neutral). The
basin is post-toSimplex, so each dim ≈ 1/64 in a uniform reading. The
old subtraction produced basinDir ≈ −1.0 on every tick — confirmed
across 21,458 monkey_decisions in 72h, structurally killing DRIFT mode.

The fix compares momentum-band simplex mass to its uniform expectation
(8/BASIN_DIM). Symmetric around 0 at flat input.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.perception_scalars import basin_direction  # noqa: E402

BASIN_DIM = 64


def _make_simplex_basin(setter) -> np.ndarray:
    """Build a 64-dim vector with all dims at 0.5, apply optional setter,
    then normalize to a simplex point (sum = 1)."""
    v = np.full(BASIN_DIM, 0.5, dtype=np.float64)
    setter(v)
    return v / v.sum()


class TestBasinDirectionPostSimplex:
    def test_uniform_basin_reads_zero(self):
        uniform = np.full(BASIN_DIM, 1 / BASIN_DIM)
        assert abs(basin_direction(uniform)) < 1e-9

    def test_flat_momentum_reads_near_zero(self):
        """All raw dims = 0.5. After simplex, dims 7..14 each ≈ 1/64.
        (mom_mass − 0.125) ≈ 0 → tanh(0) = 0."""
        flat = _make_simplex_basin(lambda v: None)
        assert abs(basin_direction(flat)) < 0.05

    def test_bullish_basin_strongly_positive(self):
        """Raw momentum dims at 0.9 — a bullish reading. Post-simplex
        those dims hold more than uniform mass → positive direction."""
        def setter(v):
            v[7:15] = 0.9
        bull = _make_simplex_basin(setter)
        d = basin_direction(bull)
        assert d > 0.3
        assert d <= 1.0

    def test_bearish_basin_strongly_negative(self):
        def setter(v):
            v[7:15] = 0.1
        bear = _make_simplex_basin(setter)
        d = basin_direction(bear)
        assert d < -0.3
        assert d >= -1.0

    def test_symmetry_bull_and_bear_opposite_signs(self):
        bull = _make_simplex_basin(lambda v: v.__setitem__(slice(7, 15), 0.8))
        bear = _make_simplex_basin(lambda v: v.__setitem__(slice(7, 15), 0.2))
        d_bull = basin_direction(bull)
        d_bear = basin_direction(bear)
        assert d_bull > 0
        assert d_bear < 0
        assert abs(d_bull + d_bear) < 0.1  # symmetric

    def test_regression_uniform_does_not_return_minus_one(self):
        """Locks in the fix: pre-bug, uniform basin returned ≈ −1.0."""
        uniform = np.full(BASIN_DIM, 1 / BASIN_DIM)
        d = basin_direction(uniform)
        assert d > -0.5

    def test_regression_production_basin_shape_is_not_pegged(self):
        """Recreate the production basin shape that produced 21,458
        consecutive basinDir = −1.0 readings: dims 7..14 ≈ 0.020,
        rest near 1/64. Pre-fix this gave −1.0; post-fix it should
        read mildly positive (0.020 > 1/64 = 0.0156)."""
        v = np.full(BASIN_DIM, 0.0156)
        v[7:15] = 0.020
        v = v / v.sum()
        d = basin_direction(v)
        assert d > -0.5
        assert d > 0.0
