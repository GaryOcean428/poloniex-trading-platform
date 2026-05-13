"""Tests for mtf_l_classifier.py — Python port of mtfLClassifier.ts."""
from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.mtf_l_classifier import (  # noqa: E402
    DEFAULT_TIMEFRAMES,
    MTFDecision,
    TimeframeConfig,
    is_longest_horizon_expired,
    mtf_decide,
    new_mtf_state,
    on_tick_append,
    record_agreement_timestamps,
    set_bootstrap_history,
)
from monkey_kernel.agent_l_classifier import (  # noqa: E402
    DEFAULT_AGENT_L_CONFIG,
    AgentLDecision,
    LabelDistribution,
)


BASIN_DIM = 64


def _uniform_basin() -> np.ndarray:
    return np.full(BASIN_DIM, 1.0 / BASIN_DIM, dtype=np.float64)


# ── new_mtf_state ─────────────────────────────────────────────────


def test_new_state_initializes_empty():
    s = new_mtf_state()
    assert s.histories_by_tf["15m"] == []
    assert s.histories_by_tf["1h"] == []
    assert s.histories_by_tf["4h"] == []
    import math
    assert s.last_sample_tick_by_tf["15m"] == -math.inf
    assert s.last_agreement_by_tf_side["1h"]["long"] is None


# ── on_tick_append (down-sampling) ────────────────────────────────


class TestOnTickAppend:
    def test_first_tick_appends_to_all(self):
        s = new_mtf_state()
        on_tick_append(s, _uniform_basin(), 0)
        assert len(s.histories_by_tf["15m"]) == 1
        assert len(s.histories_by_tf["1h"]) == 1
        assert len(s.histories_by_tf["4h"]) == 1

    def test_15m_boundary_every_30_ticks(self):
        s = new_mtf_state()
        on_tick_append(s, _uniform_basin(), 0)
        on_tick_append(s, _uniform_basin(), 29)
        assert len(s.histories_by_tf["15m"]) == 1  # not yet
        on_tick_append(s, _uniform_basin(), 30)
        assert len(s.histories_by_tf["15m"]) == 2

    def test_1h_boundary_every_120_ticks(self):
        s = new_mtf_state()
        on_tick_append(s, _uniform_basin(), 0)
        on_tick_append(s, _uniform_basin(), 60)
        assert len(s.histories_by_tf["1h"]) == 1
        on_tick_append(s, _uniform_basin(), 120)
        assert len(s.histories_by_tf["1h"]) == 2

    def test_caps_at_max_samples(self):
        tfs = (
            TimeframeConfig(
                label="15m", ticks_per_sample=1, max_samples=3,
                config=DEFAULT_TIMEFRAMES[0].config,
            ),
        )
        s = new_mtf_state(tfs)
        for i in range(10):
            on_tick_append(s, _uniform_basin(), i, tfs)
        assert len(s.histories_by_tf["15m"]) == 3


# ── set_bootstrap_history ─────────────────────────────────────────


class TestSetBootstrapHistory:
    def test_replaces_history(self):
        s = new_mtf_state()
        bootstrap = [_uniform_basin() for _ in range(100)]
        set_bootstrap_history(s, "4h", bootstrap)
        assert len(s.histories_by_tf["4h"]) == 100

    def test_caps_at_max_samples(self):
        s = new_mtf_state()
        bootstrap = [_uniform_basin() for _ in range(3000)]
        set_bootstrap_history(s, "4h", bootstrap)
        assert len(s.histories_by_tf["4h"]) == 2000  # default cap


# ── mtf_decide ────────────────────────────────────────────────────


class TestMtfDecide:
    def test_no_warm_timeframes_holds(self):
        s = new_mtf_state()
        d = mtf_decide(s)
        assert d.action == "hold"
        assert d.agreement_count == 0
        assert d.size_multiplier == 0.0
        assert d.reason == "no_warm_timeframes"

    def test_reports_per_tf_warm_status(self):
        s = new_mtf_state()
        # 200 basins — insufficient for the warm threshold (min_tuple_start +
        # horizon = 480 + 120 = 600).
        for i in range(200):
            on_tick_append(s, _uniform_basin(), i * 30)
        d = mtf_decide(s)
        for entry in d.per_timeframe:
            assert entry.warm is False
            assert entry.decision is None


# ── per-TF horizon expiry ─────────────────────────────────────────


class TestHorizonExpiry:
    def test_no_agreement_recorded_returns_false(self):
        s = new_mtf_state()
        assert (
            is_longest_horizon_expired(s, "long", "1h", time.time() * 1000, 30_000)
            is False
        )

    def test_within_horizon_returns_false(self):
        tfs = (
            TimeframeConfig(
                label="1h", ticks_per_sample=1, max_samples=100,
                # horizon=60 → 1 * 1 * 30_000 = 30s; within 1s elapsed
                config=DEFAULT_AGENT_L_CONFIG,
            ),
        )
        s = new_mtf_state(tfs)
        s.last_agreement_by_tf_side["1h"]["long"] = time.time() * 1000 - 1_000
        assert (
            is_longest_horizon_expired(
                s, "long", "1h", time.time() * 1000, 30_000, tfs
            )
            is False
        )

    def test_horizon_exceeded_returns_true(self):
        from dataclasses import replace
        cfg = replace(DEFAULT_AGENT_L_CONFIG, horizon=1)
        tfs = (
            TimeframeConfig(
                label="15m", ticks_per_sample=1, max_samples=100,
                config=cfg,
            ),
        )
        s = new_mtf_state(tfs)
        s.last_agreement_by_tf_side["15m"]["long"] = time.time() * 1000 - 60_000
        # horizon = 1 * 1 * 30_000 = 30s; elapsed 60s > 30s → expired
        assert (
            is_longest_horizon_expired(
                s, "long", "15m", time.time() * 1000, 30_000, tfs
            )
            is True
        )


# ── record_agreement_timestamps ───────────────────────────────────


class TestRecordAgreementTimestamps:
    def test_does_nothing_on_hold(self):
        s = new_mtf_state()
        d = MTFDecision(
            action="hold", agreement_count=0, total_tfs=3, size_multiplier=0.0,
            per_timeframe=(), longest_agreeing_label=None, reason="t",
        )
        record_agreement_timestamps(s, d, time.time() * 1000)
        assert s.last_agreement_by_tf_side["15m"]["long"] is None

    def test_records_on_voting_tfs(self):
        from monkey_kernel.mtf_l_classifier import _PerTfDecision
        s = new_mtf_state()
        now = time.time() * 1000
        empty_ld = LabelDistribution(
            long=0, short=0, neutral=0,
            long_weight=0.0, short_weight=0.0,
            nearest_distance=0.0, farthest_distance=0.0,
        )
        dec_long = AgentLDecision(
            action="enter_long", signed_score=0.5, conviction=1.0,
            neighbors=(), label_distribution=empty_ld, reason="t",
        )
        dec_hold = AgentLDecision(
            action="hold", signed_score=0.0, conviction=0.0,
            neighbors=(), label_distribution=empty_ld, reason="t",
        )
        d = MTFDecision(
            action="enter_long", agreement_count=2, total_tfs=3, size_multiplier=0.5,
            per_timeframe=(
                _PerTfDecision(label="15m", warm=True, decision=dec_long),
                _PerTfDecision(label="1h", warm=True, decision=dec_long),
                _PerTfDecision(label="4h", warm=True, decision=dec_hold),
            ),
            longest_agreeing_label="1h", reason="t",
        )
        record_agreement_timestamps(s, d, now)
        assert s.last_agreement_by_tf_side["15m"]["long"] == now
        assert s.last_agreement_by_tf_side["1h"]["long"] == now
        assert s.last_agreement_by_tf_side["4h"]["long"] is None
        assert s.last_agreement_by_tf_side["15m"]["short"] is None
