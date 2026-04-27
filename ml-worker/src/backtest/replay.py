"""OHLCV replay engine — runs a StrategySpec through historical candles
and returns realized PnL + win-rate + max-drawdown.

Simplification: we model entry/exit as a stripped-down Monkey using only
TP/SL/trailing-harvest. Side selection is by simple SMA crossover (SMA20
vs SMA50). DCA logic uses the spec's dca_better_price gate. Fees applied
on every fill (entry + exit + DCA add).

The full Monkey decision pipeline (basin / regime / NC modulation) is not
replayed — that requires bubble-bank state which is path-dependent and
expensive to simulate. The sweep is therefore an upper-bound proxy for
how a derivation kernel would perform with these baseline anchors. It's
sufficient for relative ranking of candidates; absolute PnL is approximate.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import numpy as np

from .spec import StrategySpec


@dataclass
class Trade:
    entry_idx: int
    exit_idx: int
    side: str  # 'long' | 'short'
    entry_price: float
    exit_price: float
    qty: float
    pnl_gross: float
    fees: float
    exit_reason: str

    @property
    def pnl_net(self) -> float:
        return self.pnl_gross - self.fees


@dataclass
class BacktestResult:
    spec: StrategySpec
    trades: list[Trade]
    total_pnl: float
    n_wins: int
    n_losses: int
    max_drawdown: float
    final_equity: float

    @property
    def n_trades(self) -> int:
        return len(self.trades)

    @property
    def win_rate(self) -> float:
        if self.n_trades == 0:
            return 0.0
        return self.n_wins / self.n_trades

    @property
    def profit_factor(self) -> float:
        wins_sum = sum(t.pnl_net for t in self.trades if t.pnl_net > 0)
        loss_sum = sum(-t.pnl_net for t in self.trades if t.pnl_net < 0)
        if loss_sum <= 0:
            return float("inf") if wins_sum > 0 else 0.0
        return wins_sum / loss_sum


def _sma(closes: np.ndarray, n: int) -> np.ndarray:
    if len(closes) < n:
        return np.full_like(closes, np.nan)
    out = np.full_like(closes, np.nan)
    cumsum = np.cumsum(closes)
    out[n - 1:] = (cumsum[n - 1:] - np.concatenate(([0], cumsum[:-n]))) / n
    return out


def replay_ohlcv(
    closes: np.ndarray,
    spec: StrategySpec,
    starting_equity: float = 100.0,
    notional_per_trade: float = 50.0,
    leverage: float = 14.0,
) -> BacktestResult:
    """Walk closes; on SMA20-vs-SMA50 crossover, open a position; close
    when TP/SL/trailing-floor triggers. DCA add when price has moved
    spec.dca_better_price in your favour and DCA cap not exhausted.

    Returns a BacktestResult with realized trades and equity curve.
    """
    closes = np.asarray(closes, dtype=np.float64)
    n = len(closes)
    if n < 60:
        return BacktestResult(spec=spec, trades=[], total_pnl=0.0,
                              n_wins=0, n_losses=0, max_drawdown=0.0,
                              final_equity=starting_equity)

    sma20 = _sma(closes, 20)
    sma50 = _sma(closes, 50)

    equity = starting_equity
    peak_equity = equity
    max_dd = 0.0
    trades: list[Trade] = []

    open_trade: dict | None = None  # tracks current position
    qty_per_unit = notional_per_trade / closes[50] if closes[50] > 0 else 0.001

    for i in range(50, n):
        c = closes[i]
        if not np.isfinite(c) or c <= 0:
            continue

        # ── Open-position management ──
        if open_trade is not None:
            entry = open_trade["entry"]
            side = open_trade["side"]
            qty = open_trade["qty"]
            peak_pnl_frac = open_trade["peak_pnl_frac"]
            n_adds = open_trade["n_adds"]

            move = (c - entry) / entry if side == "long" else (entry - c) / entry
            pnl_frac = move
            if pnl_frac > peak_pnl_frac:
                open_trade["peak_pnl_frac"] = pnl_frac
                peak_pnl_frac = pnl_frac

            close_now = False
            exit_reason = ""

            # 1. Stop-loss
            if pnl_frac <= -spec.sl_frac:
                close_now = True
                exit_reason = "stop_loss"
            # 2. Trailing harvest (only after meaningful peak)
            elif peak_pnl_frac >= spec.tp_base_frac and \
                 pnl_frac < peak_pnl_frac * (1.0 - spec.trailing_giveback):
                close_now = True
                exit_reason = "trailing_harvest"
            # 3. DCA add (price moved in favour past dca threshold)
            elif n_adds < spec.dca_max_adds and \
                 move >= spec.dca_better_price:
                add_qty = qty  # double up
                add_fee = add_qty * c * spec.taker_fee_frac
                # Update entry price as weighted average
                new_qty = qty + add_qty
                new_entry = (entry * qty + c * add_qty) / new_qty
                open_trade["entry"] = new_entry
                open_trade["qty"] = new_qty
                open_trade["n_adds"] = n_adds + 1
                open_trade["fees_paid"] += add_fee
                # peak resets relative to new entry
                open_trade["peak_pnl_frac"] = 0.0

            if close_now:
                qty = open_trade["qty"]
                entry = open_trade["entry"]
                gross = (c - entry) * qty if side == "long" else (entry - c) * qty
                exit_fee = qty * c * spec.taker_fee_frac
                fees_total = open_trade["fees_paid"] + exit_fee
                trade = Trade(
                    entry_idx=open_trade["entry_idx"],
                    exit_idx=i,
                    side=side,
                    entry_price=entry,
                    exit_price=c,
                    qty=qty,
                    pnl_gross=gross,
                    fees=fees_total,
                    exit_reason=exit_reason,
                )
                trades.append(trade)
                equity += trade.pnl_net
                if equity > peak_equity:
                    peak_equity = equity
                else:
                    dd = peak_equity - equity
                    if dd > max_dd:
                        max_dd = dd
                open_trade = None

        # ── Entry logic (only if flat) ──
        if open_trade is None:
            s20 = sma20[i]
            s50 = sma50[i]
            if not (np.isfinite(s20) and np.isfinite(s50)):
                continue
            # Look back up to 5 bars for a recent SMA cross (cross often
            # has weak strength on bar-1 of a slow trend; needs a few
            # bars to develop strength). Accepts either direction.
            crossed_up = False
            crossed_down = False
            for back in range(1, min(6, i - 49)):
                p20 = sma20[i - back]
                p50 = sma50[i - back]
                if not (np.isfinite(p20) and np.isfinite(p50)):
                    continue
                if p20 <= p50 and s20 > s50:
                    crossed_up = True; break
                if p20 >= p50 and s20 < s50:
                    crossed_down = True; break
            if not (crossed_up or crossed_down):
                continue
            cross_strength = abs(s20 - s50) / s50
            # entry_threshold_scale > 1 makes entry harder; ≤ 1 easier.
            # Base threshold is 1bp (1e-5) of price — extremely permissive.
            if cross_strength < 1e-5 * spec.entry_threshold_scale:
                continue

            side = "long" if crossed_up else "short"
            qty = qty_per_unit
            entry_fee = qty * c * spec.taker_fee_frac
            open_trade = {
                "entry_idx": i,
                "entry": c,
                "side": side,
                "qty": qty,
                "peak_pnl_frac": 0.0,
                "n_adds": 0,
                "fees_paid": entry_fee,
            }

    # Close any still-open trade at last price
    if open_trade is not None:
        c = closes[-1]
        side = open_trade["side"]
        qty = open_trade["qty"]
        entry = open_trade["entry"]
        gross = (c - entry) * qty if side == "long" else (entry - c) * qty
        exit_fee = qty * c * spec.taker_fee_frac
        fees_total = open_trade["fees_paid"] + exit_fee
        trades.append(Trade(
            entry_idx=open_trade["entry_idx"],
            exit_idx=len(closes) - 1,
            side=side,
            entry_price=entry,
            exit_price=c,
            qty=qty,
            pnl_gross=gross,
            fees=fees_total,
            exit_reason="window_end",
        ))
        equity += trades[-1].pnl_net
        if equity > peak_equity:
            peak_equity = equity
        else:
            dd = peak_equity - equity
            if dd > max_dd:
                max_dd = dd

    n_wins = sum(1 for t in trades if t.pnl_net > 0)
    n_losses = sum(1 for t in trades if t.pnl_net < 0)
    total_pnl = equity - starting_equity

    return BacktestResult(
        spec=spec,
        trades=trades,
        total_pnl=total_pnl,
        n_wins=n_wins,
        n_losses=n_losses,
        max_drawdown=max_dd,
        final_equity=equity,
    )


def score_strategy(result: BacktestResult) -> float:
    """Composite score for a single backtest result.

    Components (higher = better):
      total_pnl                  — primary objective
      win_rate                   — robustness signal
      profit_factor              — efficiency signal
      penalty for max_drawdown   — risk control

    Returns a single float that qig_warp can rank.

    Edge cases:
      n_trades=0  → score = 0 (strategy never traded; not interesting)
      max_drawdown=0 → no penalty
    """
    if result.n_trades == 0:
        return 0.0
    pnl_term = result.total_pnl
    wr_term = result.win_rate * 0.5  # bonus for hit-rate
    dd_penalty = result.max_drawdown * 1.5
    pf = result.profit_factor
    pf_term = (pf - 1.0) * 0.25 if np.isfinite(pf) else 0.0
    return float(pnl_term + wr_term + pf_term - dd_penalty)
