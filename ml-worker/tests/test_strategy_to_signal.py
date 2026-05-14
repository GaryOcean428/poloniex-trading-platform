"""test_strategy_to_signal.py — ML signal direction-awareness.

2026-05-14: the `/ml/predict` signal path mapped the trend-following
strategies (momentum / breakout / trend_follow) to BUY
UNCONDITIONALLY. A breakout *down* in a clear downtrend still returned
BUY, so the ML signal was "consistently wrong" whenever the market
turned — the user had to manually reverse long→short while the signal
still said BUY, and LiveSignal then fought the reversal.

These tests pin that the signal now follows the regime direction.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from signal_mapping import strategy_to_signal as _strategy_to_signal  # noqa: E402


class TestStrategyToSignalDirection:
    def test_breakout_bearish_is_sell_not_buy(self) -> None:
        """The bug case: a breakout in a downtrend must be SELL."""
        sig = _strategy_to_signal("breakout", "creator", "BEARISH")
        assert sig["signal"] == "SELL"

    def test_breakout_bullish_is_buy(self) -> None:
        sig = _strategy_to_signal("breakout", "creator", "BULLISH")
        assert sig["signal"] == "BUY"

    def test_breakout_neutral_is_hold(self) -> None:
        """No clear direction → no conviction → HOLD (was BUY pre-fix)."""
        sig = _strategy_to_signal("breakout", "creator", "NEUTRAL")
        assert sig["signal"] == "HOLD"
        assert sig["strength"] == 0.30

    def test_momentum_and_trend_follow_follow_direction(self) -> None:
        for strat in ("momentum", "trend_follow"):
            assert _strategy_to_signal(strat, "preserver", "BEARISH")["signal"] == "SELL"
            assert _strategy_to_signal(strat, "preserver", "BULLISH")["signal"] == "BUY"
            assert _strategy_to_signal(strat, "preserver", "NEUTRAL")["signal"] == "HOLD"

    def test_mean_revert_stays_sell(self) -> None:
        """mean_revert is the counter-trend SELL leg — unchanged."""
        for direction in ("BULLISH", "BEARISH", "NEUTRAL"):
            assert _strategy_to_signal("mean_revert", "dissolver", direction)["signal"] == "SELL"

    def test_cash_stays_hold(self) -> None:
        for direction in ("BULLISH", "BEARISH", "NEUTRAL"):
            sig = _strategy_to_signal("cash", "dissolver", direction)
            assert sig["signal"] == "HOLD"
            assert sig["strength"] == 0.30

    def test_directional_strategy_keeps_its_strength_when_it_trades(self) -> None:
        """A real BUY/SELL keeps the strategy's conviction; only HOLD is floored."""
        assert _strategy_to_signal("momentum", "creator", "BULLISH")["strength"] == 0.75
        assert _strategy_to_signal("breakout", "creator", "BEARISH")["strength"] == 0.65

    def test_reason_string_carries_direction(self) -> None:
        sig = _strategy_to_signal("breakout", "creator", "BEARISH")
        assert "regime=creator" in sig["reason"]
        assert "strategy=breakout" in sig["reason"]
        assert "dir=bearish" in sig["reason"]
