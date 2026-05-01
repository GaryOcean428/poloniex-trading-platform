"""test_kernel_bus.py — internal Agent K constellation pub/sub.

The kernel bus is INTERNAL to Agent K. Tests cover:
  - Singleton per instance_id
  - Subscribe filters by event type and symbol
  - Crashing subscriber doesn't break bus or other subscribers
  - Unsubscribe stops delivery
  - Max subscriber limit enforcement
  - Payload normalization (dict, dataclass with to_dict, plain dataclass)
  - Persistence tail integration
"""
from __future__ import annotations

import sys
import threading
from dataclasses import dataclass
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.bus_events import (  # noqa: E402
    HeartTickPayload,
    KernelEvent,
    KernelEventEnvelope,
    SelfObsTriplePayload,
)
from monkey_kernel.kernel_bus import (  # noqa: E402
    KernelBus,
    _reset_buses_for_tests,
    get_kernel_bus,
)


@pytest.fixture(autouse=True)
def reset_buses():
    _reset_buses_for_tests()
    yield
    _reset_buses_for_tests()


class TestSingleton:
    def test_same_instance_id_returns_same_bus(self) -> None:
        a1 = get_kernel_bus("a")
        a2 = get_kernel_bus("a")
        assert a1 is a2

    def test_different_instance_ids_get_different_buses(self) -> None:
        a = get_kernel_bus("a")
        b = get_kernel_bus("b")
        assert a is not b
        assert a.instance_id == "a"
        assert b.instance_id == "b"

    def test_reset_clears_singletons(self) -> None:
        a1 = get_kernel_bus("test")
        _reset_buses_for_tests()
        a2 = get_kernel_bus("test")
        assert a1 is not a2


class TestPublishSubscribe:
    def test_subscribe_no_filters_receives_all_events(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        bus.subscribe("a", received.append)
        bus.publish(KernelEvent.HEART_TICK, "heart", {"k": 1})
        bus.publish(
            KernelEvent.OCEAN_OBSERVATION, "ocean", {"phi": 0.5},
        )
        assert len(received) == 2
        assert received[0].type == KernelEvent.HEART_TICK
        assert received[1].type == KernelEvent.OCEAN_OBSERVATION

    def test_subscribe_filters_by_event_type(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        bus.subscribe(
            "heart-only", received.append, types=[KernelEvent.HEART_TICK],
        )
        bus.publish(KernelEvent.HEART_TICK, "heart", {"k": 1})
        bus.publish(
            KernelEvent.OCEAN_OBSERVATION, "ocean", {"phi": 0.5},
        )
        assert len(received) == 1
        assert received[0].type == KernelEvent.HEART_TICK

    def test_subscribe_filters_by_symbol(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        bus.subscribe("eth", received.append, symbols=["ETH"])
        bus.publish(KernelEvent.HEART_TICK, "heart", {"k": 1}, symbol="ETH")
        bus.publish(KernelEvent.HEART_TICK, "heart", {"k": 2}, symbol="BTC")
        assert len(received) == 1
        assert received[0].symbol == "ETH"

    def test_subscribe_combined_filters_use_AND(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        bus.subscribe(
            "narrow",
            received.append,
            types=[KernelEvent.HEART_TICK],
            symbols=["ETH"],
        )
        bus.publish(KernelEvent.HEART_TICK, "heart", {"k": 1}, symbol="ETH")
        bus.publish(KernelEvent.HEART_TICK, "heart", {"k": 2}, symbol="BTC")
        bus.publish(
            KernelEvent.OCEAN_OBSERVATION, "ocean", {"phi": 0.5}, symbol="ETH",
        )
        assert len(received) == 1
        assert received[0].symbol == "ETH"
        assert received[0].type == KernelEvent.HEART_TICK


class TestErrorHandling:
    def test_crashing_subscriber_doesnt_break_other_subscribers(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []

        def boom(_env: KernelEventEnvelope) -> None:
            raise RuntimeError("middle subscriber threw")

        bus.subscribe("first", received.append)
        bus.subscribe("middle", boom)
        bus.subscribe("last", received.append)
        bus.publish(KernelEvent.HEART_TICK, "heart", {"k": 1})
        # Both surviving subscribers fired
        assert len(received) == 2

    def test_crashing_subscriber_doesnt_break_bus(self) -> None:
        bus = KernelBus("t")

        def boom(_env: KernelEventEnvelope) -> None:
            raise RuntimeError("subscriber always crashes")

        received: list[KernelEventEnvelope] = []
        bus.subscribe("boom", boom)
        bus.subscribe("ok", received.append)
        bus.publish(KernelEvent.HEART_TICK, "heart", {"k": 1})
        bus.publish(KernelEvent.OCEAN_OBSERVATION, "ocean", {"phi": 0.5})
        assert len(received) == 2


class TestUnsubscribe:
    def test_unsubscribe_stops_delivery(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        unsub = bus.subscribe("a", received.append)
        bus.publish(KernelEvent.HEART_TICK, "heart", {"k": 1})
        unsub()
        bus.publish(KernelEvent.HEART_TICK, "heart", {"k": 2})
        assert len(received) == 1

    def test_unsubscribe_idempotent(self) -> None:
        bus = KernelBus("t")
        unsub = bus.subscribe("a", lambda _e: None)
        unsub()
        unsub()  # second call must not raise


class TestMaxSubscribers:
    def test_max_subscribers_enforced(self) -> None:
        bus = KernelBus("t", max_subscribers=2)
        bus.subscribe("a", lambda _e: None)
        bus.subscribe("b", lambda _e: None)
        with pytest.raises(RuntimeError, match="max subscribers"):
            bus.subscribe("c", lambda _e: None)


class TestPayloadNormalization:
    def test_dict_payload_passes_through(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        bus.subscribe("a", received.append)
        bus.publish(KernelEvent.HEART_TICK, "heart", {"kappa": 64.0})
        assert received[0].payload == {"kappa": 64.0}

    def test_dataclass_with_to_dict_uses_to_dict(self) -> None:
        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        bus.subscribe("a", received.append)
        bus.publish(
            KernelEvent.HEART_TICK,
            "heart",
            HeartTickPayload(kappa=64.0, kappa_star=64.0, hrv=0.1, mode="ANCHOR"),
        )
        assert received[0].payload["kappa"] == 64.0
        assert received[0].payload["mode"] == "ANCHOR"

    def test_plain_dataclass_uses_asdict(self) -> None:
        @dataclass(frozen=True)
        class Plain:
            x: int

        bus = KernelBus("t")
        received: list[KernelEventEnvelope] = []
        bus.subscribe("a", received.append)
        bus.publish(KernelEvent.ANOMALY, "test", Plain(x=42))
        assert received[0].payload == {"x": 42}

    def test_invalid_payload_raises_typeerror(self) -> None:
        bus = KernelBus("t")
        with pytest.raises(TypeError):
            bus.publish(KernelEvent.HEART_TICK, "heart", "not a dict")


class TestPersistenceTail:
    def test_persistence_called_when_provided(self) -> None:
        events_seen: list = []

        class FakePersistence:
            is_available = True

            def append_bus_event(self, env):  # noqa: ANN001
                events_seen.append(env)

        bus = KernelBus("t", persistence=FakePersistence())
        bus.publish(KernelEvent.HEART_TICK, "heart", {"k": 1})
        assert len(events_seen) == 1
        assert events_seen[0].type == KernelEvent.HEART_TICK

    def test_persistence_failure_doesnt_break_publish(self) -> None:
        class BadPersistence:
            is_available = True

            def append_bus_event(self, env):  # noqa: ANN001
                raise RuntimeError("persistence down")

        bus = KernelBus("t", persistence=BadPersistence())
        # Must not raise
        bus.publish(KernelEvent.HEART_TICK, "heart", {"k": 1})


class TestConcurrency:
    def test_concurrent_subscribe_publish_no_corruption(self) -> None:
        bus = KernelBus("t")
        stop = threading.Event()
        errors: list[Exception] = []

        def publisher() -> None:
            try:
                while not stop.is_set():
                    bus.publish(
                        KernelEvent.HEART_TICK, "heart", {"k": 1},
                    )
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        def subscriber() -> None:
            try:
                while not stop.is_set():
                    unsub = bus.subscribe(
                        f"sub-{threading.get_ident()}", lambda _e: None,
                    )
                    unsub()
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [
            threading.Thread(target=publisher),
            threading.Thread(target=subscriber),
            threading.Thread(target=publisher),
        ]
        for t in threads:
            t.start()
        # Run briefly
        threading.Event().wait(0.1)
        stop.set()
        for t in threads:
            t.join(timeout=1.0)
        assert errors == []


class TestEventCount:
    def test_event_count_increments(self) -> None:
        bus = KernelBus("t")
        assert bus.event_count() == 0
        bus.publish(KernelEvent.HEART_TICK, "heart", {"k": 1})
        bus.publish(KernelEvent.HEART_TICK, "heart", {"k": 2})
        assert bus.event_count() == 2

    def test_subscriber_count_tracks_correctly(self) -> None:
        bus = KernelBus("t")
        assert bus.subscriber_count() == 0
        u1 = bus.subscribe("a", lambda _e: None)
        u2 = bus.subscribe("b", lambda _e: None)
        assert bus.subscriber_count() == 2
        u1()
        assert bus.subscriber_count() == 1
        u2()
        assert bus.subscriber_count() == 0


class TestSelfObsTriplePayload:
    def test_to_dict_round_trip(self) -> None:
        payload = SelfObsTriplePayload(
            repetition_score=0.7,
            sovereignty_score=0.8,
            confidence_score=0.6,
            decision_id="K-test-1",
        )
        d = payload.to_dict()
        assert d["repetition_score"] == 0.7
        assert d["sovereignty_score"] == 0.8
        assert d["confidence_score"] == 0.6
        assert d["decision_id"] == "K-test-1"
