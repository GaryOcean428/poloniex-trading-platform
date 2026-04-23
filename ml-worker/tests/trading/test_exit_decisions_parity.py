"""
test_exit_decisions_parity.py — pin exit_decisions.py to
fullyAutonomousTrader.managePositions TS behavior.

Each test traces one TS-side path through the if/else-if chain with
hand-derived expected outcomes. Boundary cases (exactly-at-threshold,
no analysis, tp_percent = sl_percent, zero quantity) are explicit.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from trading.exit_decisions import (  # noqa: E402
    ExitConfig,
    ExitDecision,
    MarketAnalysis,
    PositionSnapshot,
    decide_exit,
)


def _long_pos(*, entry: float = 100.0, qty: float = 1.0, pnl: float = 0.0) -> PositionSnapshot:
    return PositionSnapshot(symbol="BTC_USDT_PERP", qty=qty, entry_price=entry, unrealized_pnl=pnl)


def _short_pos(*, entry: float = 100.0, qty: float = -1.0, pnl: float = 0.0) -> PositionSnapshot:
    return PositionSnapshot(symbol="BTC_USDT_PERP", qty=qty, entry_price=entry, unrealized_pnl=pnl)


def _cfg(*, sl: float = 2.0, tp: float = 4.0) -> ExitConfig:
    return ExitConfig(stop_loss_percent=sl, take_profit_percent=tp)


# ─── P&L calculation ─────────────────────────────────────────────

class TestPnLPercent:
    def test_long_positive(self):
        """Long entry $100 × 1 qty, +$5 unreal → +5%."""
        p = _long_pos(entry=100, qty=1, pnl=5)
        assert p.pnl_percent() == pytest.approx(5.0)

    def test_short_positive(self):
        """Short entry $100 × -1 qty, +$5 unreal → +5% (abs(qty))."""
        p = _short_pos(entry=100, qty=-1, pnl=5)
        assert p.pnl_percent() == pytest.approx(5.0)

    def test_long_negative(self):
        p = _long_pos(entry=100, qty=1, pnl=-3)
        assert p.pnl_percent() == pytest.approx(-3.0)

    def test_zero_entry_returns_zero(self):
        p = _long_pos(entry=0, qty=1, pnl=10)
        assert p.pnl_percent() == 0.0

    def test_zero_qty_returns_zero(self):
        p = _long_pos(entry=100, qty=0, pnl=10)
        assert p.pnl_percent() == 0.0


# ─── Stop-loss gate ──────────────────────────────────────────────

class TestStopLoss:
    def test_below_stop_loss_triggers(self):
        """Long -3% with sl=2% → stop_loss fires."""
        r = decide_exit(_long_pos(pnl=-3), _cfg(sl=2, tp=4))
        assert r.should_close is True
        assert r.reason == "stop_loss"

    def test_exactly_at_minus_sl_does_not_trigger(self):
        """TS uses pnlPercent < -slPercent, strict — exactly-at stays open."""
        r = decide_exit(_long_pos(pnl=-2), _cfg(sl=2, tp=4))
        assert r.should_close is False
        assert r.reason == "hold"

    def test_one_cent_below_minus_sl_triggers(self):
        r = decide_exit(_long_pos(pnl=-2.01), _cfg(sl=2, tp=4))
        assert r.should_close is True
        assert r.reason == "stop_loss"

    def test_short_stop_loss_on_price_rise(self):
        """Short losing money when price moves up → unreal_pnl goes negative."""
        r = decide_exit(_short_pos(qty=-1, entry=100, pnl=-3), _cfg(sl=2))
        assert r.should_close is True
        assert r.reason == "stop_loss"


# ─── Take-profit gate ────────────────────────────────────────────

class TestTakeProfit:
    def test_above_tp_triggers(self):
        r = decide_exit(_long_pos(pnl=5), _cfg(sl=2, tp=4))
        assert r.should_close is True
        assert r.reason == "take_profit"

    def test_exactly_at_tp_does_not_trigger(self):
        """TS uses pnlPercent > tpPercent, strict."""
        r = decide_exit(_long_pos(pnl=4), _cfg(sl=2, tp=4))
        # 4% is NOT > 4% → no TP, but 4% IS > trailing_trigger=2% …
        # However trend reversal needs analysis; without it → hold.
        assert r.reason != "take_profit"

    def test_one_cent_above_tp_triggers(self):
        r = decide_exit(_long_pos(pnl=4.01), _cfg(sl=2, tp=4))
        assert r.should_close is True
        assert r.reason == "take_profit"


# ─── Trailing-stop / trend-reversal gate ─────────────────────────

class TestTrailingReversal:
    def test_long_profit_bearish_trend_closes(self):
        """Long at +3% (above trailing_trigger=sl=2), bearish analysis → close."""
        r = decide_exit(
            _long_pos(pnl=3),
            _cfg(sl=2, tp=4),
            analysis=MarketAnalysis(trend="bearish"),
        )
        assert r.should_close is True
        assert r.reason == "trend_reversal"

    def test_short_profit_bullish_trend_closes(self):
        """Short at +3%, bullish analysis → close."""
        r = decide_exit(
            _short_pos(qty=-1, pnl=3),
            _cfg(sl=2, tp=4),
            analysis=MarketAnalysis(trend="bullish"),
        )
        assert r.should_close is True
        assert r.reason == "trend_reversal"

    def test_long_profit_bullish_trend_holds(self):
        """Long at +3%, bullish analysis → aligned, hold."""
        r = decide_exit(
            _long_pos(pnl=3),
            _cfg(sl=2, tp=4),
            analysis=MarketAnalysis(trend="bullish"),
        )
        assert r.should_close is False
        assert r.reason == "hold"

    def test_missing_analysis_skips_trailing(self):
        """pnl above trailing but no analysis → can't evaluate reversal."""
        r = decide_exit(_long_pos(pnl=3), _cfg(sl=2, tp=4), analysis=None)
        assert r.should_close is False
        assert r.reason == "hold"

    def test_neutral_trend_holds(self):
        r = decide_exit(
            _long_pos(pnl=3),
            _cfg(sl=2, tp=4),
            analysis=MarketAnalysis(trend="neutral"),
        )
        assert r.should_close is False

    def test_below_trailing_trigger_holds(self):
        """pnl=1% with sl=2 → below trailing_trigger=2 → no reversal check."""
        r = decide_exit(
            _long_pos(pnl=1),
            _cfg(sl=2, tp=4),
            analysis=MarketAnalysis(trend="bearish"),
        )
        assert r.should_close is False


# ─── Priority ordering ───────────────────────────────────────────

class TestPriorityOrdering:
    def test_stop_loss_wins_over_take_profit(self):
        """Impossible in reality but tests strict priority.
        If stop_loss_percent > take_profit_percent somehow, SL runs first."""
        r = decide_exit(_long_pos(pnl=-10), _cfg(sl=5, tp=1))
        # -10 < -5 → SL fires first (even though -10 is also not > 1)
        assert r.reason == "stop_loss"

    def test_take_profit_wins_over_trailing(self):
        """+5% with sl=2, tp=4 AND bearish trend → TP gate fires FIRST
        (pnl=5 > 4 → TP), trailing never evaluated.
        """
        r = decide_exit(
            _long_pos(pnl=5),
            _cfg(sl=2, tp=4),
            analysis=MarketAnalysis(trend="bearish"),
        )
        assert r.reason == "take_profit"

    def test_sl_wins_over_trailing(self):
        """-3% → SL fires even if we had analysis (pnl negative so trailing
        wouldn't fire anyway, but priority test)."""
        r = decide_exit(
            _long_pos(pnl=-3),
            _cfg(sl=2, tp=4),
            analysis=MarketAnalysis(trend="bearish"),
        )
        assert r.reason == "stop_loss"


# ─── Hold path (no exit) ─────────────────────────────────────────

class TestHoldPath:
    def test_within_band_holds(self):
        """Small profit, no trend signal → hold."""
        r = decide_exit(_long_pos(pnl=1), _cfg(sl=2, tp=4))
        assert r.should_close is False
        assert r.reason == "hold"

    def test_flat_position_holds(self):
        r = decide_exit(_long_pos(pnl=0), _cfg(sl=2, tp=4))
        assert r.should_close is False

    def test_hold_decision_carries_thresholds(self):
        """Decision exposes thresholds so caller can log / audit."""
        r = decide_exit(_long_pos(pnl=1), _cfg(sl=2, tp=4))
        assert r.stop_loss_threshold == 2.0
        assert r.take_profit_threshold == 4.0
        assert r.pnl_percent == pytest.approx(1.0)


if __name__ == "__main__":
    import inspect
    passed = 0
    failed: list[str] = []
    for cls_name, cls in list(globals().items()):
        if not inspect.isclass(cls) or not cls_name.startswith("Test"):
            continue
        instance = cls()
        for name, fn in inspect.getmembers(cls, predicate=inspect.isfunction):
            if not name.startswith("test_"):
                continue
            try:
                fn(instance)
                passed += 1
                print(f"  ✓ {cls_name}.{name}")
            except AssertionError as exc:
                failed.append(f"{cls_name}.{name}: {exc}")
                print(f"  ✗ {cls_name}.{name}: {exc}")
    print(f"\n{passed} passed, {len(failed)} failed")
    sys.exit(0 if not failed else 1)
