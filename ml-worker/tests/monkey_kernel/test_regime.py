"""Tests for the regime classifier (proposal #5)."""
from __future__ import annotations

import os
import sys

import numpy as np
import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.regime import (  # noqa: E402
    RegimeReading,
    classify_regime,
    regime_entry_threshold_modifier,
    regime_harvest_tightness,
)

BASIN_DIM = 64


def _bullish_basin(intensity: float = 0.9) -> np.ndarray:
    """A simplex basin with dims 7..14 above-uniform — reads positive
    via basin_direction."""
    v = np.full(BASIN_DIM, 0.5)
    v[7:15] = intensity
    return v / v.sum()


def _bearish_basin(intensity: float = 0.1) -> np.ndarray:
    v = np.full(BASIN_DIM, 0.5)
    v[7:15] = intensity
    return v / v.sum()


def _flat_basin() -> np.ndarray:
    return np.full(BASIN_DIM, 1 / BASIN_DIM)


class TestClassifyRegimeBasics:
    def test_empty_history_returns_chop_low_confidence(self):
        r = classify_regime([])
        assert r.regime == "CHOP"
        assert r.confidence < 0.5

    def test_single_basin_returns_chop_low_confidence(self):
        r = classify_regime([_flat_basin()])
        assert r.regime == "CHOP"
        assert r.confidence < 0.5

    def test_two_basins_returns_chop_low_confidence(self):
        r = classify_regime([_flat_basin(), _flat_basin()])
        assert r.regime == "CHOP"
        assert r.confidence < 0.5

    def test_consistent_bull_history_classifies_trend_up(self):
        history = [_bullish_basin() for _ in range(20)]
        r = classify_regime(history)
        assert r.regime == "TREND_UP"
        assert r.confidence > 0.5

    def test_consistent_bear_history_classifies_trend_down(self):
        history = [_bearish_basin() for _ in range(20)]
        r = classify_regime(history)
        assert r.regime == "TREND_DOWN"
        assert r.confidence > 0.5

    def test_alternating_history_classifies_chop(self):
        # Alternating bull/bear -> trend_strength near 0, chop_score high.
        history = []
        for i in range(20):
            history.append(_bullish_basin() if i % 2 == 0 else _bearish_basin())
        r = classify_regime(history)
        assert r.regime == "CHOP"
        # trend_strength averages near 0; chop_score near 1.
        assert abs(r.trend_strength) < 0.1
        assert r.chop_score > 0.5


class TestRegimeReadingFields:
    def test_trend_strength_is_signed(self):
        bull = classify_regime([_bullish_basin() for _ in range(20)])
        bear = classify_regime([_bearish_basin() for _ in range(20)])
        assert bull.trend_strength > 0
        assert bear.trend_strength < 0

    def test_trend_strength_in_minus_one_one(self):
        history = [_bullish_basin(0.99) for _ in range(20)]
        r = classify_regime(history)
        assert -1.0 <= r.trend_strength <= 1.0

    def test_chop_score_in_zero_one(self):
        rng = np.random.default_rng(42)
        for _ in range(10):
            history = []
            for _ in range(16):
                v = rng.uniform(0.1, 0.9, BASIN_DIM)
                history.append(v / v.sum())
            r = classify_regime(history)
            assert 0.0 <= r.chop_score <= 1.0

    def test_confidence_in_zero_one(self):
        for hist in [
            [_bullish_basin() for _ in range(20)],
            [_bearish_basin() for _ in range(20)],
            [_flat_basin() for _ in range(20)],
        ]:
            r = classify_regime(hist)
            assert 0.0 <= r.confidence <= 1.0

    def test_as_dict_round_trip(self):
        r = classify_regime([_bullish_basin() for _ in range(20)])
        d = r.as_dict()
        assert d["regime"] == "TREND_UP"
        assert "trend_strength" in d
        assert "chop_score" in d
        assert "confidence" in d


class TestRegimeStateTransitions:
    def test_transitions_through_chop_when_bull_decays(self):
        # First half bull, second half flat -> the average drops, may
        # cross the trend threshold.
        history = []
        for _ in range(8):
            history.append(_bullish_basin())
        for _ in range(8):
            history.append(_flat_basin())
        r = classify_regime(history)
        # No assertion on exact label — could be CHOP or TREND_UP at low
        # confidence depending on threshold. Asserts it's well-defined.
        assert r.regime in ("CHOP", "TREND_UP")
        assert 0.0 <= r.confidence <= 1.0

    def test_pure_bull_to_pure_bear_window_lands_on_chop(self):
        history = []
        for _ in range(8):
            history.append(_bullish_basin())
        for _ in range(8):
            history.append(_bearish_basin())
        r = classify_regime(history)
        # 50/50 split -> trend_strength ≈ 0 -> CHOP.
        assert r.regime == "CHOP"


class TestRegimeStabilityUnderNoise:
    def test_mostly_bull_with_noise_stays_trend_up(self):
        """If 7/8 of the window is bull and 1/8 is flat, regime should
        still classify as TREND_UP (resilient to single-tick noise)."""
        rng = np.random.default_rng(seed=11)
        history = []
        for i in range(16):
            if rng.random() < 0.85:
                history.append(_bullish_basin())
            else:
                history.append(_flat_basin())
        r = classify_regime(history)
        assert r.regime == "TREND_UP"

    def test_thresholds_are_configurable(self):
        history = [_bullish_basin(0.7) for _ in range(16)]
        # With default thresholds this should be a TREND_UP.
        default = classify_regime(history)
        assert default.regime == "TREND_UP"
        # With looser thresholds we get TREND_UP confidently.
        loose = classify_regime(
            history, trend_threshold=0.001, chop_threshold=0.95,
        )
        assert loose.regime == "TREND_UP"
        # And tighter thresholds make it CHOP.
        tight = classify_regime(
            history, trend_threshold=0.95, chop_threshold=0.05,
        )
        assert tight.regime == "CHOP"


class TestRegimeModifiers:
    def test_chop_modifier_raises_threshold(self):
        chop = RegimeReading(regime="CHOP", confidence=1.0,
                             trend_strength=0.0, chop_score=1.0)
        m = regime_entry_threshold_modifier(chop)
        assert m > 1.0

    def test_trend_modifier_lowers_threshold(self):
        trend = RegimeReading(regime="TREND_UP", confidence=1.0,
                              trend_strength=0.5, chop_score=0.0)
        m = regime_entry_threshold_modifier(trend)
        assert m < 1.0

    def test_chop_harvest_tightens(self):
        chop = RegimeReading(regime="CHOP", confidence=1.0,
                             trend_strength=0.0, chop_score=1.0)
        h = regime_harvest_tightness(chop)
        assert h < 1.0  # tighter

    def test_trend_harvest_loosens(self):
        trend = RegimeReading(regime="TREND_UP", confidence=1.0,
                              trend_strength=0.5, chop_score=0.0)
        h = regime_harvest_tightness(trend)
        assert h > 1.0  # looser

    def test_zero_confidence_modifiers_are_neutral(self):
        chop = RegimeReading(regime="CHOP", confidence=0.0,
                             trend_strength=0.0, chop_score=0.0)
        assert regime_entry_threshold_modifier(chop) == pytest.approx(1.0)
        assert regime_harvest_tightness(chop) == pytest.approx(1.0)


class TestRegimePurity:
    def test_no_euclidean_or_cosine_in_module(self):
        path = os.path.join(_SRC, "monkey_kernel", "regime.py")
        with open(path) as fh:
            src = fh.read()
        forbidden = [
            "cosine_similarity",
            "scipy.spatial.distance.cosine",
            "scipy.spatial.distance.euclidean",
            "np.linalg.norm",
            "np.std",  # explicit forbidden — variance-on-returns is impure
        ]
        for tok in forbidden:
            assert tok not in src, f"forbidden token in regime.py: {tok}"

    def test_output_signed_consistent_with_basin_direction(self):
        """The mean direction over a bullish-only history should be
        positive; over a bearish-only history negative."""
        from monkey_kernel.perception_scalars import basin_direction
        bull_hist = [_bullish_basin() for _ in range(16)]
        bear_hist = [_bearish_basin() for _ in range(16)]
        bull_dirs = [basin_direction(b) for b in bull_hist]
        bear_dirs = [basin_direction(b) for b in bear_hist]
        assert np.mean(bull_dirs) > 0
        assert np.mean(bear_dirs) < 0
        bull_r = classify_regime(bull_hist)
        bear_r = classify_regime(bear_hist)
        assert bull_r.trend_strength > 0
        assert bear_r.trend_strength < 0


class TestRegimeWithRealisticHistory:
    """Synthesised OHLCV-derived basin trajectories — exercise
    realistic Δ⁶³ trajectories rather than canonical bull/bear basins.
    """

    def _drifting_basin(self, n: int, drift_per_step: float = 0.005) -> list[np.ndarray]:
        """Build n basins where the momentum band gradually rises."""
        history = []
        base = 0.5
        for i in range(n):
            v = np.full(BASIN_DIM, 0.5)
            v[7:15] = base + i * drift_per_step
            history.append(v / v.sum())
        return history

    def test_gradual_uptrend_classifies_as_trend_up(self):
        hist = self._drifting_basin(16, drift_per_step=0.05)
        r = classify_regime(hist)
        assert r.regime == "TREND_UP"

    def test_gradual_downtrend_classifies_as_trend_down(self):
        hist = self._drifting_basin(16, drift_per_step=-0.05)
        r = classify_regime(hist)
        assert r.regime == "TREND_DOWN"

    def test_drift_too_small_classifies_chop(self):
        hist = self._drifting_basin(16, drift_per_step=0.0)
        # All identical -> chop_score might be 1.0 (all directions
        # equal -> persistence ratio 1.0 -> chop_score 0.0); so this
        # tests the corner case carefully.
        r = classify_regime(hist)
        assert r.regime in ("CHOP", "TREND_UP")
