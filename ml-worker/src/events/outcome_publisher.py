"""Async Redis publisher for trade outcome events.

Channel: `ml:trade:outcome` (matches TS-side publishOutcomeEvent
in fullyAutonomousTrader / liveSignalEngine).

Default behaviour when REDIS_URL is unset: log + skip. The trading
engine should still produce trades; only the bus event is no-op'd.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass
from typing import Optional

import redis.asyncio as redis

logger = logging.getLogger(__name__)

OUTCOME_CHANNEL = "ml:trade:outcome"

_client: Optional[redis.Redis] = None


@dataclass
class TradeOutcomeEvent:
    """Schema mirrors TS-side publishOutcomeEvent payload.

    Consumers subscribe to ml:trade:outcome and update their internal
    state (online learners, dashboards, etc.) on every published event.
    """
    user_id: str
    symbol: str
    side: str  # 'long' | 'short'
    entry_price: float
    exit_price: float
    quantity: float
    pnl: float
    exit_reason: str
    order_id: str
    closed_at_ms: int
    engine_version: str = "v0.8.7c-3-py"


async def _get_client() -> Optional[redis.Redis]:
    """Lazy-init Redis client. Returns None if REDIS_URL is unset
    (publish becomes no-op + log)."""
    global _client
    if _client is not None:
        return _client
    url = os.environ.get("REDIS_URL")
    if not url:
        logger.warning(
            "REDIS_URL unset — trade outcome events will be logged but "
            "not published. Online learners + dashboards subscribing to "
            "ml:trade:outcome will not see this engine's events."
        )
        return None
    _client = redis.from_url(url, decode_responses=True)
    return _client


async def publish_trade_outcome(event: TradeOutcomeEvent) -> bool:
    """Publish to ml:trade:outcome. Returns True on success, False on
    no-op (Redis unset) or error. Never raises — this is a fire-and-
    forget sidechannel; trade execution must not depend on bus health.
    """
    client = await _get_client()
    payload = json.dumps(asdict(event))
    if client is None:
        logger.info("[outcome.no-redis] %s", payload)
        return False
    try:
        await client.publish(OUTCOME_CHANNEL, payload)
        return True
    except Exception as err:  # noqa: BLE001 — fire-and-forget sidechannel
        logger.warning(
            "[outcome.publish-failed] %s — %s", err, payload,
        )
        return False


async def close_redis_client() -> None:
    """Close the Redis client. Called on FastAPI shutdown."""
    global _client
    if _client is not None:
        try:
            await _client.aclose()
        except Exception:  # noqa: BLE001
            pass
        _client = None
