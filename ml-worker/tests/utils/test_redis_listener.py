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
    _is_idle_read_timeout,
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


# =====================================================================
# Idle-timeout log-level tests (2026-04-30 fix).
#
# PR #604 hardened the listener to retry forever, but every idle pubsub
# read timeout still logged at ERROR ("redis-listener-crashed attempt=N
# errno=None err=Timeout reading from socket"). On a quiet channel that
# meant 60+ ERROR lines per minute on `ml-predict-request` and
# `trade-outcome` — fake-alarm telemetry that drowned out genuine
# connection failures. The fix classifies idle timeouts as DEBUG, leaves
# real connection errors at ERROR, and emits one INFO line after
# `idle_escalate_after` consecutive timeouts to surface a stuck producer.
# =====================================================================


class _IdleTimeoutScript:
    """Test harness: connect once, raise a timeout on `pubsub.listen`,
    optionally repeat for N attempts before yielding a real message.

    This simulates Redis being healthy but the channel being quiet — the
    exact scenario that produced the prod log spam.
    """

    def __init__(
        self,
        *,
        timeouts_before_message: int,
        message: Optional[Dict[str, Any]] = None,
        timeout_exc_factory=None,
    ):
        self._remaining_timeouts = timeouts_before_message
        self._message = message
        self._timeout_exc_factory = timeout_exc_factory or (
            lambda: __import__("socket").timeout("Timeout reading from socket")
        )
        self.attempts = 0
        self.exceptions = type("Exc", (), {"TimeoutError": __import__("socket").timeout})

        outer = self

        class _PS:
            def __init__(self):
                self.subscribed = []
                self.closed = False

            def subscribe(self, ch):
                self.subscribed.append(ch)

            def listen(self):
                if outer._remaining_timeouts > 0:
                    outer._remaining_timeouts -= 1
                    raise outer._timeout_exc_factory()
                if outer._message is not None:
                    yield {"type": "message", "data": json.dumps(outer._message)}

            def close(self):
                self.closed = True

        class _Client:
            def __init__(self):
                self.closed = False
                self.set_calls: List[tuple] = []

            def pubsub(self, ignore_subscribe_messages=False):
                return _PS()

            def set(self, key, value, ex=0):
                self.set_calls.append((key, value, ex))

            def ping(self):
                return True

            def close(self):
                self.closed = True

        class _Redis:
            @staticmethod
            def from_url(url, **kwargs):  # noqa: ARG004
                outer.attempts += 1
                return _Client()

        self.Redis = _Redis


def test_is_idle_read_timeout_classifies_socket_timeout():
    """``socket.timeout`` is the canonical idle signal — must be DEBUG."""
    import socket as _sock

    fake = _FakeRedisModule(failures_before_success=0, message_batches=[[]])
    assert _is_idle_read_timeout(_sock.timeout("Timeout reading from socket"), fake) is True


def test_is_idle_read_timeout_classifies_real_connection_error():
    """``OSError(ECONNRESET)`` is a real failure — must NOT match idle."""
    fake = _FakeRedisModule(failures_before_success=0, message_batches=[[]])
    err = OSError(104, "Connection reset by peer")
    assert _is_idle_read_timeout(err, fake) is False


def test_is_idle_read_timeout_classifies_einval():
    """EINVAL from setsockopt is a real failure — keep at ERROR."""
    fake = _FakeRedisModule(failures_before_success=0, message_batches=[[]])
    err = OSError(22, "Invalid argument")
    assert _is_idle_read_timeout(err, fake) is False


def test_is_idle_read_timeout_classifies_message_substring_fallback():
    """Some redis-py builds wrap timeouts in a non-TimeoutError class.
    The substring match catches that legacy shape without downgrading
    generic connection errors."""
    fake = _FakeRedisModule(failures_before_success=0, message_batches=[[]])
    weird = RuntimeError("Timeout reading from socket")
    assert _is_idle_read_timeout(weird, fake) is True
    not_idle = RuntimeError("Connection refused")
    assert _is_idle_read_timeout(not_idle, fake) is False


def test_idle_timeout_logs_debug_not_error(caplog):
    """A single idle timeout must log at DEBUG, NOT ERROR. This is the
    primary regression: prior to the fix every timeout produced an
    ERROR-level line, which generated 60+ false alarms per minute on
    quiet channels."""
    import logging as _logging

    msg = {"i": 1}
    fake = _IdleTimeoutScript(
        timeouts_before_message=1,
        message=msg,
    )
    cfg = ListenerConfig(
        name="idle-test", channel="ch",
        initial_backoff=0.0001, max_backoff=0.001, backoff_factor=1.0,
    )
    received: List[Dict[str, Any]] = []

    with caplog.at_level(_logging.DEBUG, logger="utils.redis_listener"):
        _run_listener(fake=fake, cfg=cfg, received=received, expected_messages=1)

    assert received == [msg]
    # Filter to records emitted by the listener module under test.
    listener_records = [r for r in caplog.records if r.name == "utils.redis_listener"]
    error_records = [r for r in listener_records if r.levelno >= _logging.ERROR]
    crashed_records = [
        r for r in listener_records if "redis-listener-crashed" in r.getMessage()
    ]
    debug_idle_records = [
        r for r in listener_records
        if r.levelno == _logging.DEBUG
        and "redis-listener-idle-timeout" in r.getMessage()
    ]
    # Must have at least one DEBUG idle entry.
    assert debug_idle_records, "expected at least one DEBUG idle-timeout record"
    # Must NOT have logged the idle as a crash at ERROR.
    assert not crashed_records, (
        f"idle timeouts should NOT log redis-listener-crashed; got {[r.getMessage() for r in error_records]}"
    )


def test_real_connection_error_logs_error(caplog):
    """An actual ``OSError`` (errno=22, EINVAL, or any non-timeout
    OSError raised on connect) must continue to log at ERROR."""
    import logging as _logging

    msg = {"x": 1}
    # Reuse the existing _FakeRedisModule which raises OSError(errno=22)
    # on `from_url` — that goes through the listener's `try` block as a
    # real connect failure, NOT an idle pubsub timeout.
    fake = _FakeRedisModule(
        failures_before_success=2,  # probe + 1 listener attempt fail
        message_batches=[[{"type": "message", "data": json.dumps(msg)}]],
        errno=22,
    )
    cfg = ListenerConfig(
        name="conn-err-test", channel="ch",
        initial_backoff=0.0001, max_backoff=0.001, backoff_factor=1.0,
    )
    received: List[Dict[str, Any]] = []

    with caplog.at_level(_logging.DEBUG, logger="utils.redis_listener"):
        _run_listener(fake=fake, cfg=cfg, received=received, expected_messages=1)

    assert received == [msg]
    listener_records = [r for r in caplog.records if r.name == "utils.redis_listener"]
    crashed_records = [
        r for r in listener_records
        if r.levelno == _logging.ERROR
        and "redis-listener-crashed" in r.getMessage()
        and "errno=22" in r.getMessage()
    ]
    assert crashed_records, (
        "expected EINVAL OSError to log at ERROR with errno=22; "
        f"got {[(r.levelno, r.getMessage()) for r in listener_records]}"
    )


def test_idle_timeout_escalates_to_info_after_threshold(caplog):
    """After ``idle_escalate_after`` (default 100) consecutive idle
    timeouts, the listener must emit ONE INFO-level ``redis-listener-idle``
    line so a stuck producer surfaces — without spamming ERROR or
    repeating the INFO every tick."""
    import logging as _logging

    # 100 idle timeouts exactly hits the escalation threshold; the 100th
    # timeout fires the INFO line. Then a real message lets the listener
    # loop terminate via the test's `expected_messages` stop hook.
    fake = _IdleTimeoutScript(
        timeouts_before_message=100,
        message={"after": "idle"},
    )
    cfg = ListenerConfig(
        name="escalate-test", channel="ch",
        initial_backoff=0.00001, max_backoff=0.0001, backoff_factor=1.0,
    )
    received: List[Dict[str, Any]] = []

    sleeps: List[float] = []
    stop = threading.Event()

    def _sleep(s: float) -> None:
        sleeps.append(s)
        time.sleep(0.0001)
        # Hard cap so a regression in the escalation logic can't hang
        # the test runner: 200 sleeps is well past the 100 threshold.
        if len(sleeps) > 200:
            stop.set()

    def _on_message(_c: Any, payload: Dict[str, Any]) -> None:
        received.append(payload)
        stop.set()

    with caplog.at_level(_logging.DEBUG, logger="utils.redis_listener"):
        t = threading.Thread(
            target=run_resilient_listener,
            kwargs=dict(
                redis_url="redis://fake/0",
                config=cfg,
                on_message=_on_message,
                redis_module=fake,
                sleep_fn=_sleep,
                stop_event=stop,
            ),
            daemon=True,
        )
        t.start()
        t.join(timeout=10.0)
        if t.is_alive():
            stop.set()
            t.join(1.0)

    listener_records = [r for r in caplog.records if r.name == "utils.redis_listener"]
    info_idle_records = [
        r for r in listener_records
        if r.levelno == _logging.INFO and "redis-listener-idle " in r.getMessage()
    ]
    assert info_idle_records, (
        "expected one INFO-level redis-listener-idle escalation line after "
        "100 consecutive timeouts"
    )
    # And critically — even with 100 timeouts, no ERROR-level crash lines.
    error_crashed = [
        r for r in listener_records
        if r.levelno == _logging.ERROR
        and "redis-listener-crashed" in r.getMessage()
    ]
    assert not error_crashed, (
        "100 idle timeouts must NOT produce ERROR-level crash lines"
    )


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
