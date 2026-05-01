"""Tests for CHOP regime entry suppression (issue #623).

Decision table:
  - trend + CHOP + confidence 0.75  → suppressed (above 0.70 threshold)
  - trend + CHOP + confidence 0.65  → proceeds (below threshold)
  - trend + TREND_UP                → proceeds (directional regime)
  - swing + CHOP + confidence 0.80  → proceeds (below swing threshold 0.85)
  - swing + CHOP + confidence 0.90  → suppressed
  - scalp + CHOP + confidence 0.99  → proceeds (scalp never suspended)
  - held position + CHOP            → suppression does not fire (held path)
"""
from __future__ import annotations

import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.regime import (  # noqa: E402
    ChopSuppressionResult,
    RegimeReading,
    chop_suppress_entry,
    CHOP_SUPPRESS_TREND_CONFIDENCE_DEFAULT,
    CHOP_SUPPRESS_SWING_CONFIDENCE_DEFAULT,
)


def _chop(confidence: float) -> RegimeReading:
    return RegimeReading(
        regime="CHOP",
        confidence=confidence,
        trend_strength=0.0,
        chop_score=0.9,
    )


def _trend_up(confidence: float = 0.8) -> RegimeReading:
    return RegimeReading(
        regime="TREND_UP",
        confidence=confidence,
        trend_strength=0.5,
        chop_score=0.1,
    )


def _trend_down(confidence: float = 0.8) -> RegimeReading:
    return RegimeReading(
        regime="TREND_DOWN",
        confidence=confidence,
        trend_strength=-0.5,
        chop_score=0.1,
    )


class TestChopSuppressionDefaults:
    """Decision table with default thresholds."""

    def test_trend_chop_above_threshold_suppressed(self):
        """trend + CHOP + confidence 0.75 → suppressed."""
        result = chop_suppress_entry(_chop(0.75), lane="trend")
        assert result.suppressed is True
        assert result.suppress_reason is not None
        assert "trend" in result.suppress_reason
        assert "chop" in result.suppress_reason.lower()

    def test_trend_chop_below_threshold_proceeds(self):
        """trend + CHOP + confidence 0.65 → entry proceeds."""
        result = chop_suppress_entry(_chop(0.65), lane="trend")
        assert result.suppressed is False
        assert result.suppress_reason is None

    def test_trend_chop_at_threshold_suppressed(self):
        """trend + CHOP + confidence == 0.70 → suppressed (boundary inclusive)."""
        result = chop_suppress_entry(_chop(0.70), lane="trend")
        assert result.suppressed is True

    def test_trend_trend_up_proceeds(self):
        """trend + TREND_UP → proceeds regardless of confidence."""
        result = chop_suppress_entry(_trend_up(0.99), lane="trend")
        assert result.suppressed is False
        assert result.suppress_reason is None

    def test_trend_trend_down_proceeds(self):
        """trend + TREND_DOWN → proceeds regardless of confidence."""
        result = chop_suppress_entry(_trend_down(0.99), lane="trend")
        assert result.suppressed is False

    def test_swing_chop_below_threshold_proceeds(self):
        """swing + CHOP + confidence 0.80 → proceeds (below swing threshold 0.85)."""
        result = chop_suppress_entry(_chop(0.80), lane="swing")
        assert result.suppressed is False
        assert result.suppress_reason is None

    def test_swing_chop_above_threshold_suppressed(self):
        """swing + CHOP + confidence 0.90 → suppressed."""
        result = chop_suppress_entry(_chop(0.90), lane="swing")
        assert result.suppressed is True
        assert result.suppress_reason is not None
        assert "swing" in result.suppress_reason

    def test_swing_chop_at_threshold_suppressed(self):
        """swing + CHOP + confidence == 0.85 → suppressed (boundary inclusive)."""
        result = chop_suppress_entry(_chop(0.85), lane="swing")
        assert result.suppressed is True

    def test_scalp_chop_high_confidence_proceeds(self):
        """scalp + CHOP + confidence 0.99 → proceeds (scalp never suspended)."""
        result = chop_suppress_entry(_chop(0.99), lane="scalp")
        assert result.suppressed is False
        assert result.suppress_reason is None

    def test_scalp_chop_any_confidence_proceeds(self):
        """scalp is always exempt regardless of confidence."""
        for conf in [0.5, 0.70, 0.85, 0.99, 1.0]:
            result = chop_suppress_entry(_chop(conf), lane="scalp")
            assert result.suppressed is False, f"scalp should never suppress at conf={conf}"


class TestChopSuppressionTelemetry:
    """ChopSuppressionResult fields are always populated."""

    def test_result_fields_when_suppressed(self):
        result = chop_suppress_entry(_chop(0.90), lane="trend")
        assert result.regime == "CHOP"
        assert result.confidence == pytest.approx(0.90)
        assert result.lane == "trend"
        assert result.suppressed is True
        assert isinstance(result.suppress_reason, str)

    def test_result_fields_when_not_suppressed(self):
        result = chop_suppress_entry(_trend_up(0.8), lane="trend")
        assert result.regime == "TREND_UP"
        assert result.confidence == pytest.approx(0.8)
        assert result.lane == "trend"
        assert result.suppressed is False
        assert result.suppress_reason is None

    def test_as_dict_keys_present(self):
        result = chop_suppress_entry(_chop(0.90), lane="trend")
        d = result.as_dict()
        assert set(d.keys()) == {
            "regime", "confidence", "lane", "suppressed", "suppress_reason",
        }
        assert d["suppressed"] is True
        assert isinstance(d["suppress_reason"], str)

    def test_as_dict_not_suppressed(self):
        result = chop_suppress_entry(_chop(0.60), lane="swing")
        d = result.as_dict()
        assert d["suppressed"] is False
        assert d["suppress_reason"] is None


class TestChopSuppressionThresholdOverride:
    """Registry-overridable thresholds change behavior."""

    def test_lower_trend_threshold_triggers_earlier(self):
        # At confidence 0.55, default threshold (0.70) would NOT suppress.
        # Lowered threshold (0.50) SHOULD suppress.
        default_result = chop_suppress_entry(_chop(0.55), lane="trend")
        assert default_result.suppressed is False

        overridden = chop_suppress_entry(
            _chop(0.55), lane="trend", trend_confidence_threshold=0.50,
        )
        assert overridden.suppressed is True

    def test_higher_trend_threshold_requires_more_confidence(self):
        # At confidence 0.75, default threshold (0.70) suppresses.
        # Raised threshold (0.80) should NOT suppress.
        default_result = chop_suppress_entry(_chop(0.75), lane="trend")
        assert default_result.suppressed is True

        overridden = chop_suppress_entry(
            _chop(0.75), lane="trend", trend_confidence_threshold=0.80,
        )
        assert overridden.suppressed is False

    def test_swing_threshold_override(self):
        # At confidence 0.82, default (0.85) does NOT suppress.
        # Lowered threshold (0.80) SHOULD suppress.
        default_result = chop_suppress_entry(_chop(0.82), lane="swing")
        assert default_result.suppressed is False

        overridden = chop_suppress_entry(
            _chop(0.82), lane="swing", swing_confidence_threshold=0.80,
        )
        assert overridden.suppressed is True


class TestChopSuppressionObserveLane:
    """observe lane falls back to swing — should not be suppressed at swing
    level since caller maps observe → swing before calling suppressor."""

    def test_observe_lane_not_suppressed_at_swing_threshold(self):
        # The caller (tick.py, loop.ts) maps 'observe' → 'swing' for
        # sizing; the suppressor receives the mapped lane. If someone
        # passes 'observe' directly (unusual), it is treated as a
        # non-swing, non-trend, non-scalp lane → no suppression.
        result = chop_suppress_entry(_chop(0.99), lane="observe")
        assert result.suppressed is False


class TestChopSuppressionConstants:
    """Module-level constants match the documented defaults."""

    def test_trend_confidence_default(self):
        assert CHOP_SUPPRESS_TREND_CONFIDENCE_DEFAULT == pytest.approx(0.70)

    def test_swing_confidence_default(self):
        assert CHOP_SUPPRESS_SWING_CONFIDENCE_DEFAULT == pytest.approx(0.85)


class TestTSPythonParity:
    """Verify the decision table is consistent with the TypeScript
    implementation spec (regime.ts chopSuppressEntry). Both sides
    share the same thresholds and rules; this test is the canonical
    parity table."""

    CASES = [
        # (lane, regime, confidence, expected_suppressed)
        ("trend", "CHOP",      0.75, True),
        ("trend", "CHOP",      0.65, False),
        ("trend", "CHOP",      0.70, True),   # boundary inclusive
        ("trend", "TREND_UP",  0.99, False),
        ("trend", "TREND_DOWN",0.99, False),
        ("swing", "CHOP",      0.80, False),
        ("swing", "CHOP",      0.90, True),
        ("swing", "CHOP",      0.85, True),   # boundary inclusive
        ("scalp", "CHOP",      0.99, False),
        ("scalp", "CHOP",      1.0,  False),
    ]

    @pytest.mark.parametrize("lane,regime_label,confidence,expected", CASES)
    def test_parity_table(
        self, lane: str, regime_label: str, confidence: float, expected: bool,
    ) -> None:
        r = RegimeReading(
            regime=regime_label,  # type: ignore[arg-type]
            confidence=confidence,
            trend_strength=0.5 if "TREND" in regime_label else 0.0,
            chop_score=0.1 if "TREND" in regime_label else 0.9,
        )
        result = chop_suppress_entry(r, lane)
        assert result.suppressed is expected, (
            f"lane={lane} regime={regime_label} conf={confidence} "
            f"expected_suppressed={expected} got={result.suppressed}"
        )
