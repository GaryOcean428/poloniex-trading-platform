"""AsyncConnectionPool singleton — used by the v0.8.7c-3 trading engine.

Lazy init from DATABASE_URL. Min/max sizes tuned for ml-worker's
concurrent-trade workload (a single tick may interleave: position
read, autonomous_trades insert, autonomous_performance update,
outcome publish).
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from psycopg_pool import AsyncConnectionPool

logger = logging.getLogger(__name__)

_pool: Optional[AsyncConnectionPool] = None


def _build_pool() -> AsyncConnectionPool:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError(
            "DATABASE_URL is required for the async DB pool "
            "(v0.8.7c-3 trading engine)."
        )
    # Sizes: min=1 keeps a warm connection; max=8 lets a burst of
    # concurrent trade closes proceed without queueing. ml-worker is
    # single-replica so this caps cleanly.
    pool = AsyncConnectionPool(
        conninfo=dsn,
        min_size=1,
        max_size=8,
        timeout=30.0,
        # Open lazily on first acquire — avoids module-import-time DB
        # connection that breaks unit tests.
        open=False,
    )
    return pool


async def get_async_pool() -> AsyncConnectionPool:
    """Returns the singleton pool, opening it on first call."""
    global _pool
    if _pool is None:
        _pool = _build_pool()
    if _pool.closed:
        # Pool was previously closed (shutdown). Reopen.
        _pool = _build_pool()
    if not _pool._opened:  # type: ignore[attr-defined]
        await _pool.open()
    return _pool


async def close_async_pool() -> None:
    """Close the pool. Called on FastAPI shutdown."""
    global _pool
    if _pool is not None and not _pool.closed:
        await _pool.close()
    _pool = None
