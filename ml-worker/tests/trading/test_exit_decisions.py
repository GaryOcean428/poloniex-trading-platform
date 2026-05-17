"""Tests for trading.exit_decisions.decide_exit() including the
regime-adaptive ExitModifiers layer (GAP 2 — P25 compliance).

The original parity-vs-TS test file was removed in the Path B rollback
(b7af600 / PR #688). These tests cover:
  - the three-gate exit chain (stop-loss / take-profit / trend-reversal)
  - the new optional ExitModifiers parameter that scales SL/TP thresholds
    based on a regime reading
"""
from __future__ import annotations

import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from trading.exit_decisions import (  # noqa: E402
    ExitConfig,
    ExitModifiers,
    MarketAnalysis,
    PositionSnapshot,
    decide_exit,
)


def _long_position(entry: float = 100.0, qty: float = 1.0, pnl: float = 0.0) -> PositionSnapshot:
    return PositionSnapshot(symbol="BTC_USDT", qty=qty, entry_price=entry, unrealized_pnl=pnl)


def _short_position(entry: float = 100.0, qty: float = -1.0, pnl: float = 0.0) -> PositionSnapshot:
    return PositionSnapshot(symbol="BTC_USDT", qty=qty, entry_price=entry, unrealized_pnl=pnl)


class TestDecideExitNoModifier:
    """Baseline: no modifiers, identity behaviour."""

    def test_holds_when_pnl_inside_envelope(self):
        cfg = ExitConfig(stop_loss_percent=2.0, take_profit_percent=4.0)
        pos = _long_position(entry=100.0, qty=1.0, pnl=1.0)  # +1% pnl
        d = decide_exit(pos, cfg)
        assert d.should_close is False
        assert d.reason == "hold"

    def test_triggers_stop_loss_below_threshold(self):
        cfg = ExitConfig(stop_loss_percent=2.0, take_profit_percent=4.0)
        pos = _long_position(entry=100.0, qty=1.0, pnl=-2.5)  # -2.5% pnl
        d = decide_exit(pos, cfg)
        assert d.should_close is True
        assert d.reason == "stop_loss"
        assert d.stop_loss_threshold == pytest.approx(2.0)

    def test_triggers_take_profit_above_threshold(self):
        cfg = ExitConfig(stop_loss_percent=2.0, take_profit_percent=4.0)
        pos = _long_position(entry=100.0, qty=1.0, pnl=5.0)  # +5% pnl
        d = decide_exit(pos, cfg)
        assert d.should_close is True
        assert d.reason == "take_profit"
        assert d.take_profit_threshold == pytest.approx(4.0)


class TestDecideExitWithModifier:
    """Regime-adaptive ExitModifiers scale SL/TP thresholds in-place."""

    def test_modifier_widens_sl_in_trend(self):
        """A trend-widened SL should NOT trigger a stop that would fire at base config."""
        cfg = ExitConfig(stop_loss_percent=2.0, take_profit_percent=4.0)
        mods = ExitModifiers(sl_multiplier=1.5, tp_multiplier=1.0)
        # -2.5% pnl: would trigger at base 2.0%, should NOT trigger at 3.0%
        pos = _long_position(entry=100.0, qty=1.0, pnl=-2.5)
        d = decide_exit(pos, cfg, modifiers=mods)
        assert d.should_close is False
        assert d.reason == "hold"
        assert d.stop_loss_threshold == pytest.approx(3.0)

    def test_modifier_tightens_tp_in_chop(self):
        """A chop-tightened TP should fire earlier than the base config."""
        cfg = ExitConfig(stop_loss_percent=2.0, take_profit_percent=4.0)
        mods = ExitModifiers(sl_multiplier=1.0, tp_multiplier=0.7)
        # +3% pnl: would HOLD at base TP=4.0%, should TRIGGER at TP=2.8%
        pos = _long_position(entry=100.0, qty=1.0, pnl=3.0)
        d = decide_exit(pos, cfg, modifiers=mods)
        assert d.should_close is True
        assert d.reason == "take_profit"
        assert d.take_profit_threshold == pytest.approx(2.8)

    def test_default_modifier_is_identity(self):
        """ExitModifiers() defaults must not change behaviour vs no modifier."""
        cfg = ExitConfig(stop_loss_percent=2.0, take_profit_percent=4.0)
        pos = _long_position(entry=100.0, qty=1.0, pnl=3.0)
        without = decide_exit(pos, cfg)
        with_id = decide_exit(pos, cfg, modifiers=ExitModifiers())
        assert without.should_close == with_id.should_close
        assert without.reason == with_id.reason
        assert without.stop_loss_threshold == with_id.stop_loss_threshold
        assert without.take_profit_threshold == with_id.take_profit_threshold

    def test_modifier_applies_to_trailing_trigger(self):
        """Trailing-stop trigger == effective SL — so widening SL widens
        the trend-reversal arming point too."""
        cfg = ExitConfig(stop_loss_percent=2.0, take_profit_percent=4.0)
        mods = ExitModifiers(sl_multiplier=1.5, tp_multiplier=1.0)
        analysis = MarketAnalysis(trend="bearish")
        # +2.5% pnl: at base, trailing arms at 2.0% and bearish trend → reverse exit.
        # With SL widened to 3.0%, trailing trigger is 3.0% → 2.5% < 3.0% → HOLD.
        pos = _long_position(entry=100.0, qty=1.0, pnl=2.5)
        d = decide_exit(pos, cfg, analysis=analysis, modifiers=mods)
        assert d.should_close is False
        assert d.reason == "hold"

    def test_short_position_with_modifier(self):
        """Modifiers apply symmetrically to shorts."""
        cfg = ExitConfig(stop_loss_percent=2.0, take_profit_percent=4.0)
        mods = ExitModifiers(sl_multiplier=1.15, tp_multiplier=1.30)
        # Short at entry=100, qty=-1, unrealized=+5 → pnl=+5%
        # Effective TP=4.0×1.30=5.2% → 5% < 5.2% → HOLD
        pos = _short_position(entry=100.0, qty=-1.0, pnl=5.0)
        d = decide_exit(pos, cfg, modifiers=mods)
        assert d.should_close is False


class TestExitModifierEdgeCases:
    """Boundary and defensive tests for the modifier surface."""

    def test_zero_multiplier_disables_gate(self):
        """A modifier of 0.0 collapses the threshold to 0 — every nonzero
        pnl crosses it. This is a defensive test that the multiplier
        actually multiplies (catches off-by-one wiring bugs)."""
        cfg = ExitConfig(stop_loss_percent=2.0, take_profit_percent=4.0)
        mods = ExitModifiers(sl_multiplier=0.0, tp_multiplier=0.0)
        pos = _long_position(entry=100.0, qty=1.0, pnl=0.01)
        d = decide_exit(pos, cfg, modifiers=mods)
        assert d.should_close is True
        assert d.reason == "take_profit"

    def test_modifier_dataclass_is_frozen(self):
        """ExitModifiers should be immutable so callers can't mutate
        a shared instance across tick cycles."""
        mods = ExitModifiers(sl_multiplier=1.0, tp_multiplier=1.0)
        with pytest.raises(Exception):  # FrozenInstanceError or similar
            mods.sl_multiplier = 2.0  # type: ignore[misc]
