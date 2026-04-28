"""Async DB layer for v0.8.7c-3 order placement port.

Existing parameter-registry code uses sync psycopg.connect() directly.
The trading-engine port needs concurrent async writes (entry placement
+ outcome publish + circuit-breaker update can interleave), so we
introduce an AsyncConnectionPool here.

Both can coexist — the async pool is opt-in for new code.
"""
from .pool import get_async_pool, close_async_pool

__all__ = ["get_async_pool", "close_async_pool"]
