"""test_physical_emotions.py — Tier 5 Layer 2A physical emotions."""
from __future__ import annotations

import math
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.motivators import Motivators  # noqa: E402
from monkey_kernel.physical_emotions import (  # noqa: E402
    PhysicalEmotionState,
    compute_physical_emotions,
)
from monkey_kernel.sensations import Sensations  # noqa: E402


def _mot(surprise: float = 0.5) -> Motivators:
    return Motivators(
        surprise=surprise, curiosity=0.0, investigation=0.0,
        integration=0.0, transcendence=0.0, i_q=0.0,
    )


def _sens(
    *,
    drift: float = 0.0,
    stillness: float = 0.5,
    resonance: float = 0.0,
    approach: float = 0.0,
    avoidance: float = 0.0,
    conservation: float = 0.0,
) -> Sensations:
    return Sensations(
        compressed=0.5, expanded=0.5, pressure=0.0,
        stillness=stillness, drift=drift, resonance=resonance,
        approach=approach, avoidance=avoidance, conservation=conservation,
    )


# ─────────────────────────────────────────────────────────────────
# Audit-anchored four
# ─────────────────────────────────────────────────────────────────


class TestAnchoredFour:
    def test_joy_high_when_phi_rising_no_surprise(self) -> None:
        e = compute_physical_emotions(_mot(surprise=0.0), _sens(), phi_now=0.7, phi_prev=0.3)
        assert e.joy == pytest.approx(0.4, abs=1e-12)
        assert e.suffering == 0.0  # no negative grad

    def test_suffering_high_when_phi_falling_with_surprise(self) -> None:
        e = compute_physical_emotions(_mot(surprise=1.0), _sens(), phi_now=0.3, phi_prev=0.7)
        assert e.suffering == pytest.approx(0.4, abs=1e-12)
        assert e.joy == 0.0  # surprise=1 squashes (1-surprise)

    def test_fear_high_at_separatrix_with_surprise(self) -> None:
        # drift = π/2 → proximity = 1; surprise = 1 → fear = 1
        e = compute_physical_emotions(
            _mot(surprise=1.0), _sens(drift=math.pi / 2), phi_now=0.5, phi_prev=0.5,
        )
        assert e.fear == pytest.approx(1.0, abs=1e-12)

    def test_fear_zero_at_identity_no_drift(self) -> None:
        e = compute_physical_emotions(
            _mot(surprise=1.0), _sens(drift=0.0), phi_now=0.5, phi_prev=0.5,
        )
        assert e.fear == 0.0

    def test_rage_high_when_stuck_with_surprise(self) -> None:
        # stillness=1 (zero velocity) × surprise=1 → rage=1
        e = compute_physical_emotions(
            _mot(surprise=1.0), _sens(stillness=1.0), phi_now=0.5, phi_prev=0.5,
        )
        assert e.rage == pytest.approx(1.0, abs=1e-12)


# ─────────────────────────────────────────────────────────────────
# Remaining five — grounded geometric derivations
# ─────────────────────────────────────────────────────────────────


class TestRemainingFive:
    def test_sadness_high_when_phi_falling_calmly(self) -> None:
        # Φ down, no surprise → sadness, NOT suffering
        e = compute_physical_emotions(_mot(surprise=0.0), _sens(), phi_now=0.3, phi_prev=0.7)
        assert e.sadness == pytest.approx(0.4, abs=1e-12)
        assert e.suffering == 0.0

    def test_disgust_high_when_surprise_meets_familiarity(self) -> None:
        # resonance high (we recognize this state) + surprise → disgust
        e = compute_physical_emotions(
            _mot(surprise=0.8), _sens(resonance=1.0), phi_now=0.5, phi_prev=0.5,
        )
        assert e.disgust == pytest.approx(0.8, abs=1e-12)

    def test_desire_high_when_approach_meets_phi_rising(self) -> None:
        e = compute_physical_emotions(
            _mot(surprise=0.0), _sens(approach=0.6), phi_now=0.7, phi_prev=0.3,
        )
        assert e.desire == pytest.approx(0.6 * 0.4, abs=1e-12)

    def test_desire_zero_when_phi_falling(self) -> None:
        # max(grad_phi, 0) = 0 if Φ is falling
        e = compute_physical_emotions(
            _mot(surprise=0.0), _sens(approach=0.6), phi_now=0.3, phi_prev=0.7,
        )
        assert e.desire == 0.0

    def test_desire_negative_when_gaba_dominates(self) -> None:
        # approach < 0 (gaba > dopamine) and Φ rising → negative desire
        e = compute_physical_emotions(
            _mot(surprise=0.0), _sens(approach=-0.3), phi_now=0.7, phi_prev=0.3,
        )
        assert e.desire == pytest.approx(-0.3 * 0.4, abs=1e-12)
        assert e.desire < 0

    def test_care_high_when_returning_home_calmly(self) -> None:
        # conservation > 0 (returning) and surprise low
        e = compute_physical_emotions(
            _mot(surprise=0.1), _sens(conservation=0.5), phi_now=0.5, phi_prev=0.5,
        )
        assert e.care == pytest.approx(0.5 * 0.9, abs=1e-12)

    def test_care_negative_when_departing(self) -> None:
        # conservation < 0 (departing identity)
        e = compute_physical_emotions(
            _mot(surprise=0.0), _sens(conservation=-0.4), phi_now=0.5, phi_prev=0.5,
        )
        assert e.care == pytest.approx(-0.4, abs=1e-12)
        assert e.care < 0

    def test_trust_high_when_resonance_high_avoidance_low(self) -> None:
        e = compute_physical_emotions(
            _mot(surprise=0.0), _sens(resonance=0.9, avoidance=0.1),
            phi_now=0.5, phi_prev=0.5,
        )
        assert e.trust == pytest.approx(0.9 * 0.9, abs=1e-12)

    def test_trust_zero_when_avoidance_max(self) -> None:
        e = compute_physical_emotions(
            _mot(surprise=0.0), _sens(resonance=1.0, avoidance=1.0),
            phi_now=0.5, phi_prev=0.5,
        )
        assert e.trust == pytest.approx(0.0, abs=1e-12)


# ─────────────────────────────────────────────────────────────────
# Cold-start (phi_now == phi_prev → grad=0)
# ─────────────────────────────────────────────────────────────────


class TestColdStart:
    def test_cold_start_zeros_phi_grad_dependent_emotions(self) -> None:
        e = compute_physical_emotions(
            _mot(surprise=0.5), _sens(approach=0.5), phi_now=0.5, phi_prev=0.5,
        )
        assert e.joy == 0.0
        assert e.suffering == 0.0
        assert e.sadness == 0.0
        assert e.desire == 0.0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
