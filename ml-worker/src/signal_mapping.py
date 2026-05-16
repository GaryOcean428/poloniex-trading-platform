"""signal_mapping.py — pure StrategyLoop-output → trading-signal mapping.

Extracted from main.py so the mapping can be unit-tested without
importing the FastAPI app. These are pure functions — no I/O, no
model state.

The output shape must stay compatible with polytrade-be's
mlPredictionService, which is calibrated against it.
"""
from __future__ import annotations

from typing import Any


def regime_to_direction(regime: str, trend_strength: float) -> str:
    """Map (regime, trend_strength) → BULLISH / BEARISH / NEUTRAL."""
    regime_l = (regime or "").lower()
    if regime_l == "creator" and trend_strength > 0.1:
        return "BULLISH"
    if regime_l == "preserver" and trend_strength > 0.15:
        return "BULLISH"
    if regime_l in ("dissolver",):
        return "NEUTRAL"
    if trend_strength < -0.05:
        return "BEARISH"
    return "NEUTRAL"


def strategy_to_signal(
    strategy_value: str, regime: str, direction: str,
) -> dict[str, Any]:
    """Translate StrategyLoop output into the signal format expected by polytrade-be.

    The strategy decides conviction (strength) and whether to trade at
    all; the regime *direction* (BULLISH / BEARISH / NEUTRAL, from
    regime_to_direction) decides BUY vs SELL.

    Pre-2026-05-14 this mapped momentum/breakout/trend_follow → BUY
    UNCONDITIONALLY — direction-blind. A breakout *down* in a clear
    downtrend still returned BUY, so the ML signal was "consistently
    wrong" whenever the market turned (the multi-horizon `predict` path
    already respected direction; only the `signal` path did not). That
    drove LiveSignal to fight a turning market — on 2026-05-14 the user
    had to manually reverse long→short while the signal still said BUY.
    """
    strategy = strategy_value.lower()
    regime_l = regime.lower() if regime else "unknown"
    dir_u = (direction or "NEUTRAL").upper()

    strength_map = {
        "momentum": 0.75,
        "breakout": 0.65,
        "trend_follow": 0.70,
        "mean_revert": 0.60,
        "cash": 0.30,
    }
    strength = strength_map.get(strategy, 0.30)

    if strategy == "cash":
        action = "HOLD"
    elif strategy == "mean_revert":
        # Counter-trend leg — the SELL source. Direction-aware handling
        # of mean reversion is a separate strategy question; left as-is.
        action = "SELL"
    else:
        # momentum / breakout / trend_follow are trend-FOLLOWING — the
        # signal must follow the regime's direction, not assume BUY.
        action = {"BULLISH": "BUY", "BEARISH": "SELL"}.get(dir_u, "HOLD")

    # A HOLD carries no conviction regardless of which strategy produced it.
    if action == "HOLD":
        strength = 0.30

    return {
        "signal": action,
        "strength": strength,
        "reason": f"regime={regime_l} strategy={strategy} dir={dir_u.lower()}",
    }
