"""OHLCV replay engine — runs a StrategySpec through historical candles
and returns realized PnL + win-rate + max-drawdown.

⚠️  PROXY-FIDELITY DISCLOSURE — read before interpreting output.

What this engine simulates:
  Entry  : SMA20 vs SMA50 crossover (within last 5 bars)
  Exit   : Stop-loss → trailing-harvest (peak × (1 - giveback)) → window-end
  DCA    : One add when price moves spec.dca_better_price favourably
  Fees   : taker_fee_frac applied on entry + exit + DCA add fills

What the LIVE Monkey kernel actually does (and this engine does NOT):
  Entry  : basin_direction + ML signal + tape OVERRIDE quorum +
           neurochemistry × mode_profile.entry_threshold_scale +
           self_observation_bias + per-symbol exposure cap
  Exit   : Loop 2 disagreement (Fisher-Rao perception vs identity) +
           Pillar 1 zombie-basin guard + DRIFT trend-flip + scalp_TP
           with mode-derived thresholds + ROI-based gate at higher level
  DCA    : Bank-maturity gate, sovereignty floor, basin-direction
           alignment, mode-confidence weighting
  Fees   : Same — only correctly modeled component

The replay is therefore a CANDIDATE FILTER, not a STRATEGY VALIDATOR.

Use sweep output to:
  ✓ Reject obviously-bad parameter values (TP=10%, SL_ratio=0.95, etc.)
  ✓ Find the *order of magnitude* range that makes sense
  ✓ Compare candidates RELATIVELY against the same baseline

Do NOT use sweep output to:
  ✗ Predict absolute live PnL ("Strategy A makes +$X in production")
  ✗ Claim Strategy A beats Strategy B by exactly N% in live trading
  ✗ Promote anything to live MODE_PROFILES without further validation

For absolute fidelity, Phase C must inject the full kernel against
replayed candles — a substantial build, intentionally deferred from
the v0.9.0 scaffold.

⚠️  QIG-WARP SAVINGS LIMITATION (validated 2026-04-27, commit 4e28558e).

qig-warp screening provides 0% measured savings on this scoring surface.
30/30 Phase B sweeps over real ETH/BTC OHLCV showed:
  avg_wallclock_savings:  -1.05%   (essentially zero)
  avg_eval_savings:        0.00%   (qig-warp ran every value)
  agreement_rate_pct:    100.00%   (qw top == naive top)

The qig-warp wrapper is retained for API consistency with the QIG package
family but does not accelerate fast-eval domains where each scoring call
is sub-100ms (~15ms here).  Phase C kernel-replay backtests are expected
to be expensive enough (seconds per eval) for screening physics to
re-engage; re-validate qig-warp savings when Phase C ships.
See issue #571 for the full decision record (Path A chosen).
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


@dataclass(frozen=True)
class ScoreWeights:
    """Composite-score weights. Different profiles encode different
    risk preferences without changing the underlying backtest.

    Two strategies with identical composite scores can still have
    radically different real-world profiles. Running the same sweep
    under multiple weight profiles is the cheapest robustness check
    available before promoting any candidate.

    Defaults match the original "balanced" profile shipped in 55e29af.
    """
    pnl: float = 1.0
    win_rate: float = 0.5
    profit_factor: float = 0.25
    max_drawdown_penalty: float = 1.5

    @classmethod
    def conservative(cls) -> "ScoreWeights":
        """Heavy DD penalty, modest PnL weight. Prefers shallow-DD
        strategies even at lower PnL — small consistent winners over
        rare-big-wins-with-deep-drawdowns."""
        return cls(pnl=1.0, win_rate=0.5, profit_factor=0.25,
                   max_drawdown_penalty=3.0)

    @classmethod
    def balanced(cls) -> "ScoreWeights":
        """The original v0.9.0 weights. Equal-ish weight on PnL and
        risk, modest bonuses for win-rate and profit-factor."""
        return cls(pnl=1.0, win_rate=0.5, profit_factor=0.25,
                   max_drawdown_penalty=1.5)

    @classmethod
    def aggressive(cls) -> "ScoreWeights":
        """Heavy on profit factor, light on DD penalty. Prefers
        strategies with strong unit economics even if drawdowns are
        deeper. Suitable for higher-equity / higher-tolerance accounts."""
        return cls(pnl=1.0, win_rate=0.25, profit_factor=1.0,
                   max_drawdown_penalty=0.5)


# Public profile registry — keep the names CLI-stable.
SCORE_PROFILES: dict[str, ScoreWeights] = {
    "conservative": ScoreWeights.conservative(),
    "balanced": ScoreWeights.balanced(),
    "aggressive": ScoreWeights.aggressive(),
}


def score_strategy(result: BacktestResult,
                   weights: ScoreWeights | None = None) -> float:
    """Composite score for a single backtest result.

    score = pnl·w_pnl + win_rate·w_wr + (pf-1)·w_pf - max_dd·w_dd

    Edge cases:
      n_trades=0       → score = 0 (strategy never traded; not interesting)
      profit_factor=∞  → pf_term = 0 (avoid score blow-up on no-loss runs)
      max_drawdown=0   → no penalty
    """
    if weights is None:
        weights = ScoreWeights.balanced()
    if result.n_trades == 0:
        return 0.0
    pnl_term = result.total_pnl * weights.pnl
    wr_term = result.win_rate * weights.win_rate
    pf = result.profit_factor
    pf_term = (pf - 1.0) * weights.profit_factor if np.isfinite(pf) else 0.0
    dd_penalty = result.max_drawdown * weights.max_drawdown_penalty
    return float(pnl_term + wr_term + pf_term - dd_penalty)
