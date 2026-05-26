"""test_kernel_predictions.py — Issue #941 Phase 1 (Python parity).

Pins the observer-derived cadence + basin-dimension invariants. The
write path is deferred to Phase 1b (consensus arbiter live cutover);
this test file covers what's shippable now.
"""

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.kernel_predictions import (  # noqa: E402
    BASIN_DIM,
    KernelPredictionSnapshot,
    periodic_cadence_seconds,
    validate_basin_shape,
)


def _uniform_basin():
    return [1.0 / BASIN_DIM] * BASIN_DIM


class TestPeriodicCadenceSeconds:
    """Observer-derived cadence — mirror of TS helper invariants."""

    def test_clamps_low_at_5s_minimum(self):
        # very high velocity → tiny → clamp at 5
        assert periodic_cadence_seconds(10.0) == 5.0

    def test_clamps_high_at_300s_maximum(self):
        # very low velocity → huge → clamp at 300
        assert periodic_cadence_seconds(0.001) == 300.0

    def test_returns_inverse_in_normal_range(self):
        assert periodic_cadence_seconds(0.1) == 10.0
        assert periodic_cadence_seconds(0.05) == 20.0
        assert periodic_cadence_seconds(0.02) == 50.0

    def test_fallback_60s_on_degenerate_input(self):
        assert periodic_cadence_seconds(0) == 60.0
        assert periodic_cadence_seconds(-1.0) == 60.0
        assert periodic_cadence_seconds(float("nan")) == 60.0


class TestBasinShapeValidation:
    """Defensive guard at the write boundary — mirrors TS check."""

    def test_accepts_64_element_basin(self):
        assert validate_basin_shape(_uniform_basin(), "perception") is True

    def test_rejects_undersized_basin(self):
        assert validate_basin_shape([1 / 32] * 32, "perception") is False

    def test_rejects_oversized_basin(self):
        assert validate_basin_shape([1 / 128] * 128, "perception") is False


class TestSnapshotDataclass:
    """The payload shape is the public contract — frozen so it can't be
    mutated by callers after construction."""

    def test_constructs_with_full_payload(self):
        snap = KernelPredictionSnapshot(
            trade_id=42,
            kernel_id="monkey-position|BTC_USDT_PERP",
            perception_basin=_uniform_basin(),
            strategy_forecast_basin=_uniform_basin(),
            basin_velocity=0.05,
            phi=0.6,
            kappa_eff=64.0,
            predicted_horizon_seconds=300.0,
            predicted_terminal_pnl_usdt=1.5,
            predicted_pnl_stddev_usdt=0.5,
            predicted_direction=1,
            predicted_confidence=0.7,
            dopamine=0.5, serotonin=0.5, norepinephrine=0.5,
            gaba=0.5, endorphins=0.5, acetylcholine=0.5,
            regime_quantum=0.33, regime_efficient=0.33, regime_equilibrium=0.34,
            mode="investigation",
            lane="swing",
            snapshot_reason="periodic",
            triggering_gate=None,
            kernel_version="monkey-0.9.0-i941",
            source_path="tick.py:_decide_K",
        )
        assert snap.trade_id == 42
        assert snap.snapshot_reason == "periodic"
        assert len(snap.perception_basin) == BASIN_DIM

    def test_payload_is_frozen(self):
        """`frozen=True` on the dataclass enforces immutability — callers
        can't accidentally mutate a snapshot after construction (this is
        part of the READ-ONLY doctrinal guarantee at the type level)."""
        snap = KernelPredictionSnapshot(
            trade_id=None, kernel_id="test",
            perception_basin=_uniform_basin(),
            strategy_forecast_basin=_uniform_basin(),
            basin_velocity=None, phi=None, kappa_eff=None,
            predicted_horizon_seconds=None,
            predicted_terminal_pnl_usdt=None,
            predicted_pnl_stddev_usdt=None,
            predicted_direction=None,
            predicted_confidence=None,
            dopamine=None, serotonin=None, norepinephrine=None,
            gaba=None, endorphins=None, acetylcholine=None,
            regime_quantum=None, regime_efficient=None, regime_equilibrium=None,
            mode=None, lane=None,
            snapshot_reason="periodic",
            triggering_gate=None,
            kernel_version="test", source_path="test",
        )

        try:
            snap.trade_id = 99  # type: ignore[misc]
        except Exception:
            return
        raise AssertionError("Expected FrozenInstanceError on field assignment")
