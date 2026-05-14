"""Tests for regime_sizing.py — Python port of regimeSizing.ts (PRs #667,#672)."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.regime_sizing import (  # noqa: E402
    DEFAULT_REGIME_CONFIG,
    DEFAULT_SIZING_CONFIG,
    RegimeConfig,
    basin_alignment_to_window,
    compute_regime_sizing,
    regime_score,
    trailing_regime_stop,
)


# ── helpers ────────────────────────────────────────────────────────


def _uniform_basin(dim: int = 64) -> np.ndarray:
    """Uniform Δⁿ basin — max entropy, zero direction, zero velocity vs self."""
    return np.full(dim, 1.0 / dim, dtype=np.float64)


def _peaked_basin(idx: int, dim: int = 64, peak: float = 0.5) -> np.ndarray:
    """Basin with most mass on one coordinate. Used to drive direction."""
    b = np.full(dim, (1.0 - peak) / (dim - 1), dtype=np.float64)
    b[idx] = peak
    return b


# ── regime_score ───────────────────────────────────────────────────


class TestRegimeScore:
    def test_returns_none_on_insufficient_history(self):
        assert regime_score([], 64.0) is None
        assert regime_score([_uniform_basin()], 64.0) is None

    def test_uniform_history_at_critical_kappa_is_max_flat(self):
        """60 identical uniform basins, kappa at critical: r = 1.0."""
        result = regime_score([_uniform_basin()] * 60, kappa=64.0)
        assert result is not None
        assert result.r == pytest.approx(1.0)
        assert result.label == "flat"
        assert result.components.velocity_flatness == pytest.approx(1.0)
        # Uniform basin has direction=0; persistence=0; chop=1.
        assert result.components.directional_chop == pytest.approx(1.0)
        assert result.components.kappa_criticality == pytest.approx(1.0)

    def test_kappa_none_falls_back_to_neutral_component(self):
        result = regime_score([_uniform_basin()] * 30, kappa=None)
        assert result is not None
        assert result.components.kappa_criticality == 0.5

    def test_kappa_far_from_critical_drives_score_down(self):
        """Same OHLCV-side inputs but kappa far from critical -> lower r."""
        near = regime_score([_uniform_basin()] * 30, kappa=64.0)
        far = regime_score([_uniform_basin()] * 30, kappa=200.0)
        assert near is not None and far is not None
        assert near.r > far.r
        assert near.components.kappa_criticality > far.components.kappa_criticality

    def test_label_thresholds(self):
        """flat_at=0.65, trend_at=0.35 — verify cutoffs (default config)."""
        config = DEFAULT_REGIME_CONFIG
        # Hand-craft components by abusing kappa: at kappa_critical -> flat
        # comp = 1.0; weight is 0.2 of total. Combined with velocity 1, dir 1
        # -> r ~= 1.0.
        result = regime_score([_uniform_basin()] * 30, kappa=64.0, config=config)
        assert result is not None
        assert result.r >= config.flat_at
        assert result.label == "flat"


# ── compute_regime_sizing ──────────────────────────────────────────


class TestComputeRegimeSizing:
    def test_r_one_is_full_flat(self):
        s = compute_regime_sizing(1.0)
        assert s.leverage == DEFAULT_SIZING_CONFIG.flat_leverage  # 50
        assert s.hold_ms == DEFAULT_SIZING_CONFIG.flat_hold_ms  # 10 min
        assert s.stop_bps == DEFAULT_SIZING_CONFIG.flat_stop_bps  # 30
        assert s.size_fraction == pytest.approx(DEFAULT_SIZING_CONFIG.flat_size_fraction)
        assert s.margin_headroom_floor == pytest.approx(
            DEFAULT_SIZING_CONFIG.flat_headroom_floor
        )

    def test_r_zero_is_full_trend(self):
        s = compute_regime_sizing(0.0)
        assert s.leverage == DEFAULT_SIZING_CONFIG.trend_leverage  # 8
        assert s.hold_ms == DEFAULT_SIZING_CONFIG.trend_hold_ms  # 4 h
        assert s.stop_bps == DEFAULT_SIZING_CONFIG.trend_stop_bps  # 150
        assert s.size_fraction == pytest.approx(DEFAULT_SIZING_CONFIG.trend_size_fraction)

    def test_r_half_is_midpoint(self):
        s = compute_regime_sizing(0.5)
        # leverage_at_0.5 = 8 + (50 - 8) * 0.5 = 29
        assert s.leverage == 29
        # stop_bps midpoint = (30 + 150) / 2 = 90
        assert s.stop_bps == pytest.approx(90.0)

    def test_continuous_monotonic_leverage(self):
        """Leverage non-strictly increasing in r — flat has higher leverage."""
        prev = compute_regime_sizing(0.0).leverage
        for r_pct in range(0, 11):
            r = r_pct / 10.0
            cur = compute_regime_sizing(r).leverage
            assert cur >= prev
            prev = cur

    def test_clamps_r_outside_unit_range(self):
        """Out-of-range r values are clamped; no crash, no NaN."""
        s_neg = compute_regime_sizing(-1.0)
        s_over = compute_regime_sizing(2.0)
        # r=-1 clamps to 0 -> trend params; r=2 clamps to 1 -> flat params
        assert s_neg.leverage == DEFAULT_SIZING_CONFIG.trend_leverage
        assert s_over.leverage == DEFAULT_SIZING_CONFIG.flat_leverage


# ── trailing_regime_stop ───────────────────────────────────────────


class TestTrailingRegimeStop:
    def test_within_delta_returns_false(self):
        assert trailing_regime_stop(0.8, 0.6, adverse_delta=0.30) is False
        # Exactly at delta is also False (strict gt).
        assert trailing_regime_stop(0.8, 0.50001, adverse_delta=0.30) is False

    def test_beyond_delta_returns_true(self):
        assert trailing_regime_stop(0.8, 0.45, adverse_delta=0.30) is True
        # Symmetric: regime rising past delta also fires.
        assert trailing_regime_stop(0.3, 0.65, adverse_delta=0.30) is True

    def test_default_delta_is_0_3(self):
        assert trailing_regime_stop(0.8, 0.45) is True
        assert trailing_regime_stop(0.8, 0.55) is False


# ── basin_alignment_to_window ──────────────────────────────────────


class TestBasinAlignmentToWindow:
    def test_empty_window_returns_zero(self):
        assert basin_alignment_to_window(_uniform_basin(), []) == 0.0

    def test_aligned_basin_has_low_distance(self):
        """Same basin as the window mean -> FR distance near 0."""
        b = _uniform_basin()
        d = basin_alignment_to_window(b, [b] * 10)
        assert d == pytest.approx(0.0, abs=1e-6)

    def test_outlier_basin_has_high_distance(self):
        """Peaked basin vs uniform mean -> non-zero FR distance."""
        window = [_uniform_basin()] * 10
        outlier = _peaked_basin(0, peak=0.9)
        d = basin_alignment_to_window(outlier, window)
        assert d > 0.0
        assert d <= np.pi / 2 + 1e-9
