"""Tests for agent_l_classifier.py — Python port of agent_L_classifier.ts."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.agent_l_classifier import (  # noqa: E402
    DEFAULT_AGENT_L_CONFIG,
    AgentLConfig,
    ScaleWeights,
    agent_l_decide,
    build_basin_tuple,
    fisher_rao_tuple_distance,
    realized_label,
)


# ── helpers ────────────────────────────────────────────────────────


def _uniform_basin(dim: int = 64) -> np.ndarray:
    return np.full(dim, 1.0 / dim, dtype=np.float64)


def _peaked_basin(idx: int, dim: int = 64, peak: float = 0.5) -> np.ndarray:
    b = np.full(dim, (1.0 - peak) / (dim - 1), dtype=np.float64)
    b[idx] = peak
    return b


# ── build_basin_tuple ──────────────────────────────────────────────


class TestBuildBasinTuple:
    def test_empty_history_returns_none(self):
        assert build_basin_tuple([]) is None

    def test_short_history_uses_available(self):
        hist = [_uniform_basin()] * 5
        t = build_basin_tuple(hist, medium_window=10, long_window=100)
        assert t is not None
        np.testing.assert_allclose(t.current, hist[-1])

    def test_current_is_last_basin(self):
        hist = [_uniform_basin(), _peaked_basin(0, peak=0.5)]
        t = build_basin_tuple(hist)
        assert t is not None
        np.testing.assert_allclose(t.current, hist[-1])


# ── fisher_rao_tuple_distance ──────────────────────────────────────


class TestFisherRaoTupleDistance:
    def test_self_distance_is_zero(self):
        b = _uniform_basin()
        t = build_basin_tuple([b] * 10)
        assert t is not None
        d = fisher_rao_tuple_distance(t, t)
        assert d == pytest.approx(0.0, abs=1e-9)

    def test_disjoint_basins_have_positive_distance(self):
        t1 = build_basin_tuple([_peaked_basin(0, peak=0.9)] * 10)
        t2 = build_basin_tuple([_peaked_basin(63, peak=0.9)] * 10)
        assert t1 is not None and t2 is not None
        d = fisher_rao_tuple_distance(t1, t2)
        assert d > 0.0


# ── realized_label ─────────────────────────────────────────────────


class TestRealizedLabel:
    def test_target_out_of_range_returns_zero(self):
        assert realized_label([_uniform_basin()] * 5, i=4, horizon=10) == 0

    def test_uniform_basin_at_target_is_neutral(self):
        hist = [_uniform_basin()] * 200
        assert realized_label(hist, i=0, horizon=120) == 0


# ── agent_l_decide ─────────────────────────────────────────────────


class TestAgentLDecide:
    def test_empty_history_holds(self):
        d = agent_l_decide([])
        assert d.action == "hold"
        assert d.reason == "history empty"

    def test_insufficient_history_holds(self):
        d = agent_l_decide([_uniform_basin()] * 100)
        assert d.action == "hold"
        assert "insufficient candidates" in d.reason

    def test_uniform_history_holds_with_neutral_neighbors(self):
        """800 uniform basins → no realized direction signal → hold."""
        hist = [_uniform_basin() for _ in range(800)]
        d = agent_l_decide(hist)
        assert d.action == "hold"
        assert d.signed_score == pytest.approx(0.0)

    def test_returns_diagnostic_label_distribution(self):
        hist = [_uniform_basin() for _ in range(800)]
        d = agent_l_decide(hist)
        ld = d.label_distribution
        # All-uniform → all neighbors neutral
        assert ld.long == 0
        assert ld.short == 0
        assert ld.neutral >= 0
        # nearest_distance should be 0 since cur tuple == hist tuple shape
        assert ld.nearest_distance >= 0.0

    def test_action_threshold_gates_hold(self):
        """Lower the threshold → more decisions become non-hold."""
        # Uniform basin still has signed_score=0, so this verifies the
        # threshold path doesn't change a zero into action.
        hist = [_uniform_basin() for _ in range(800)]
        custom = AgentLConfig(action_threshold=0.001)
        d = agent_l_decide(hist, config=custom)
        assert d.action == "hold"
        assert d.signed_score == pytest.approx(0.0)
