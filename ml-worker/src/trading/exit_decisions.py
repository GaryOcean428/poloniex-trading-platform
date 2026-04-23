"""
exit_decisions.py — pure position-exit logic (v0.8.7c-1).

Ports the stateless pieces of fullyAutonomousTrader.managePositions
that decide WHETHER a position should close and WHY. The orchestration
layer (reading exchange positions, writing exit orders, updating DB)
stays TS until v0.8.7c-3 — this module only produces exit decisions
given already-fetched position + market state.

Three exit triggers, priority-ordered (first-hit-wins matches the TS
if/else-if chain in managePositions):

  1. STOP_LOSS      pnl_percent ≤ -config.stop_loss_percent
  2. TAKE_PROFIT    pnl_percent ≥ config.take_profit_percent
  3. TREND_REVERSAL pnl_percent ≥ trailing_trigger AND trend flipped
                    (trailing_trigger == stop_loss_percent per TS
                     line 1231: "start trailing stop when profit
                     exceeds SL distance")

This is the natural per-position analogue to risk_kernel's pre-trade
chain: same "first failure wins" composer, same pure function shape.
Keeps shadow-mode parity cheap.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

# ────────────────────────────────────────────────────────────────
# Types mirror TS reference — camelCase → snake_case at the boundary
# ────────────────────────────────────────────────────────────────

ExitReason = Literal[
    "stop_loss",
    "take_profit",
    "trend_reversal",
    "hold",  # sentinel: no exit this tick
]

Trend = Literal["bullish", "bearish", "neutral", "unknown"]
Side = Literal["long", "short"]


@dataclass(frozen=True)
class ExitConfig:
    """Per-user trading config passed in by orchestration layer.
    Sourced from agent_config / TradingConfig in the TS side.
    """
    stop_loss_percent: float = 2.0    # e.g. 2 = 2%
    take_profit_percent: float = 4.0


@dataclass(frozen=True)
class PositionSnapshot:
    """Position state at decision time. Caller fetches from Poloniex
    (TS: poloniexFuturesService.getPositions) and maps field names —
    keeps this module IO-free.
    """
    symbol: str
    qty: float              # signed: positive = long, negative = short
    entry_price: float
    unrealized_pnl: float   # USDT

    @property
    def side(self) -> Side:
        return "long" if self.qty > 0 else "short"

    def pnl_percent(self) -> float:
        """Return P&L as a percent of cost basis (same formula as TS
        managePositions line 1247: unrealizedPnL / (entry × |qty|) * 100).

        Zero entry or zero qty → 0 (divide-by-zero guard matches TS).
        """
        if self.entry_price <= 0 or self.qty == 0:
            return 0.0
        return (self.unrealized_pnl / (self.entry_price * abs(self.qty))) * 100.0


@dataclass(frozen=True)
class MarketAnalysis:
    """Slice of MarketAnalysis the exit-decision needs. TS type has
    many more fields (volatility, momentum, etc.); we only take what
    drives the exit logic.
    """
    trend: Trend


@dataclass(frozen=True)
class ExitDecision:
    """Structured output. Carries enough context that the orchestration
    layer can log + audit without needing to re-derive thresholds.
    """
    should_close: bool
    reason: ExitReason
    explanation: str
    pnl_percent: float
    stop_loss_threshold: float
    take_profit_threshold: float


def decide_exit(
    position: PositionSnapshot,
    config: ExitConfig,
    analysis: Optional[MarketAnalysis] = None,
) -> ExitDecision:
    """Run the three-gate exit chain. First-trigger-wins matches the
    TS managePositions flow. `analysis` is optional because in TS it's
    a .get() lookup that may miss — in that case trend-reversal can't
    fire but stop_loss / take_profit still can.

    Returns ExitDecision(should_close=False, reason='hold', …) when no
    trigger fires — caller continues holding.
    """
    pnl_pct = position.pnl_percent()
    sl_thr = config.stop_loss_percent
    tp_thr = config.take_profit_percent
    trailing_trigger = sl_thr  # TS line 1231: "start trailing stop when profit exceeds SL distance"

    # Gate 1: stop-loss (account-saving; runs first)
    if pnl_pct < -sl_thr:
        return ExitDecision(
            should_close=True,
            reason="stop_loss",
            explanation=(
                f"Stop loss triggered: {pnl_pct:.2f}% < -{sl_thr:.2f}%"
            ),
            pnl_percent=pnl_pct,
            stop_loss_threshold=sl_thr,
            take_profit_threshold=tp_thr,
        )

    # Gate 2: take-profit
    if pnl_pct > tp_thr:
        return ExitDecision(
            should_close=True,
            reason="take_profit",
            explanation=(
                f"Take profit triggered: {pnl_pct:.2f}% > {tp_thr:.2f}%"
            ),
            pnl_percent=pnl_pct,
            stop_loss_threshold=sl_thr,
            take_profit_threshold=tp_thr,
        )

    # Gate 3: trailing stop via trend reversal (needs analysis present)
    if pnl_pct > trailing_trigger and analysis is not None:
        is_long = position.qty > 0
        reversed_against_us = (
            (is_long and analysis.trend == "bearish")
            or (not is_long and analysis.trend == "bullish")
        )
        if reversed_against_us:
            return ExitDecision(
                should_close=True,
                reason="trend_reversal",
                explanation=(
                    f"Trailing stop + trend reversal: pnl={pnl_pct:.2f}% > "
                    f"trigger {trailing_trigger:.2f}%, trend={analysis.trend} "
                    f"vs {position.side}"
                ),
                pnl_percent=pnl_pct,
                stop_loss_threshold=sl_thr,
                take_profit_threshold=tp_thr,
            )

    return ExitDecision(
        should_close=False,
        reason="hold",
        explanation=(
            f"Hold: pnl={pnl_pct:.2f}% in "
            f"[-{sl_thr:.2f}%, {tp_thr:.2f}%]"
        ),
        pnl_percent=pnl_pct,
        stop_loss_threshold=sl_thr,
        take_profit_threshold=tp_thr,
    )
