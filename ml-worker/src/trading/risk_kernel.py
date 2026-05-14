"""
risk_kernel.py — pre-trade blast door (Python port).

1:1 port of apps/api/src/services/riskKernel.ts. Decisions are pure
input → KernelDecision maps so this is safe to run in shadow mode
against the live TS path — same inputs should always produce the
same decision. A parity test (see tests/trading/) pins that
invariant against a hand-crafted corpus of boundary cases.

Five vetoes (priority order, first-failure-wins):

  1. UNREALIZED_DRAWDOWN_KILL_THRESHOLD (account-saving)
  2. Execution-mode global override (operator kill-switch)
  3. Self-match prevention (Corporations Act s.1041B compliance)
  4. Per-symbol gross exposure cap (correlated-stack blast door)
  5. Symbol max leverage (exchange ceiling)

All functions are SYNC and PURE. Callers read DB / exchange / catalog
BEFORE calling into the kernel — kernel never does IO. This is also
why it's eligible for shadow-mode parity diffing against the TS side
at zero risk to live decisions.

Purity: BOUNDARY per P14. Not QIG cognition. Excluded from the purity
check's default scan root — same posture as exchange/ and
proprietary_core/.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Literal, Optional

# ────────────────────────────────────────────────────────────────
# Types — mirror the TS interfaces 1:1
# ────────────────────────────────────────────────────────────────

OrderSide = Literal["long", "short", "buy", "sell"]
RestingSide = Literal["buy", "sell"]
HeldSide = Literal["long", "short"]
ExecutionMode = Literal["auto", "paper_only", "pause"]

KernelVetoCode = Literal[
    "per_symbol_exposure_cap",
    "self_match",
    "unrealized_drawdown_kill_switch",
    "symbol_max_leverage",
    "execution_mode_paused",
    "execution_mode_paper_only_blocks_live",
    "margin_headroom",
]


@dataclass(frozen=True)
class KernelOrder:
    """Order being proposed for pre-trade evaluation."""
    symbol: str
    side: OrderSide
    notional: float     # position notional in quote (USDT)
    leverage: float
    price: float        # entry/limit price


@dataclass(frozen=True)
class KernelOpenPosition:
    symbol: str
    side: HeldSide
    notional: float


@dataclass(frozen=True)
class KernelRestingOrder:
    symbol: str
    side: RestingSide
    price: float


@dataclass(frozen=True)
class KernelAccountState:
    equity_usdt: float
    unrealized_pnl_usdt: float
    open_positions: list[KernelOpenPosition] = field(default_factory=list)
    resting_orders: list[KernelRestingOrder] = field(default_factory=list)
    # v0.8.8: cumulative margin currently committed across all open
    # positions (cross-margin sum). Caller computes from balance feed —
    # kernel stays pure sync. Default 0.0 keeps back-compat with the
    # parity corpus and pre-v0.8.8 callers.
    used_margin_usdt: float = 0.0


@dataclass(frozen=True)
class KernelContext:
    """Passed in by caller — looked up from DB / catalog before the call.

    - is_live: True for real-capital orders. Paper-only orders bypass
      the 'paper_only_blocks_live' veto.
    - mode: Global operator override (agent_execution_mode).
    - symbol_max_leverage: From marketCatalog.getMaxLeverage(symbol).
    - monkey_mode: Current Monkey mode (exploration/investigation/
      integration/drift/reversion). Optional; when provided, the
      margin-headroom check uses MODE_HEADROOM_FLOORS[monkey_mode]
      as a floor on top of the global env-var setting. Mirrors TS
      PR #668.
    """
    is_live: bool
    mode: ExecutionMode
    symbol_max_leverage: float
    monkey_mode: Optional[str] = None


# Per-mode reserve floors (TS PR #668). Tighter floor on flat (need
# headroom for rapid scalp cycles); looser on trend (one slow large
# position is OK). Keys match modes.py MonkeyMode values.
MODE_HEADROOM_FLOORS: dict[str, float] = {
    "exploration": 0.35,
    "investigation": 0.25,
    "integration": 0.15,
    "drift": 0.50,
    "reversion": 0.25,  # mirrors INVESTIGATION envelope
}


@dataclass(frozen=True)
class KernelDecision:
    allowed: bool
    reason: Optional[str] = None
    code: Optional[KernelVetoCode] = None


# ────────────────────────────────────────────────────────────────
# Thresholds — 1:1 with TS reference
# ────────────────────────────────────────────────────────────────

# Per-symbol gross notional cap as a multiple of equity. Notional-based
# (not margin-based) because at high leverage, margin commit per unit
# notional is small. TS reference raised this from 3.0 → 5.0 after the
# 2026-04 observation that $19 equity × 3× = $56, below the $75 BTC lot
# floor. TODO when the TS side migrates to margin-based cap: mirror.
PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER = 5.0

# Unrealized drawdown kill-switch threshold. -15% of equity triggers
# flatten-all + 24h pause. The realised-loss daily cap can miss a flash
# wick (no trade closed), so this acts on the running P&L directly.
UNREALIZED_DRAWDOWN_KILL_THRESHOLD = -0.15


def _is_long(side: OrderSide) -> bool:
    return side == "long" or side == "buy"


# ────────────────────────────────────────────────────────────────
# Check 1 — per-symbol gross exposure
# ────────────────────────────────────────────────────────────────

def check_per_symbol_exposure(
    order: KernelOrder,
    state: KernelAccountState,
) -> KernelDecision:
    """Blocks any order that would push gross notional on this symbol
    past equity × PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER.
    """
    cap = state.equity_usdt * PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER
    existing = sum(
        abs(p.notional) for p in state.open_positions if p.symbol == order.symbol
    )
    projected = existing + abs(order.notional)
    if projected > cap:
        return KernelDecision(
            allowed=False,
            code="per_symbol_exposure_cap",
            reason=(
                f"Per-symbol exposure cap breached: {projected:.2f} > {cap:.2f} "
                f"({PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER}× equity)"
            ),
        )
    return KernelDecision(allowed=True)


# ────────────────────────────────────────────────────────────────
# Check 2 — self-match prevention
# ────────────────────────────────────────────────────────────────

def check_self_match(
    order: KernelOrder,
    state: KernelAccountState,
) -> KernelDecision:
    """A buy would self-match a same-account sell at-or-below the buy
    price. A sell would self-match a same-account buy at-or-above the
    sell price. Blocks per Corporations Act s.1041B (false trading).
    """
    order_is_buy = _is_long(order.side)
    for resting in state.resting_orders:
        if resting.symbol != order.symbol:
            continue
        resting_is_buy = resting.side == "buy"
        if order_is_buy == resting_is_buy:
            continue
        crosses = (
            resting.price <= order.price if order_is_buy
            else resting.price >= order.price
        )
        if crosses:
            return KernelDecision(
                allowed=False,
                code="self_match",
                reason=(
                    f"Self-match with account's own resting {resting.side} "
                    f"@ {resting.price} on {resting.symbol}. "
                    f"Blocked per Corporations Act s.1041B."
                ),
            )
    return KernelDecision(allowed=True)


# ────────────────────────────────────────────────────────────────
# Check 3 — unrealised-drawdown kill-switch
# ────────────────────────────────────────────────────────────────

def check_unrealized_drawdown(state: KernelAccountState) -> KernelDecision:
    """If unrealized P&L ≤ -15% of equity, halt all new orders. The
    caller is responsible for the flatten-all + 24h pause on the
    order side; this function only blocks new entries.
    """
    if state.equity_usdt <= 0:
        # Divide-by-zero guard. Realised-loss cap owns this case.
        return KernelDecision(allowed=True)
    ratio = state.unrealized_pnl_usdt / state.equity_usdt
    if ratio <= UNREALIZED_DRAWDOWN_KILL_THRESHOLD:
        return KernelDecision(
            allowed=False,
            code="unrealized_drawdown_kill_switch",
            reason=(
                f"Unrealised P&L {ratio * 100:.2f}% of equity ≤ "
                f"{UNREALIZED_DRAWDOWN_KILL_THRESHOLD * 100:.0f}% — "
                f"flatten and pause 24h."
            ),
        )
    return KernelDecision(allowed=True)


# ────────────────────────────────────────────────────────────────
# Check 4 — execution-mode global override
# ────────────────────────────────────────────────────────────────

def check_execution_mode(
    is_live_order: bool,
    mode: ExecutionMode,
) -> KernelDecision:
    """Operator kill-switch. pause = block everything;
    paper_only = block live but allow paper; auto = pass through.
    """
    if mode == "pause":
        return KernelDecision(
            allowed=False,
            code="execution_mode_paused",
            reason="Execution Mode is Pause — no new orders at any stage.",
        )
    if mode == "paper_only" and is_live_order:
        return KernelDecision(
            allowed=False,
            code="execution_mode_paper_only_blocks_live",
            reason=(
                "Execution Mode is Paper-Only — live order blocked; "
                "route to paper instead."
            ),
        )
    return KernelDecision(allowed=True)


# ────────────────────────────────────────────────────────────────
# Check 5 — symbol max leverage (exchange ceiling)
# ────────────────────────────────────────────────────────────────

def check_symbol_max_leverage(
    order: KernelOrder,
    symbol_max_leverage: float,
) -> KernelDecision:
    """Enforces the exchange's per-symbol maxLeverage ceiling. Caller
    reads marketCatalog.getMaxLeverage(symbol) and passes it in —
    kernel stays sync.
    """
    if order.leverage > symbol_max_leverage:
        return KernelDecision(
            allowed=False,
            code="symbol_max_leverage",
            reason=(
                f"Leverage {order.leverage}× exceeds {order.symbol} "
                f"exchange max of {symbol_max_leverage}×."
            ),
        )
    return KernelDecision(allowed=True)


# ────────────────────────────────────────────────────────────────
# Check 6 — margin headroom reserve (v0.8.8)
# ────────────────────────────────────────────────────────────────

def _min_margin_headroom_pct() -> float:
    raw = os.getenv("MONKEY_MIN_MARGIN_HEADROOM_PCT", "0.0")
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return 0.0
    if not (0.0 <= v < 1.0):
        return 0.0  # operator typo → fail OPEN, don't freeze trading
    return v


def check_margin_headroom(
    order: KernelOrder,
    state: KernelAccountState,
    min_headroom_pct: Optional[float] = None,
    monkey_mode: Optional[str] = None,
) -> KernelDecision:
    """Reserve N% of equity as uncommitted margin so closes / reverses /
    counter-positions always have room. Without this, Monkey can keep
    entering tick-after-tick when basin direction stays strong, until
    available margin → 0 and Poloniex rejects new orders incl. the
    fresh-open leg of reverses.

    min_headroom_pct=None reads MONKEY_MIN_MARGIN_HEADROOM_PCT env var
    (default 0.0 = no-op, parity with TS reference).

    monkey_mode (TS PR #668) sets a per-mode floor that takes effect
    when it's higher than the env-derived global. EXPLORATION 35% /
    INVESTIGATION 25% / INTEGRATION 15% / DRIFT 50% / REVERSION 25%.

    Out-of-range pct (negative or ≥ 1) fails OPEN — operator typo
    shouldn't silently freeze the kernel.
    """
    pct = _min_margin_headroom_pct() if min_headroom_pct is None else min_headroom_pct
    # Apply per-mode floor when monkey_mode is provided.
    if monkey_mode is not None:
        mode_floor = MODE_HEADROOM_FLOORS.get(monkey_mode.lower())
        if mode_floor is not None and 0.0 < mode_floor < 1.0:
            pct = max(pct, mode_floor)
    if pct is None or pct <= 0.0 or pct >= 1.0:
        return KernelDecision(allowed=True)
    if state.equity_usdt <= 0:
        return KernelDecision(allowed=True)

    new_margin = abs(order.notional) / max(order.leverage, 1.0)
    projected_used = state.used_margin_usdt + new_margin
    free_after = state.equity_usdt - projected_used
    free_pct = free_after / state.equity_usdt
    if free_pct < pct:
        return KernelDecision(
            allowed=False,
            code="margin_headroom",
            reason=(
                f"Margin headroom {free_pct * 100:.1f}% below "
                f"{pct * 100:.0f}% reserve "
                f"(equity={state.equity_usdt:.2f} "
                f"used_after={projected_used:.2f} "
                f"new_margin={new_margin:.2f})"
            ),
        )
    return KernelDecision(allowed=True)


# ────────────────────────────────────────────────────────────────
# Composer — priority-ordered chain
# ────────────────────────────────────────────────────────────────

def evaluate_pre_trade_vetoes(
    order: KernelOrder,
    state: KernelAccountState,
    context: KernelContext,
) -> KernelDecision:
    """Run all kernel vetoes in priority order. First failure stops
    the chain and is returned. If all pass, returns allowed=True.

    Priority (matches TS reference exactly):
      1. Unrealised-drawdown kill-switch (account-saving)
      2. Execution-mode global override (operator kill-switch)
      3. Self-match (legal compliance)
      4. Per-symbol exposure (correlated-stack blast door)
      5. Margin headroom reserve (v0.8.8 — uncommitted-margin floor)
      6. Symbol max leverage (exchange ceiling)
    """
    for check in (
        check_unrealized_drawdown(state),
        check_execution_mode(context.is_live, context.mode),
        check_self_match(order, state),
        check_per_symbol_exposure(order, state),
        check_margin_headroom(order, state, monkey_mode=context.monkey_mode),
        check_symbol_max_leverage(order, context.symbol_max_leverage),
    ):
        if not check.allowed:
            return check
    return KernelDecision(allowed=True)
