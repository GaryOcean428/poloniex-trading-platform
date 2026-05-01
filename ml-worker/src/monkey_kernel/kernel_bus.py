"""
kernel_bus.py — internal Agent K constellation pub/sub.

The bus is INTERNAL to Agent K. Heart, Ocean, Foresight, Forge,
WorkingMemory, Executive, Coordinator, ThoughtBus, LearningGate all
publish and subscribe through this single instance.

Wall to Agent M and T: this bus does not connect to them. They are
black-box agents to the arbiter. The arbiter sees only their PnL.

QIG purity: the bus is plumbing — it carries dicts, basins (np.ndarray),
and scalars. No geometry computation happens here. Subscribers do
geometry on receive, never the bus itself.

Singleton per kernel instance. Two instances of Agent K (e.g.
monkey-primary, monkey-position) get separate buses by instance_id.

Sync fan-out for low latency. Optional Redis tail for forensic
persistence — never blocks publish; failures are logged at debug.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import asdict, is_dataclass
from typing import Any, Callable, Iterable, Optional

from .bus_events import KernelEvent, KernelEventEnvelope
from .persistence import PersistentMemory

logger = logging.getLogger("monkey.kernel_bus")

Handler = Callable[[KernelEventEnvelope], None]

DEFAULT_MAX_SUBSCRIBERS: int = 64


class _Subscriber:
    __slots__ = ("id", "types", "symbols", "handler")

    def __init__(
        self,
        sub_id: str,
        types: Optional[set[KernelEvent]],
        symbols: Optional[set[str]],
        handler: Handler,
    ) -> None:
        self.id = sub_id
        self.types = types
        self.symbols = symbols
        self.handler = handler


class KernelBus:
    """In-process pub/sub for one Agent K constellation."""

    def __init__(
        self,
        instance_id: str,
        persistence: Optional[PersistentMemory] = None,
        max_subscribers: int = DEFAULT_MAX_SUBSCRIBERS,
    ) -> None:
        self._instance_id = instance_id
        self._subscribers: list[_Subscriber] = []
        self._lock = threading.Lock()
        self._max_subscribers = max_subscribers
        self._persistence = persistence
        self._event_count = 0

    @property
    def instance_id(self) -> str:
        return self._instance_id

    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def publish(
        self,
        event_type: KernelEvent,
        source: str,
        payload: Any,
        symbol: Optional[str] = None,
    ) -> None:
        """Publish an event. Sync fan-out to subscribers; async
        persistence tail. Subscriber exceptions are logged at debug
        and swallowed — a crashing subscriber must not break the bus
        or other subscribers.
        """
        payload_dict = self._normalize_payload(payload)

        envelope = KernelEventEnvelope(
            type=event_type,
            source=source,
            symbol=symbol,
            instance_id=self._instance_id,
            payload=payload_dict,
            at_ms=time.time() * 1000.0,
        )

        # Snapshot under lock so subscribe/unsubscribe during publish
        # doesn't corrupt iteration.
        with self._lock:
            subs_snapshot = list(self._subscribers)

        for sub in subs_snapshot:
            if sub.types is not None and event_type not in sub.types:
                continue
            if (
                sub.symbols is not None
                and symbol is not None
                and symbol not in sub.symbols
            ):
                continue
            try:
                sub.handler(envelope)
            except Exception as exc:  # noqa: BLE001
                logger.debug(
                    "[bus] subscriber %s threw on %s: %s",
                    sub.id, event_type.value, exc,
                )

        self._event_count += 1

        # Persistence tail — non-blocking, fail-soft.
        if self._persistence is not None:
            try:
                self._persistence.append_bus_event(envelope)
            except Exception as exc:  # noqa: BLE001
                logger.debug("[bus] persistence tail failed: %s", exc)

    @staticmethod
    def _normalize_payload(payload: Any) -> dict[str, Any]:
        """Normalize payload to dict (accept dataclass with to_dict,
        plain dataclass instances, or dicts).
        """
        if hasattr(payload, "to_dict") and callable(payload.to_dict):
            return payload.to_dict()
        if is_dataclass(payload) and not isinstance(payload, type):
            return asdict(payload)
        if isinstance(payload, dict):
            return payload
        raise TypeError(
            f"payload must be dict, dataclass, or have to_dict(); "
            f"got {type(payload).__name__}"
        )

    def subscribe(
        self,
        sub_id: str,
        handler: Handler,
        types: Optional[Iterable[KernelEvent]] = None,
        symbols: Optional[Iterable[str]] = None,
    ) -> Callable[[], None]:
        """Subscribe to events. Returns unsubscribe function.

        types=None means subscribe to all event types.
        symbols=None means subscribe to all symbols.
        """
        with self._lock:
            if len(self._subscribers) >= self._max_subscribers:
                raise RuntimeError(
                    f"max subscribers ({self._max_subscribers}) reached on "
                    f"bus {self._instance_id}"
                )
            sub = _Subscriber(
                sub_id=sub_id,
                types=set(types) if types else None,
                symbols=set(symbols) if symbols else None,
                handler=handler,
            )
            self._subscribers.append(sub)

        def unsubscribe() -> None:
            with self._lock:
                try:
                    self._subscribers.remove(sub)
                except ValueError:
                    pass

        return unsubscribe

    def event_count(self) -> int:
        return self._event_count


# ─── Singleton per instance_id ────────────────────────────────────

_buses: dict[str, KernelBus] = {}
_buses_lock = threading.Lock()


def get_kernel_bus(
    instance_id: str = "monkey-primary",
    persistence: Optional[PersistentMemory] = None,
) -> KernelBus:
    """Process-wide bus singleton per instance_id.

    Two instances of Agent K (e.g. position-trading and swing-trading)
    get separate buses. Same instance_id always returns the same bus.
    Persistence is captured on first call; later calls with a different
    persistence handle are ignored (the bus singleton owns its tail).
    """
    with _buses_lock:
        if instance_id not in _buses:
            _buses[instance_id] = KernelBus(
                instance_id=instance_id,
                persistence=persistence,
            )
        return _buses[instance_id]


def _reset_buses_for_tests() -> None:
    """Test-only: wipe all bus singletons."""
    global _buses
    with _buses_lock:
        _buses = {}
