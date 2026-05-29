"""hindsight_regret.py — counterfactual-regret reward signal (Python parity).

Mirrors apps/api/src/services/monkey/hindsightRegret.ts exactly.

Operator intent (2026-05-29, verbatim): "rather than a knob, it needs to
feel the pain of this. not so much that its scared to make a trade but enough
that it thinks about thinking about the trend a second time before closing."
+ "something akin to hindsight. e.g. 'if i just left it i would have got the
reward'."

CONCEPT (counterfactual regret minimisation):
  When the kernel closes a position we keep watching the symbol for a forward
  window and track what the CLOSED position WOULD have earned had it been
  held. If holding would have beaten the realised close (the trend continued
  in the position's favour) emit an AVERSIVE "closed too early" chemistry
  signal scaled by the foregone gain. If closing was correct (price moved
  against the old position) emit NO regret — optionally a mild positive
  "good close" reinforcement.

  The ASYMMETRY is load-bearing: regret fires ONLY when holding would have
  won. That is what stops the signal from making the kernel scared to ever
  close — there is no penalty for a correct exit, only for an exit that left
  money on the table in a continuing favourable trend.

DOCTRINAL ANCHORS:
  - P1 (Observer sets all params from frozen facts): the regret MAGNITUDE is
    normalised against the kernel's own realised pnl_frac distribution (MAD),
    exactly like observer_fib_coefficient / push_reward. No hardcoded "how
    much a foregone gain should sting" knob. The transform shape (tanh) and
    output cap are STRUCTURAL design constants, mirroring the trade-outcome
    reward channel.
  - P14 (Variable Separation): hindsight regret is its OWN chemistry channel.
    NOT folded into the realised-pnl reward.
  - P15 (Fail-Closed Safety): non-finite inputs produce zero deltas; never
    blocks trading.

This module is PURE (no I/O, no time, no DB). The orchestration that registers
a watch at close, advances it with live price each tick, and pushes the
resulting deltas lives in loop.ts behind MONKEY_HINDSIGHT_REGRET_LIVE
(default OFF). The Py side receives the resolved deltas via the autonomic
prediction-style channel; this module exists for parity + unit-testable math.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, replace
from typing import Optional

# ── Structural constants (NOT operator knobs) ──────────────────────────────
# REGRET_DOP_CAP mirrors the trade-outcome dopamine cap (0.5 in push_reward).
# Regret is the same CLASS of signal as a realised loss, so the foregone gain
# must be able to sting comparably to a real loss — but BOUNDED so a huge
# foregone gain cannot produce unbounded aversion. tanh saturates into [0, CAP).
REGRET_DOP_CAP: float = 0.5

# Small positive "good close" reinforcement when the close avoided a worse
# outcome (counterfactual <= realized). Much smaller than the regret cap so
# the asymmetry favours "don't punish closing" without teaching eager closing.
GOOD_CLOSE_DOP: float = 0.05

_EPS: float = 1e-12
_MIN_SAMPLES: int = 5


def _is_finite(x: object) -> bool:
    return isinstance(x, (int, float)) and math.isfinite(float(x))


@dataclass
class HindsightWatch:
    """A position that was closed and is now watched for counterfactual pnl."""

    symbol: str
    side_sign: int  # +1 closed long, -1 closed short
    qty: float
    exit_price: float
    realized_pnl_usdt: float
    margin_usdt: float
    closed_at_ms: float
    expires_at_ms: float
    best_counterfactual_pnl_usdt: float


@dataclass
class HindsightRegretDeltas:
    dopamine_delta: float
    foregone_gain_usdt: float
    regret_frac: float
    source: str


def counterfactual_pnl_usdt(
    *,
    side_sign: int,
    qty: float,
    exit_price: float,
    realized_pnl_usdt: float,
    price: float,
) -> Optional[float]:
    """Counterfactual pnl (USDT) of holding the CLOSED position to ``price``.

    long  : (price - exit_price) * qty
    short : (exit_price - price) * qty

    Returns the realised pnl PLUS the marginal pnl of holding past the exit
    (i.e. total "if I'd just left it"). None on any invalid input.
    """
    if not _is_finite(price) or price <= 0:
        return None
    if not _is_finite(qty) or qty <= 0:
        return None
    if not _is_finite(exit_price) or exit_price <= 0:
        return None
    if not _is_finite(realized_pnl_usdt):
        return None
    if side_sign not in (1, -1):
        return None
    marginal = (price - exit_price) * side_sign * qty
    return float(realized_pnl_usdt + marginal)


def advance_watch(watch: HindsightWatch, price: float) -> HindsightWatch:
    """Update the running best (most favourable) counterfactual pnl. Pure."""
    cf = counterfactual_pnl_usdt(
        side_sign=watch.side_sign,
        qty=watch.qty,
        exit_price=watch.exit_price,
        realized_pnl_usdt=watch.realized_pnl_usdt,
        price=price,
    )
    if cf is None:
        return watch
    if cf > watch.best_counterfactual_pnl_usdt:
        return replace(watch, best_counterfactual_pnl_usdt=cf)
    return watch


def median_absolute_deviation(xs: list[float]) -> float:
    """MAD around the median — robust statistic mirroring push_reward."""
    finite = [float(x) for x in xs if _is_finite(x)]
    if not finite:
        return 0.0
    s = sorted(finite)
    n = len(s)
    median = (s[n // 2 - 1] + s[n // 2]) / 2 if n % 2 == 0 else s[n // 2]
    devs = sorted(abs(x - median) for x in s)
    return (devs[n // 2 - 1] + devs[n // 2]) / 2 if n % 2 == 0 else devs[n // 2]


def resolve_regret(
    watch: HindsightWatch,
    pnl_frac_history: Optional[list[float]] = None,
) -> HindsightRegretDeltas:
    """Resolve an (expired) watch into a chemistry delta. Pure.

    foregone_gain = max(0, best_counterfactual - realized).
      - <= 0 → close avoided a worse outcome → no regret, mild positive.
      - > 0  → holding would have won → aversive, bounded.

    regret_frac = foregone_gain / margin, then normalised by the MAD of the
    kernel's own realised pnl_frac history (observer-derived scale, no
    hardcoded magnitude). dopamine_delta = -tanh(normalised) * REGRET_DOP_CAP.
    """
    if pnl_frac_history is None:
        pnl_frac_history = []

    best = watch.best_counterfactual_pnl_usdt
    realized = watch.realized_pnl_usdt
    margin = watch.margin_usdt

    if not _is_finite(best) or not _is_finite(realized):
        return HindsightRegretDeltas(0.0, 0.0, 0.0, "hindsight_invalid")
    if not _is_finite(margin) or margin <= 0:
        return HindsightRegretDeltas(0.0, 0.0, 0.0, "hindsight_no_margin")

    foregone_gain = best - realized

    if foregone_gain <= _EPS:
        return HindsightRegretDeltas(GOOD_CLOSE_DOP, 0.0, 0.0, "hindsight_good_close")

    regret_frac = foregone_gain / margin
    regret_frac_normalized = regret_frac
    if len(pnl_frac_history) >= _MIN_SAMPLES:
        mad = median_absolute_deviation(pnl_frac_history)
        if mad > _EPS:
            regret_frac_normalized = regret_frac / mad

    dopamine_delta = -math.tanh(regret_frac_normalized) * REGRET_DOP_CAP
    return HindsightRegretDeltas(
        dopamine_delta=float(dopamine_delta),
        foregone_gain_usdt=float(foregone_gain),
        regret_frac=float(regret_frac),
        source="hindsight_regret",
    )


def is_hindsight_regret_live() -> bool:
    """Feature flag. Default OFF — behaviour byte-identical when unset."""
    return os.environ.get("MONKEY_HINDSIGHT_REGRET_LIVE") == "true"


__all__ = [
    "HindsightWatch",
    "HindsightRegretDeltas",
    "counterfactual_pnl_usdt",
    "advance_watch",
    "median_absolute_deviation",
    "resolve_regret",
    "is_hindsight_regret_live",
    "REGRET_DOP_CAP",
    "GOOD_CLOSE_DOP",
]
