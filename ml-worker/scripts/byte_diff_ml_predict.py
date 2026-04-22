#!/usr/bin/env python
"""
byte_diff_ml_predict.py — Stage 1b validation gate for v0.8.3.5 Option C.

Compares ml-worker's /ml/predict (new deploy surface, with
ROUTE_VERSION=v0.8 set so StrategyLoop serves) against the live
kernels/core /ml/predict (current production). Zero diffs across N
calls is the gate the advisor set before Stage 2 flips Railway's
rootDirectory.

Why this is a manual step, not CI: we need real inputs from the live
Poloniex feed to exercise the regime detector the way production sees
it. Running against synthetic candles would only prove the ports
compile, not that the moved code produces identical outputs on the
real input distribution.

Usage:
  export STAGING_URL="http://localhost:8000"              # ml-worker
  export PROD_URL="https://ml-worker.railway.internal:PORT"  # kernels/core
  python ml-worker/scripts/byte_diff_ml_predict.py --n 1000

  # Or with CLI flags:
  python ml-worker/scripts/byte_diff_ml_predict.py \
      --staging-url http://localhost:8000 \
      --prod-url   https://ml-worker-prod.up.railway.app \
      --symbol     BTC_USDT_PERP \
      --n          1000

Exit code:
  0  — all calls matched byte-for-byte (gate open, proceed to Stage 2)
  1  — mismatches detected (block Stage 2 until fixed)
  2  — setup error (bad URL, seed fetch failed, etc.)

Output:
  - Human-readable progress to stderr
  - First 5 mismatches printed with diff context
  - Final JSON summary to stdout, suitable for CI log-grep
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from typing import Any

import requests

# ────────────────────────────────────────────────────────────────
# Config
# ────────────────────────────────────────────────────────────────

DEFAULT_SYMBOL = "BTC_USDT_PERP"
DEFAULT_N = 1000
DEFAULT_TIMEOUT = 15.0
DEFAULT_DELAY_MS = 50  # polite throttle between calls
MAX_INLINE_MISMATCHES = 5  # print this many diff details before summarising

# Poloniex v3 public kline endpoint — no auth needed for seed fetch.
POLONIEX_KLINE_URL = "https://api.poloniex.com/v3/market/get-kline-data"

# Action mix — weighted to exercise all code paths in _run_prediction.
ACTION_WEIGHTS: list[tuple[str, float]] = [
    ("multi_horizon", 0.45),
    ("signal", 0.40),
    ("predict", 0.15),  # will pick 1h / 4h / 24h horizon uniformly below
]

PREDICT_HORIZONS = ["1h", "4h", "24h"]


# ────────────────────────────────────────────────────────────────
# Seed fetch — one large OHLCV window, sliced N different ways
# ────────────────────────────────────────────────────────────────

def fetch_seed_ohlcv(symbol: str, granularity: int = 15) -> list[dict[str, Any]]:
    """Grab ~500 candles from Poloniex public API. If this fails,
    fall back to --seed-file. Poloniex's public kline path occasionally
    misbehaves (rate-limit, symbol-format drift); pre-fetched files
    insulate us from that.
    """
    params = {"symbol": symbol, "granularity": str(granularity), "limit": 500}
    resp = requests.get(POLONIEX_KLINE_URL, params=params, timeout=20)
    resp.raise_for_status()
    body = resp.json()

    # Poloniex response shape: {"code": 200, "data": [[t,o,h,l,c,v,...], ...]}
    raw = body.get("data") or []
    if not raw:
        raise RuntimeError(
            f"Poloniex returned empty kline data for {symbol}. "
            f"Body: {json.dumps(body)[:300]}"
        )

    # Normalize to the shape polytrade-be sends: list of dicts.
    candles: list[dict[str, Any]] = []
    for row in raw:
        # Different Poloniex endpoints use different array orderings.
        # Try the v3 futures shape first: [ts, o, h, l, c, v, ...].
        try:
            ts, o, h, low, c, v = row[0], row[1], row[2], row[3], row[4], row[5]
            candles.append({
                "timestamp": int(ts),
                "open": float(o),
                "high": float(h),
                "low": float(low),
                "close": float(c),
                "volume": float(v),
            })
        except (IndexError, TypeError, ValueError):
            # Skip rows we can't parse — don't let a partial response tank the run.
            continue

    if len(candles) < 100:
        raise RuntimeError(
            f"Got only {len(candles)} usable candles from Poloniex. "
            "Need at least 100 for meaningful test windows."
        )
    return candles


def make_payload(
    seed: list[dict[str, Any]],
    rng: random.Random,
    symbol: str,
) -> dict[str, Any]:
    """Generate one request payload by slicing the seed + choosing action.

    Window length varies [60, 200] so the StrategyLoop sees enough data
    to detect regimes for most calls but occasionally gets an
    insufficient-data slice (exercises the fallback branch).
    """
    win_len = rng.randint(60, 200)
    start = rng.randint(0, max(0, len(seed) - win_len))
    window = seed[start:start + win_len]

    # Pick action by weight.
    r = rng.random()
    cumulative = 0.0
    action = "multi_horizon"
    for act, w in ACTION_WEIGHTS:
        cumulative += w
        if r <= cumulative:
            action = act
            break

    payload: dict[str, Any] = {
        "action": action,
        "symbol": symbol,
        "data": window,
        "current_price": window[-1]["close"] if window else 0.0,
    }
    if action == "predict":
        payload["horizon"] = rng.choice(PREDICT_HORIZONS)
    return payload


# ────────────────────────────────────────────────────────────────
# Diff engine
# ────────────────────────────────────────────────────────────────

def call_predict(base_url: str, payload: dict, timeout: float) -> dict[str, Any]:
    """POST the payload; return (status_code, parsed_json_or_text, elapsed_ms)."""
    url = f"{base_url.rstrip('/')}/ml/predict"
    started = time.monotonic()
    try:
        resp = requests.post(url, json=payload, timeout=timeout)
    except requests.RequestException as exc:
        return {
            "ok": False,
            "status": None,
            "body": None,
            "error": f"{type(exc).__name__}: {exc}",
            "elapsed_ms": round((time.monotonic() - started) * 1000, 2),
        }
    try:
        body = resp.json()
    except ValueError:
        body = resp.text
    return {
        "ok": True,
        "status": resp.status_code,
        "body": body,
        "error": None,
        "elapsed_ms": round((time.monotonic() - started) * 1000, 2),
    }


def diff_responses(staging: dict, prod: dict) -> list[str]:
    """Return a list of human-readable diff lines. Empty list = match."""
    diffs: list[str] = []

    if staging["ok"] != prod["ok"]:
        diffs.append(
            f"transport mismatch: staging.ok={staging['ok']} prod.ok={prod['ok']} "
            f"(staging.err={staging.get('error')}, prod.err={prod.get('error')})"
        )
        return diffs

    if not staging["ok"]:
        # Both errored; consider it a match only if the error class is same.
        se = (staging.get("error") or "").split(":")[0]
        pe = (prod.get("error") or "").split(":")[0]
        if se != pe:
            diffs.append(f"both erred but different classes: staging={se} prod={pe}")
        return diffs

    if staging["status"] != prod["status"]:
        diffs.append(
            f"HTTP status mismatch: staging={staging['status']} prod={prod['status']}"
        )

    # Body byte-compare. Ordering-agnostic via canonical JSON form.
    s_body, p_body = staging["body"], prod["body"]
    if type(s_body) is not type(p_body):
        diffs.append(f"body type mismatch: staging={type(s_body).__name__} prod={type(p_body).__name__}")
        return diffs

    try:
        s_canon = json.dumps(s_body, sort_keys=True)
        p_canon = json.dumps(p_body, sort_keys=True)
    except TypeError:
        # Non-JSON-able payload — compare as strings.
        s_canon, p_canon = str(s_body), str(p_body)

    if s_canon != p_canon:
        diffs.append(f"body mismatch:\n  staging: {s_canon[:400]}\n  prod   : {p_canon[:400]}")

    return diffs


# ────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Byte-diff ml-worker /ml/predict against live kernels/core /ml/predict.",
    )
    parser.add_argument(
        "--staging-url", default=os.environ.get("STAGING_URL"),
        help="ml-worker base URL (no /ml/predict suffix). Env: STAGING_URL.",
    )
    parser.add_argument(
        "--prod-url", default=os.environ.get("PROD_URL"),
        help="kernels/core base URL. Env: PROD_URL.",
    )
    parser.add_argument(
        "--symbol", default=os.environ.get("SYMBOL", DEFAULT_SYMBOL),
    )
    parser.add_argument(
        "--n", type=int, default=int(os.environ.get("N", DEFAULT_N)),
    )
    parser.add_argument(
        "--delay-ms", type=int, default=int(os.environ.get("DELAY_MS", DEFAULT_DELAY_MS)),
        help="Polite throttle between call pairs.",
    )
    parser.add_argument(
        "--timeout", type=float, default=DEFAULT_TIMEOUT,
    )
    parser.add_argument(
        "--seed", type=int, default=None,
        help="RNG seed for reproducible payload sequences.",
    )
    parser.add_argument(
        "--seed-file", default=os.environ.get("SEED_FILE"),
        help=(
            "JSON file containing a list of OHLCV dicts "
            "({timestamp,open,high,low,close,volume}). "
            "Bypasses Poloniex fetch — use when the public API is "
            "flaky or when you want a frozen test corpus."
        ),
    )
    args = parser.parse_args()

    if not args.staging_url or not args.prod_url:
        print(
            "ERROR: --staging-url / STAGING_URL and --prod-url / PROD_URL are required.",
            file=sys.stderr,
        )
        return 2

    # Seed acquisition: --seed-file takes priority (offline + reproducible),
    # else try Poloniex public kline. On live-fetch failure, suggest the
    # --seed-file alternative instead of tanking the whole run.
    seed: list[dict[str, Any]]
    if args.seed_file:
        try:
            with open(args.seed_file) as f:
                raw = json.load(f)
            seed = [
                {
                    "timestamp": int(c.get("timestamp", c.get("t", 0))),
                    "open": float(c["open"]),
                    "high": float(c["high"]),
                    "low": float(c["low"]),
                    "close": float(c["close"]),
                    "volume": float(c["volume"]),
                }
                for c in raw if isinstance(c, dict)
            ]
            print(f"[byte-diff] seed-file: {len(seed)} candles from {args.seed_file}",
                  file=sys.stderr)
        except Exception as exc:
            print(f"ERROR: seed-file load failed — {exc}", file=sys.stderr)
            return 2
    else:
        print(f"[byte-diff] fetching seed OHLCV for {args.symbol}...", file=sys.stderr)
        try:
            seed = fetch_seed_ohlcv(args.symbol)
            print(f"[byte-diff] seed: {len(seed)} candles", file=sys.stderr)
        except Exception as exc:
            print(
                f"ERROR: Poloniex public kline fetch failed — {exc}\n"
                f"       Try --seed-file <path> with a pre-fetched OHLCV dump.\n"
                f"       Example shape: [{{\"timestamp\":1700000000,\"open\":45000,"
                f"\"high\":45100,\"low\":44900,\"close\":45050,\"volume\":12.3}}, ...]",
                file=sys.stderr,
            )
            return 2

    rng = random.Random(args.seed)
    mismatches: list[dict[str, Any]] = []
    transport_errors = 0
    staging_latencies: list[float] = []
    prod_latencies: list[float] = []

    print(
        f"[byte-diff] running {args.n} calls "
        f"(staging={args.staging_url}, prod={args.prod_url})",
        file=sys.stderr,
    )
    started = time.monotonic()

    for i in range(args.n):
        payload = make_payload(seed, rng, args.symbol)

        s_resp = call_predict(args.staging_url, payload, args.timeout)
        p_resp = call_predict(args.prod_url, payload, args.timeout)

        if s_resp["ok"]:
            staging_latencies.append(s_resp["elapsed_ms"])
        if p_resp["ok"]:
            prod_latencies.append(p_resp["elapsed_ms"])
        if not s_resp["ok"] or not p_resp["ok"]:
            transport_errors += 1

        diffs = diff_responses(s_resp, p_resp)
        if diffs:
            mismatches.append({
                "index": i,
                "action": payload["action"],
                "window_len": len(payload["data"]),
                "diffs": diffs,
            })
            if len(mismatches) <= MAX_INLINE_MISMATCHES:
                print(
                    f"\n[MISMATCH #{i} action={payload['action']} "
                    f"window={len(payload['data'])}]",
                    file=sys.stderr,
                )
                for d in diffs:
                    print(f"  {d}", file=sys.stderr)

        if (i + 1) % 50 == 0:
            print(
                f"[byte-diff] {i + 1}/{args.n}  mismatches={len(mismatches)}  "
                f"transport_errs={transport_errors}",
                file=sys.stderr,
            )

        if args.delay_ms > 0:
            time.sleep(args.delay_ms / 1000.0)

    elapsed_s = time.monotonic() - started

    def p(pcts: list[float], q: float) -> float:
        if not pcts:
            return 0.0
        srt = sorted(pcts)
        k = int(max(0, min(len(srt) - 1, round(q * (len(srt) - 1)))))
        return round(srt[k], 2)

    summary = {
        "n": args.n,
        "symbol": args.symbol,
        "mismatches": len(mismatches),
        "transport_errors": transport_errors,
        "elapsed_s": round(elapsed_s, 2),
        "staging_latency_ms": {
            "p50": p(staging_latencies, 0.50),
            "p95": p(staging_latencies, 0.95),
            "p99": p(staging_latencies, 0.99),
        },
        "prod_latency_ms": {
            "p50": p(prod_latencies, 0.50),
            "p95": p(prod_latencies, 0.95),
            "p99": p(prod_latencies, 0.99),
        },
        "first_mismatch_examples": mismatches[:MAX_INLINE_MISMATCHES],
    }

    print(json.dumps(summary, indent=2))

    if len(mismatches) > MAX_INLINE_MISMATCHES:
        print(
            f"\n[byte-diff] NOTE: {len(mismatches) - MAX_INLINE_MISMATCHES} more "
            f"mismatches not shown inline — see summary.first_mismatch_examples.",
            file=sys.stderr,
        )

    if transport_errors > 0:
        # Can't infer anything about parity if the transport is broken.
        # Both-sides-errored-with-same-class is NOT a byte-match — the
        # servers might disagree completely once reachable.
        print(
            f"\n[byte-diff] INVALID RUN: {transport_errors}/{args.n} "
            f"calls hit transport errors. Fix URLs / networking and re-run. "
            f"Stage 2 GATE NOT ASSESSED.",
            file=sys.stderr,
        )
        return 2

    if mismatches:
        print(
            f"\n[byte-diff] FAIL: {len(mismatches)}/{args.n} mismatches. "
            f"Stage 2 GATE CLOSED.",
            file=sys.stderr,
        )
        return 1

    print(
        f"\n[byte-diff] PASS: {args.n}/{args.n} matched byte-for-byte. "
        f"Stage 2 GATE OPEN.",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
