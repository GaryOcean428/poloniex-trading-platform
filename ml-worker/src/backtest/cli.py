"""CLI for v0.9.0 Phase B sweeps.

Usage:
  # Sweep TP threshold over 8 candidate values, scored on a CSV of closes
  python -m backtest.cli \
      --closes-csv data/eth_15m_30d.csv \
      --axis tp_base_frac \
      --values 0.002,0.004,0.008,0.012,0.016,0.024,0.032,0.048

  # Synthetic random-walk closes for smoke-testing the pipeline
  python -m backtest.cli \
      --synthetic 1000 \
      --axis sl_ratio \
      --values 0.3,0.4,0.5,0.6,0.7

Outputs JSON to stdout. Top-K candidates ranked by composite score.
DOES NOT promote anything to live MODE_PROFILES — that's Phase C.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import asdict
from pathlib import Path

import numpy as np

from .spec import StrategySpec, SWEEPABLE_AXES, default_spec
from .sweep import sweep_axis, Candidate


def _load_closes_csv(path: Path) -> np.ndarray:
    """Load a CSV of close prices. Accepts either:
      - single column of floats (no header)
      - multi-column with a 'close' column header
    """
    closes: list[float] = []
    with path.open() as f:
        sample = f.read(4096)
        f.seek(0)
        has_header = csv.Sniffer().has_header(sample) if sample else False
        if has_header:
            reader = csv.DictReader(f)
            field = "close" if "close" in reader.fieldnames else (
                "Close" if "Close" in reader.fieldnames else reader.fieldnames[0]
            )
            for row in reader:
                try:
                    closes.append(float(row[field]))
                except (ValueError, TypeError, KeyError):
                    continue
        else:
            for row in csv.reader(f):
                if not row:
                    continue
                try:
                    closes.append(float(row[0]))
                except (ValueError, TypeError):
                    continue
    return np.asarray(closes, dtype=np.float64)


def _synthetic_closes(n: int, seed: int = 42) -> np.ndarray:
    """Generate a synthetic random-walk close series for smoke tests."""
    rng = np.random.default_rng(seed)
    log_returns = rng.normal(loc=0.0, scale=0.005, size=n)
    log_price = np.cumsum(log_returns)
    return 2300.0 * np.exp(log_price)


def _candidate_dict(c: Candidate) -> dict:
    spec_dict = asdict(c.spec)
    return {
        "spec": spec_dict,
        "score": round(c.score, 4),
        "n_trades": c.n_trades,
        "win_rate": round(c.win_rate, 4),
        "total_pnl": round(c.total_pnl, 4),
        "max_drawdown": round(c.max_drawdown, 4),
        "profit_factor": round(c.profit_factor, 4) if np.isfinite(c.profit_factor) else None,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="backtest.cli", description=__doc__)
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--closes-csv", type=Path,
                     help="Path to CSV of close prices.")
    src.add_argument("--synthetic", type=int, metavar="N",
                     help="Generate N synthetic random-walk closes (smoke test).")
    parser.add_argument("--axis", required=True, choices=SWEEPABLE_AXES,
                        help="Strategy axis to sweep.")
    parser.add_argument("--values", required=True,
                        help="Comma-separated candidate values for the axis.")
    parser.add_argument("--budget-s", type=float, default=None,
                        help="Max runtime budget for qig_warp.navigate (s).")
    parser.add_argument("--top-k", type=int, default=5,
                        help="How many top candidates to print.")
    parser.add_argument("--starting-equity", type=float, default=100.0)
    parser.add_argument("--notional", type=float, default=50.0,
                        help="Notional USDT per trade.")
    parser.add_argument("--leverage", type=float, default=14.0)
    parser.add_argument("--seed", type=int, default=42,
                        help="Synthetic data seed.")
    args = parser.parse_args(argv)

    if args.closes_csv:
        closes = _load_closes_csv(args.closes_csv)
        source = str(args.closes_csv)
    else:
        closes = _synthetic_closes(args.synthetic, seed=args.seed)
        source = f"synthetic n={args.synthetic} seed={args.seed}"

    if len(closes) < 60:
        print(f"ERROR: need >=60 closes, got {len(closes)}", file=sys.stderr)
        return 2

    try:
        values = [float(v.strip()) for v in args.values.split(",")]
    except ValueError as e:
        print(f"ERROR: --values must be comma-separated floats: {e}", file=sys.stderr)
        return 2

    base = default_spec()
    result = sweep_axis(
        closes=closes,
        base_spec=base,
        axis=args.axis,
        values=values,
        starting_equity=args.starting_equity,
        notional_per_trade=args.notional,
        leverage=args.leverage,
        budget_s=args.budget_s,
    )

    out = {
        "version": "v0.9.0-phase-b",
        "source": source,
        "n_closes": len(closes),
        "axis": args.axis,
        "base_spec": asdict(base),
        "qig_warp": {
            "probes_used": result.nav.probes_used,
            "full_evals": result.nav.full_evals,
            "actual_total_s": result.nav.actual_total_s,
            "actual_savings_pct": round(result.nav.actual_savings_pct, 2),
            "discovered": {
                "screening_length": result.nav.discovered.screening_length,
                "cost_exponent": result.nav.discovered.cost_exponent,
                "convergence_rate": result.nav.discovered.convergence_rate,
                "n_probes": result.nav.discovered.n_probes,
                "warnings": result.nav.discovered.warnings,
            },
        },
        "n_candidates": len(result.candidates),
        "top_k": [_candidate_dict(c) for c in result.top_k(args.top_k)],
    }
    print(json.dumps(out, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
