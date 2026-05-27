"""proposal_bus.py — Redis pub/sub bridge for cross-kernel proposal exchange.

Python counterpart of `apps/api/src/services/monkey/proposal_bus.ts`.
Layer 1.5 of the dual-kernel consensus architecture per
[[polytrade-consensus-architecture]]. Both TS Monkey and Py Monkey
publish proposals to the same channel; both subscribe and store the
most-recent peer proposal for the consensus arbiter (PR CONSENSUS-7).

Channel: `monkey:consensus:proposal`

Flag: `CONSENSUS_PROPOSAL_BUS_LIVE` — default off. When off, neither
publisher nor subscriber connects (no Redis traffic). When on,
proposals stream across the bus.

Fail-soft: any Redis error logs at debug and returns silently. A
dead Redis never blocks a tick.

QIG purity: no math here — just JSON pub/sub. The geometric payload
fields (basin, phi, kappa) are reported as-is.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Optional

logger = logging.getLogger("monkey_kernel.proposal_bus")

PROPOSAL_CHANNEL = "monkey:consensus:proposal"
PEER_PROPOSAL_FRESHNESS_MS = 60_000


def consensus_bus_live() -> bool:
    """True unless CONSENSUS_PROPOSAL_BUS_LIVE=false (explicit kill switch).
    Reversal of flag-gated paralysis (fb083891 + user 2026-05-27 "flag gated Kills me").
    When live, publisher/subscriber connect for cross-kernel proposal bus.
    """
    return os.environ.get("CONSENSUS_PROPOSAL_BUS_LIVE", "true").strip().lower() != "false"


@dataclass
class ProposalEvent:
    """Schema mirrors TS-side ProposalEvent. Channel payload is JSON
    serialization of this dataclass."""

    instance_id: str
    symbol: str
    tick_id: str
    proposed_action: str  # 'enter_long' | 'enter_short' | 'exit' | 'hold'
    side: Optional[str]   # 'long' | 'short' | None
    lane: str
    size_usdt: float
    leverage: float
    entry_threshold: float
    conviction: float
    basin_signature: list[float] = field(default_factory=list)
    phi: float = 0.0
    kappa: float = 0.0
    regime_label: Optional[str] = None
    mode: str = ""
    at_ms: float = 0.0
    engine_version: str = "v0.8.7c-3-py"


# Module-level state — most-recent peer proposal by (peer_instance_id, symbol)
_peer_proposals: dict[str, ProposalEvent] = {}
_peer_lock = threading.Lock()
_subscriber_task: Optional[asyncio.Task] = None
_publisher_client = None  # type: ignore[var-annotated]


async def _get_publisher():
    """Lazy-init Redis async client for publishing. Returns None if
    flag is off or REDIS_URL unset."""
    global _publisher_client
    if not consensus_bus_live():
        return None
    if _publisher_client is not None:
        return _publisher_client
    url = os.environ.get("REDIS_URL")
    if not url:
        logger.debug("[ProposalBus] REDIS_URL unset; publisher disabled")
        return None
    try:
        import redis.asyncio as redis
        _publisher_client = redis.from_url(url, decode_responses=True)
        return _publisher_client
    except Exception as err:  # noqa: BLE001
        logger.debug("[ProposalBus] publisher init failed: %s", err)
        return None


async def publish_proposal(event: ProposalEvent) -> None:
    """Publish this kernel's proposal for the given tick. Fire-and-forget;
    Redis errors are swallowed. No-op when flag is off."""
    if not consensus_bus_live():
        return
    client = await _get_publisher()
    if client is None:
        return
    try:
        payload = json.dumps(asdict(event))
        await client.publish(PROPOSAL_CHANNEL, payload)
    except Exception as err:  # noqa: BLE001
        logger.debug("[ProposalBus] publish failed: %s", err)


_sync_publisher = None  # type: ignore[var-annotated]


def publish_proposal_sync(event: ProposalEvent) -> None:
    """Sync variant for callers without an event loop (e.g. tick.py's
    synchronous run_tick). Uses the blocking `redis` library; publish
    is a single TCP write so blocking is negligible. Fire-and-forget;
    Redis errors swallowed. No-op when flag is off."""
    global _sync_publisher
    if not consensus_bus_live():
        return
    url = os.environ.get("REDIS_URL")
    if not url:
        return
    try:
        if _sync_publisher is None:
            import redis as redis_sync  # noqa: WPS433
            _sync_publisher = redis_sync.from_url(url, decode_responses=True)
        payload = json.dumps(asdict(event))
        _sync_publisher.publish(PROPOSAL_CHANNEL, payload)
    except Exception as err:  # noqa: BLE001
        logger.debug("[ProposalBus] sync publish failed: %s", err)


async def _subscriber_loop() -> None:
    """Background coroutine — subscribes to the proposal channel and
    stores the most-recent peer proposal per (instance_id, symbol)."""
    url = os.environ.get("REDIS_URL")
    if not url:
        return
    try:
        import redis.asyncio as redis
        client = redis.from_url(url, decode_responses=True)
        pubsub = client.pubsub()
        await pubsub.subscribe(PROPOSAL_CHANNEL)
        async for message in pubsub.listen():
            if message is None or message.get("type") != "message":
                continue
            try:
                raw = message.get("data", "")
                evt_dict = json.loads(raw)
                evt = ProposalEvent(**evt_dict)
                key = f"{evt.instance_id}|{evt.symbol}"
                with _peer_lock:
                    _peer_proposals[key] = evt
            except Exception as err:  # noqa: BLE001
                logger.debug("[ProposalBus] message parse failed: %s", err)
    except Exception as err:  # noqa: BLE001
        logger.debug("[ProposalBus] subscriber loop crashed: %s", err)


def init_proposal_bus() -> None:
    """Idempotently start the subscriber background task. Call once at
    kernel boot. No-op when flag is off."""
    global _subscriber_task
    if not consensus_bus_live():
        return
    if _subscriber_task is not None and not _subscriber_task.done():
        return
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            _subscriber_task = loop.create_task(_subscriber_loop())
        else:
            # Defer subscriber creation until event loop is available.
            # Caller likely runs us during sync init; the FastAPI startup
            # hook will pick this up on first request via get_event_loop.
            logger.debug("[ProposalBus] init deferred — event loop not running")
    except Exception as err:  # noqa: BLE001
        logger.debug("[ProposalBus] init failed: %s", err)


def get_recent_peer_proposal(symbol: str, self_instance_id: str) -> Optional[ProposalEvent]:
    """Return the most-recent peer proposal for `symbol` from any kernel
    instance OTHER than `self_instance_id`, provided it's fresh enough.
    Returns None when flag is off, no peer proposals received, or all
    stale beyond PEER_PROPOSAL_FRESHNESS_MS."""
    if not consensus_bus_live():
        return None
    now_ms = time.time() * 1000.0
    best: Optional[ProposalEvent] = None
    with _peer_lock:
        for evt in _peer_proposals.values():
            if evt.symbol != symbol:
                continue
            if evt.instance_id == self_instance_id:
                continue
            if now_ms - evt.at_ms > PEER_PROPOSAL_FRESHNESS_MS:
                continue
            if best is None or evt.at_ms > best.at_ms:
                best = evt
    return best


def proposal_from_tick_decision(
    *,
    symbol: str,
    instance_id: str,
    action: str,
    side: Optional[str],
    size_usdt: float,
    leverage: float,
    entry_threshold: float,
    basin_signature: list[float],
    phi: float,
    kappa: float,
    mode: str,
    tick_id: str,
    lane: str = "swing",
    conviction: float = 0.0,
    regime_label: Optional[str] = None,
    engine_version: str = "v0.8.7c-3-py",
) -> ProposalEvent:
    """Map a tick decision to a ProposalEvent for the consensus bus.

    Normalises action variants to the canonical set used by the TS bus:
      - pyramid_long / pyramid_short → enter_long / enter_short
      - exit_long / exit_short / exit → exit
      - everything else → hold

    Mirrors the TS normalisation at loop.ts:3806-3818.
    """
    # Normalise action — same logic as loop.ts self-proposal block
    if action in ("enter_long", "pyramid_long"):
        normalised_action = "enter_long"
    elif action in ("enter_short", "pyramid_short"):
        normalised_action = "enter_short"
    elif action == "exit" or action.startswith("exit"):
        normalised_action = "exit"
    else:
        normalised_action = "hold"

    return ProposalEvent(
        instance_id=instance_id,
        symbol=symbol,
        tick_id=tick_id,
        proposed_action=normalised_action,
        side=side,
        lane=lane,
        size_usdt=size_usdt,
        leverage=leverage,
        entry_threshold=entry_threshold,
        conviction=conviction,
        basin_signature=list(basin_signature),
        phi=phi,
        kappa=kappa,
        regime_label=regime_label,
        mode=mode,
        at_ms=time.time() * 1000.0,
        engine_version=engine_version,
    )


def _reset_for_tests() -> None:
    """Test cleanup — clear peer proposals + publisher client."""
    global _publisher_client, _subscriber_task
    with _peer_lock:
        _peer_proposals.clear()
    _publisher_client = None
    if _subscriber_task is not None and not _subscriber_task.done():
        _subscriber_task.cancel()
    _subscriber_task = None
