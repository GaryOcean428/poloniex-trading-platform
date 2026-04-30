"""Robust Redis pub/sub listener helper for ml-worker (proposal #1).

Background context
------------------
Prior to this module, ``ml-worker/main.py`` had two background ``_listener``
threads — one for ``ml:predict:request`` (~L83) and one for
``ml:trade:outcome`` (~L165). Both threads:

* Used ad-hoc retry loops bounded to ``MAX_RETRIES = 10``
* Reused per-thread ``ConnectionPool`` objects across reconnects, which
  could cache a half-open socket
* Lacked a startup probe — so ``OSError: [Errno 22] Invalid argument``
  (EINVAL) coming back from ``socket.setsockopt`` did not surface until
  ten consecutive failures had been logged
* Permanently silenced after 10 failures, breaking the closed-trade
  PnL flow that the arbiter depends on

This module centralises the connection logic with:

1. A startup probe that runs once before the listener loop is entered.
   The probe reports which keep-alive socket options the kernel accepts
   so EINVAL-style failures point at the offending option immediately.
2. Exponential backoff with no failure cap. Transient outages no
   longer permanently silence the listener; the listener keeps trying
   forever, with an upper-bound sleep of 60s between attempts.
3. Per-attempt connection construction — no shared ``ConnectionPool``
   across retries. A broken connection cannot poison the next attempt.
4. Structured logging via ``logger.warning`` / ``logger.error`` with a
   stable ``listener=<name>`` extra so future EINVAL events are easy
   to grep in Railway logs.

QIG note: this is plumbing, not kernel geometry. No Fisher-Rao
operations, no basin coordinates touched.
"""
from __future__ import annotations

import json
import logging
import os
import socket
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)


# Kernel keep-alive options. ``socket.TCP_KEEPIDLE`` and friends are
# Linux-only; on macOS / Windows the constants either differ or are
# missing entirely. We probe at startup and only pass through what the
# running kernel actually accepts. This is the EINVAL fix root-cause:
# the previous code passed integer keys 1/2/3 unconditionally, which
# turned into ``setsockopt(SOL_TCP, 1, 60)`` → EINVAL on a kernel that
# expects ``TCP_KEEPIDLE`` (== 4 on Linux 5.x+).
def _candidate_keepalive_options() -> Dict[int, int]:
    opts: Dict[int, int] = {}
    if hasattr(socket, "TCP_KEEPIDLE"):
        opts[int(socket.TCP_KEEPIDLE)] = 60  # start keepalives after 60s idle
    if hasattr(socket, "TCP_KEEPINTVL"):
        opts[int(socket.TCP_KEEPINTVL)] = 10  # interval between keepalives
    if hasattr(socket, "TCP_KEEPCNT"):
        opts[int(socket.TCP_KEEPCNT)] = 3  # drop after 3 missed keepalives
    return opts


@dataclass
class ListenerConfig:
    """Tunables for ``run_resilient_listener``.

    Defaults are chosen for live trading: never give up, but cap the
    backoff so a recovered Redis re-attaches within a minute.
    """
    name: str
    channel: str
    initial_backoff: float = 1.0
    max_backoff: float = 60.0
    backoff_factor: float = 2.0
    socket_connect_timeout: float = 5.0
    socket_read_timeout: float = 30.0
    health_key: Optional[str] = None
    health_ttl: int = 90


# Pluggable redis module / sleep / time hooks for test injection. Keep
# them keyword-only so production callers never have to think about
# them.
def run_resilient_listener(
    *,
    redis_url: str,
    config: ListenerConfig,
    on_message: Callable[[Any, Dict[str, Any]], None],
    redis_module: Optional[Any] = None,
    sleep_fn: Callable[[float], None] = time.sleep,
    stop_event: Optional[threading.Event] = None,
) -> None:
    """Subscribe to ``config.channel`` and call ``on_message`` per envelope.

    Runs forever (or until ``stop_event`` is set). Intended to be the
    target of a daemon thread spawned at FastAPI startup. The function
    blocks the calling thread.

    ``on_message(redis_client, payload_dict)`` is invoked once per
    JSON message received on the channel. Any exception raised by the
    callback is logged and swallowed so a single bad payload cannot
    take down the listener.
    """
    if redis_module is None:
        try:
            import redis  # noqa: WPS433 — optional import
        except ImportError:
            logger.warning(
                "redis package not installed — listener=%s disabled",
                config.name,
            )
            return
        redis_module = redis

    if not redis_url:
        logger.info(
            "REDIS_URL not set — listener=%s disabled", config.name,
        )
        return

    keepalive_opts = _candidate_keepalive_options()

    # One-shot startup probe. Try to open a fresh connection with the
    # candidate keep-alive options. If that fails, log the kernel
    # diagnostic immediately rather than hiding it behind ten retries.
    probe_ok, probe_diag = _probe_redis_connection(
        redis_module=redis_module,
        redis_url=redis_url,
        keepalive_opts=keepalive_opts,
        connect_timeout=config.socket_connect_timeout,
    )
    logger.info(
        "redis-listener-probe listener=%s ok=%s diag=%s",
        config.name,
        probe_ok,
        probe_diag,
    )
    if not probe_ok:
        # If even the empty-options probe fails, drop keepalive opts
        # entirely — better to run without keepalive than not at all.
        logger.warning(
            "redis-listener-probe falling back to empty keepalive_opts "
            "listener=%s reason=%s",
            config.name,
            probe_diag,
        )
        keepalive_opts = {}

    backoff = config.initial_backoff
    attempt = 0
    while stop_event is None or not stop_event.is_set():
        attempt += 1
        pubsub = None
        client = None
        try:
            client = redis_module.Redis.from_url(
                redis_url,
                decode_responses=True,
                socket_timeout=config.socket_read_timeout,
                socket_connect_timeout=config.socket_connect_timeout,
                socket_keepalive=True,
                socket_keepalive_options=keepalive_opts,
                health_check_interval=30,
            )
            pubsub = client.pubsub(ignore_subscribe_messages=True)
            pubsub.subscribe(config.channel)
            logger.info(
                "redis-listener-connected listener=%s channel=%s attempt=%d",
                config.name,
                config.channel,
                attempt,
            )

            if config.health_key is not None:
                try:
                    client.set(
                        config.health_key,
                        json.dumps({"status": "ok"}),
                        ex=config.health_ttl,
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "redis-listener-health-write-failed listener=%s err=%s",
                        config.name,
                        exc,
                    )

            # Connected — reset backoff for the next disconnect.
            backoff = config.initial_backoff

            for message in pubsub.listen():
                if stop_event is not None and stop_event.is_set():
                    break
                if message is None or message.get("type") != "message":
                    continue
                try:
                    raw = message["data"]
                    payload = json.loads(raw) if isinstance(raw, (bytes, str)) else raw
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "redis-listener-bad-payload listener=%s err=%s raw=%r",
                        config.name,
                        exc,
                        message.get("data"),
                    )
                    continue
                try:
                    on_message(client, payload)
                except Exception as exc:  # noqa: BLE001
                    logger.error(
                        "redis-listener-handler-error listener=%s err=%s",
                        config.name,
                        exc,
                        exc_info=True,
                    )
                if config.health_key is not None:
                    try:
                        client.set(
                            config.health_key,
                            json.dumps({"status": "ok"}),
                            ex=config.health_ttl,
                        )
                    except Exception:  # noqa: BLE001
                        pass
        except Exception as exc:  # noqa: BLE001
            # ``OSError(EINVAL)`` ends up here. Log structurally; do
            # NOT decrement attempt or short-circuit — we retry forever.
            errno = getattr(exc, "errno", None)
            logger.error(
                "redis-listener-crashed listener=%s attempt=%d errno=%s err=%s",
                config.name,
                attempt,
                errno,
                exc,
                exc_info=False,
            )
            if config.health_key is not None and client is not None:
                try:
                    client.set(
                        config.health_key,
                        json.dumps({"status": "reconnecting"}),
                        ex=config.health_ttl,
                    )
                except Exception:  # noqa: BLE001
                    pass
        finally:
            # Always tear down the client + pubsub before the next
            # attempt. Reusing a poisoned connection is the second
            # half of the EINVAL bug — the first attempt's bad fd
            # leaks into the second attempt's setsockopt call.
            try:
                if pubsub is not None:
                    pubsub.close()
            except Exception:  # noqa: BLE001
                pass
            try:
                if client is not None:
                    close = getattr(client, "close", None)
                    if callable(close):
                        close()
            except Exception:  # noqa: BLE001
                pass

        if stop_event is not None and stop_event.is_set():
            break
        logger.info(
            "redis-listener-reconnecting listener=%s sleep=%.1fs next_attempt=%d",
            config.name,
            backoff,
            attempt + 1,
        )
        sleep_fn(backoff)
        backoff = min(backoff * config.backoff_factor, config.max_backoff)


def _probe_redis_connection(
    *,
    redis_module: Any,
    redis_url: str,
    keepalive_opts: Dict[int, int],
    connect_timeout: float,
) -> tuple[bool, str]:
    """Synchronous one-shot probe that exercises the same socket options
    the listener will use. Returns (ok, diag). Never raises."""
    try:
        client = redis_module.Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_timeout=connect_timeout,
            socket_connect_timeout=connect_timeout,
            socket_keepalive=bool(keepalive_opts),
            socket_keepalive_options=keepalive_opts,
        )
        try:
            pong = client.ping()
            return True, f"ping={pong} keepalive_opts_keys={sorted(keepalive_opts.keys())}"
        finally:
            try:
                client.close()
            except Exception:  # noqa: BLE001
                pass
    except Exception as exc:  # noqa: BLE001
        errno = getattr(exc, "errno", None)
        return False, f"errno={errno} type={type(exc).__name__} msg={exc}"


def spawn_listener_thread(
    *,
    name: str,
    target: Callable[[], None],
) -> threading.Thread:
    """Convenience wrapper for spawning a daemon listener thread."""
    t = threading.Thread(target=target, daemon=True, name=name)
    t.start()
    return t


def env_redis_url() -> str:
    """Single source of truth for ``REDIS_URL`` reads. Centralised so
    a future env-name change touches one place only."""
    return os.environ.get("REDIS_URL", "")
