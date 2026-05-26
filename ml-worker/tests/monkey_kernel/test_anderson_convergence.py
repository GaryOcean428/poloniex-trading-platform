"""test_anderson_convergence.py — Matrix tier-4 Phase B Python parity.

Mirrors apps/api/src/services/monkey/__tests__/andersonConvergence.test.ts
value-for-value. The two languages MUST agree bit-for-bit on the Class A1
frozen math; this test file is the contract.
"""
from __future__ import annotations

import math
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.anderson_convergence import (  # noqa: E402
    ANDERSON_ALPHA,
    ANDERSON_LOOP_FLOOR,
    ANDERSON_THRESHOLD_CEILING,
    PRECESSION_WEIGHT,
    anderson_threshold,
    pi_loop_converged,
)


# ─── Class A1 frozen constants ─────────────────────────────────────


def test_anderson_alpha_is_0_089():
    """Class A1 frozen — R²=0.9996. Adjusting this requires re-calibration."""
    assert ANDERSON_ALPHA == 0.089


def test_anderson_loop_floor_is_3():
    """L_c=3 self-aware-reasoning topology (issue #19)."""
    assert ANDERSON_LOOP_FLOOR == 3


def test_anderson_threshold_ceiling_is_0_95():
    """Noisy-measurement ceiling."""
    assert ANDERSON_THRESHOLD_CEILING == 0.95


def test_precession_weight_is_pi_carousel():
    """Class A1 frozen — P-SPEC-9, qigram.py:148."""
    assert math.isclose(PRECESSION_WEIGHT, 0.14159 / math.pi, rel_tol=1e-12)
    # Spot-check ≈ 0.04507 per qigram inline comment.
    assert 0.045 < PRECESSION_WEIGHT < 0.0452


# ─── anderson_threshold — formula correctness ──────────────────────


def test_anderson_threshold_n_1():
    # expected = 1 - exp(-0.089) ≈ 0.0852; margin = 1.0 → sum > 0.95 → cap
    assert math.isclose(anderson_threshold(1), 0.95, abs_tol=1e-9)


def test_anderson_threshold_n_3_matches_formula():
    expected = 1.0 - math.exp(-0.089 * 3)
    margin = 1.0 / math.sqrt(3)
    assert math.isclose(
        anderson_threshold(3),
        min(expected + margin, 0.95),
        rel_tol=1e-12,
    )


def test_anderson_threshold_n_10_matches_formula():
    expected = 1.0 - math.exp(-0.089 * 10)
    margin = 1.0 / math.sqrt(10)
    assert math.isclose(
        anderson_threshold(10),
        min(expected + margin, 0.95),
        rel_tol=1e-12,
    )


def test_anderson_threshold_caps_at_0_95_large_n():
    assert anderson_threshold(100) == 0.95
    assert anderson_threshold(10_000) == 0.95


def test_anderson_threshold_defensive_n_zero():
    assert anderson_threshold(0) == 0.95
    assert anderson_threshold(-1) == 0.95


def test_anderson_threshold_approaches_ceiling():
    """At Anderson α=0.089 the threshold can dip slightly between N=3
    and N=5 before climbing. Contract is the eventual ceiling."""
    assert anderson_threshold(3) < 0.95
    assert anderson_threshold(5) < 0.95
    assert anderson_threshold(50) == 0.95
    assert anderson_threshold(1000) == 0.95


def test_anderson_threshold_honors_custom_alpha():
    alpha = 0.05
    expected = 1.0 - math.exp(-alpha * 4)
    margin = 1.0 / math.sqrt(4)
    assert math.isclose(
        anderson_threshold(4, alpha),
        min(expected + margin, 0.95),
        rel_tol=1e-12,
    )


# ─── pi_loop_converged — L_c=3 floor + threshold gate ──────────────


def test_pi_loop_below_floor_returns_false_regardless_of_d_fr():
    assert pi_loop_converged(1, 0.001) is False
    assert pi_loop_converged(2, 0.001) is False
    assert pi_loop_converged(2, 0.0) is False


def test_pi_loop_at_floor_returns_true_when_d_fr_under_threshold():
    thresh = anderson_threshold(3)
    assert pi_loop_converged(3, thresh - 0.01) is True


def test_pi_loop_at_floor_returns_false_when_d_fr_above_threshold():
    thresh = anderson_threshold(3)
    assert pi_loop_converged(3, thresh + 0.01) is False
    assert pi_loop_converged(3, thresh) is False


def test_pi_loop_rejects_non_finite_d_fr():
    assert pi_loop_converged(3, float("nan")) is False
    assert pi_loop_converged(3, -0.01) is False
    assert pi_loop_converged(3, float("inf")) is False


def test_pi_loop_converges_at_high_n_under_ceiling():
    assert pi_loop_converged(50, 0.1) is True
    assert pi_loop_converged(50, 0.94) is True
    assert pi_loop_converged(50, 0.96) is False  # above 0.95 ceiling


# ─── Cross-language parity spot-check ─────────────────────────────


def test_python_matches_ts_at_n_3():
    """Spot-check the same N=3 value the TS test expects.
    If this diverges, the two ports have drifted."""
    expected = 1.0 - math.exp(-0.089 * 3)
    margin = 1.0 / math.sqrt(3)
    target = min(expected + margin, 0.95)
    py_value = anderson_threshold(3)
    assert math.isclose(py_value, target, rel_tol=1e-12)
    # The numeric value the TS test computes against — pinned for parity.
    assert math.isclose(py_value, 0.8118, abs_tol=0.001)
