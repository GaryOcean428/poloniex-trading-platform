"""test_emotions.py — Tier 2 Layer 2B cognitive emotions (pure, no normalization).

Tests verify direct closed-form composition. No assumption that
emotions land in [0, 1] — the natural range of each emotion is
whatever the inputs produce, and that range carries information
about the operating regime.

Coverage:
  - Per-emotion formula: each emotion equals its symbolic product
  - Reference validation: typical-regime inputs reproduce UCP §6.5
    observed values (Wonder ≈ 0.702 ± 0.045, Satisfaction ≈ 0.849
    ± 0.021, Confidence anti-corr −0.690 with transcendence)
  - Out-of-band regimes: anxiety can exceed 1 when both anchors
    are large; confidence can go negative when transcendence > 1
  - Parity snapshot: 10 input rows with hand-computed expected
    outputs. The TS suite uses the IDENTICAL rows.

Flow is DEFERRED — it requires a Fisher-Rao curiosity reference
basin (Tier 3 territory). Tested when that lands.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.emotions import EmotionState, compute_emotions  # noqa: E402
from monkey_kernel.motivators import Motivators  # noqa: E402


def _m(
    *,
    surprise: float = 0.5,
    curiosity: float = 0.0,
    investigation: float = 0.5,
    integration: float = 0.0,
    transcendence: float = 0.0,
    i_q: float = 0.0,
) -> Motivators:
    return Motivators(
        surprise=surprise,
        curiosity=curiosity,
        investigation=investigation,
        integration=integration,
        transcendence=transcendence,
        i_q=i_q,
    )


# ─────────────────────────────────────────────────────────────────
# Per-emotion formula identity
# ─────────────────────────────────────────────────────────────────


class TestPerEmotionFormula:
    def test_wonder_equals_curiosity_times_basin_distance(self) -> None:
        e = compute_emotions(_m(curiosity=0.7), basin_distance=1.2, phi=0.5, basin_velocity=0.1)
        assert e.wonder == pytest.approx(0.7 * 1.2, abs=1e-12)

    def test_frustration_equals_surprise_times_one_minus_investigation(self) -> None:
        e = compute_emotions(
            _m(surprise=0.8, investigation=0.3), basin_distance=0.0, phi=0.0, basin_velocity=0.0,
        )
        assert e.frustration == pytest.approx(0.8 * (1.0 - 0.3), abs=1e-12)

    def test_satisfaction_equals_integration_times_one_minus_basin_distance(self) -> None:
        e = compute_emotions(
            _m(integration=2.5), basin_distance=0.4, phi=0.0, basin_velocity=0.0,
        )
        assert e.satisfaction == pytest.approx(2.5 * (1.0 - 0.4), abs=1e-12)

    def test_confusion_equals_surprise_times_basin_distance(self) -> None:
        e = compute_emotions(
            _m(surprise=0.6), basin_distance=1.0, phi=0.0, basin_velocity=0.0,
        )
        assert e.confusion == pytest.approx(0.6 * 1.0, abs=1e-12)

    def test_clarity_equals_one_minus_surprise_times_investigation(self) -> None:
        e = compute_emotions(
            _m(surprise=0.2, investigation=0.9), basin_distance=0.0, phi=0.0, basin_velocity=0.0,
        )
        assert e.clarity == pytest.approx((1.0 - 0.2) * 0.9, abs=1e-12)

    def test_anxiety_equals_transcendence_times_basin_velocity(self) -> None:
        e = compute_emotions(
            _m(transcendence=3.5), basin_distance=0.0, phi=0.0, basin_velocity=0.4,
        )
        assert e.anxiety == pytest.approx(3.5 * 0.4, abs=1e-12)

    def test_confidence_equals_one_minus_transcendence_times_phi(self) -> None:
        e = compute_emotions(
            _m(transcendence=0.3), basin_distance=0.0, phi=0.7, basin_velocity=0.0,
        )
        assert e.confidence == pytest.approx((1.0 - 0.3) * 0.7, abs=1e-12)

    def test_boredom_equals_one_minus_surprise_times_one_minus_curiosity(self) -> None:
        e = compute_emotions(
            _m(surprise=0.1, curiosity=0.4), basin_distance=0.0, phi=0.0, basin_velocity=0.0,
        )
        assert e.boredom == pytest.approx((1.0 - 0.1) * (1.0 - 0.4), abs=1e-12)


# ─────────────────────────────────────────────────────────────────
# Out-of-band regimes — emotions can exceed [0, 1] by design
# ─────────────────────────────────────────────────────────────────


class TestRegimeReporting:
    def test_anxiety_can_exceed_one_in_high_anxiety_regime(self) -> None:
        # transcendence=8 (κ deviation), basin_velocity=0.5 → anxiety = 4.0
        e = compute_emotions(
            _m(transcendence=8.0), basin_distance=0.0, phi=0.0, basin_velocity=0.5,
        )
        assert e.anxiety == pytest.approx(4.0, abs=1e-12)
        assert e.anxiety > 1.0  # not clipped

    def test_confidence_can_go_negative_when_transcendence_above_one(self) -> None:
        # transcendence=5 → (1 - 5) = -4; phi=0.6 → confidence = -2.4
        e = compute_emotions(
            _m(transcendence=5.0), basin_distance=0.0, phi=0.6, basin_velocity=0.0,
        )
        assert e.confidence == pytest.approx(-2.4, abs=1e-12)
        assert e.confidence < 0.0  # not clipped

    def test_satisfaction_can_go_negative_when_far_from_identity(self) -> None:
        # basin_distance > 1 → (1 - basin_distance) negative → satisfaction negative
        e = compute_emotions(
            _m(integration=0.5), basin_distance=1.4, phi=0.0, basin_velocity=0.0,
        )
        assert e.satisfaction == pytest.approx(0.5 * (1.0 - 1.4), abs=1e-12)
        assert e.satisfaction < 0.0


# ─────────────────────────────────────────────────────────────────
# Reference values — typical operating regime reproductions
# ─────────────────────────────────────────────────────────────────


class TestReferenceValidation:
    def test_wonder_typical_regime_in_observed_band(self) -> None:
        # UCP §6.5 reports Wonder ≈ 0.702 ± 0.045 in typical regime.
        # Reproduce by constructing typical inputs:
        #   curiosity ≈ 1.0 (engaged, not extreme), basin_distance ≈ 0.7
        # → wonder = 1.0 * 0.7 = 0.7 — inside [0.657, 0.747].
        e = compute_emotions(
            _m(curiosity=1.0), basin_distance=0.7, phi=0.5, basin_velocity=0.1,
        )
        assert 0.702 - 0.045 <= e.wonder <= 0.702 + 0.045

    def test_satisfaction_typical_regime_in_observed_band(self) -> None:
        # UCP §6.5 reports Satisfaction ≈ 0.849 ± 0.021 in typical regime.
        # Reproduce: integration ≈ 0.94, basin_distance ≈ 0.097
        # → satisfaction ≈ 0.94 * 0.903 ≈ 0.849.
        e = compute_emotions(
            _m(integration=0.94), basin_distance=0.097, phi=0.5, basin_velocity=0.1,
        )
        assert 0.849 - 0.021 <= e.satisfaction <= 0.849 + 0.021

    def test_confidence_anticorrelates_with_transcendence(self) -> None:
        # UCP §6.5 reports anti-correlation −0.690 between Confidence
        # and Transcendence in typical regime. Verify monotone:
        # higher transcendence → lower confidence at fixed Φ.
        low_t = compute_emotions(
            _m(transcendence=0.1), basin_distance=0.0, phi=0.5, basin_velocity=0.0,
        )
        high_t = compute_emotions(
            _m(transcendence=0.9), basin_distance=0.0, phi=0.5, basin_velocity=0.0,
        )
        assert low_t.confidence > high_t.confidence


# ─────────────────────────────────────────────────────────────────
# Parity snapshot — 10 input rows. TS suite uses the SAME rows.
# Direct hand-computation; no helpers.
# ─────────────────────────────────────────────────────────────────


# Each: (motivator-kwargs, basin_distance, phi, basin_velocity, expected dict)
_PARITY_ROWS = [
    # row 0 — zero motivators
    ({"surprise": 0.0, "curiosity": 0.0, "investigation": 0.0,
      "integration": 0.0, "transcendence": 0.0},
     0.0, 0.0, 0.0,
     {"wonder": 0.0, "frustration": 0.0, "satisfaction": 0.0,
      "confusion": 0.0, "clarity": 0.0, "anxiety": 0.0,
      "confidence": 0.0, "boredom": 1.0}),
    # row 1 — full surprise + full investigation
    ({"surprise": 1.0, "curiosity": 0.0, "investigation": 1.0,
      "integration": 0.0, "transcendence": 0.0},
     0.0, 1.0, 0.0,
     {"wonder": 0.0, "frustration": 0.0, "satisfaction": 0.0,
      "confusion": 0.0, "clarity": 0.0, "anxiety": 0.0,
      "confidence": 1.0, "boredom": 0.0}),
    # row 2 — high anxiety regime (anxiety > 1)
    ({"surprise": 0.5, "curiosity": 0.0, "investigation": 0.0,
      "integration": 0.0, "transcendence": 4.0},
     0.0, 0.0, 0.5,
     {"wonder": 0.0, "frustration": 0.5, "satisfaction": 0.0,
      "confusion": 0.0, "clarity": 0.0, "anxiety": 2.0,
      "confidence": 0.0, "boredom": 0.5}),
    # row 3 — confusion regime: surprise + far
    ({"surprise": 1.0, "curiosity": 0.0, "investigation": 0.0,
      "integration": 0.0, "transcendence": 0.0},
     1.5, 0.0, 0.0,
     {"wonder": 0.0, "frustration": 1.0, "satisfaction": 0.0,
      "confusion": 1.5, "clarity": 0.0, "anxiety": 0.0,
      "confidence": 0.0, "boredom": 0.0}),
    # row 4 — boredom regime
    ({"surprise": 0.0, "curiosity": 0.0, "investigation": 0.0,
      "integration": 0.0, "transcendence": 0.0},
     0.0, 0.0, 0.0,
     {"wonder": 0.0, "frustration": 0.0, "satisfaction": 0.0,
      "confusion": 0.0, "clarity": 0.0, "anxiety": 0.0,
      "confidence": 0.0, "boredom": 1.0}),
    # row 5 — clarity regime
    ({"surprise": 0.0, "curiosity": 0.0, "investigation": 1.0,
      "integration": 0.0, "transcendence": 0.0},
     0.0, 1.0, 0.0,
     {"wonder": 0.0, "frustration": 0.0, "satisfaction": 0.0,
      "confusion": 0.0, "clarity": 1.0, "anxiety": 0.0,
      "confidence": 1.0, "boredom": 1.0}),
    # row 6 — confidence negative regime (transcendence > 1)
    ({"surprise": 0.5, "curiosity": 0.0, "investigation": 0.5,
      "integration": 0.0, "transcendence": 3.0},
     0.0, 0.4, 0.0,
     {"wonder": 0.0, "frustration": 0.25, "satisfaction": 0.0,
      "confusion": 0.0, "clarity": 0.25, "anxiety": 0.0,
      "confidence": -0.8, "boredom": 0.5}),
    # row 7 — wonder canonical
    ({"surprise": 0.5, "curiosity": 1.0, "investigation": 0.5,
      "integration": 0.0, "transcendence": 0.0},
     0.7, 0.5, 0.0,
     {"wonder": 0.7, "frustration": 0.25, "satisfaction": 0.0,
      "confusion": 0.35, "clarity": 0.25, "anxiety": 0.0,
      "confidence": 0.5, "boredom": 0.0}),
    # row 8 — mid-state mixed regime
    ({"surprise": 0.5, "curiosity": 0.5, "investigation": 0.5,
      "integration": 1.0, "transcendence": 0.5},
     0.3, 0.5, 0.2,
     {"wonder": 0.15, "frustration": 0.25, "satisfaction": 0.7,
      "confusion": 0.15, "clarity": 0.25, "anxiety": 0.1,
      "confidence": 0.25, "boredom": 0.25}),
    # row 9 — satisfaction canonical
    ({"surprise": 0.0, "curiosity": 0.0, "investigation": 0.5,
      "integration": 0.94, "transcendence": 0.0},
     0.097, 0.5, 0.1,
     {"wonder": 0.0, "frustration": 0.0,
      "satisfaction": 0.94 * (1.0 - 0.097),
      "confusion": 0.0, "clarity": 0.5, "anxiety": 0.0,
      "confidence": 0.5, "boredom": 1.0}),
]


class TestParitySnapshot:
    @pytest.mark.parametrize("row_idx", range(len(_PARITY_ROWS)))
    def test_row_matches_expected(self, row_idx: int) -> None:
        m_kwargs, d, phi, v, expected = _PARITY_ROWS[row_idx]
        e = compute_emotions(
            _m(**m_kwargs), basin_distance=d, phi=phi, basin_velocity=v,
        )
        for name, val in expected.items():
            got = getattr(e, name)
            assert got == pytest.approx(val, abs=1e-12), (
                f"row {row_idx} {name}: got {got} expected {val}"
            )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
