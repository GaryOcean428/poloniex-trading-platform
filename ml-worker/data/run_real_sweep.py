"""Real-data validation sweep — Phase B output that the strategic
guidance asked for.

5 axes × 2 symbols × 3 weight profiles = 30 sweep runs over 30-day
15m candles. Reports actual qig-warp savings against a naive grid
baseline computed by re-running the full sweep with n_probes=len(values).

Outputs JSON aggregate to stdout + per-run breakdowns.
"""
from __future__ import annotations

import csv
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from backtest.spec import default_spec, SWEEPABLE_AXES
from backtest.replay import SCORE_PROFILES, replay_ohlcv, score_strategy, ScoreWeights
from backtest.sweep import sweep_axis


def load_closes(path: Path) -> np.ndarray:
    closes = []
    with path.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                closes.append(float(row["close"]))
            except (KeyError, ValueError):
                continue
    return np.asarray(closes, dtype=np.float64)


# Realistic candidate values per axis. Wider grids than the smoke test.
AXIS_VALUES = {
    "tp_base_frac":          [0.002, 0.003, 0.005, 0.008, 0.012, 0.020, 0.032, 0.050, 0.080],
    "sl_ratio":              [0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90],
    "trailing_giveback":     [0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.60],
    "entry_threshold_scale": [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0],
    "dca_better_price":      [0.005, 0.0075, 0.01, 0.015, 0.02, 0.03, 0.05, 0.08],
}


def naive_baseline(closes: np.ndarray, axis: str, values: list[float],
                   weights: ScoreWeights) -> tuple[float, dict[float, float]]:
    """Run all values without qig-warp's screening — measure as
    baseline 'no savings' time. Returns (total_seconds, scores_dict)."""
    base = default_spec()
    t0 = time.time()
    out = {}
    for v in values:
        spec = base.with_(**{axis: float(v)})
        bt = replay_ohlcv(closes, spec)
        out[float(v)] = float(score_strategy(bt, weights=weights))
    return time.time() - t0, out


def main():
    here = Path(__file__).parent
    symbols = {
        "ETH_USDT_PERP": here / "eth_usdt_perp_15m_30d.csv",
        "BTC_USDT_PERP": here / "btc_usdt_perp_15m_30d.csv",
    }
    closes_by_symbol = {sym: load_closes(p) for sym, p in symbols.items()}
    print(f"# data: " + ", ".join(f"{s}={len(c)}" for s, c in closes_by_symbol.items()),
          file=sys.stderr)

    runs = []
    for symbol, closes in closes_by_symbol.items():
        for axis in SWEEPABLE_AXES:
            for profile_name, weights in SCORE_PROFILES.items():
                values = AXIS_VALUES[axis]

                # Run qig-warp sweep
                qw_t0 = time.time()
                sweep = sweep_axis(closes, default_spec(), axis, values,
                                   weights=weights)
                qw_secs = time.time() - qw_t0

                # Run naive baseline (full grid, no qig-warp)
                naive_secs, naive_scores = naive_baseline(closes, axis, values, weights)

                # Compare result coverage
                qw_param_count = len(sweep.candidates)
                evals_qw = sweep.nav.full_evals + sweep.nav.probes_used
                evals_naive = len(values)

                # Top result agreement
                qw_top = sweep.top
                naive_top_p = max(naive_scores, key=naive_scores.get) if naive_scores else None
                naive_top_score = naive_scores.get(naive_top_p, 0.0) if naive_top_p is not None else 0.0
                qw_top_p = (
                    qw_top.spec.tp_base_frac if axis == "tp_base_frac" else
                    qw_top.spec.sl_ratio if axis == "sl_ratio" else
                    qw_top.spec.trailing_giveback if axis == "trailing_giveback" else
                    qw_top.spec.entry_threshold_scale if axis == "entry_threshold_scale" else
                    qw_top.spec.dca_better_price
                ) if qw_top else None

                run = {
                    "symbol": symbol,
                    "axis": axis,
                    "profile": profile_name,
                    "n_values": len(values),
                    "naive_seconds": round(naive_secs, 4),
                    "qig_warp_seconds": round(qw_secs, 4),
                    "qig_warp_evals": evals_qw,
                    "naive_evals": evals_naive,
                    "wallclock_savings_pct": round(
                        (1 - qw_secs / naive_secs) * 100 if naive_secs > 0 else 0, 2),
                    "eval_savings_pct": round(
                        (1 - evals_qw / evals_naive) * 100 if evals_naive > 0 else 0, 2),
                    "qig_warp_top_p": qw_top_p,
                    "qig_warp_top_score": round(qw_top.score, 4) if qw_top else None,
                    "naive_top_p": naive_top_p,
                    "naive_top_score": round(naive_top_score, 4),
                    "agreement": qw_top_p == naive_top_p,
                    "discovered": {
                        "screening_length": sweep.nav.discovered.screening_length,
                        "cost_exponent": sweep.nav.discovered.cost_exponent,
                        "convergence_rate": sweep.nav.discovered.convergence_rate,
                    },
                }
                runs.append(run)
                print(f"  {symbol} {axis:25s} {profile_name:13s}  "
                      f"qw={qw_secs:.3f}s naive={naive_secs:.3f}s "
                      f"savings={run['wallclock_savings_pct']:+.1f}% "
                      f"agree={run['agreement']}",
                      file=sys.stderr)

    # Aggregate stats
    n_runs = len(runs)
    avg_wall_savings = sum(r["wallclock_savings_pct"] for r in runs) / n_runs
    avg_eval_savings = sum(r["eval_savings_pct"] for r in runs) / n_runs
    n_agree = sum(1 for r in runs if r["agreement"])
    pct_agree = 100 * n_agree / n_runs

    summary = {
        "version": "v0.9.0-phase-b-real-validation",
        "n_runs": n_runs,
        "data": {sym: len(c) for sym, c in closes_by_symbol.items()},
        "avg_wallclock_savings_pct": round(avg_wall_savings, 2),
        "avg_eval_savings_pct": round(avg_eval_savings, 2),
        "agreement_rate_pct": round(pct_agree, 2),
        "agreement_count": n_agree,
        "runs": runs,
    }
    print(json.dumps(summary, indent=2, default=str))


if __name__ == "__main__":
    main()
