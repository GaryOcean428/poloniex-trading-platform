"""Tests for ``utils.redis_listener`` (proposal #1).

These tests use a hand-rolled fake redis module that fails N times then
succeeds, so we can verify:

* Exponential backoff sleeps between attempts
* No 10-retry cap — the listener keeps trying
* Per-attempt connection construction (no reuse of a poisoned client)
* Successful message dispatch flows into ``on_message``
* EINVAL-style failures during the keepalive probe drop opts to {} but
  do not abort the listener
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from typing import Any, Dict, List, Optional

import pytest

# tests/utils/ -> ml-worker/ -> ml-worker/src/ on path
_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from utils.redis_listener import (  # noqa: E402
    ListenerConfig,
    _candidate_keepalive_options,
    _probe_redis_connection,
    run_resilient_listener,
)


class _FakePubSub:
    def __init__(self, messages: List[Dict[str, Any]]):
        self._messages = list(messages)
        self.subscribed: List[str] = []
        self.closed = False

    def subscribe(self, channel: str) -> None:
        self.subscribed.append(channel)

    def listen(self):
        for m in self._messages:
            yield m

    def close(self) -> None:
        self.closed = True


class _FakeRedis:
    def __init__(self, module: "_FakeRedisModule", *, fail: bool, errno: Optional[int]):
        self._module = module
        self.published: List[tuple] = []
        self.set_calls: List[tuple] = []
        self.closed = False
        if fail:
            err = OSError(errno or 0, "fake EINVAL")
            err.errno = errno
            raise err

    def pubsub(self, ignore_subscribe_messages: bool = False) -> _FakePubSub:
        msgs = self._module.next_messages()
        return _FakePubSub(msgs)

    def publish(self, channel: str, payload: str) -> int:
        self.published.append((channel, payload))
        return 1

    def set(self, key: str, value: str, ex: int = 0) -> None:
        self.set_calls.append((key, value, ex))

    def ping(self) -> bool:
        return True

    def close(self) -> None:
        self.closed = True


class _FakeRedisModule:
    """Failure-script + message-script for the listener under test.

    The listener does:
      1. probe -> from_url (counts as one attempt)
      2. loop: from_url, pubsub, drain messages, close, sleep
    """

    def __init__(
        self,
        *,
        failures_before_success: int,
        message_batches: List[List[Dict[str, Any]]],
        errno: int = 22,
    ):
        self._failures_left = failures_before_success
        self._errno = errno
        self._batches = list(message_batches)
        self.attempts = 0
        self.created_clients: List[_FakeRedis] = []

        outer = self

        class _Redis:
            @staticmethod
            def from_url(url, **kwargs):  # noqa: ARG004
                outer.attempts += 1
                fail = outer._failures_left > 0
                if fail:
                    outer._failures_left -= 1
                client = _FakeRedis(outer, fail=fail, errno=outer._errno if fail else None)
                outer.created_clients.append(client)
                return client

        self.Redis = _Redis

    def next_messages(self) -> List[Dict[str, Any]]:
        """Pop the next message batch, or empty if exhausted."""
        if self._batches:
            return self._batches.pop(0)
        return []


def _run_listener(
    *,
    fake: _FakeRedisModule,
    cfg: ListenerConfig,
    received: List[Dict[str, Any]],
    expected_messages: int,
    timeout: float = 3.0,
):
    sleeps: List[float] = []
    stop = threading.Event()

    def _sleep(s: float) -> None:
        sleeps.append(s)
        time.sleep(0.001)
        # Cap test runtime: if we've slept too many times without a
        # message, give up.
        if len(sleeps) > 100:
            stop.set()

    def _on_message(_client: Any, payload: Dict[str, Any]) -> None:
        received.append(payload)
        if len(received) >= expected_messages:
            stop.set()

    t = threading.Thread(
        target=run_resilient_listener,
        kwargs=dict(
            redis_url="redis://fake:6379/0",
            config=cfg,
            on_message=_on_message,
            redis_module=fake,
            sleep_fn=_sleep,
            stop_event=stop,
        ),
        daemon=True,
    )
    t.start()
    t.join(timeout=timeout)
    if t.is_alive():
        stop.set()
        t.join(timeout=1.0)
    return sleeps


def test_listener_dispatches_message_on_first_attempt():
    msg = {"symbol": "BTC", "phase": "submitted"}
    fake = _FakeRedisModule(
        failures_before_success=0,
        message_batches=[[{"type": "message", "data": json.dumps(msg)}]],
    )
    cfg = ListenerConfig(name="test", channel="ch")
    received: List[Dict[str, Any]] = []
    _run_listener(fake=fake, cfg=cfg, received=received, expected_messages=1)
    assert received == [msg]
    # 1 probe + 1 listener attempt = 2 from_url calls.
    assert fake.attempts == 2
    # All non-failing clients close cleanly.
    closed = [c.closed for c in fake.created_clients if not isinstance(c, type)]
    assert all(closed)


def test_listener_retries_past_old_10_cap():
    msg = {"i": 1}
    fake = _FakeRedisModule(
        failures_before_success=15,  # Old code died at 10.
        message_batches=[[{"type": "message", "data": json.dumps(msg)}]],
        errno=22,
    )
    cfg = ListenerConfig(
        name="test", channel="ch",
        initial_backoff=0.0001, max_backoff=0.001, backoff_factor=1.0,
    )
    received: List[Dict[str, Any]] = []
    _run_listener(fake=fake, cfg=cfg, received=received, expected_messages=1, timeout=5.0)
    assert received == [msg]
    # Critically, the listener kept going past the old 10-cap.
    assert fake.attempts > 10


def test_listener_uses_exponential_backoff():
    msg = {"k": "v"}
    fake = _FakeRedisModule(
        failures_before_success=3,  # probe fails + 2 listener fails
        message_batches=[[{"type": "message", "data": json.dumps(msg)}]],
        errno=22,
    )
    cfg = ListenerConfig(
        name="test", channel="ch",
        initial_backoff=1.0, max_backoff=8.0, backoff_factor=2.0,
    )
    received: List[Dict[str, Any]] = []
    sleeps = _run_listener(
        fake=fake, cfg=cfg, received=received, expected_messages=1, timeout=5.0,
    )
    assert received == [msg]
    # First two sleeps come after listener fails; backoff doubles each time.
    assert sleeps[0] == 1.0
    assert sleeps[1] == 2.0


def test_listener_resets_backoff_after_successful_connect():
    """After a successful connect (even if no messages), backoff should
    reset to ``initial_backoff`` for the next disconnect.
    """
    fake = _FakeRedisModule(
        failures_before_success=2,  # probe fails + 1 listener fails
        message_batches=[
            [],  # 1st success: empty pubsub, then reconnect path
            [{"type": "message", "data": json.dumps({"x": 1})}],  # 2nd: deliver
        ],
        errno=22,
    )
    cfg = ListenerConfig(
        name="test", channel="ch",
        initial_backoff=1.0, max_backoff=16.0, backoff_factor=2.0,
    )
    received: List[Dict[str, Any]] = []
    sleeps = _run_listener(
        fake=fake, cfg=cfg, received=received, expected_messages=1, timeout=5.0,
    )
    assert received == [{"x": 1}]
    # Sleep timeline:
    #   sleeps[0] after listener attempt 1 fails -> 1.0
    #   sleeps[1] after listener attempt 2 succeeds + drains empty batch -> 1.0 (RESET)
    assert sleeps[0] == 1.0
    assert sleeps[1] == 1.0


def test_listener_creates_fresh_client_per_attempt():
    fake = _FakeRedisModule(
        failures_before_success=2,
        message_batches=[[{"type": "message", "data": json.dumps({"x": 1})}]],
    )
    cfg = ListenerConfig(
        name="test", channel="ch",
        initial_backoff=0.0001, max_backoff=0.001, backoff_factor=1.0,
    )
    received: List[Dict[str, Any]] = []
    _run_listener(fake=fake, cfg=cfg, received=received, expected_messages=1)
    # 1 probe (fails) + 1 listener fail + 1 listener success = 3.
    # Each from_url is a separate construction; failing attempts raise
    # before ``client`` is appended (so created_clients only collects
    # the one that successfully constructed).
    assert fake.attempts == 3
    # The single surviving client is not the same object as any prior
    # (failed) attempt — those raised and were never assigned, so
    # there's no shared-state path between attempts.
    assert len(fake.created_clients) == 1


def test_listener_skips_when_url_empty():
    fake = _FakeRedisModule(failures_before_success=0, message_batches=[[]])
    cfg = ListenerConfig(name="test", channel="ch")
    received: List[Dict[str, Any]] = []
    run_resilient_listener(
        redis_url="",
        config=cfg,
        on_message=lambda c, p: received.append(p),
        redis_module=fake,
        sleep_fn=lambda s: None,
    )
    assert received == []
    assert fake.attempts == 0


def test_listener_swallows_handler_exception():
    fake = _FakeRedisModule(
        failures_before_success=0,
        message_batches=[
            [
                {"type": "message", "data": json.dumps({"i": 1})},
                {"type": "message", "data": json.dumps({"i": 2})},
            ]
        ],
    )
    cfg = ListenerConfig(name="test", channel="ch")
    seen: List[Dict[str, Any]] = []
    stop = threading.Event()

    def _on_message(_c: Any, p: Dict[str, Any]) -> None:
        if p.get("i") == 1:
            raise RuntimeError("boom")
        seen.append(p)
        if seen:
            stop.set()

    t = threading.Thread(
        target=run_resilient_listener,
        kwargs=dict(
            redis_url="redis://fake/0",
            config=cfg,
            on_message=_on_message,
            redis_module=fake,
            sleep_fn=lambda s: None,
            stop_event=stop,
        ),
        daemon=True,
    )
    t.start()
    t.join(timeout=2.0)
    if t.is_alive():
        stop.set()
        t.join(1.0)

    assert seen == [{"i": 2}]


def test_listener_handles_bad_payload_without_crashing():
    fake = _FakeRedisModule(
        failures_before_success=0,
        message_batches=[
            [
                {"type": "message", "data": "not-json{{"},
                {"type": "message", "data": json.dumps({"ok": True})},
            ]
        ],
    )
    cfg = ListenerConfig(name="test", channel="ch")
    received: List[Dict[str, Any]] = []
    _run_listener(fake=fake, cfg=cfg, received=received, expected_messages=1)
    assert received == [{"ok": True}]


def test_listener_writes_health_key_when_configured():
    fake = _FakeRedisModule(
        failures_before_success=0,
        message_batches=[[{"type": "message", "data": json.dumps({"ok": 1})}]],
    )
    cfg = ListenerConfig(name="test", channel="ch", health_key="ml:health", health_ttl=42)
    received: List[Dict[str, Any]] = []
    _run_listener(fake=fake, cfg=cfg, received=received, expected_messages=1)
    # Probe client doesn't write health; listener client does (twice:
    # once on connect, once after the message).
    health_clients = [c for c in fake.created_clients if c.set_calls]
    assert health_clients
    keys = {call[0] for c in health_clients for call in c.set_calls}
    assert "ml:health" in keys


def test_probe_returns_ok_with_keepalive_opts():
    fake = _FakeRedisModule(failures_before_success=0, message_batches=[[]])
    ok, diag = _probe_redis_connection(
        redis_module=fake,
        redis_url="redis://fake/0",
        keepalive_opts={4: 60, 5: 10, 6: 3},
        connect_timeout=1.0,
    )
    assert ok is True
    assert "ping=True" in diag
    assert "keepalive_opts_keys=[4, 5, 6]" in diag


def test_probe_returns_diag_on_einval():
    fake = _FakeRedisModule(failures_before_success=10, message_batches=[[]] * 10, errno=22)
    ok, diag = _probe_redis_connection(
        redis_module=fake,
        redis_url="redis://fake/0",
        keepalive_opts={1: 60},
        connect_timeout=1.0,
    )
    assert ok is False
    assert "errno=22" in diag


def test_keepalive_options_match_kernel_constants():
    # The previous code used integer keys 1/2/3 unconditionally — on
    # Linux that is wrong (TCP_KEEPIDLE is 4 since Linux 2.4). Probe
    # candidate options should use real kernel constants.
    import socket
    opts = _candidate_keepalive_options()
    if hasattr(socket, "TCP_KEEPIDLE"):
        assert int(socket.TCP_KEEPIDLE) in opts
    if hasattr(socket, "TCP_KEEPINTVL"):
        assert int(socket.TCP_KEEPINTVL) in opts
    if hasattr(socket, "TCP_KEEPCNT"):
        assert int(socket.TCP_KEEPCNT) in opts
    # The bare integers 1/2/3 must NOT be present unless the kernel
    # happens to map them to a real keepalive constant.
    if hasattr(socket, "TCP_KEEPIDLE") and int(socket.TCP_KEEPIDLE) != 1:
        assert 1 not in opts
