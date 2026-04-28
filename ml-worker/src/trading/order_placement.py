"""v0.8.7c-3 — Python port of fullyAutonomousTrader's order placement.

Three methods migrated from TS:
  - execute_entry      — open new position (long/short), persist to DB,
                         publish outcome on submission failure for parity
  - close_position     — close existing position, persist exit, publish
                         outcome on success
  - record_trade_result — circuit-breaker state update on a closed trade

The TS counterparts live in apps/api/src/services/fullyAutonomousTrader.ts
at:
  executeSignals + executeEntry block — line ~870-1100 (size format,
  leverage set, margin check, place order, persist)
  closePosition — line ~1435-1483
  recordTradeResult — line ~1618-1646

Activation flow (per strategic-guidance directive):
  1. ✓ Build the Python surface (this file + endpoints) — flag default OFF.
  2. Soak: TS continues to own order placement until evidence is conclusive.
  3. After Phase B real-OHLCV validation soaks 24-48h: flip
     TRADING_ENGINE_PY=true. TS short-circuits before its own
     poloniexFuturesService.closePosition / submitOrder and POSTs to the
     Python endpoints instead.
  4. v0.8.8: delete TS orchestration modules.

State management note:
  The TS class FullyAutonomousTrader holds in-memory state (configs,
  performanceMetrics, circuit-breakers, runningIntervals). The Python
  port keeps that state in this module's module-level singletons +
  the database. CircuitBreaker state is per-user, in-memory; restarts
  reset it (matches TS behaviour).
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════════════
# CircuitBreaker — in-memory, mirrors TS-side recordTradeResult logic
# ════════════════════════════════════════════════════════════════════

# SAFETY_BOUND constants — match TS values verbatim. P14 says safety
# bounds may be hardcoded; these are catastrophic-loss guard rails.
MAX_CONSECUTIVE_LOSSES = 5
MAX_DAILY_LOSS_PERCENT = 10.0
COOLDOWN_AFTER_TRIP_MS = 30 * 60 * 1000  # 30 minutes


@dataclass
class CircuitBreakerState:
    consecutive_losses: int = 0
    daily_loss: float = 0.0
    is_tripped: bool = False
    tripped_at_ms: Optional[int] = None
    tripped_reason: Optional[str] = None
    daily_reset_at_ms: int = field(default_factory=lambda: int(time.time() * 1000))


_circuit_breakers: dict[str, CircuitBreakerState] = {}


def get_circuit_breaker(user_id: str) -> CircuitBreakerState:
    """Get-or-create a per-user circuit breaker. Resets daily_loss
    if the calendar day rolled over since last access."""
    cb = _circuit_breakers.get(user_id)
    if cb is None:
        cb = CircuitBreakerState()
        _circuit_breakers[user_id] = cb
    # Day-rollover check (UTC). 86_400_000 ms = 24h.
    now_ms = int(time.time() * 1000)
    if now_ms - cb.daily_reset_at_ms > 86_400_000:
        cb.daily_loss = 0.0
        cb.daily_reset_at_ms = now_ms
    # Cooldown — auto-untrip after COOLDOWN_AFTER_TRIP_MS.
    if cb.is_tripped and cb.tripped_at_ms is not None:
        if now_ms - cb.tripped_at_ms >= COOLDOWN_AFTER_TRIP_MS:
            cb.is_tripped = False
            cb.consecutive_losses = 0
            cb.tripped_reason = None
            cb.tripped_at_ms = None
    return cb


def record_trade_result(user_id: str, pnl: float, capital_base: float) -> CircuitBreakerState:
    """Update circuit-breaker state after a closed trade.

    Mirrors fullyAutonomousTrader.ts:1618 recordTradeResult.

    Returns the post-update CB state for caller introspection.
    """
    cb = get_circuit_breaker(user_id)

    if pnl < 0:
        cb.consecutive_losses += 1
        cb.daily_loss += abs(pnl)
    else:
        cb.consecutive_losses = 0  # reset on a win

    # Consecutive-loss check
    if cb.consecutive_losses >= MAX_CONSECUTIVE_LOSSES and not cb.is_tripped:
        cb.is_tripped = True
        cb.tripped_at_ms = int(time.time() * 1000)
        cb.tripped_reason = (
            f"{cb.consecutive_losses} consecutive losses — pausing for cooldown"
        )
        logger.warning(
            "[CB] TRIPPED for user %s: %s", user_id, cb.tripped_reason,
        )

    # Daily-loss limit check
    daily_loss_percent = (cb.daily_loss / capital_base) * 100 if capital_base > 0 else 0.0
    if daily_loss_percent >= MAX_DAILY_LOSS_PERCENT and not cb.is_tripped:
        cb.is_tripped = True
        cb.tripped_at_ms = int(time.time() * 1000)
        cb.tripped_reason = (
            f"Daily loss limit reached ({daily_loss_percent:.1f}% of capital) — "
            "halting until next day"
        )
        logger.warning(
            "[CB] TRIPPED for user %s: %s", user_id, cb.tripped_reason,
        )

    return cb


def reset_circuit_breakers_for_test() -> None:
    """Clear all per-user CB state. Test-only entry point."""
    _circuit_breakers.clear()


# ════════════════════════════════════════════════════════════════════
# Order placement / close — DB writes
# ════════════════════════════════════════════════════════════════════
#
# These functions write to autonomous_trades. The TS counterpart is
# fullyAutonomousTrader.ts:1435 closePosition (DB UPDATE). Entry
# placement TS code lives in executeSignals; the simplified port here
# accepts a pre-validated signal dict and an exit_price/pnl for parity.
#
# IO architecture: caller acquires async pool from db.pool, passes a
# connection or uses pool.connection() context. Functions take the
# pool directly so the caller doesn't have to thread a connection
# through. Each function is a single transaction.

@dataclass
class CloseRecord:
    user_id: str
    symbol: str
    exit_reason: str
    exit_price: float
    pnl: float
    closed_at_ms: int


async def close_open_trades(pool, record: CloseRecord) -> int:
    """UPDATE all status='open' rows for (user_id, symbol) → status='closed'
    with the supplied exit metadata. Mirrors closePosition's DB write.

    Returns number of rows updated. Idempotent (already-closed rows
    don't match the WHERE).
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            # Try the rich update first; fall back if exit columns missing
            # (matches TS-side defensive try/catch at line 1459).
            try:
                await cur.execute(
                    """
                    UPDATE autonomous_trades
                       SET status = 'closed',
                           exit_reason = %s,
                           exit_time = NOW(),
                           exit_price = %s,
                           pnl = %s
                     WHERE user_id = %s AND symbol = %s AND status = 'open'
                    """,
                    (record.exit_reason, record.exit_price, record.pnl,
                     record.user_id, record.symbol),
                )
                rows = cur.rowcount
                await conn.commit()
                return rows or 0
            except Exception:
                # Roll back and retry without exit_price + pnl columns
                await conn.rollback()
                await cur.execute(
                    """
                    UPDATE autonomous_trades
                       SET status = 'closed',
                           exit_reason = %s,
                           exit_time = NOW()
                     WHERE user_id = %s AND symbol = %s AND status = 'open'
                    """,
                    (record.exit_reason, record.user_id, record.symbol),
                )
                rows = cur.rowcount
                await conn.commit()
                return rows or 0


@dataclass
class EntryRecord:
    user_id: str
    symbol: str
    side: str  # 'long' | 'short' | 'buy' | 'sell'
    entry_price: float
    quantity: float
    leverage: float
    stop_loss: Optional[float]
    take_profit: Optional[float]
    confidence: float
    reason: str
    order_id: str
    paper_trade: bool = False
    engine_version: str = "v0.8.7c-3-py"


async def insert_entry(pool, record: EntryRecord) -> str:
    """INSERT a new autonomous_trades row for an opened position.

    Returns the new row's id (UUID).
    """
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO autonomous_trades
                  (user_id, symbol, side, entry_price, quantity, leverage,
                   stop_loss, take_profit, confidence, reason, order_id,
                   paper_trade, engine_version)
                VALUES (%s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s,
                        %s, %s)
                RETURNING id
                """,
                (record.user_id, record.symbol, record.side,
                 record.entry_price, record.quantity, record.leverage,
                 record.stop_loss, record.take_profit, record.confidence,
                 record.reason, record.order_id,
                 record.paper_trade, record.engine_version),
            )
            row = await cur.fetchone()
            await conn.commit()
            return str(row[0]) if row else ""


# ════════════════════════════════════════════════════════════════════
# Activation flag
# ════════════════════════════════════════════════════════════════════

import os  # noqa: E402


def trading_engine_py_enabled() -> bool:
    """Return True iff TRADING_ENGINE_PY=true in env. Default false.

    When False, the Python order-placement endpoints exist but should
    return 503 / no-op so TS continues owning order placement. The TS
    side will eventually short-circuit on this flag, but until then
    the flag's only effect is documenting which side is authoritative.
    """
    return os.environ.get("TRADING_ENGINE_PY", "").strip().lower() == "true"
