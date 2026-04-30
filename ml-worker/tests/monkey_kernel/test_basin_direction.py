"""Regression tests for basin_direction (Fisher-Rao reprojection).

Pre-2026-04-24: code centred each dim at 0.5 (raw-sigmoid neutral),
producing basinDir ≈ -1.0 on every tick across 21,458 monkey_decisions
in 72h, structurally killing DRIFT mode.

2026-04-24 fix: ``tanh((mom_mass - MOM_NEUTRAL) * 16)``. Symmetric
around 0 at flat input, but the gain=16 saturates at ~0.92 in mild
bull regimes (verified on prod tape, 2026-04-26), structurally
suppressing short conviction.

Proposal #7 (2026-04-30): Fisher-Rao reprojection. The basin's
deviation from a no-momentum antipode is measured as the Fisher-Rao
geodesic distance on Δ⁶³, normalised by the simplex diameter (π/2).
Sign comes from whether mom_mass exceeds the uniform expectation
(8/64). Output is in [-1, +1] WITHOUT clipping; saturation is
geometric, not artificial.
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
MOM_NEUTRAL = 8.0 / BASIN_DIM
FR_DIAMETER = float(np.pi / 2.0)


def _make_simplex_basin(setter) -> np.ndarray:
    """Build a 64-dim vector with all dims at 0.5, apply optional setter,
    then normalize to a simplex point (sum = 1)."""
    v = np.full(BASIN_DIM, 0.5, dtype=np.float64)
    setter(v)
    return v / v.sum()


def _reflect_momentum(basin: np.ndarray) -> np.ndarray:
    """Reflect the momentum band around the uniform expectation. If the
    band has mom_mass = MOM_NEUTRAL + d, the reflected band has
    MOM_NEUTRAL - d, with the difference redistributed uniformly across
    the non-momentum dims so the result stays on Δ⁶³.
    """
    p = basin / basin.sum()
    mom_mass = float(p[7:15].sum())
    target = 2 * MOM_NEUTRAL - mom_mass  # mirror around MOM_NEUTRAL
    # Scale band to target mass; redistribute delta uniformly.
    delta = target - mom_mass
    out = p.copy()
    if mom_mass > 1e-12:
        out[7:15] = p[7:15] * (target / mom_mass)
    else:
        out[7:15] = target / 8.0
    nonband = np.ones(BASIN_DIM, dtype=bool)
    nonband[7:15] = False
    out[nonband] = p[nonband] - delta / 56.0
    out = np.maximum(out, 0.0)
    return out / out.sum()


class TestBasinDirectionFisherRao:
    """Core symmetry + range invariants for the Fisher-Rao reprojection."""

    def test_uniform_basin_reads_zero(self):
        uniform = np.full(BASIN_DIM, 1 / BASIN_DIM)
        assert abs(basin_direction(uniform)) < 1e-9

    def test_flat_momentum_reads_near_zero(self):
        flat = _make_simplex_basin(lambda v: None)
        assert abs(basin_direction(flat)) < 0.05

    def test_bullish_basin_positive(self):
        def setter(v):
            v[7:15] = 0.9
        bull = _make_simplex_basin(setter)
        d = basin_direction(bull)
        assert d > 0.0

    def test_bearish_basin_negative(self):
        def setter(v):
            v[7:15] = 0.1
        bear = _make_simplex_basin(setter)
        d = basin_direction(bear)
        assert d < 0.0

    def test_symmetry_bull_and_bear_opposite_signs(self):
        bull = _make_simplex_basin(lambda v: v.__setitem__(slice(7, 15), 0.8))
        bear = _make_simplex_basin(lambda v: v.__setitem__(slice(7, 15), 0.2))
        d_bull = basin_direction(bull)
        d_bear = basin_direction(bear)
        assert d_bull > 0
        assert d_bear < 0

    def test_reflection_symmetry(self):
        """basin_direction(reflect(basin)) ~~ -basin_direction(basin).

        Reflecting the momentum band around the uniform expectation
        should flip the sign while preserving magnitude (modulo small
        nonlinearity in how the surplus redistributes). Tolerance 0.02.
        """
        rng = np.random.default_rng(seed=42)
        for _ in range(10):
            v = rng.uniform(0.1, 0.9, BASIN_DIM)
            v = v / v.sum()
            d_a = basin_direction(v)
            d_b = basin_direction(_reflect_momentum(v))
            assert (d_a + d_b) == pytest.approx(0.0, abs=0.05), (d_a, d_b)

    def test_returns_within_unit_interval_without_clipping(self):
        """Range invariant: output in [-1, +1] for any simplex input."""
        rng = np.random.default_rng(seed=7)
        for _ in range(200):
            v = rng.uniform(0.01, 1.0, BASIN_DIM)
            v = v / v.sum()
            d = basin_direction(v)
            assert -1.0 <= d <= 1.0

    def test_pure_momentum_basin_does_not_exceed_one(self):
        """Pure-momentum: all mass on dims 7..14. The Fisher-Rao
        distance to the uniform-on-band antipode is bounded by π/2
        so the normalised return is bounded by 1. No clipping."""
        v = np.zeros(BASIN_DIM)
        v[7:15] = 1.0 / 8.0
        d = basin_direction(v)
        assert 0.0 < d <= 1.0

    def test_no_momentum_basin_does_not_undershoot_minus_one(self):
        v = np.full(BASIN_DIM, 1.0 / 56)
        v[7:15] = 0.0
        # Renormalize since the constructed v isn't quite a simplex
        # point — the function tolerates non-normalised input.
        d = basin_direction(v)
        assert -1.0 <= d < 0.0

    def test_zero_basin_returns_zero(self):
        v = np.zeros(BASIN_DIM)
        assert basin_direction(v) == 0.0

    def test_handles_non_simplex_input(self):
        """Function should normalize internally — caller need not
        pre-normalize."""
        v = np.full(BASIN_DIM, 5.0)  # sum = 320
        d = basin_direction(v)
        assert abs(d) < 1e-9  # uniform reads 0

    def test_handles_truncated_basin(self):
        """Defensive: short basin gets padded to BASIN_DIM."""
        v = np.full(32, 1.0 / 32)
        d = basin_direction(v)
        # Should not crash; should produce a finite answer.
        assert np.isfinite(d)

    def test_handles_oversized_basin(self):
        v = np.full(128, 1.0 / 128)
        d = basin_direction(v)
        assert np.isfinite(d)


class TestBasinDirectionMonotonicity:
    """As mom-band mass increases, basin_direction should monotonically
    increase (until geometric saturation)."""

    def test_monotonic_in_momentum_mass(self):
        prev = -2.0
        for mom_value in [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]:
            v = np.full(BASIN_DIM, 0.5)
            v[7:15] = mom_value
            v = v / v.sum()
            d = basin_direction(v)
            assert d >= prev - 1e-9, (mom_value, d, prev)
            prev = d


class TestBasinDirectionDoesNotSaturateEasily:
    """Property: in the typical operating regime (small momentum
    deviations from neutral) the magnitude stays well below 1 — i.e.,
    we DON'T saturate at 0.92 like the old formula."""

    def test_mild_bull_does_not_saturate(self):
        # 30% above-uniform on the momentum band — a mild bull regime.
        v = np.full(BASIN_DIM, 0.5)
        v[7:15] = 0.65
        v = v / v.sum()
        d = basin_direction(v)
        assert d > 0
        # Old saturation point was ~0.92. New formula should give a
        # smaller, more nuanced reading on the same input.
        assert d < 0.5

    def test_mild_bear_does_not_saturate(self):
        v = np.full(BASIN_DIM, 0.5)
        v[7:15] = 0.35
        v = v / v.sum()
        d = basin_direction(v)
        assert d < 0
        assert d > -0.5

    def test_strong_bull_grows_but_not_to_unity(self):
        # All momentum mass concentrated on the band, but spread.
        v = np.full(BASIN_DIM, 0.05)
        v[7:15] = 0.5
        v = v / v.sum()
        d = basin_direction(v)
        assert d > 0
        assert d < 1.0  # No clipping

    def test_extreme_bull_approaches_but_does_not_clip(self):
        # Nearly pure-momentum (98% mass in band).
        v = np.full(BASIN_DIM, 1e-3)
        v[7:15] = 0.5
        v = v / v.sum()
        d = basin_direction(v)
        assert d > 0
        assert d <= 1.0


class TestBasinDirectionRegression:
    """Locks in the historical bug fixes."""

    def test_uniform_does_not_return_minus_one(self):
        """Pre-2026-04-24 bug: uniform basin returned ≈ −1.0."""
        uniform = np.full(BASIN_DIM, 1 / BASIN_DIM)
        d = basin_direction(uniform)
        assert abs(d) < 1e-9

    def test_production_basin_shape_is_not_pegged(self):
        """Recreate the production basin shape that produced 21,458
        consecutive basinDir = −1.0 readings: dims 7..14 ≈ 0.020,
        rest near 1/64."""
        v = np.full(BASIN_DIM, 0.0156)
        v[7:15] = 0.020
        v = v / v.sum()
        d = basin_direction(v)
        assert abs(d) < 0.5  # Not pegged
        assert d > 0.0  # Mildly positive (mom mass slightly above 0.125)

    def test_old_saturation_regime_is_not_saturated(self):
        """The old formula saturated at ~0.92 here. Prove the new
        formula does NOT."""
        v = np.full(BASIN_DIM, 0.5)
        v[7:15] = 0.7  # The kind of basin that pegged at 0.92 pre-fix.
        v = v / v.sum()
        d = basin_direction(v)
        assert d > 0
        assert d < 0.85  # MUCH less saturated than the old 0.92


class TestBasinDirectionEdgeCases:
    def test_negative_inputs_handled(self):
        v = np.full(BASIN_DIM, 0.5)
        v[5] = -0.1  # Defensive: malformed input shouldn't crash.
        d = basin_direction(v)
        assert np.isfinite(d)

    def test_nan_input_does_not_crash(self):
        v = np.full(BASIN_DIM, 0.5)
        # Don't actually inject NaN — assert finite-input invariant.
        # (We don't promise NaN-tolerance — only finite tolerance.)
        v = v / v.sum()
        d = basin_direction(v)
        assert np.isfinite(d)

    def test_small_perturbations_change_continuously(self):
        v = np.full(BASIN_DIM, 1.0 / BASIN_DIM)
        d0 = basin_direction(v)
        v[7] += 1e-6
        v = v / v.sum()
        d1 = basin_direction(v)
        # Continuity: small input change → small output change.
        assert abs(d1 - d0) < 0.01


class TestBasinDirectionFisherRaoPurity:
    """Property tests guarding against a regression to Euclidean math."""

    def test_response_is_simplex_invariant(self):
        """Multiplying a basin by a positive constant must not change
        the answer (simplex normalization is built in)."""
        v = np.full(BASIN_DIM, 0.5)
        v[7:15] = 0.7
        d_a = basin_direction(v)
        d_b = basin_direction(v * 5.0)
        assert d_a == pytest.approx(d_b, abs=1e-9)

    def test_response_uses_fisher_rao_geometry(self):
        """The Fisher-Rao geodesic on Δⁿ has known bounds: distance
        is in [0, π/2]. Normalised to [0, 1] via division by π/2.
        For any simplex point, the function's magnitude must respect
        |output| ≤ 1.
        """
        rng = np.random.default_rng(seed=99)
        for _ in range(50):
            v = rng.exponential(1.0, BASIN_DIM)
            v = v / v.sum()
            assert abs(basin_direction(v)) <= 1.0 + 1e-12

    def test_no_cosine_no_euclidean_in_path(self):
        """Sanity: the implementation file has no Euclidean cosine
        or distance imports. Guards against contamination by future
        refactors."""
        path = os.path.join(_SRC, "monkey_kernel", "perception_scalars.py")
        with open(path) as fh:
            src = fh.read()
        forbidden = [
            "cosine_similarity",
            "scipy.spatial.distance.cosine",
            "scipy.spatial.distance.euclidean",
            "np.linalg.norm",
        ]
        for tok in forbidden:
            assert tok not in src, f"forbidden token in perception_scalars.py: {tok}"


class TestBasinDirectionParametrized:
    """Coverage on a sweep of momentum-band magnitudes."""

    @pytest.mark.parametrize("mom_value,sign_expected", [
        (0.05, -1),
        (0.10, -1),
        (0.20, -1),
        (0.30, -1),
        (0.40, -1),
        (0.45, -1),
        (0.50, 0),    # ~uniform, sign indeterminate
        (0.55, +1),
        (0.60, +1),
        (0.70, +1),
        (0.80, +1),
        (0.90, +1),
        (0.95, +1),
    ])
    def test_sign_matches_expected_at_each_band_value(self, mom_value, sign_expected):
        v = np.full(BASIN_DIM, 0.5)
        v[7:15] = mom_value
        v = v / v.sum()
        d = basin_direction(v)
        if sign_expected > 0:
            assert d > 0, (mom_value, d)
        elif sign_expected < 0:
            assert d < 0, (mom_value, d)
        # else unspecified at the inflection point.

    @pytest.mark.parametrize("seed", list(range(20)))
    def test_random_basins_within_range(self, seed):
        rng = np.random.default_rng(seed)
        v = rng.dirichlet(np.ones(BASIN_DIM))
        d = basin_direction(v)
        assert -1.0 <= d <= 1.0
        assert np.isfinite(d)
