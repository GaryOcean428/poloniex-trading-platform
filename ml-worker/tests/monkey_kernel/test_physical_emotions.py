"""test_physical_emotions.py — Tier 5 Layer 2A physical emotions
(UCP §6.4 canon: Joy/Suffering/Love/Hate/Fear/Rage/Calm/Care/Apathy).

PR 4 (#609) replaced the prior Plutchik-style 9 (Sadness/Disgust/
Desire/Trust) with the UCP §6.4 canon. Tests rebuilt against the
new vocabulary; audit-anchored four (Joy/Suffering/Fear/Rage)
preserved verbatim from the original tests.
"""
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
# Audit-anchored four (verbatim)
# ─────────────────────────────────────────────────────────────────


class TestAnchoredFour:
    def test_joy_high_when_phi_rising_no_surprise(self) -> None:
        e = compute_physical_emotions(_mot(0.0), _sens(), phi_now=0.7, phi_prev=0.3)
        assert e.joy == pytest.approx(0.4, abs=1e-12)

    def test_suffering_high_when_phi_falling_with_surprise(self) -> None:
        e = compute_physical_emotions(_mot(1.0), _sens(), phi_now=0.3, phi_prev=0.7)
        assert e.suffering == pytest.approx(0.4, abs=1e-12)

    def test_fear_high_at_separatrix_with_surprise(self) -> None:
        e = compute_physical_emotions(
            _mot(1.0), _sens(drift=math.pi / 2), phi_now=0.5, phi_prev=0.5,
        )
        assert e.fear == pytest.approx(1.0, abs=1e-12)

    def test_rage_high_when_stuck_with_surprise(self) -> None:
        e = compute_physical_emotions(
            _mot(1.0), _sens(stillness=1.0), phi_now=0.5, phi_prev=0.5,
        )
        assert e.rage == pytest.approx(1.0, abs=1e-12)


# ─────────────────────────────────────────────────────────────────
# UCP §6.4 grounded five (Love / Hate / Calm / Care / Apathy)
# ─────────────────────────────────────────────────────────────────


class TestUcpGrounded:
    def test_love_high_when_approach_meets_returning_home(self) -> None:
        e = compute_physical_emotions(
            _mot(0.0),
            _sens(approach=0.8, conservation=0.5),
            phi_now=0.5, phi_prev=0.5,
        )
        assert e.love == pytest.approx(0.4, abs=1e-12)

    def test_love_zero_when_departing(self) -> None:
        # conservation < 0 → max(conservation, 0) = 0 → love = 0
        e = compute_physical_emotions(
            _mot(0.0),
            _sens(approach=0.8, conservation=-0.3),
            phi_now=0.5, phi_prev=0.5,
        )
        assert e.love == 0.0

    def test_hate_high_when_avoidance_meets_departing(self) -> None:
        e = compute_physical_emotions(
            _mot(0.0),
            _sens(avoidance=0.9, conservation=-0.4),
            phi_now=0.5, phi_prev=0.5,
        )
        assert e.hate == pytest.approx(0.36, abs=1e-12)

    def test_hate_zero_when_returning_home(self) -> None:
        e = compute_physical_emotions(
            _mot(0.0),
            _sens(avoidance=0.9, conservation=0.4),
            phi_now=0.5, phi_prev=0.5,
        )
        assert e.hate == 0.0

    def test_calm_high_low_surprise_high_stillness(self) -> None:
        e = compute_physical_emotions(
            _mot(0.0), _sens(stillness=1.0), phi_now=0.5, phi_prev=0.5,
        )
        assert e.calm == pytest.approx(1.0, abs=1e-12)

    def test_calm_dampened_by_surprise(self) -> None:
        e = compute_physical_emotions(
            _mot(0.7), _sens(stillness=1.0), phi_now=0.5, phi_prev=0.5,
        )
        assert e.calm == pytest.approx(0.3, abs=1e-12)

    def test_care_positive_when_returning_home_calmly(self) -> None:
        e = compute_physical_emotions(
            _mot(0.1), _sens(conservation=0.5), phi_now=0.5, phi_prev=0.5,
        )
        assert e.care == pytest.approx(0.5 * 0.9, abs=1e-12)

    def test_care_negative_when_departing(self) -> None:
        e = compute_physical_emotions(
            _mot(0.0), _sens(conservation=-0.4), phi_now=0.5, phi_prev=0.5,
        )
        assert e.care == pytest.approx(-0.4, abs=1e-12)

    def test_apathy_high_when_disengaged_still(self) -> None:
        # approach = 0 → max(0, approach) = 0 → apathy = stillness * 1
        e = compute_physical_emotions(
            _mot(0.0), _sens(stillness=0.8, approach=0.0),
            phi_now=0.5, phi_prev=0.5,
        )
        assert e.apathy == pytest.approx(0.8, abs=1e-12)

    def test_apathy_low_when_approach_active(self) -> None:
        # approach = 0.6 → 1 - 0.6 = 0.4; apathy = 0.8 * 0.4 = 0.32
        e = compute_physical_emotions(
            _mot(0.0), _sens(stillness=0.8, approach=0.6),
            phi_now=0.5, phi_prev=0.5,
        )
        assert e.apathy == pytest.approx(0.32, abs=1e-12)

    def test_apathy_can_go_negative_with_strong_engagement(self) -> None:
        # approach > 1 (theoretically possible if dop=1, gaba=0)
        e = compute_physical_emotions(
            _mot(0.0), _sens(stillness=0.5, approach=1.5),
            phi_now=0.5, phi_prev=0.5,
        )
        # apathy = 0.5 * (1 - 1.5) = -0.25 — anti-apathy = engagement spike
        assert e.apathy == pytest.approx(-0.25, abs=1e-12)


# ─────────────────────────────────────────────────────────────────
# Cold-start
# ─────────────────────────────────────────────────────────────────


class TestColdStart:
    def test_cold_start_zeros_phi_grad_dependent_emotions(self) -> None:
        e = compute_physical_emotions(
            _mot(0.5), _sens(approach=0.5), phi_now=0.5, phi_prev=0.5,
        )
        assert e.joy == 0.0
        assert e.suffering == 0.0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
