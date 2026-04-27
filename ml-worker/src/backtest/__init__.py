"""v0.9.0 Phase B — offline strategy search.

Method-discovery layer wrapped around qig_warp.WarpBubble.auto().

Pipeline:
  1. Define a StrategySpec parameter space (TP / SL / trailing / entry).
  2. Replay OHLCV through Monkey's decision functions to compute PnL.
  3. Score each candidate by (PnL × win_rate / |max_drawdown|).
  4. Use qig_warp.auto.navigate to discover the parameter manifold's
     screening length + cost exponent + convergence rate, then run the
     full sweep with provable savings (5 pilot probes → screened sweep).
  5. Output top-K candidates to JSON. NO live promotion to MODE_PROFILES;
     that's Phase C (P14 governance with provenance + rollback).

This module runs OFFLINE only. It does not touch the live decision path.
"""
from .spec import StrategySpec, default_spec
from .replay import (
    replay_ohlcv,
    BacktestResult,
    score_strategy,
    ScoreWeights,
    SCORE_PROFILES,
)
from .sweep import sweep_axis, SweepResult, Candidate

__all__ = [
    "StrategySpec",
    "default_spec",
    "replay_ohlcv",
    "BacktestResult",
    "score_strategy",
    "ScoreWeights",
    "SCORE_PROFILES",
    "sweep_axis",
    "SweepResult",
    "Candidate",
]
