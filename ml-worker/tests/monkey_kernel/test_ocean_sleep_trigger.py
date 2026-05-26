"""test_ocean_sleep_trigger.py — Matrix tier-4 Phase C Python parity.

Mirrors apps/api/src/services/monkey/__tests__/oceanSleepTrigger.test.ts.
The numeric contracts (95th percentile, Tukey 3·IQR, ddof=1 variance)
MUST match TS bit-for-bit on the same inputs.
"""
from __future__ import annotations

import math
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.ocean_sleep_trigger import (  # noqa: E402
    doctrine_sleep_trigger,
    fluctuation_overrun,
    quantile,
    rolling_phi_variance,
    sovereignty_saturated,
)


# ─── quantile (Hyndman-Fan type 7) ────────────────────────────


def test_quantile_length_1():
    assert quantile([5], 0.95) == 5


def test_quantile_empty():
    assert quantile([], 0.5) == 0


def test_quantile_median():
    assert quantile([1, 2, 3, 4, 5], 0.5) == 3


def test_quantile_interpolation():
    assert quantile([1, 2, 3, 4, 5], 0.25) == 2
    xs = list(range(1, 101))
    assert math.isclose(quantile(xs, 0.95), 95.05, abs_tol=1e-6)


# ─── rolling_phi_variance ──────────────────────────────────────


def test_rolling_var_below_2_samples():
    assert rolling_phi_variance([]) == 0
    assert rolling_phi_variance([0.5]) == 0


def test_rolling_var_2_samples_ddof_1():
    assert math.isclose(rolling_phi_variance([0, 1]), 0.5, rel_tol=1e-10)


def test_rolling_var_uses_last_window():
    early_outlier = [100] * 5
    recent = [0.5] * 30
    assert math.isclose(rolling_phi_variance(early_outlier + recent, 30), 0, abs_tol=1e-6)


# ─── sovereignty_saturated ─────────────────────────────────────


def test_sovereignty_cold_start_false():
    assert sovereignty_saturated(0.99, [0.1, 0.2, 0.3]) is False


def test_sovereignty_non_finite_false():
    hist = [0.5] * 50
    assert sovereignty_saturated(float("nan"), hist) is False
    assert sovereignty_saturated(float("inf"), hist) is False


def test_sovereignty_at_95th_percentile_true():
    hist = [(i / 49) * 0.5 for i in range(50)]
    assert sovereignty_saturated(0.49, hist) is True
    assert sovereignty_saturated(0.5, hist) is True


def test_sovereignty_below_95th_percentile_false():
    hist = [(i / 49) * 0.5 for i in range(50)]
    assert sovereignty_saturated(0.2, hist) is False
    assert sovereignty_saturated(0.4, hist) is False


# ─── fluctuation_overrun ───────────────────────────────────────


def test_fluctuation_cold_start_baseline_false():
    phi_hist = [0.5] * 30
    assert fluctuation_overrun(phi_hist, [0.01, 0.02, 0.03]) is False


def test_fluctuation_phi_history_too_short_false():
    long_baseline = [0.01] * 50
    assert fluctuation_overrun([], long_baseline) is False
    assert fluctuation_overrun([0.5], long_baseline) is False


def test_fluctuation_steady_state_false():
    phi_hist = [0.5 + (0.05 if i % 2 == 0 else -0.05) for i in range(30)]
    baseline = [0.005 + i * 1e-6 for i in range(50)]
    assert fluctuation_overrun(phi_hist, baseline) is False


def test_fluctuation_outer_fence_breach_true():
    wild_phi = [0.0 if i % 2 == 0 else 1.0 for i in range(30)]  # var ≈ 0.258
    tight_baseline = [0.001 + i * 1e-6 for i in range(50)]
    assert fluctuation_overrun(wild_phi, tight_baseline) is True


def test_fluctuation_degenerate_baseline_iqr_zero_false():
    phi_hist = [0 if i % 2 == 0 else 1 for i in range(30)]
    flat_baseline = [0.5] * 50  # IQR = 0
    assert fluctuation_overrun(phi_hist, flat_baseline) is False


# ─── doctrine_sleep_trigger — combined gate ────────────────────


def test_doctrine_neither_predicate_false():
    r = doctrine_sleep_trigger(
        sovereignty_now=0.1,
        sovereignty_history=[i / 49 for i in range(50)],
        phi_history=[0.5] * 30,
        phi_variance_history=[0.005] * 50,
    )
    assert r["should_sleep"] is False
    assert r["sovereignty_saturated"] is False
    assert r["fluctuation_overrun"] is False


def test_doctrine_only_sovereignty_saturates_false():
    r = doctrine_sleep_trigger(
        sovereignty_now=0.99,
        sovereignty_history=[i / 49 for i in range(50)],
        phi_history=[0.5] * 30,
        phi_variance_history=[0.005] * 50,
    )
    assert r["should_sleep"] is False
    assert r["sovereignty_saturated"] is True
    assert r["fluctuation_overrun"] is False


def test_doctrine_only_fluctuation_overruns_false():
    wild_phi = [0 if i % 2 == 0 else 1 for i in range(30)]
    r = doctrine_sleep_trigger(
        sovereignty_now=0.1,
        sovereignty_history=[i / 49 for i in range(50)],
        phi_history=wild_phi,
        phi_variance_history=[0.001 + i * 1e-6 for i in range(50)],
    )
    assert r["should_sleep"] is False
    assert r["sovereignty_saturated"] is False
    assert r["fluctuation_overrun"] is True


def test_doctrine_both_fire_sleeps():
    wild_phi = [0 if i % 2 == 0 else 1 for i in range(30)]
    r = doctrine_sleep_trigger(
        sovereignty_now=0.99,
        sovereignty_history=[i / 49 for i in range(50)],
        phi_history=wild_phi,
        phi_variance_history=[0.001 + i * 1e-6 for i in range(50)],
    )
    assert r["should_sleep"] is True
    assert r["sovereignty_saturated"] is True
    assert r["fluctuation_overrun"] is True


def test_doctrine_cold_start_safety():
    r = doctrine_sleep_trigger(
        sovereignty_now=0.99,
        sovereignty_history=[0.1, 0.5, 0.9, 0.95, 0.99],
        phi_history=[0, 1, 0, 1, 0],
        phi_variance_history=[0.01, 0.02, 0.03],
    )
    assert r["should_sleep"] is False
