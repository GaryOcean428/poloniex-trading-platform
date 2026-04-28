"""Async event publishing for v0.8.7c-3.

Mirrors the TS-side `ml:trade:outcome` Redis publish from
fullyAutonomousTrader. Used by the trading engine to emit outcome
events that ml-worker's online learners (and any future consumers)
subscribe to.
"""
from .outcome_publisher import (
    publish_trade_outcome,
    close_redis_client,
    TradeOutcomeEvent,
)

__all__ = [
    "publish_trade_outcome",
    "close_redis_client",
    "TradeOutcomeEvent",
]
