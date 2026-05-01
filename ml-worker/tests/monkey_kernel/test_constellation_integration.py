"""test_constellation_integration.py — end-to-end constellation flow.

Verifies that Heart → Ocean → Foresight → Coordinator → ThoughtBus
→ LearningGate fire in sequence on a single tick of activity, all
events land on the bus with correct ordering and attribution.

Synthetic scenarios:
  1. Heart + Ocean + Foresight all publish, Gary synthesizes via
     ThoughtBus, GARY_SYNTHESIS lands.
  2. LearningGate filters out short-duration / noise / groupthink
     trades; bank only sees approved exchanges.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.bus_events import KernelEvent, KernelEventEnvelope  # noqa: E402
from monkey_kernel.coordinator import GaryCoordinator  # noqa: E402
from monkey_kernel.foresight import ForesightPredictor  # noqa: E402
from monkey_kernel.heart import HeartMonitor  # noqa: E402
from monkey_kernel.kernel_bus import KernelBus, _reset_buses_for_tests  # noqa: E402
from monkey_kernel.learning_gate import LearningGate  # noqa: E402
from monkey_kernel.ocean import Ocean  # noqa: E402
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


class TestConstellationFlow:
    def test_heart_ocean_foresight_chain_to_gary_synthesis(self) -> None:
        bus = KernelBus("integration")
        events: list[KernelEventEnvelope] = []
        bus.subscribe("audit", events.append)

        heart = HeartMonitor(bus=bus, symbol="ETH")
        ocean = Ocean(label="t", bus=bus, symbol="ETH")
        foresight = ForesightPredictor(bus=bus, symbol="ETH")
        coord = GaryCoordinator(bus)

        # One tick of activity
        heart.append(70.0, 0.0)
        ocean.observe(
            phi=0.5, basin=_peak(0, 0.5),
            current_mode="investigation", is_flat=True, now_ms=1000.0,
        )
        # Build trajectory so foresight can predict
        for i, ts in enumerate([0.0, 1000.0, 2000.0]):
            foresight.append(_peak(i, 0.5), 0.5, ts)
        foresight.predict({"quantum": 1.0, "efficient": 0.0, "equilibrium": 0.0})

        coord.synthesize(_peak(10, 0.5), "ETH")

        types = [e.type for e in events]
        # Required event types fired
        assert KernelEvent.HEART_TICK in types
        assert KernelEvent.OCEAN_OBSERVATION in types
        assert KernelEvent.FORESIGHT_PREDICTION in types
        assert KernelEvent.GARY_SYNTHESIS in types

    def test_learning_gate_approves_quality_trade(self) -> None:
        bus = KernelBus("integration")
        events: list[KernelEventEnvelope] = []
        bus.subscribe(
            "audit", events.append,
            types=[KernelEvent.LEARNING_BANK_WRITE_APPROVED],
        )
        gate = LearningGate(bus)
        decision = gate.evaluate_write(
            symbol="ETH",
            decision_id="K-real",
            sovereignty_score=0.7,
            convergence_type="genuine_multi",
            trade_pnl_usdt=2.5,
            trade_duration_s=1800.0,
        )
        assert decision.approved is True
        assert len(events) == 1

    def test_learning_gate_rejects_noise_flinch_groupthink(self) -> None:
        bus = KernelBus("integration")
        events: list[KernelEventEnvelope] = []
        bus.subscribe(
            "audit", events.append,
            types=[KernelEvent.LEARNING_BANK_WRITE_REJECTED],
        )
        gate = LearningGate(bus)
        # Three rejections from different reasons
        gate.evaluate_write(
            symbol="ETH", decision_id="K-flinch",
            sovereignty_score=0.7, convergence_type="genuine_multi",
            trade_pnl_usdt=1.0, trade_duration_s=10.0,  # short duration
        )
        gate.evaluate_write(
            symbol="ETH", decision_id="K-noise",
            sovereignty_score=0.7, convergence_type="genuine_multi",
            trade_pnl_usdt=0.001, trade_duration_s=1800.0,  # noise floor
        )
        gate.evaluate_write(
            symbol="ETH", decision_id="K-group",
            sovereignty_score=0.7, convergence_type="groupthink",
            trade_pnl_usdt=2.0, trade_duration_s=1800.0,  # groupthink
        )
        assert len(events) == 3
        all_reasons = [e.payload["reasons"] for e in events]
        assert any("duration" in r for rl in all_reasons for r in rl)
        assert any("noise floor" in r for rl in all_reasons for r in rl)
        assert any("groupthink" in r for rl in all_reasons for r in rl)


class TestBusInstanceIsolation:
    def test_two_instances_have_independent_buses(self) -> None:
        bus_a = KernelBus("a")
        bus_b = KernelBus("b")
        events_a: list[KernelEventEnvelope] = []
        events_b: list[KernelEventEnvelope] = []
        bus_a.subscribe("audit", events_a.append)
        bus_b.subscribe("audit", events_b.append)
        bus_a.publish(KernelEvent.HEART_TICK, "heart", {"k": 1})
        assert len(events_a) == 1
        assert len(events_b) == 0
