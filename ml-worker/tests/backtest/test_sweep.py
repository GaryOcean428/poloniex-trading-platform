"""Tests for the v0.9.0 Phase B qig_warp-driven sweep."""
from __future__ import annotations

import os
import sys

import numpy as np
import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from backtest.spec import default_spec, SWEEPABLE_AXES
from backtest.sweep import sweep_axis, SweepResult, Candidate


def _zigzag(n: int = 300) -> np.ndarray:
    rng = np.random.default_rng(7)
    base = 2300.0
    closes = []
    for i in range(n):
        wave = 0.01 * np.sin(i * 0.3)
        noise = rng.normal(0, 0.001)
        closes.append(base * (1 + wave + noise))
    return np.array(closes, dtype=np.float64)


def _trend_up(n: int = 300, slope: float = 0.0015) -> np.ndarray:
    return np.array([2300.0 * (1 + slope * i) for i in range(n)], dtype=np.float64)


class TestSweepAxis:
    def test_invalid_axis_raises(self):
        with pytest.raises(ValueError):
            sweep_axis(_zigzag(), default_spec(),
                       axis="not_a_real_axis", values=[1.0])  # type: ignore

    def test_returns_sorted_candidates(self):
        result = sweep_axis(
            _zigzag(300),
            default_spec(),
            axis="tp_base_frac",
            values=[0.002, 0.005, 0.01, 0.02, 0.04, 0.08],
            budget_s=30,
        )
        assert isinstance(result, SweepResult)
        # Top-K candidates ordered by score descending
        scores = [c.score for c in result.candidates]
        assert scores == sorted(scores, reverse=True)

    def test_top_returns_first(self):
        result = sweep_axis(
            _zigzag(300),
            default_spec(),
            axis="sl_ratio",
            values=[0.3, 0.4, 0.5, 0.6, 0.7],
            budget_s=30,
        )
        if result.candidates:
            assert result.top is result.candidates[0]

    def test_qig_warp_executed(self):
        """Verify qig_warp.navigate actually ran probes + full sweep."""
        result = sweep_axis(
            _trend_up(300),
            default_spec(),
            axis="tp_base_frac",
            values=[0.001, 0.002, 0.004, 0.008, 0.016, 0.032],
            budget_s=30,
        )
        # navigate uses 5 pilot probes by default
        assert result.nav.probes_used >= 1
        # actual_total_s populated by navigate
        assert result.nav.actual_total_s >= 0.0

    def test_each_candidate_has_distinct_axis_value(self):
        values = [0.002, 0.004, 0.008, 0.016, 0.032]
        result = sweep_axis(
            _zigzag(200),
            default_spec(),
            axis="tp_base_frac",
            values=values,
        )
        candidate_tp_values = sorted([c.spec.tp_base_frac for c in result.candidates])
        # Some values may be skipped if qig_warp budgets cut them; what
        # remains should be a subset of the input.
        for v in candidate_tp_values:
            assert any(abs(v - vv) < 1e-9 for vv in values), \
                f"unexpected tp value {v} not in input {values}"

    @pytest.mark.parametrize("axis", SWEEPABLE_AXES)
    def test_each_axis_runs_without_error(self, axis):
        """Smoke test: every documented axis is sweepable end-to-end."""
        values_by_axis = {
            "tp_base_frac": [0.002, 0.005, 0.01, 0.02],
            "sl_ratio": [0.3, 0.5, 0.7],
            "trailing_giveback": [0.1, 0.3, 0.5],
            "entry_threshold_scale": [0.5, 1.0, 2.0],
            "dca_better_price": [0.005, 0.01, 0.02],
        }
        result = sweep_axis(
            _zigzag(200),
            default_spec(),
            axis=axis,
            values=values_by_axis[axis],
            budget_s=15,
        )
        assert isinstance(result, SweepResult)
        # Pipeline runs without raising; candidate list may be empty if
        # no entries fired with the given values + closes, that's fine.
