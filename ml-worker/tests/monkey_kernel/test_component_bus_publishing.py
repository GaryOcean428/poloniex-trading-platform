"""test_component_bus_publishing.py — component bus migration.

Each kernel component publishes the expected event types with correct
payload shapes when a bus is provided. Without a bus, components
continue to function unchanged (legacy null-bus path).
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.bus_events import KernelEvent, KernelEventEnvelope  # noqa: E402
from monkey_kernel.foresight import ForesightPredictor  # noqa: E402
from monkey_kernel.forge import ShadowEvent, forge  # noqa: E402
from monkey_kernel.heart import HeartMonitor  # noqa: E402
from monkey_kernel.kernel_bus import KernelBus, _reset_buses_for_tests  # noqa: E402
from monkey_kernel.ocean import Ocean  # noqa: E402
from monkey_kernel.state import BASIN_DIM, KAPPA_STAR  # noqa: E402
from monkey_kernel.working_memory import WorkingMemory  # noqa: E402


@pytest.fixture(autouse=True)
def reset_buses():
    _reset_buses_for_tests()
    yield
    _reset_buses_for_tests()


def _peak_basin(idx: int, peak: float = 0.5) -> np.ndarray:
    b = np.full(BASIN_DIM, (1.0 - peak) / (BASIN_DIM - 1), dtype=np.float64)
    b[idx] = peak
    return b


# ───────────── HEART ─────────────

class TestHeartPublishing:
    def test_heart_no_bus_still_works(self) -> None:
        h = HeartMonitor()  # no bus
        h.append(64.0, 0.0)
        h.append(70.0, 1000.0)
        h.append(72.0, 2000.0)
        state = h.read()
        assert state.kappa == 72.0

    def test_heart_publishes_tick(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        bus.subscribe("a", received.append, types=[KernelEvent.HEART_TICK])
        h = HeartMonitor(bus=bus, symbol="ETH")
        h.append(70.0, 0.0)
        assert len(received) == 1
        assert received[0].source == "heart"
        assert received[0].symbol == "ETH"
        assert received[0].payload["kappa"] == 70.0
        assert received[0].payload["mode"] == "LOGIC"

    def test_heart_publishes_mode_shift(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        bus.subscribe("a", received.append, types=[KernelEvent.HEART_MODE_SHIFT])
        h = HeartMonitor(bus=bus, symbol="ETH")
        h.append(70.0, 0.0)  # LOGIC
        h.append(60.0, 1000.0)  # FEELING — mode shift
        assert len(received) == 1
        assert received[0].payload["from"] == "LOGIC"
        assert received[0].payload["to"] == "FEELING"

    def test_heart_publishes_tacking(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        bus.subscribe("a", received.append, types=[KernelEvent.HEART_TACKING])
        h = HeartMonitor(bus=bus, symbol="ETH")
        h.append(70.0, 0.0)  # κ > κ* (sign +)
        h.append(60.0, 1000.0)  # κ < κ* (sign -, tacking)
        assert len(received) == 1
        assert received[0].payload["kappa"] == 60.0


# ───────────── OCEAN ─────────────

class TestOceanPublishing:
    def test_ocean_no_bus_still_works(self) -> None:
        o = Ocean(label="t")
        state = o.observe(
            phi=0.6, basin=_peak_basin(0),
            current_mode="investigation", is_flat=True, now_ms=0.0,
        )
        assert state.intervention is None or state.intervention is not None  # smoke

    def test_ocean_publishes_observation(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        bus.subscribe(
            "a", received.append, types=[KernelEvent.OCEAN_OBSERVATION],
        )
        o = Ocean(label="t", bus=bus, symbol="ETH")
        o.observe(
            phi=0.6, basin=_peak_basin(0),
            current_mode="investigation", is_flat=True, now_ms=0.0,
        )
        assert len(received) == 1
        assert received[0].payload["phi"] == 0.6

    def test_ocean_publishes_intervention_when_phi_low(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        bus.subscribe(
            "a", received.append, types=[KernelEvent.OCEAN_INTERVENTION],
        )
        o = Ocean(label="t", bus=bus, symbol="ETH")
        # Φ below ESCAPE bound (0.15)
        o.observe(
            phi=0.10, basin=_peak_basin(0),
            current_mode="investigation", is_flat=True, now_ms=0.0,
        )
        assert len(received) == 1
        assert received[0].payload["intervention"] == "ESCAPE"


# ───────────── FORESIGHT ─────────────

class TestForesightPublishing:
    def test_foresight_no_bus_still_works(self) -> None:
        f = ForesightPredictor()
        f.append(_peak_basin(0), 0.5, 0.0)
        f.append(_peak_basin(1), 0.5, 1000.0)
        f.append(_peak_basin(2), 0.5, 2000.0)
        result = f.predict({"quantum": 1.0, "efficient": 0.0, "equilibrium": 0.0})
        assert result.predicted_basin is not None

    def test_foresight_predict_publishes(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        bus.subscribe(
            "a", received.append, types=[KernelEvent.FORESIGHT_PREDICTION],
        )
        f = ForesightPredictor(bus=bus, symbol="ETH")
        f.append(_peak_basin(0), 0.5, 0.0)
        f.append(_peak_basin(1), 0.5, 1000.0)
        f.append(_peak_basin(2), 0.5, 2000.0)
        f.predict({"quantum": 1.0, "efficient": 0.0, "equilibrium": 0.0})
        assert len(received) == 1
        assert received[0].source == "foresight"

    def test_foresight_divergence_fires_on_large_gap(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        bus.subscribe(
            "a", received.append, types=[KernelEvent.FORESIGHT_DIVERGENCE],
        )
        f = ForesightPredictor(bus=bus, symbol="ETH")
        f.append(_peak_basin(0, peak=0.95), 0.5, 0.0)
        f.append(_peak_basin(1, peak=0.95), 0.5, 1000.0)
        f.append(_peak_basin(2, peak=0.95), 0.5, 2000.0)
        # Predict (caches predicted basin)
        f.predict({"quantum": 1.0, "efficient": 0.0, "equilibrium": 0.0})
        # Append a basin very far from the predicted next-step
        f.append(_peak_basin(63, peak=0.95), 0.5, 3000.0)
        assert len(received) >= 1


# ───────────── FORGE ─────────────

class TestForgePublishing:
    def test_forge_no_bus_still_works(self) -> None:
        result = forge(ShadowEvent(
            basin=_peak_basin(0),
            phi=0.4,
            kappa=70.0,
            realized_pnl=-1.0,
            regime_weights={"quantum": 0.5, "efficient": 0.3, "equilibrium": 0.2},
        ))
        assert result.lesson_summary["loss_magnitude"] == pytest.approx(1.0)

    def test_forge_publishes_phase_shifts(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        bus.subscribe(
            "a", received.append, types=[KernelEvent.FORGE_PHASE_SHIFT],
        )
        forge(
            ShadowEvent(
                basin=_peak_basin(0),
                phi=0.4,
                kappa=70.0,
                realized_pnl=-1.0,
                regime_weights={"quantum": 0.5, "efficient": 0.3, "equilibrium": 0.2},
            ),
            bus=bus,
            symbol="ETH",
        )
        # Four phases: DECOMPRESS / FRACTURE / NUCLEATE / DISSIPATE
        phases = [e.payload["phase"] for e in received]
        assert phases == ["DECOMPRESS", "FRACTURE", "NUCLEATE", "DISSIPATE"]

    def test_forge_publishes_nucleus(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        bus.subscribe(
            "a", received.append, types=[KernelEvent.FORGE_NUCLEUS],
        )
        forge(
            ShadowEvent(
                basin=_peak_basin(0),
                phi=0.4,
                kappa=70.0,
                realized_pnl=-1.0,
                regime_weights={"quantum": 0.5, "efficient": 0.3, "equilibrium": 0.2},
            ),
            bus=bus,
            symbol="ETH",
        )
        assert len(received) == 1
        assert "nucleus_basin" in received[0].payload


# ───────────── WORKING MEMORY ─────────────

class TestWorkingMemoryPublishing:
    def test_wm_no_bus_still_works(self) -> None:
        wm = WorkingMemory()
        b = wm.add(_peak_basin(0), 0.5, now_ms=0.0)
        assert b.status == "alive"

    def test_wm_publishes_bubble_add(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        bus.subscribe(
            "a", received.append, types=[KernelEvent.WORKING_MEMORY_BUBBLE_ADD],
        )
        wm = WorkingMemory(bus=bus, symbol="ETH")
        wm.add(_peak_basin(0), 0.5, now_ms=0.0)
        assert len(received) == 1
        assert received[0].payload["phi"] == 0.5

    def test_wm_publishes_promotion_on_high_phi(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        bus.subscribe(
            "a", received.append, types=[KernelEvent.WORKING_MEMORY_PROMOTION],
        )
        wm = WorkingMemory(bus=bus, symbol="ETH")
        # Bootstrap (under 10 samples) → bootstrap_promote_threshold = 0.70
        wm.add(_peak_basin(0), 0.95, now_ms=0.0)
        wm.tick(now_ms=1000.0)
        assert len(received) == 1
