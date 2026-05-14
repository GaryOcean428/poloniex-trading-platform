"""
test_risk_kernel_parity.py — risk_kernel.py must match riskKernel.ts
decision-for-decision on a hand-crafted boundary-case corpus.

Each case pins ONE veto (or ONE pass-through). The expected decision
was derived by tracing through the TS reference by hand; if anyone
edits the Python port in a way that diverges from TS, these tests
break BEFORE the divergence hits shadow mode.

Corpus is kept here (not generated) because the interesting cases are
boundary conditions — exactly-at-threshold, zero-equity, empty lists
— and those are what regressions typically break.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from trading.risk_kernel import (  # noqa: E402
    KernelAccountState,
    KernelContext,
    KernelOpenPosition,
    KernelOrder,
    KernelRestingOrder,
    PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER,
    UNREALIZED_DRAWDOWN_KILL_THRESHOLD,
    check_execution_mode,
    check_margin_headroom,
    check_per_symbol_exposure,
    check_self_match,
    check_symbol_max_leverage,
    check_unrealized_drawdown,
    evaluate_pre_trade_vetoes,
)


def _nominal_order(**overrides) -> KernelOrder:
    base = dict(
        symbol="BTC_USDT_PERP",
        side="buy",
        notional=20.0,
        leverage=10.0,
        price=75_000.0,
    )
    base.update(overrides)
    return KernelOrder(**base)


def _nominal_state(**overrides) -> KernelAccountState:
    base = dict(
        equity_usdt=100.0,
        unrealized_pnl_usdt=0.0,
        open_positions=[],
        resting_orders=[],
    )
    base.update(overrides)
    return KernelAccountState(**base)


def _nominal_context(**overrides) -> KernelContext:
    base = dict(is_live=True, mode="auto", symbol_max_leverage=100.0)
    base.update(overrides)
    return KernelContext(**base)


# ─── Check 1: per-symbol exposure ────────────────────────────────

class TestPerSymbolExposure:
    def test_empty_positions_passes(self):
        r = check_per_symbol_exposure(_nominal_order(notional=400), _nominal_state())
        assert r.allowed is True

    def test_at_cap_passes(self):
        """Exactly at cap — > not >=, per TS reference line 115."""
        cap = 100.0 * PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER  # 500
        r = check_per_symbol_exposure(_nominal_order(notional=cap), _nominal_state())
        assert r.allowed is True

    def test_one_cent_over_cap_blocks(self):
        cap = 100.0 * PER_SYMBOL_EXPOSURE_MAX_MULTIPLIER
        r = check_per_symbol_exposure(_nominal_order(notional=cap + 0.01), _nominal_state())
        assert r.allowed is False
        assert r.code == "per_symbol_exposure_cap"

    def test_existing_position_counts_same_symbol(self):
        """Existing 200 BTC + new 400 BTC > 500 cap, but passes if 200 is ETH."""
        state = _nominal_state(open_positions=[
            KernelOpenPosition(symbol="BTC_USDT_PERP", side="long", notional=200.0),
        ])
        r = check_per_symbol_exposure(_nominal_order(notional=400.0), state)
        assert r.allowed is False

        # Same numbers, different symbol — passes
        state2 = _nominal_state(open_positions=[
            KernelOpenPosition(symbol="ETH_USDT_PERP", side="long", notional=200.0),
        ])
        r2 = check_per_symbol_exposure(_nominal_order(notional=400.0), state2)
        assert r2.allowed is True

    def test_short_positions_counted_by_abs(self):
        """Short notional stored negative; cap compares |notional|."""
        state = _nominal_state(open_positions=[
            KernelOpenPosition(symbol="BTC_USDT_PERP", side="short", notional=-300.0),
        ])
        r = check_per_symbol_exposure(_nominal_order(notional=300.0), state)
        assert r.allowed is False  # |−300| + 300 = 600 > 500


# ─── Check 2: self-match ─────────────────────────────────────────

class TestSelfMatch:
    def test_empty_resting_passes(self):
        r = check_self_match(_nominal_order(side="buy", price=75_000), _nominal_state())
        assert r.allowed is True

    def test_same_side_resting_ignored(self):
        """Two buys from the same account don't self-match — they'd both be
        on the same side of the book."""
        state = _nominal_state(resting_orders=[
            KernelRestingOrder(symbol="BTC_USDT_PERP", side="buy", price=74_900),
        ])
        r = check_self_match(_nominal_order(side="buy", price=75_000), state)
        assert r.allowed is True

    def test_different_symbol_ignored(self):
        state = _nominal_state(resting_orders=[
            KernelRestingOrder(symbol="ETH_USDT_PERP", side="sell", price=3_000),
        ])
        r = check_self_match(_nominal_order(side="buy", price=75_000), state)
        assert r.allowed is True

    def test_buy_crosses_resting_sell_blocks(self):
        """Buy @ 75000 vs own sell @ 74900 → crosses (buy price >= sell price).
        Note TS semantic: buy crosses if resting.price <= order.price.
        """
        state = _nominal_state(resting_orders=[
            KernelRestingOrder(symbol="BTC_USDT_PERP", side="sell", price=74_900),
        ])
        r = check_self_match(_nominal_order(side="buy", price=75_000), state)
        assert r.allowed is False
        assert r.code == "self_match"

    def test_buy_at_exactly_resting_sell_price_blocks(self):
        """At-price self-match: TS uses <= so equal prices block."""
        state = _nominal_state(resting_orders=[
            KernelRestingOrder(symbol="BTC_USDT_PERP", side="sell", price=75_000),
        ])
        r = check_self_match(_nominal_order(side="buy", price=75_000), state)
        assert r.allowed is False

    def test_buy_below_resting_sell_passes(self):
        """Buy @ 74_900 vs own sell @ 75_000 doesn't cross (buy below)."""
        state = _nominal_state(resting_orders=[
            KernelRestingOrder(symbol="BTC_USDT_PERP", side="sell", price=75_000),
        ])
        r = check_self_match(_nominal_order(side="buy", price=74_900), state)
        assert r.allowed is True

    def test_sell_crosses_resting_buy_blocks(self):
        """Sell @ 74_900 vs own buy @ 75_000 → sell crosses (sell <= buy)."""
        state = _nominal_state(resting_orders=[
            KernelRestingOrder(symbol="BTC_USDT_PERP", side="buy", price=75_000),
        ])
        r = check_self_match(_nominal_order(side="sell", price=74_900), state)
        assert r.allowed is False

    def test_long_alias_treats_as_buy(self):
        """'long' side must behave identically to 'buy' for self-match."""
        state = _nominal_state(resting_orders=[
            KernelRestingOrder(symbol="BTC_USDT_PERP", side="sell", price=74_900),
        ])
        r_long = check_self_match(_nominal_order(side="long", price=75_000), state)
        r_buy = check_self_match(_nominal_order(side="buy", price=75_000), state)
        assert r_long.allowed == r_buy.allowed == False


# ─── Check 3: unrealised-drawdown kill ───────────────────────────

class TestUnrealizedDrawdown:
    def test_positive_pnl_passes(self):
        r = check_unrealized_drawdown(_nominal_state(unrealized_pnl_usdt=50.0))
        assert r.allowed is True

    def test_zero_pnl_passes(self):
        r = check_unrealized_drawdown(_nominal_state(unrealized_pnl_usdt=0.0))
        assert r.allowed is True

    def test_exactly_minus_15_pct_blocks(self):
        """TS uses <= threshold, so exactly -15% blocks."""
        r = check_unrealized_drawdown(_nominal_state(
            equity_usdt=100.0,
            unrealized_pnl_usdt=-15.0,
        ))
        assert r.allowed is False
        assert r.code == "unrealized_drawdown_kill_switch"

    def test_minus_14_99_pct_passes(self):
        r = check_unrealized_drawdown(_nominal_state(
            equity_usdt=100.0,
            unrealized_pnl_usdt=-14.99,
        ))
        assert r.allowed is True

    def test_zero_equity_passes_divide_guard(self):
        """equity=0 would divide by zero; TS bails out early and realised-loss
        cap handles the case."""
        r = check_unrealized_drawdown(_nominal_state(
            equity_usdt=0.0,
            unrealized_pnl_usdt=-1_000_000.0,
        ))
        assert r.allowed is True

    def test_negative_equity_passes_divide_guard(self):
        """TS uses <= 0, so negative equity also bails out."""
        r = check_unrealized_drawdown(_nominal_state(
            equity_usdt=-50.0,
            unrealized_pnl_usdt=-100.0,
        ))
        assert r.allowed is True


# ─── Check 4: execution-mode global override ─────────────────────

class TestExecutionMode:
    def test_auto_passes_live(self):
        assert check_execution_mode(True, "auto").allowed is True

    def test_auto_passes_paper(self):
        assert check_execution_mode(False, "auto").allowed is True

    def test_pause_blocks_live(self):
        r = check_execution_mode(True, "pause")
        assert r.allowed is False
        assert r.code == "execution_mode_paused"

    def test_pause_blocks_paper_too(self):
        """pause = block everything."""
        r = check_execution_mode(False, "pause")
        assert r.allowed is False

    def test_paper_only_blocks_live(self):
        r = check_execution_mode(True, "paper_only")
        assert r.allowed is False
        assert r.code == "execution_mode_paper_only_blocks_live"

    def test_paper_only_passes_paper(self):
        r = check_execution_mode(False, "paper_only")
        assert r.allowed is True


# ─── Check 5: symbol max leverage ────────────────────────────────

class TestSymbolMaxLeverage:
    def test_at_cap_passes(self):
        r = check_symbol_max_leverage(_nominal_order(leverage=100.0), symbol_max_leverage=100.0)
        assert r.allowed is True

    def test_over_cap_blocks(self):
        r = check_symbol_max_leverage(_nominal_order(leverage=101.0), symbol_max_leverage=100.0)
        assert r.allowed is False
        assert r.code == "symbol_max_leverage"


# ─── Composer — priority ordering ────────────────────────────────

class TestComposerPriority:
    def test_drawdown_wins_over_self_match(self):
        """If BOTH drawdown-kill AND self-match would fire, drawdown takes
        priority (account-saving runs first in TS line 248).
        """
        state = _nominal_state(
            equity_usdt=100.0,
            unrealized_pnl_usdt=-20.0,  # -20% → kill fires
            resting_orders=[
                KernelRestingOrder(symbol="BTC_USDT_PERP", side="sell", price=74_000),
            ],
        )
        order = _nominal_order(side="buy", price=75_000)  # would self-match
        r = evaluate_pre_trade_vetoes(order, state, _nominal_context())
        assert r.allowed is False
        assert r.code == "unrealized_drawdown_kill_switch"

    def test_mode_pause_wins_over_self_match(self):
        """Pause mode blocks before self-match is checked."""
        state = _nominal_state(resting_orders=[
            KernelRestingOrder(symbol="BTC_USDT_PERP", side="sell", price=74_900),
        ])
        order = _nominal_order(side="buy", price=75_000)
        r = evaluate_pre_trade_vetoes(order, state, _nominal_context(mode="pause"))
        assert r.allowed is False
        assert r.code == "execution_mode_paused"

    def test_self_match_wins_over_exposure(self):
        """TS check order: self-match (3) before per-symbol exposure (4)."""
        state = _nominal_state(
            resting_orders=[
                KernelRestingOrder(symbol="BTC_USDT_PERP", side="sell", price=74_900),
            ],
            open_positions=[
                # Existing 1000 BTC, order 1000 BTC → would also fail exposure (cap 500)
                KernelOpenPosition(symbol="BTC_USDT_PERP", side="long", notional=1000.0),
            ],
        )
        order = _nominal_order(notional=1000.0, side="buy", price=75_000)
        r = evaluate_pre_trade_vetoes(order, state, _nominal_context())
        assert r.allowed is False
        assert r.code == "self_match"

    def test_all_pass_returns_allowed(self):
        r = evaluate_pre_trade_vetoes(
            _nominal_order(notional=50.0, leverage=10.0),
            _nominal_state(),
            _nominal_context(),
        )
        assert r.allowed is True
        assert r.reason is None
        assert r.code is None


if __name__ == "__main__":
    # Standalone runner without pytest.
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


# ─── Check 6: margin headroom (v0.8.8) — TS riskKernel.ts parity ───

import os as _os_for_headroom


class TestMarginHeadroom:
    def test_disabled_by_default_passes(self):
        """min_headroom_pct=0 → no-op, allowed."""
        r = check_margin_headroom(
            _nominal_order(notional=1000, leverage=10),
            _nominal_state(equity_usdt=100, used_margin_usdt=99),
            min_headroom_pct=0.0,
        )
        assert r.allowed is True

    def test_zero_equity_divide_guard(self):
        r = check_margin_headroom(
            _nominal_order(notional=100, leverage=10),
            _nominal_state(equity_usdt=0.0, used_margin_usdt=0.0),
            min_headroom_pct=0.25,
        )
        assert r.allowed is True

    def test_at_reserve_passes(self):
        # equity=100, used=70, new_margin=50/10=5 → projected=75 → 25% free
        r = check_margin_headroom(
            _nominal_order(notional=50, leverage=10),
            _nominal_state(equity_usdt=100, used_margin_usdt=70),
            min_headroom_pct=0.25,
        )
        assert r.allowed is True

    def test_one_dollar_below_reserve_blocks(self):
        # equity=100, used=70, new_margin=60/10=6 → projected=76 → 24% free
        r = check_margin_headroom(
            _nominal_order(notional=60, leverage=10),
            _nominal_state(equity_usdt=100, used_margin_usdt=70),
            min_headroom_pct=0.25,
        )
        assert r.allowed is False
        assert r.code == "margin_headroom"

    def test_used_alone_past_reserve_blocks(self):
        r = check_margin_headroom(
            _nominal_order(notional=10, leverage=10),
            _nominal_state(equity_usdt=100, used_margin_usdt=80),
            min_headroom_pct=0.25,
        )
        assert r.allowed is False

    def test_high_leverage_low_margin_passes(self):
        # equity=100, used=50, new_margin=200/20=10 → projected=60 → 40% free
        r = check_margin_headroom(
            _nominal_order(notional=200, leverage=20),
            _nominal_state(equity_usdt=100, used_margin_usdt=50),
            min_headroom_pct=0.25,
        )
        assert r.allowed is True

    def test_out_of_range_pct_fails_open(self):
        # pct=1.5 (≥ 1) → veto disabled, allowed
        r = check_margin_headroom(
            _nominal_order(notional=1000, leverage=10),
            _nominal_state(equity_usdt=100, used_margin_usdt=99),
            min_headroom_pct=1.5,
        )
        assert r.allowed is True

    def test_env_var_unset_defaults_to_zero(self):
        prev = _os_for_headroom.environ.pop("MONKEY_MIN_MARGIN_HEADROOM_PCT", None)
        try:
            r = check_margin_headroom(
                _nominal_order(notional=1000, leverage=10),
                _nominal_state(equity_usdt=100, used_margin_usdt=99),
            )
            assert r.allowed is True  # no env → 0.0 → no-op
        finally:
            if prev is not None:
                _os_for_headroom.environ["MONKEY_MIN_MARGIN_HEADROOM_PCT"] = prev


class TestMarginHeadroomComposer:
    def test_exposure_fires_before_headroom(self):
        # equity=100. notional=600 breaches per_symbol cap (=500).
        # ALSO new_margin=60, used=50 → projected=110 → would breach headroom.
        # Composer order: exposure (priority 4) before headroom (priority 5).
        prev = _os_for_headroom.environ.get("MONKEY_MIN_MARGIN_HEADROOM_PCT")
        _os_for_headroom.environ["MONKEY_MIN_MARGIN_HEADROOM_PCT"] = "0.25"
        try:
            order = _nominal_order(notional=600, leverage=10)
            state = _nominal_state(equity_usdt=100, used_margin_usdt=50)
            r = evaluate_pre_trade_vetoes(order, state, _nominal_context())
            assert r.allowed is False
            assert r.code == "per_symbol_exposure_cap"
        finally:
            if prev is None:
                _os_for_headroom.environ.pop("MONKEY_MIN_MARGIN_HEADROOM_PCT", None)
            else:
                _os_for_headroom.environ["MONKEY_MIN_MARGIN_HEADROOM_PCT"] = prev

    def test_headroom_blocks_when_exposure_passes(self):
        # notional=200 within 5× cap. used=70, new_margin=20 → projected=90 → 10% free
        prev = _os_for_headroom.environ.get("MONKEY_MIN_MARGIN_HEADROOM_PCT")
        _os_for_headroom.environ["MONKEY_MIN_MARGIN_HEADROOM_PCT"] = "0.25"
        try:
            order = _nominal_order(notional=200, leverage=10)
            state = _nominal_state(equity_usdt=100, used_margin_usdt=70)
            r = evaluate_pre_trade_vetoes(order, state, _nominal_context())
            assert r.allowed is False
            assert r.code == "margin_headroom"
        finally:
            if prev is None:
                _os_for_headroom.environ.pop("MONKEY_MIN_MARGIN_HEADROOM_PCT", None)
            else:
                _os_for_headroom.environ["MONKEY_MIN_MARGIN_HEADROOM_PCT"] = prev
