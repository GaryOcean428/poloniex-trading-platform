"""Tests for mtf_bootstrap.py — Python port of mtfBootstrap.ts."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))


def _run(coro):
    """Run an async coroutine to completion in a fresh event loop."""
    return asyncio.new_event_loop().run_until_complete(coro)

from monkey_kernel.mtf_bootstrap import (  # noqa: E402
    BOOTSTRAP_CANDLE_COUNT,
    POLONIEX_GRANULARITY_FOR_TF,
    bootstrap_mtf_for_symbol,
    parse_poloniex_kline_row,
)
from monkey_kernel.mtf_l_classifier import new_mtf_state  # noqa: E402
from monkey_kernel.perception import OHLCVCandle  # noqa: E402


def _fake_candle(i: int) -> OHLCVCandle:
    """Generate a deterministic candle. Slight upward drift so OHLCV
    isn't completely flat (otherwise perceive() math becomes degenerate)."""
    base = 100.0 + i * 0.01
    return OHLCVCandle(
        timestamp=i * 30_000,
        open=base,
        high=base + 0.5,
        low=base - 0.5,
        close=base + 0.1,
        volume=1000.0,
    )


# ── parse_poloniex_kline_row ──────────────────────────────────────


class TestParseKlineRow:
    def test_valid_row(self):
        c = parse_poloniex_kline_row([1700_000_000, 100.0, 101.0, 99.0, 100.5, 5000])
        assert c is not None
        assert c.timestamp == 1700_000_000
        assert c.open == 100.0
        assert c.close == 100.5

    def test_malformed_row_returns_none(self):
        assert parse_poloniex_kline_row([1700, 100.0]) is None
        assert parse_poloniex_kline_row(["bad"]) is None
        assert parse_poloniex_kline_row([]) is None


# ── bootstrap_mtf_for_symbol ──────────────────────────────────────


class TestBootstrapMtfForSymbol:
    def test_insufficient_candles_skips_timeframe(self):
        async def fetch(symbol, granularity, limit):
            return [_fake_candle(i) for i in range(50)]

        state = new_mtf_state()
        _run(bootstrap_mtf_for_symbol("ETH_PERP", state, fetch_klines=fetch))
        assert state.histories_by_tf["15m"] == []
        assert state.histories_by_tf["1h"] == []
        assert state.histories_by_tf["4h"] == []

    def test_none_candles_skips_timeframe(self):
        async def fetch(symbol, granularity, limit):
            return None

        state = new_mtf_state()
        _run(bootstrap_mtf_for_symbol("ETH_PERP", state, fetch_klines=fetch))
        assert state.histories_by_tf["15m"] == []

    def test_fetch_exception_is_caught_per_timeframe(self):
        async def fetch(symbol, granularity, limit):
            raise RuntimeError("network blip")

        state = new_mtf_state()
        # No raise — caught and logged.
        _run(bootstrap_mtf_for_symbol("ETH_PERP", state, fetch_klines=fetch))
        assert state.histories_by_tf["15m"] == []
        assert state.histories_by_tf["4h"] == []

    def test_populates_history_when_candles_supplied(self):
        async def fetch(symbol, granularity, limit):
            return [_fake_candle(i) for i in range(150)]

        state = new_mtf_state()
        _run(bootstrap_mtf_for_symbol("ETH_PERP", state, fetch_klines=fetch))
        # 150 candles - 50 window = 100 basins per timeframe.
        for label in ("15m", "1h", "4h"):
            assert len(state.histories_by_tf[label]) > 0


# ── constants ─────────────────────────────────────────────────────


def test_granularity_table():
    assert POLONIEX_GRANULARITY_FOR_TF["15m"] == 15
    assert POLONIEX_GRANULARITY_FOR_TF["1h"] == 60
    assert POLONIEX_GRANULARITY_FOR_TF["4h"] == 240


def test_bootstrap_candle_count_covers_warmup():
    # 480 long_window + 120 horizon = 600 minimum; 700 leaves margin.
    assert BOOTSTRAP_CANDLE_COUNT >= 700
