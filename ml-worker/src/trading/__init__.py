"""
trading — Python ports of apps/api/src/services trading logic.

v0.8.7 scope: the orchestration that currently runs in apps/api
(risk kernel, live signal engine, fully-autonomous trader) lifts into
Python additively. TS remains authoritative during Stage 1;
Python ports run in shadow mode with parity-diff telemetry. Once
parity is proven, v0.8.8 cuts over and the TS copies delete.

Purity: this package is BOUNDARY per P14, not QIG cognition. It
ingests the decisions Monkey's kernel computes (risk gates, position
sizing, order placement) and speaks to the exchange. Excluded from
qig_purity_check's default scan roots — same posture as
exchange/ and proprietary_core/.
"""

from .risk_kernel import (
    KernelAccountState,
    KernelContext,
    KernelDecision,
    KernelOpenPosition,
    KernelOrder,
    KernelRestingOrder,
    KernelVetoCode,
    PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER,
    UNREALIZED_DRAWDOWN_KILL_THRESHOLD,
    check_execution_mode,
    check_per_symbol_exposure,
    check_self_match,
    check_symbol_max_leverage,
    check_unrealized_drawdown,
    evaluate_pre_trade_vetoes,
)
from .exit_decisions import (
    ExitConfig,
    ExitDecision,
    ExitReason,
    MarketAnalysis,
    PositionSnapshot,
    Side as PositionSide,
    Trend,
    decide_exit,
)
from .reconciliation import (
    ExchangePosition,
    ReconciliationReport,
    TrackedPosition,
    reconcile_positions,
)

__all__ = [
    "ExchangePosition",
    "ExitConfig",
    "ExitDecision",
    "ExitReason",
    "KernelAccountState",
    "KernelContext",
    "KernelDecision",
    "KernelOpenPosition",
    "KernelOrder",
    "KernelRestingOrder",
    "KernelVetoCode",
    "MarketAnalysis",
    "PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER",
    "PositionSide",
    "PositionSnapshot",
    "ReconciliationReport",
    "TrackedPosition",
    "Trend",
    "UNREALIZED_DRAWDOWN_KILL_THRESHOLD",
    "check_execution_mode",
    "check_per_symbol_exposure",
    "check_self_match",
    "check_symbol_max_leverage",
    "check_unrealized_drawdown",
    "decide_exit",
    "evaluate_pre_trade_vetoes",
    "reconcile_positions",
]
