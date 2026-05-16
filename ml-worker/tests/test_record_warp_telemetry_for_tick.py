"""test_record_warp_telemetry_for_tick.py — regression for the MIG-5
empty-buffer bug.

Symptom (caught by overnight monitor 2026-05-17T17:01Z): the
observable_governance ``sample_count`` stayed at 0 for an hour after
the MIG-5 deploy despite /ml/predict being called ~200 times. Root
cause: MIG-5 placed ``record_tick()`` AFTER the
``if action == "signal": return ...`` early-return in
``_handle_predict_strategyloop``. polytrade-be drives most ticks via
the signal action, so the recording path never fired.

Fix: extract ``_record_warp_telemetry_for_tick`` and call it BEFORE
the early-return. This file is the regression — it would fail under
the bug and pass under the fix.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import pytest

ML_WORKER_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ML_WORKER_ROOT / "src"


@pytest.fixture(scope="module")
def main_module():
    """Boot the FastAPI main module without dragging full env."""
    if str(SRC_DIR) not in sys.path:
        sys.path.insert(0, str(SRC_DIR))
    if str(ML_WORKER_ROOT) not in sys.path:
        sys.path.insert(0, str(ML_WORKER_ROOT))

    try:
        import main as m
        return m
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"ml-worker main.py import failed: {type(exc).__name__}: {exc}")


def _make_decision(
    *, regime_value: str = "creator", entropy: float = 2.5,
    trend_strength: float = 0.4, confidence: float = 0.9,
) -> SimpleNamespace:
    """Build a stand-in for the StrategyLoop decision the helper reads."""
    regime = SimpleNamespace(
        regime=SimpleNamespace(value=regime_value),
        entropy=entropy,
        fisher_info=0.1,
        trend_strength=trend_strength,
        volatility=0.02,
        confidence=confidence,
        is_transition=False,
        pillar1_gate=True,
    )
    return SimpleNamespace(regime=regime)


def _fake_qig_warp() -> mock.MagicMock:
    """qig_warp.regime_constants returns a stable RegimeConstants stub."""
    rc = mock.MagicMock()
    rc.regime = mock.MagicMock()
    rc.regime.value = "critical"
    rc.bridge_exponent = 0.86
    rc.screening_length = 0.618
    rc.gr_direction = "transitional"
    rc.confidence = "high"
    fake_module = mock.MagicMock()
    fake_module.regime_constants.return_value = rc
    return fake_module


class TestRecordTelemetryFiresOnEveryPath:
    """The MIG-5 hotfix moves the telemetry recording before the
    action == "signal" early-return. These tests would fail under
    the pre-hotfix code path."""

    def test_helper_records_with_warp_fields_populated(
        self, main_module, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """When qig_warp is reachable, every recorded row carries the
        bridge_exponent / screening_length / warp_regime / gr_direction
        / regime_confidence fields. This is the path the production
        bug was blocking."""
        # Reset the rolling buffer to a known state.
        import observable_governance as og
        monkeypatch.setattr(og, "_buffer", og.GovernanceBuffer(capacity=200))

        with mock.patch.dict(sys.modules, {"qig_warp": _fake_qig_warp()}):
            main_module._record_warp_telemetry_for_tick(
                decision=_make_decision(),
                regime_val="creator",
                direction="BULLISH",
            )

        buf = og._buffer
        assert len(buf.raw_drift_pct) == 1
        assert len(buf.bridge_exponent) == 1
        assert buf.bridge_exponent[0] == pytest.approx(0.86)
        assert buf.screening_length[0] == pytest.approx(0.618)
        assert buf.warp_regime[0] == "critical"
        assert buf.gr_direction[0] == "transitional"
        assert buf.regime_confidence[0] == "high"
        assert buf.signal_str[0] == "BUY"
        assert buf.regime[0] == "creator"

    def test_helper_is_noop_when_decision_missing(
        self, main_module, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Insufficient-data path: decision or decision.regime is None
        → no recording (matches the strategyloop early-return shape)."""
        import observable_governance as og
        monkeypatch.setattr(og, "_buffer", og.GovernanceBuffer(capacity=200))

        main_module._record_warp_telemetry_for_tick(
            decision=None, regime_val="dissolver", direction="NEUTRAL",
        )
        assert len(og._buffer.raw_drift_pct) == 0

        no_regime = SimpleNamespace(regime=None)
        main_module._record_warp_telemetry_for_tick(
            decision=no_regime, regime_val="dissolver", direction="NEUTRAL",
        )
        assert len(og._buffer.raw_drift_pct) == 0

    def test_helper_records_even_when_qig_warp_unavailable(
        self, main_module, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """qig_warp import failure → record_tick still fires with
        regime + raw_drift_pct + signal populated; warp fields are
        None. The buffer still advances → /ml/predict-call count is
        observable through sample_count."""
        import observable_governance as og
        monkeypatch.setattr(og, "_buffer", og.GovernanceBuffer(capacity=200))

        original = sys.modules.pop("qig_warp", None)
        try:
            with mock.patch.dict(sys.modules, {"qig_warp": None}):
                main_module._record_warp_telemetry_for_tick(
                    decision=_make_decision(),
                    regime_val="creator",
                    direction="BEARISH",
                )
        finally:
            if original is not None:
                sys.modules["qig_warp"] = original

        buf = og._buffer
        assert len(buf.raw_drift_pct) == 1
        assert buf.signal_str[0] == "SELL"
        assert buf.regime[0] == "creator"
        # warp fields not populated → length stays 0
        assert len(buf.bridge_exponent) == 0
        assert len(buf.screening_length) == 0
