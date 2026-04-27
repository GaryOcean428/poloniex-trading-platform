"""qig_warp-driven 1D parameter sweep over StrategySpec axes.

Wraps qig_warp.auto.navigate around the scorer. Outputs top-K
candidates ordered by composite score, with full backtest stats.

Single-axis at a time matches qig-warp's design (it discovers the
screening length / cost exponent of a 1D parameter manifold). For a
multi-axis grid, run sweep_axis() in sequence, each time fixing the
previously-discovered best value as the new baseline.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Sequence

import numpy as np

from qig_warp.auto import navigate as qig_navigate
from qig_warp.auto import NavigationResult

from .spec import StrategySpec, AxisName, SWEEPABLE_AXES
from .replay import replay_ohlcv, BacktestResult, score_strategy


@dataclass
class Candidate:
    spec: StrategySpec
    score: float
    n_trades: int
    win_rate: float
    total_pnl: float
    max_drawdown: float
    profit_factor: float


@dataclass
class SweepResult:
    axis: str
    base_spec: StrategySpec
    candidates: list[Candidate]
    nav: NavigationResult

    @property
    def top(self) -> Candidate | None:
        return self.candidates[0] if self.candidates else None

    def top_k(self, k: int = 5) -> list[Candidate]:
        return self.candidates[:k]


def sweep_axis(
    closes: np.ndarray,
    base_spec: StrategySpec,
    axis: AxisName,
    values: Sequence[float],
    *,
    starting_equity: float = 100.0,
    notional_per_trade: float = 50.0,
    leverage: float = 14.0,
    budget_s: float | None = None,
) -> SweepResult:
    """Sweep one strategy axis over a list of candidate values.

    The scoring function is wrapped in qig_warp.auto.navigate, which
    runs 5 pilot probes, discovers the cost manifold, then plans the
    full sweep with screening-driven savings. Total runtime is bounded
    by `budget_s` if supplied.

    Returns a SweepResult with all candidates ranked by composite score.
    """
    if axis not in SWEEPABLE_AXES:
        raise ValueError(f"axis must be one of {SWEEPABLE_AXES}; got {axis}")

    closes = np.asarray(closes, dtype=np.float64)

    # Cache results so we can rebuild ranked Candidate list at the end.
    # qig_navigate just gives back {param: score} — we need full bt info.
    bt_cache: dict[float, BacktestResult] = {}

    def fn(p: float) -> float:
        if p in bt_cache:
            return score_strategy(bt_cache[p])
        spec = base_spec.with_(**{axis: float(p)})
        bt = replay_ohlcv(
            closes, spec,
            starting_equity=starting_equity,
            notional_per_trade=notional_per_trade,
            leverage=leverage,
        )
        bt_cache[p] = bt
        return float(score_strategy(bt))

    nav = qig_navigate(fn, list(map(float, values)), budget_s=budget_s)

    # Build full Candidate list from cache
    candidates: list[Candidate] = []
    for p, bt in bt_cache.items():
        candidates.append(Candidate(
            spec=bt.spec,
            score=score_strategy(bt),
            n_trades=bt.n_trades,
            win_rate=bt.win_rate,
            total_pnl=bt.total_pnl,
            max_drawdown=bt.max_drawdown,
            profit_factor=bt.profit_factor,
        ))
    candidates.sort(key=lambda c: c.score, reverse=True)
    return SweepResult(
        axis=axis,
        base_spec=base_spec,
        candidates=candidates,
        nav=nav,
    )
