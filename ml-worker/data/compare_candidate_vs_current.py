"""Phase C pre-gate — strategic-guidance acceptance for Issue #572.

Compares Phase B sweep winners against the current MODE_PROFILES.INVESTIGATION
anchor. Determines whether any axis × symbol × profile combination produces
≥10% composite-score advantage over the live baseline — which is the
strategic-guidance condition for Phase C registry build to begin.

Outputs:
  - Per-axis, per-symbol, per-profile delta vs baseline
  - Aggregate "candidates passing the gate" count
  - JSON report identifying the first registry candidate(s)

Usage:
  cd ml-worker && python -m data.compare_candidate_vs_current

Requires:
  - ml-worker/data/eth_usdt_perp_15m_30d.csv (closes column)
  - ml-worker/data/btc_usdt_perp_15m_30d.csv (closes column)

Acceptance:
  Phase C build can begin if at least one (axis, symbol-pair, profile) tuple
  shows a composite-score delta of +10% or more over MODE_PROFILES.INVESTIGATION
  on BOTH symbols under at least 2 of 3 score profiles.

Reference: Issue #572 (Phase C tracker), commit 4e28558e (sweep validation).
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from backtest.spec import StrategySpec, default_spec, SWEEPABLE_AXES
from backtest.replay import (
    SCORE_PROFILES,
    ScoreWeights,
    replay_ohlcv,
    score_strategy,
)
from backtest.sweep import sweep_axis


# Live MODE_PROFILES.INVESTIGATION anchor (the baseline).
# Sourced from ml-worker/src/monkey_kernel/modes.py at HEAD (4e28558e).
# When MODE_PROFILES changes, update this constant in lockstep.
LIVE_BASELINE_SPEC = StrategySpec(
    tp_base_frac=0.008,
    sl_ratio=0.5,
    trailing_giveback=0.30,        # default_spec value — not in MODE_PROFILES
    entry_threshold_scale=1.0,
    dca_better_price=0.01,         # default_spec value — not in MODE_PROFILES
    dca_max_adds=1,
)


# Same axis values as run_real_sweep.py — kept in sync for comparability.
AXIS_VALUES = {
    "tp_base_frac":          [0.002, 0.003, 0.005, 0.008, 0.012, 0.020, 0.032, 0.050, 0.080],
    "sl_ratio":              [0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90],
    "trailing_giveback":     [0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.60],
    "entry_threshold_scale": [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0],
    "dca_better_price":      [0.005, 0.0075, 0.01, 0.015, 0.02, 0.03, 0.05, 0.08],
}


# Strategic-guidance gate threshold (Issue #572).
GATE_MIN_DELTA_PCT = 10.0     # +10% composite score over baseline
GATE_MIN_PROFILES_PASSING = 2 # of 3 (conservative + balanced + aggressive)


def load_closes(path: Path) -> np.ndarray:
    """Load close prices from a CSV with a 'close' column header."""
    closes: list[float] = []
    with path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                closes.append(float(row["close"]))
            except (KeyError, ValueError):
                continue
    return np.asarray(closes, dtype=np.float64)


def baseline_score(
    closes: np.ndarray,
    weights: ScoreWeights,
) -> tuple[float, dict]:
    """Score the live MODE_PROFILES.INVESTIGATION baseline on a closes series.

    Returns (composite_score, details_dict).
    """
    bt = replay_ohlcv(closes, LIVE_BASELINE_SPEC)
    score = score_strategy(bt, weights=weights)
    return float(score), {
        "n_trades": bt.n_trades,
        "win_rate": round(bt.win_rate, 4),
        "total_pnl": round(bt.total_pnl, 4),
        "max_drawdown": round(bt.max_drawdown, 4),
        "profit_factor": (
            round(bt.profit_factor, 4) if np.isfinite(bt.profit_factor) else None
        ),
        "score": round(score, 4),
    }


def candidate_score(
    closes: np.ndarray,
    axis: str,
    weights: ScoreWeights,
) -> tuple[float, float, dict]:
    """Sweep one axis on this closes series under these weights, return the
    top candidate's (param_value, score, details_dict).
    """
    sweep = sweep_axis(
        closes,
        LIVE_BASELINE_SPEC,
        axis,
        AXIS_VALUES[axis],
        weights=weights,
    )
    top = sweep.top
    if top is None:
        return float("nan"), float("nan"), {}

    # Recover top param value
    p = getattr(top.spec, axis)

    return float(p), float(top.score), {
        "param_value": p,
        "n_trades": top.n_trades,
        "win_rate": round(top.win_rate, 4),
        "total_pnl": round(top.total_pnl, 4),
        "max_drawdown": round(top.max_drawdown, 4),
        "profit_factor": (
            round(top.profit_factor, 4) if np.isfinite(top.profit_factor) else None
        ),
        "score": round(top.score, 4),
    }


def delta_pct(candidate: float, baseline: float) -> float:
    """Composite-score percentage advantage of candidate over baseline.

    Handles the baseline≈0 case explicitly: when baseline is effectively
    zero (no trades or perfectly break-even) any positive candidate is
    'infinite' improvement, but we cap reported delta at +999% to keep
    the report readable. Negative-baseline cases (losing strategy) report
    delta as if relative to abs(baseline) so a candidate that goes from
    -5 to +5 reports as a flip rather than a percentage.
    """
    if abs(baseline) < 1e-9:
        if candidate > 0:
            return 999.0
        if candidate < 0:
            return -999.0
        return 0.0
    return ((candidate - baseline) / abs(baseline)) * 100.0


def evaluate_gate(
    cells: list[dict],
    axis: str,
) -> dict:
    """Determine if this axis passes the strategic-guidance gate.

    Gate: ≥10% composite-score delta over baseline on BOTH ETH and BTC
    under at least 2 of 3 profiles.
    """
    profiles_passing: list[str] = []
    for profile_name in SCORE_PROFILES.keys():
        eth_cell = next(
            (c for c in cells
             if c["symbol"] == "ETH_USDT_PERP" and c["profile"] == profile_name),
            None,
        )
        btc_cell = next(
            (c for c in cells
             if c["symbol"] == "BTC_USDT_PERP" and c["profile"] == profile_name),
            None,
        )
        if eth_cell is None or btc_cell is None:
            continue
        eth_passes = eth_cell["delta_pct"] >= GATE_MIN_DELTA_PCT
        btc_passes = btc_cell["delta_pct"] >= GATE_MIN_DELTA_PCT
        if eth_passes and btc_passes:
            profiles_passing.append(profile_name)

    return {
        "axis": axis,
        "profiles_passing": profiles_passing,
        "n_profiles_passing": len(profiles_passing),
        "gate_passed": len(profiles_passing) >= GATE_MIN_PROFILES_PASSING,
    }


def main() -> int:
    here = Path(__file__).parent
    symbols = {
        "ETH_USDT_PERP": here / "eth_usdt_perp_15m_30d.csv",
        "BTC_USDT_PERP": here / "btc_usdt_perp_15m_30d.csv",
    }

    missing = [str(p) for p in symbols.values() if not p.exists()]
    if missing:
        print(
            f"ERROR: missing data files: {missing}\n"
            f"Pull 30 days of 15m candles for ETH-USDT-PERP and BTC-USDT-PERP\n"
            f"into ml-worker/data/ before running.",
            file=sys.stderr,
        )
        return 2

    closes_by_symbol = {sym: load_closes(p) for sym, p in symbols.items()}
    print(
        "# data: " + ", ".join(
            f"{s}={len(c)}" for s, c in closes_by_symbol.items()
        ),
        file=sys.stderr,
    )

    cells: list[dict] = []
    for symbol, closes in closes_by_symbol.items():
        for axis in SWEEPABLE_AXES:
            for profile_name, weights in SCORE_PROFILES.items():
                # Score the live baseline on this (symbol, profile)
                baseline, baseline_details = baseline_score(closes, weights)

                # Sweep this axis to find its winner on this (symbol, profile)
                _, cand_score_value, cand_details = candidate_score(
                    closes, axis, weights,
                )

                d_pct = delta_pct(cand_score_value, baseline)

                cell = {
                    "symbol": symbol,
                    "axis": axis,
                    "profile": profile_name,
                    "baseline_score": round(baseline, 4),
                    "candidate_score": round(cand_score_value, 4),
                    "delta_pct": round(d_pct, 2),
                    "passes_gate": d_pct >= GATE_MIN_DELTA_PCT,
                    "candidate_param": cand_details.get("param_value"),
                    "baseline_details": baseline_details,
                    "candidate_details": cand_details,
                }
                cells.append(cell)
                print(
                    f"  {symbol} {axis:25s} {profile_name:13s}  "
                    f"baseline={baseline:+.3f} candidate={cand_score_value:+.3f} "
                    f"Δ={d_pct:+6.1f}%  "
                    f"{'PASS' if cell['passes_gate'] else '----'}",
                    file=sys.stderr,
                )

    # Per-axis gate evaluation
    axis_gates = []
    any_axis_passes = False
    for axis in SWEEPABLE_AXES:
        axis_cells = [c for c in cells if c["axis"] == axis]
        gate_result = evaluate_gate(axis_cells, axis)
        if gate_result["gate_passed"]:
            any_axis_passes = True
        axis_gates.append(gate_result)

    summary = {
        "version": "v0.9.x-phase-c-pre-gate",
        "issue": 572,
        "gate": {
            "min_delta_pct": GATE_MIN_DELTA_PCT,
            "min_profiles_passing": GATE_MIN_PROFILES_PASSING,
            "rule": (
                f">= {GATE_MIN_DELTA_PCT}% composite-score delta on BOTH "
                f"symbols under >= {GATE_MIN_PROFILES_PASSING} of 3 profiles"
            ),
        },
        "decision": "PASS" if any_axis_passes else "FAIL",
        "axes_passing": [
            g["axis"] for g in axis_gates if g["gate_passed"]
        ],
        "per_axis_gates": axis_gates,
        "n_cells": len(cells),
        "data": {sym: len(c) for sym, c in closes_by_symbol.items()},
        "cells": cells,
    }

    print(json.dumps(summary, indent=2, default=str))

    print(
        f"\n# DECISION: {summary['decision']}\n"
        f"# axes passing gate: {summary['axes_passing'] or 'none'}\n",
        file=sys.stderr,
    )
    return 0 if any_axis_passes else 1


if __name__ == "__main__":
    sys.exit(main())
