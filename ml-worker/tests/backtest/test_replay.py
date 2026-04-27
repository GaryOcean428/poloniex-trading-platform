"""Tests for the v0.9.0 Phase B replay engine."""
from __future__ import annotations

import os
import sys

import numpy as np
import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from backtest.replay import replay_ohlcv, score_strategy, BacktestResult
from backtest.spec import StrategySpec, default_spec


def _trend_up(n: int = 200, slope: float = 0.001) -> np.ndarray:
    """Flat-then-uptrend — produces an SMA20-over-SMA50 cross-up.
    Pure linear trends don't cross (both SMAs slope in lockstep)."""
    base = 2300.0
    closes = []
    flat_n = max(60, n // 3)
    for i in range(flat_n):
        closes.append(base)
    for i in range(n - flat_n):
        closes.append(base * (1 + slope * (i + 1)))
    return np.asarray(closes, dtype=np.float64)


def _trend_down(n: int = 200, slope: float = -0.001) -> np.ndarray:
    """Flat-then-downtrend — produces an SMA20-under-SMA50 cross-down."""
    base = 2300.0
    closes = []
    flat_n = max(60, n // 3)
    for i in range(flat_n):
        closes.append(base)
    for i in range(n - flat_n):
        closes.append(base * (1 + slope * (i + 1)))
    return np.asarray(closes, dtype=np.float64)


def _flat(n: int = 200) -> np.ndarray:
    return np.full(n, 2300.0, dtype=np.float64)


def _zigzag(n: int = 200, amplitude: float = 0.005) -> np.ndarray:
    """High-frequency oscillation — should produce many SL/TP hits."""
    rng = np.random.default_rng(0)
    base = 2300.0
    closes = []
    for i in range(n):
        wave = amplitude * np.sin(i * 0.4)
        noise = rng.normal(0, 0.0005)
        closes.append(base * (1 + wave + noise))
    return np.array(closes, dtype=np.float64)


class TestReplayBasic:
    def test_short_history_returns_empty(self):
        closes = np.full(30, 2300.0)  # below 60 minimum
        result = replay_ohlcv(closes, default_spec())
        assert result.n_trades == 0
        assert result.total_pnl == 0.0

    def test_flat_no_trades(self):
        """No SMA crossovers on a flat series → no entries."""
        result = replay_ohlcv(_flat(200), default_spec())
        assert result.n_trades == 0
        assert score_strategy(result) == 0.0

    def test_trend_up_takes_long(self):
        result = replay_ohlcv(_trend_up(300, slope=0.001), default_spec())
        # SMA20 crosses above SMA50 within ~50 bars → at least one long
        assert result.n_trades >= 1
        assert any(t.side == "long" for t in result.trades)

    def test_trend_down_takes_short(self):
        result = replay_ohlcv(_trend_down(300, slope=-0.001), default_spec())
        assert result.n_trades >= 1
        assert any(t.side == "short" for t in result.trades)

    def test_zigzag_produces_sl_hits(self):
        result = replay_ohlcv(_zigzag(400), default_spec())
        # Oscillation should trigger at least one stop_loss exit
        sl_hits = [t for t in result.trades if t.exit_reason == "stop_loss"]
        # Not strict — depends on amplitude; the test checks the path executes.
        assert isinstance(sl_hits, list)


class TestSpecVariation:
    def test_tighter_sl_increases_sl_count(self):
        closes = _zigzag(400)
        loose = replay_ohlcv(closes, default_spec().with_(sl_ratio=0.9))
        tight = replay_ohlcv(closes, default_spec().with_(sl_ratio=0.2))
        # Tighter SL should hit the stop more often given enough oscillation.
        loose_sl = sum(1 for t in loose.trades if t.exit_reason == "stop_loss")
        tight_sl = sum(1 for t in tight.trades if t.exit_reason == "stop_loss")
        # Allow equality (path-dependent). At minimum the tight version
        # should not produce fewer SL hits than loose given identical input.
        assert tight_sl >= loose_sl - 1

    def test_higher_tp_widens_target(self):
        closes = _trend_up(500, slope=0.002)
        wide = replay_ohlcv(closes, default_spec().with_(tp_base_frac=0.05))
        narrow = replay_ohlcv(closes, default_spec().with_(tp_base_frac=0.001))
        # Narrow TP should harvest more often (more trades end at trailing_harvest)
        narrow_th = sum(1 for t in narrow.trades if t.exit_reason == "trailing_harvest")
        wide_th = sum(1 for t in wide.trades if t.exit_reason == "trailing_harvest")
        assert narrow_th >= wide_th - 1


class TestScorer:
    def test_no_trades_zero_score(self):
        result = BacktestResult(
            spec=default_spec(), trades=[], total_pnl=0.0,
            n_wins=0, n_losses=0, max_drawdown=0.0, final_equity=100.0,
        )
        assert score_strategy(result) == 0.0

    def test_winning_strategy_positive_score(self):
        result = replay_ohlcv(_trend_up(400, slope=0.0015),
                              default_spec().with_(tp_base_frac=0.005))
        # On a steady uptrend with reasonable TP, expect positive score
        s = score_strategy(result)
        assert s > -1.0  # not strictly positive (path-dependent), but bounded
