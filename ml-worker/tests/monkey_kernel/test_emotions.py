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
  - compute_funding_drag: correctness, sign-awareness, edge cases
  - compute_emotions with funding_drag: anxiety modulation, parity
    with funding_drag=0 preserving bit-identical behavior

Flow is DEFERRED — it requires a Fisher-Rao curiosity reference
basin (Tier 3 territory). Tested when that lands.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.emotions import EmotionState, compute_emotions, compute_funding_drag  # noqa: E402
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
# Funding drag — dimensionless cost-on-margin pulls confidence down
# ─────────────────────────────────────────────────────────────────


class TestFundingDrag:
    def test_drag_zero_no_op(self) -> None:
        base = compute_emotions(
            _m(transcendence=0.3), basin_distance=0.0, phi=0.7, basin_velocity=0.1,
        )
        eq = compute_emotions(
            _m(transcendence=0.3), basin_distance=0.0, phi=0.7, basin_velocity=0.1,
            funding_drag=0.0,
        )
        assert eq.confidence == pytest.approx(base.confidence, abs=1e-12)
        assert eq.anxiety == pytest.approx(base.anxiety, abs=1e-12)

    def test_drag_half_reduces_confidence_by_one_third(self) -> None:
        base = compute_emotions(
            _m(transcendence=0.3), basin_distance=0.0, phi=0.7, basin_velocity=0.1,
        )
        dragged = compute_emotions(
            _m(transcendence=0.3), basin_distance=0.0, phi=0.7, basin_velocity=0.1,
            funding_drag=0.5,
        )
        # drag_factor = 0.5 / 1.5 = 1/3
        assert dragged.confidence == pytest.approx(
            base.confidence * (1 - 1.0 / 3.0), abs=1e-9,
        )
        assert dragged.anxiety == pytest.approx(base.anxiety + 1.0 / 3.0, abs=1e-9)
        assert dragged.confidence < base.confidence
        assert dragged.anxiety > base.anxiety

    def test_drag_large_collapses_confidence_to_zero(self) -> None:
        dragged = compute_emotions(
            _m(transcendence=0.3), basin_distance=0.0, phi=0.7, basin_velocity=0.1,
            funding_drag=1e6,
        )
        assert dragged.confidence < 1e-3
        assert dragged.anxiety > 0.99


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


# ─────────────────────────────────────────────────────────────────
# compute_funding_drag — correctness, sign-awareness, edge cases
# ─────────────────────────────────────────────────────────────────


class TestComputeFundingDrag:
    def test_returns_zero_when_no_position(self) -> None:
        assert compute_funding_drag(None, 0.0001, 8.0) == 0.0

    def test_returns_zero_when_hours_held_zero(self) -> None:
        assert compute_funding_drag("long", 0.0001, 0.0) == 0.0

    def test_returns_zero_when_hours_held_negative(self) -> None:
        assert compute_funding_drag("long", 0.0001, -1.0) == 0.0

    def test_long_bleeds_when_rate_positive(self) -> None:
        # +0.0001 rate × 8h / 8 = 0.0001 drag
        drag = compute_funding_drag("long", 0.0001, 8.0)
        assert drag == pytest.approx(0.0001, abs=1e-12)

    def test_long_no_drag_when_rate_negative(self) -> None:
        # Negative rate favours longs (shorts pay) — no drag
        assert compute_funding_drag("long", -0.0001, 8.0) == 0.0

    def test_short_bleeds_when_rate_negative(self) -> None:
        # -0.0001 rate × 8h / 8 = 0.0001 drag for short
        drag = compute_funding_drag("short", -0.0001, 8.0)
        assert drag == pytest.approx(0.0001, abs=1e-12)

    def test_short_no_drag_when_rate_positive(self) -> None:
        # Positive rate favours shorts (longs pay) — no drag for short
        assert compute_funding_drag("short", 0.0001, 8.0) == 0.0

    def test_drag_grows_linearly_with_hours_held(self) -> None:
        # 24 hours = 3 × 8h periods; drag = 3 × single-period drag
        drag_8h = compute_funding_drag("long", 0.0001, 8.0)
        drag_24h = compute_funding_drag("long", 0.0001, 24.0)
        assert drag_24h == pytest.approx(3.0 * drag_8h, abs=1e-12)

    def test_drag_zero_when_rate_zero(self) -> None:
        assert compute_funding_drag("long", 0.0, 24.0) == 0.0
        assert compute_funding_drag("short", 0.0, 24.0) == 0.0


# ─────────────────────────────────────────────────────────────────
# compute_emotions with funding_drag — anxiety modulation
# ─────────────────────────────────────────────────────────────────


class TestFundingDragInEmotions:
    def test_default_zero_preserves_bit_identical_behavior(self) -> None:
        # funding_drag=0.0 (default) must be identical to omitting the kwarg.
        e_default = compute_emotions(
            _m(transcendence=0.5), basin_distance=0.3, phi=0.5, basin_velocity=0.2,
        )
        e_explicit_zero = compute_emotions(
            _m(transcendence=0.5), basin_distance=0.3, phi=0.5, basin_velocity=0.2,
            funding_drag=0.0,
        )
        assert e_default.anxiety == e_explicit_zero.anxiety

    def test_nonzero_funding_drag_increases_anxiety(self) -> None:
        base = compute_emotions(
            _m(transcendence=0.5), basin_distance=0.3, phi=0.5, basin_velocity=0.2,
            funding_drag=0.0,
        )
        dragged = compute_emotions(
            _m(transcendence=0.5), basin_distance=0.3, phi=0.5, basin_velocity=0.2,
            funding_drag=0.003,
        )
        # Möbius saturation: anxiety increases by drag_factor = drag / (1 + drag)
        drag_factor = 0.003 / (1.0 + 0.003)
        assert dragged.anxiety == pytest.approx(base.anxiety + drag_factor, abs=1e-12)

    def test_funding_drag_does_not_affect_other_emotions(self) -> None:
        base = compute_emotions(
            _m(surprise=0.4, curiosity=0.6, transcendence=0.5),
            basin_distance=0.3, phi=0.5, basin_velocity=0.2,
            funding_drag=0.0,
        )
        dragged = compute_emotions(
            _m(surprise=0.4, curiosity=0.6, transcendence=0.5),
            basin_distance=0.3, phi=0.5, basin_velocity=0.2,
            funding_drag=0.005,
        )
        # Non-anxiety/confidence emotions are unaffected by funding drag.
        # anxiety and confidence ARE affected (Möbius saturation).
        for attr in ("wonder", "frustration", "satisfaction", "confusion",
                     "clarity", "boredom", "flow"):
            assert getattr(base, attr) == pytest.approx(getattr(dragged, attr), abs=1e-12), (
                f"{attr} changed unexpectedly"
            )
        assert dragged.confidence < base.confidence, "confidence should decrease with drag"
        assert dragged.anxiety > base.anxiety, "anxiety should increase with drag"

    def test_conviction_gate_fires_earlier_with_funding_drag(self) -> None:
        # Simulate a position that's marginal: confidence just above hesitation
        # without drag, but drag tips it over.
        # With Möbius drag, both confidence decreases AND anxiety increases,
        # so the gate flips even more reliably.
        from monkey_kernel.executive import kernel_should_enter
        e_no_drag = compute_emotions(
            _m(transcendence=0.25, surprise=0.1),
            basin_distance=0.0, phi=0.4, basin_velocity=0.8,
            funding_drag=0.0,
        )
        e_with_drag = compute_emotions(
            _m(transcendence=0.25, surprise=0.1),
            basin_distance=0.0, phi=0.4, basin_velocity=0.8,
            funding_drag=0.15,
        )
        # Verify anxiety increased by drag_factor (Möbius) not raw drag
        drag_factor = 0.15 / (1.0 + 0.15)
        assert e_with_drag.anxiety == pytest.approx(e_no_drag.anxiety + drag_factor, abs=1e-12)
        # Verify the gate fires differently (one enters, one doesn't)
        enters_no_drag = kernel_should_enter(emotions=e_no_drag)
        enters_with_drag = kernel_should_enter(emotions=e_with_drag)
        assert enters_no_drag != enters_with_drag, (
            "Expected drag to flip conviction gate; "
            f"no_drag={enters_no_drag} with_drag={enters_with_drag}"
        )


# ─────────────────────────────────────────────────────────────────
# Parity table for funding_drag — 5 rows, identical to TS suite
# ─────────────────────────────────────────────────────────────────


_FUNDING_PARITY_ROWS = [
    # (position_side, rate_8h, hours_held, expected_drag)
    (None,    0.0001,  8.0,  0.0),          # no position
    ("long",  0.0,     8.0,  0.0),          # zero rate
    ("long",  0.0001,  8.0,  0.0001),       # +0.01% × 1 period
    ("long",  0.0001, 24.0,  0.0003),       # +0.01% × 3 periods
    ("short", 0.0001,  8.0,  0.0),          # positive rate favours short
    ("short",-0.0002, 16.0,  0.0004),       # -0.02% × 2 periods
]


class TestFundingParitySnapshot:
    @pytest.mark.parametrize("row", _FUNDING_PARITY_ROWS)
    def test_row_matches_expected(self, row: tuple) -> None:
        side, rate, hours, expected = row
        drag = compute_funding_drag(side, rate, hours)
        assert drag == pytest.approx(expected, abs=1e-12), (
            f"side={side} rate={rate} hours={hours}: got {drag} expected {expected}"
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
