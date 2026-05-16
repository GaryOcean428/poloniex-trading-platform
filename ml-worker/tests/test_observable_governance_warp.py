"""test_observable_governance_warp.py — MIG-5 qig-warp telemetry surface.

Tests the MIG-5 extension to ``observable_governance`` that records
per-tick qig-warp regime telemetry (bridge_exponent, screening_length,
warp_regime, gr_direction, regime_confidence) and surfaces it in
``report_as_dict``'s ``warp_telemetry`` block.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import observable_governance as og  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_buffer():
    og._buffer = og.GovernanceBuffer(capacity=200)
    yield
    og._buffer = og.GovernanceBuffer(capacity=200)


class TestRecordTickAcceptsWarpFields:
    def test_record_tick_with_warp_fields(self) -> None:
        og.record_tick(
            raw_drift_pct=0.005,
            signal="BUY",
            regime="creator",
            bridge_exponent=0.86,
            screening_length=0.618,
            warp_regime="critical",
            gr_direction="transitional",
            regime_confidence="high",
        )
        buf = og._buffer
        assert len(buf.bridge_exponent) == 1
        assert buf.bridge_exponent[0] == pytest.approx(0.86)
        assert buf.screening_length[0] == pytest.approx(0.618)
        assert buf.warp_regime[0] == "critical"
        assert buf.gr_direction[0] == "transitional"
        assert buf.regime_confidence[0] == "high"

    def test_record_tick_backward_compatible_without_warp(self) -> None:
        """Legacy callers that omit warp fields must continue to work."""
        og.record_tick(raw_drift_pct=0.005, signal="BUY", regime="creator")
        buf = og._buffer
        assert len(buf.raw_drift_pct) == 1
        assert len(buf.bridge_exponent) == 0
        assert len(buf.screening_length) == 0


class TestReportSurfacesWarpTelemetry:
    def test_warp_telemetry_block_in_report_dict(self) -> None:
        # 10 ticks with realistic CRITICAL regime values
        for _ in range(10):
            og.record_tick(
                raw_drift_pct=0.004,
                signal="BUY",
                regime="creator",
                bridge_exponent=0.86,
                screening_length=0.618,
                warp_regime="critical",
                gr_direction="transitional",
                regime_confidence="high",
            )
        # 5 ticks with ORDERED regime
        for _ in range(5):
            og.record_tick(
                raw_drift_pct=0.002,
                signal="BUY",
                regime="preserver",
                bridge_exponent=0.0,
                screening_length=2.0,
                warp_regime="ordered",
                gr_direction="heavy_faster",
                regime_confidence="medium",
            )
        report = og.report_as_dict()
        assert "warp_telemetry" in report
        wt = report["warp_telemetry"]
        # Bridge exponent stats
        assert wt["bridge_exponent"]["samples"] == 15
        assert wt["bridge_exponent"]["min"] == pytest.approx(0.0)
        assert wt["bridge_exponent"]["max"] == pytest.approx(0.86)
        # Screening length stats
        assert wt["screening_length"]["samples"] == 15
        assert wt["screening_length"]["min"] == pytest.approx(0.618)
        assert wt["screening_length"]["max"] == pytest.approx(2.0)
        # Regime distribution
        assert wt["regime_distribution"] == {"critical": 10, "ordered": 5}
        assert wt["gr_direction_distribution"] == {
            "transitional": 10, "heavy_faster": 5,
        }
        assert wt["regime_confidence_distribution"] == {"high": 10, "medium": 5}

    def test_warp_telemetry_empty_when_no_warp_data(self) -> None:
        """Pure legacy callers (no warp fields) → warp_telemetry empty
        dict. Doesn't break report_as_dict shape."""
        for _ in range(3):
            og.record_tick(raw_drift_pct=0.001, signal="HOLD", regime="dissolver")
        report = og.report_as_dict()
        assert "warp_telemetry" in report
        assert report["warp_telemetry"] == {}


class TestTickCountTotalFreshness:
    """Regression: ``sample_count`` plateaus at the deque ``maxlen``
    (200) once the rolling buffer fills, so external freshness checks
    cannot use it. ``tick_count_total`` is the unbounded monotonic
    counter that DOES advance on every record — overnight monitor
    2026-05-17T18:13Z surfaced this false-positive freshness alert
    when the buffer hit capacity. This test proves the counter
    advances past the buffer cap."""

    def test_tick_count_total_advances_past_buffer_cap(self) -> None:
        """Push more ticks than the buffer capacity. ``sample_count``
        caps at 200; ``tick_count_total`` keeps climbing."""
        # Small buffer for the test — same shape as production.
        og._buffer = og.GovernanceBuffer(capacity=200)
        # Override the deque maxlens to match the capacity parameter
        # so we don't have to push thousands of ticks.
        from collections import deque
        og._buffer.raw_drift_pct = deque(maxlen=10)
        og._buffer.signal_str = deque(maxlen=10)
        og._buffer.regime = deque(maxlen=10)
        og._buffer.bridge_exponent = deque(maxlen=10)
        og._buffer.screening_length = deque(maxlen=10)
        og._buffer.warp_regime = deque(maxlen=10)
        og._buffer.gr_direction = deque(maxlen=10)
        og._buffer.regime_confidence = deque(maxlen=10)

        for i in range(25):
            og.record_tick(
                raw_drift_pct=0.001,
                signal="HOLD",
                regime="dissolver",
                bridge_exponent=0.38,
                screening_length=0.784,
                warp_regime="disordered",
            )

        report = og.report_as_dict()
        # sample_count is the len() of the bounded deque — capped at 10.
        assert report["sample_count"] == 10
        # tick_count_total is the monotonic ground-truth — 25 because
        # 25 ticks were pushed.
        assert report["tick_count_total"] == 25
        # Continued ticks → counter keeps climbing past buffer cap.
        for _ in range(15):
            og.record_tick(raw_drift_pct=0.001, signal="HOLD", regime="dissolver")
        report = og.report_as_dict()
        assert report["sample_count"] == 10  # still capped
        assert report["tick_count_total"] == 40

    def test_tick_count_total_starts_at_zero(self) -> None:
        og._buffer = og.GovernanceBuffer(capacity=200)
        report = og.report_as_dict()
        assert report["tick_count_total"] == 0
        assert report["sample_count"] == 0


class TestHJDiagnosticSurface:
    """Regression: 2026-05-17T20:24Z escalation surfaced mono-DISORDERED
    pinned for 80 minutes. To diagnose whether the cause is (a) genuine
    extended chop, (b) identical (h,J) inputs across ticks, or (c)
    qig_warp output being quantized away despite varied inputs, the
    operator needs the rolling (h, J) input stats. These tests verify
    that surface."""

    def test_h_j_inputs_recorded_and_surfaced(self) -> None:
        og._buffer = og.GovernanceBuffer(capacity=200)
        # 10 ticks with varying h, J landing above the DISORDERED threshold
        # (h/J > 3.65 for all). All would classify as DISORDERED.
        for i in range(10):
            og.record_tick(
                raw_drift_pct=0.001,
                signal="HOLD",
                regime="dissolver",
                bridge_exponent=0.38,
                screening_length=0.784,
                warp_regime="disordered",
                h_input=3.5 + 0.1 * i,
                j_input=0.05 + 0.005 * i,
            )
        report = og.report_as_dict()
        wt = report["warp_telemetry"]
        assert "h_input" in wt
        assert wt["h_input"]["samples"] == 10
        assert wt["h_input"]["min"] == pytest.approx(3.5)
        assert wt["h_input"]["max"] == pytest.approx(4.4)
        assert wt["h_input"]["stddev"] > 0
        assert "j_input" in wt
        assert wt["j_input"]["samples"] == 10
        # h/J ratio
        assert "h_j_ratio" in wt
        # All 10 ratios > 3.65 (above DISORDERED threshold)
        assert wt["h_j_ratio"]["above_disordered_threshold_frac"] == pytest.approx(1.0)
        assert wt["h_j_ratio"]["min"] > 3.653

    def test_h_j_diagnostic_detects_identical_inputs(self) -> None:
        """If the same (h, J) is recorded 20 times, stddev == 0 — that
        proves the inputs are stuck, not just the regime quantization."""
        og._buffer = og.GovernanceBuffer(capacity=200)
        for _ in range(20):
            og.record_tick(
                raw_drift_pct=0.001,
                signal="HOLD",
                regime="dissolver",
                warp_regime="disordered",
                bridge_exponent=0.38,
                screening_length=0.784,
                h_input=3.5,
                j_input=0.5,
            )
        report = og.report_as_dict()
        wt = report["warp_telemetry"]
        assert wt["h_input"]["stddev"] == 0.0
        assert wt["j_input"]["stddev"] == 0.0
        assert wt["h_j_ratio"]["stddev"] == 0.0
        assert wt["h_j_ratio"]["mean"] == pytest.approx(7.0)

    def test_h_j_diagnostic_below_threshold_frac(self) -> None:
        """When h/J straddles the DISORDERED threshold, the fraction
        above shows it. Validates the threshold computation."""
        og._buffer = og.GovernanceBuffer(capacity=200)
        # 4 ticks above 3.65 + 6 ticks below = 0.4
        for h, j in [(4.0, 1.0), (5.0, 1.0), (10.0, 1.0), (4.0, 1.0)]:
            og.record_tick(
                raw_drift_pct=0.001, signal="HOLD", regime="dissolver",
                bridge_exponent=0.38, screening_length=0.784, warp_regime="disordered",
                h_input=h, j_input=j,
            )
        for h, j in [(1.0, 1.0), (2.0, 1.0), (2.5, 1.0), (0.5, 1.0), (1.5, 1.0), (3.0, 1.0)]:
            og.record_tick(
                raw_drift_pct=0.001, signal="HOLD", regime="creator",
                bridge_exponent=0.86, screening_length=0.618, warp_regime="critical",
                h_input=h, j_input=j,
            )
        report = og.report_as_dict()
        wt = report["warp_telemetry"]
        assert wt["h_j_ratio"]["above_disordered_threshold_frac"] == pytest.approx(0.4)
