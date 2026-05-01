"""test_decision_triple.py — Loop 1 canonical triple per UCP §43.2.

Tests cover:
  - All three scores bounded in [0, 1]
  - Repetition: lived geometry (high velocity from history) vs scaffolding
  - Sovereignty: bank-grounded high-confidence vs nothing-near low-confidence
  - Confidence: bank resonance vs override expansion
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.self_observation import (  # noqa: E402
    DecisionTriple,
    compute_per_decision_triple,
)


def _basin(peak_idx: int, dim: int = 64, peak: float = 0.5) -> np.ndarray:
    b = np.full(dim, (1.0 - peak) / (dim - 1), dtype=np.float64)
    b[peak_idx] = peak
    return b


class TestBoundaries:
    def test_all_three_scores_bounded_in_zero_one(self) -> None:
        triple = compute_per_decision_triple(
            decision_id="K-test-1",
            current_basin=_basin(0),
            recent_basins=[_basin(1), _basin(2), _basin(3)],
            bank_resonance_count=3,
            bank_total_queried=10,
            nearest_fr_distance=0.5,
            emotion_confidence=0.7,
            emotion_anxiety=0.3,
            decision_path_overrides=[],
        )
        assert 0.0 <= triple.repetition_score <= 1.0
        assert 0.0 <= triple.sovereignty_score <= 1.0
        assert 0.0 <= triple.confidence_score <= 1.0

    def test_empty_recent_history_gives_zero_repetition(self) -> None:
        triple = compute_per_decision_triple(
            decision_id="cold",
            current_basin=_basin(0),
            recent_basins=[],
            bank_resonance_count=0,
            bank_total_queried=1,
            nearest_fr_distance=1.0,
            emotion_confidence=0.5,
            emotion_anxiety=0.5,
            decision_path_overrides=[],
        )
        assert triple.repetition_score == 0.0


class TestRepetition:
    def test_far_from_history_yields_high_repetition(self) -> None:
        # Current basin is at peak_idx=0 (concentrated mass at 0).
        # Recent history is at peak_idx=63 — far away.
        triple = compute_per_decision_triple(
            decision_id="K-far",
            current_basin=_basin(0, peak=0.95),
            recent_basins=[_basin(63, peak=0.95)] * 5,
            bank_resonance_count=0,
            bank_total_queried=1,
            nearest_fr_distance=1.0,
            emotion_confidence=0.5,
            emotion_anxiety=0.5,
            decision_path_overrides=[],
        )
        # FR distance between concentrated p[0]=0.95 and p[63]=0.95
        # is large → 1 - exp(-d) is close to 1.
        assert triple.repetition_score > 0.5

    def test_basin_matches_history_yields_low_repetition(self) -> None:
        b = _basin(10, peak=0.5)
        triple = compute_per_decision_triple(
            decision_id="K-stuck",
            current_basin=b,
            recent_basins=[b.copy() for _ in range(5)],
            bank_resonance_count=0,
            bank_total_queried=1,
            nearest_fr_distance=1.0,
            emotion_confidence=0.5,
            emotion_anxiety=0.5,
            decision_path_overrides=[],
        )
        # Identical to history → FR distance 0 → 1 - exp(0) = 0
        assert triple.repetition_score < 0.05


class TestSovereignty:
    def test_close_match_high_confidence_yields_high_sovereignty(self) -> None:
        triple = compute_per_decision_triple(
            decision_id="K-sovereign",
            current_basin=_basin(0),
            recent_basins=[_basin(1), _basin(2)],
            bank_resonance_count=5,
            bank_total_queried=10,
            nearest_fr_distance=0.1,  # well below 1/φ ≈ 0.618
            emotion_confidence=0.9,
            emotion_anxiety=0.1,
            decision_path_overrides=[],
        )
        # nearby_match = 1.0 (under 1/φ); confidence_dominance = 0.8.
        assert triple.sovereignty_score == pytest.approx(0.8, abs=1e-6)

    def test_far_match_low_confidence_yields_zero_sovereignty(self) -> None:
        triple = compute_per_decision_triple(
            decision_id="K-lost",
            current_basin=_basin(0),
            recent_basins=[_basin(1)],
            bank_resonance_count=0,
            bank_total_queried=10,
            nearest_fr_distance=math.pi / 2,  # max FR distance
            emotion_confidence=0.2,
            emotion_anxiety=0.6,
            decision_path_overrides=[],
        )
        # nearby_match = 0; anxiety > confidence so confidence_dominance = 0
        assert triple.sovereignty_score == 0.0

    def test_anxiety_dominates_kills_sovereignty(self) -> None:
        triple = compute_per_decision_triple(
            decision_id="K-anxious",
            current_basin=_basin(0),
            recent_basins=[_basin(1)],
            bank_resonance_count=5,
            bank_total_queried=10,
            nearest_fr_distance=0.1,  # close
            emotion_confidence=0.3,
            emotion_anxiety=0.7,
            decision_path_overrides=[],
        )
        assert triple.sovereignty_score == 0.0


class TestConfidence:
    def test_strong_bank_resonance_yields_high_confidence(self) -> None:
        triple = compute_per_decision_triple(
            decision_id="K-bank",
            current_basin=_basin(0),
            recent_basins=[_basin(1)],
            bank_resonance_count=8,
            bank_total_queried=10,
            nearest_fr_distance=0.5,
            emotion_confidence=0.5,
            emotion_anxiety=0.5,
            decision_path_overrides=[],
        )
        # 8/10 = 0.8, no overrides → 0.8
        assert triple.confidence_score == pytest.approx(0.8, abs=1e-6)

    def test_overrides_penalize_confidence(self) -> None:
        triple = compute_per_decision_triple(
            decision_id="K-override",
            current_basin=_basin(0),
            recent_basins=[_basin(1)],
            bank_resonance_count=8,
            bank_total_queried=10,
            nearest_fr_distance=0.5,
            emotion_confidence=0.5,
            emotion_anxiety=0.5,
            decision_path_overrides=["REVERSION_FLIP", "UPPER_STACK"],
        )
        # 0.8 - 2*0.2 = 0.4
        assert triple.confidence_score == pytest.approx(0.4, abs=1e-6)

    def test_many_overrides_clamps_to_zero(self) -> None:
        triple = compute_per_decision_triple(
            decision_id="K-rules",
            current_basin=_basin(0),
            recent_basins=[_basin(1)],
            bank_resonance_count=2,
            bank_total_queried=10,
            nearest_fr_distance=0.5,
            emotion_confidence=0.5,
            emotion_anxiety=0.5,
            decision_path_overrides=["A", "B", "C", "D", "E"],
        )
        # 0.2 - 5*0.2 = -0.8 → clamped 0.0
        assert triple.confidence_score == 0.0

    def test_zero_queried_treats_as_one(self) -> None:
        triple = compute_per_decision_triple(
            decision_id="K-zero",
            current_basin=_basin(0),
            recent_basins=[],
            bank_resonance_count=0,
            bank_total_queried=0,
            nearest_fr_distance=0.5,
            emotion_confidence=0.5,
            emotion_anxiety=0.5,
            decision_path_overrides=[],
        )
        # 0/max(1,0) = 0; no overrides → 0
        assert triple.confidence_score == 0.0


class TestDecisionTripleShape:
    def test_decision_id_is_carried(self) -> None:
        triple = compute_per_decision_triple(
            decision_id="K-id-test",
            current_basin=_basin(0),
            recent_basins=[],
            bank_resonance_count=0,
            bank_total_queried=1,
            nearest_fr_distance=0.1,
            emotion_confidence=0.5,
            emotion_anxiety=0.5,
            decision_path_overrides=[],
            at_ms=12345.0,
        )
        assert triple.decision_id == "K-id-test"
        assert triple.at_ms == 12345.0

    def test_returns_decision_triple(self) -> None:
        triple = compute_per_decision_triple(
            decision_id="K-shape",
            current_basin=_basin(0),
            recent_basins=[],
            bank_resonance_count=0,
            bank_total_queried=1,
            nearest_fr_distance=0.1,
            emotion_confidence=0.5,
            emotion_anxiety=0.5,
            decision_path_overrides=[],
        )
        assert isinstance(triple, DecisionTriple)
