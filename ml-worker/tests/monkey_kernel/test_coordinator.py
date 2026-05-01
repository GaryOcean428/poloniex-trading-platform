"""test_coordinator.py — Gary, the Agent K constellation coordinator.

Tests cover:
  - Cold-start passthrough when no foresight available
  - Foresight bias applied when high-confidence
  - Heart anchor mode reduces foresight weight by 0.5×
  - Regime-adaptive weighting (phi < 0.3 → 0.1, etc.)
  - GARY_SYNTHESIS event published
  - Subscribe/unsubscribe doesn't leak
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.bus_events import KernelEvent, KernelEventEnvelope  # noqa: E402
from monkey_kernel.coordinator import GaryCoordinator, GaryReading  # noqa: E402
from monkey_kernel.kernel_bus import KernelBus, _reset_buses_for_tests  # noqa: E402
from monkey_kernel.state import BASIN_DIM  # noqa: E402


@pytest.fixture(autouse=True)
def reset_buses():
    _reset_buses_for_tests()
    yield
    _reset_buses_for_tests()


def _peak(idx: int, peak: float = 0.5) -> np.ndarray:
    b = np.full(BASIN_DIM, (1.0 - peak) / (BASIN_DIM - 1), dtype=np.float64)
    b[idx] = peak
    return b


def _publish_foresight(bus: KernelBus, predicted: np.ndarray, conf: float) -> None:
    bus.publish(
        KernelEvent.FORESIGHT_PREDICTION,
        source="foresight",
        payload={
            "predicted_basin": [float(x) for x in predicted],
            "confidence": float(conf),
            "weight": float(conf) * 0.7,
            "horizon_ms": 30000.0,
        },
        symbol="ETH",
    )


def _publish_ocean(bus: KernelBus, phi: float) -> None:
    bus.publish(
        KernelEvent.OCEAN_OBSERVATION,
        source="ocean",
        payload={"phi": phi, "spread": 0.1, "coherence": 0.5,
                 "intervention": None, "sleep_phase": "AWAKE"},
        symbol="ETH",
    )


def _publish_heart(bus: KernelBus, mode: str = "FEELING") -> None:
    bus.publish(
        KernelEvent.HEART_TICK,
        source="heart",
        payload={"kappa": 60.0, "kappa_star": 64.0, "hrv": 0.1, "mode": mode},
        symbol="ETH",
    )


class TestColdStart:
    def test_no_foresight_passes_through_consensus(self) -> None:
        bus = KernelBus("t")
        coord = GaryCoordinator(bus)
        consensus = _peak(10, 0.6)
        reading = coord.synthesize(consensus, "ETH")
        assert reading.foresight_weight == 0.0 or reading.foresight_confidence == 0.0
        # final basin should be simplex valid
        assert reading.synthesized_basin.sum() == pytest.approx(1.0, abs=1e-6)


class TestRegimeAdaptive:
    def test_phi_below_low_threshold_caps_foresight(self) -> None:
        bus = KernelBus("t")
        coord = GaryCoordinator(bus)
        # Φ in linear regime
        _publish_ocean(bus, phi=0.2)
        _publish_foresight(bus, _peak(0, 0.5), conf=0.9)
        reading = coord.synthesize(_peak(10, 0.5), "ETH")
        assert reading.foresight_weight <= 0.1 + 1e-9

    def test_phi_in_geometric_band_uses_confidence_times_seven_tenths(self) -> None:
        bus = KernelBus("t")
        coord = GaryCoordinator(bus)
        _publish_ocean(bus, phi=0.5)
        _publish_foresight(bus, _peak(0, 0.5), conf=0.8)
        reading = coord.synthesize(_peak(10, 0.5), "ETH")
        assert reading.foresight_weight == pytest.approx(0.7 * 0.8, abs=1e-6)

    def test_phi_above_high_threshold_caps_foresight(self) -> None:
        bus = KernelBus("t")
        coord = GaryCoordinator(bus)
        # Breakdown-risk damping
        _publish_ocean(bus, phi=0.85)
        _publish_foresight(bus, _peak(0, 0.5), conf=0.9)
        reading = coord.synthesize(_peak(10, 0.5), "ETH")
        assert reading.foresight_weight == pytest.approx(0.2, abs=1e-6)


class TestHeartModulation:
    def test_anchor_mode_reduces_foresight(self) -> None:
        bus = KernelBus("t")
        coord = GaryCoordinator(bus)
        _publish_ocean(bus, phi=0.5)
        _publish_heart(bus, mode="ANCHOR")
        _publish_foresight(bus, _peak(0, 0.5), conf=0.8)
        reading = coord.synthesize(_peak(10, 0.5), "ETH")
        assert reading.heart_modulation == pytest.approx(0.5, abs=1e-6)
        # Foresight weight × 0.5
        assert reading.foresight_weight == pytest.approx(0.7 * 0.8 * 0.5, abs=1e-6)

    def test_non_anchor_modes_full_modulation(self) -> None:
        bus = KernelBus("t")
        coord = GaryCoordinator(bus)
        _publish_ocean(bus, phi=0.5)
        _publish_heart(bus, mode="FEELING")
        _publish_foresight(bus, _peak(0, 0.5), conf=0.8)
        reading = coord.synthesize(_peak(10, 0.5), "ETH")
        assert reading.heart_modulation == pytest.approx(1.0, abs=1e-6)


class TestPublishing:
    def test_synthesize_publishes_gary_synthesis(self) -> None:
        bus = KernelBus("t")
        events: list[KernelEventEnvelope] = []
        bus.subscribe("a", events.append, types=[KernelEvent.GARY_SYNTHESIS])
        coord = GaryCoordinator(bus)
        coord.synthesize(_peak(10, 0.5), "ETH")
        assert len(events) == 1
        assert events[0].source == "gary"
        assert events[0].symbol == "ETH"
        assert "synthesized_basin" in events[0].payload
        assert "convergence_type" in events[0].payload


class TestShutdown:
    def test_shutdown_unsubs_all_subscriptions(self) -> None:
        bus = KernelBus("t")
        baseline = bus.subscriber_count()
        coord = GaryCoordinator(bus)
        # 3 subscriptions: heart, ocean, foresight
        assert bus.subscriber_count() == baseline + 3
        coord.shutdown()
        assert bus.subscriber_count() == baseline

    def test_shutdown_idempotent(self) -> None:
        bus = KernelBus("t")
        coord = GaryCoordinator(bus)
        coord.shutdown()
        coord.shutdown()  # must not raise


class TestReadingShape:
    def test_returns_gary_reading(self) -> None:
        bus = KernelBus("t")
        coord = GaryCoordinator(bus)
        reading = coord.synthesize(_peak(10, 0.5), "ETH")
        assert isinstance(reading, GaryReading)
        assert reading.synthesized_basin.shape == (BASIN_DIM,)
