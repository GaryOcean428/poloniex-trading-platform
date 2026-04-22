"""
live_signal.py — pure decision functions from liveSignalEngine.ts.

v0.8.7b scope: the stateless, IO-free pieces of the live-signal
engine. Signal normalization, ATR, simple regime classification,
order shaping. DB-backed bandit logic + order placement stay TS
until v0.8.7c/d.

These functions are ported 1:1 from the TS reference, same input →
same output, so a shadow-mode parity check can cross-verify without
any behavior change. Tests pin each function against hand-crafted
boundary cases (ranging/trending regime boundary, ATR at zero-input,
signal-string aliases).

Purity: BOUNDARY per P14. Not QIG cognition. The ml-worker lives at
/ml-worker and the decision here sources from the ml-worker's own
ensemble output — so this module is literally "how the TS live-signal
engine talks back to its own data." Excluded from qig_purity_check
scan roots.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Literal, Optional

from .risk_kernel import KernelOrder

# ────────────────────────────────────────────────────────────────
# Constants — mirror liveSignalEngine.ts exactly
# ────────────────────────────────────────────────────────────────
#
# Env-var overrides preserved from the TS reference so Railway-side
# config picks these up identically. Defaults are the TS-side defaults.

DEFAULT_WATCH_SYMBOLS: tuple[str, ...] = ("BTC_USDT_PERP", "ETH_USDT_PERP")

# Minimum ensemble signal strength (0..1) considered actionable.
MIN_SIGNAL_STRENGTH: float = float(os.environ.get("LIVE_SIGNAL_MIN_STRENGTH") or 0.35)

# Live position sizing (USDT notional) — graduated ladder floor.
INITIAL_POSITION_USDT: float = float(os.environ.get("LIVE_POSITION_USDT") or 2)

# Base leverage applied before the symbol-max catalog cap.
DEFAULT_LEVERAGE: float = float(os.environ.get("LIVE_LEVERAGE") or 3)

# ATR-scaling: stop = ATR × this, take-profit = ATR × this × 2.
ATR_STOP_MULTIPLIER: float = 1.5
ATR_TAKE_PROFIT_MULTIPLIER: float = 3.0

# How many recent candles to use for the ATR calculation.
ATR_PERIOD: int = 14

# Exit signal strength — ML flip closes position at this conviction.
EXIT_SIGNAL_STRENGTH: float = float(os.environ.get("LIVE_EXIT_STRENGTH") or 0.35)

# Kill-switch: flatten all + pause when unrealized DD hits this.
KILL_SWITCH_DD_THRESHOLD: float = -0.15

# Bandit: below this many trades per (signalKey, regime) pair, accept
# every signal to gather exploration data.
BANDIT_EXPLORATION_TRADES: int = 5

# Bandit posterior floor once exploration phase ends.
BANDIT_MIN_POSTERIOR: float = 0.4


# ────────────────────────────────────────────────────────────────
# Types
# ────────────────────────────────────────────────────────────────

SignalSide = Literal["BUY", "SELL", "HOLD"]
Regime = Literal["trending_up", "trending_down", "ranging", "unknown"]


@dataclass(frozen=True)
class OHLCVBar:
    """Single OHLCV candle. Only the fields the pure decision functions
    need — timestamp/volume omitted since nothing here uses them."""
    high: float
    low: float
    close: float


@dataclass(frozen=True)
class LiveSignalDecision:
    """Shaped order intent — an abstract KernelOrder pre-notional-fixing.

    buildOrder in TS returns KernelOrder | null; the Python equivalent
    returns LiveSignalDecision whose .to_kernel_order() produces the
    actual KernelOrder once the caller has dialed in any per-symbol
    max-leverage cap. Keeps this module purely computational; the
    caller handles catalog lookups.
    """
    side: Literal["long", "short"]
    leverage: float
    notional: float
    price: float
    atr: float
    atr_stop_distance: float
    atr_tp_distance: float

    def to_kernel_order(self, symbol: str) -> KernelOrder:
        return KernelOrder(
            symbol=symbol,
            side=self.side,
            notional=self.notional,
            leverage=self.leverage,
            price=self.price,
        )


# ────────────────────────────────────────────────────────────────
# normalise_signal — BUY / SELL / HOLD aliasing
# ────────────────────────────────────────────────────────────────

def normalise_signal(s: object) -> SignalSide:
    """Normalize messy signal strings to the three-state enum.

    BUY / LONG  → 'BUY'
    SELL / SHORT → 'SELL'
    anything else → 'HOLD'

    Ports liveSignalEngine.ts:normaliseSignal exactly — case-insensitive,
    treats None/non-string as 'HOLD'.
    """
    v = str(s if s is not None else "").upper()
    if v in ("BUY", "LONG"):
        return "BUY"
    if v in ("SELL", "SHORT"):
        return "SELL"
    return "HOLD"


# ────────────────────────────────────────────────────────────────
# detect_simple_regime — cheap log-return regime proxy
# ────────────────────────────────────────────────────────────────

def detect_simple_regime(closes: list[float]) -> Regime:
    """Buckets the last 60-candle move into trending_up/down or ranging.

    The ml-worker's QIG regime classifier is authoritative for signal
    generation; this proxy exists so the contextual bandit has a stable
    key without round-tripping QIG every tick.

    Threshold (2% log-return over 60 candles) matches TS reference.
    """
    n = min(60, len(closes))
    if n < 10:
        return "unknown"
    last_close = closes[-1]
    first_close = closes[-n]
    if not (math.isfinite(last_close) and math.isfinite(first_close)) or first_close <= 0:
        return "unknown"
    log_return = math.log(last_close / first_close)
    if log_return > 0.02:
        return "trending_up"
    if log_return < -0.02:
        return "trending_down"
    return "ranging"


# ────────────────────────────────────────────────────────────────
# extract_signal_key — bandit key derivation from reason string
# ────────────────────────────────────────────────────────────────

def extract_signal_key(reason: str) -> str:
    """Condense a reason string into a stable bandit key.

    ml-worker returns reason like "regime=creator strategy=breakout".
    The bandit learns per-strategy-family, so we normalize to the
    strategy portion. Falls back to the first token if no strategy
    is declared. Truncated to 60 chars to fit the DB column.

    Ports liveSignalEngine.ts:extractSignalKey exactly, including the
    regex pattern `/strategy=([a-zA-Z_]+)/`.
    """
    import re

    match = re.search(r"strategy=([a-zA-Z_]+)", reason or "")
    if match:
        return f"ml_{match.group(1)}"
    first_token = (reason or "").split()[0] if reason else "unknown"
    return f"ml_{first_token}"[:60]


# ────────────────────────────────────────────────────────────────
# compute_atr — True Range Average (simple, deterministic)
# ────────────────────────────────────────────────────────────────

def compute_atr(ohlcv: list[OHLCVBar], period: int = ATR_PERIOD) -> float:
    """Average True Range over the last `period` bars.

    Simple average of TR, not Wilder smoothing. TS reference chose
    this for determinism; port preserves it. Returns 0.0 if the
    window is too small.

    TR = max(high - low, |high - prevClose|, |low - prevClose|)
    """
    n = min(period, len(ohlcv) - 1)
    if n < 2:
        return 0.0
    sum_tr = 0.0
    for i in range(len(ohlcv) - n, len(ohlcv)):
        bar = ohlcv[i]
        prev_close = ohlcv[i - 1].close
        tr = max(
            bar.high - bar.low,
            abs(bar.high - prev_close),
            abs(bar.low - prev_close),
        )
        if math.isfinite(tr):
            sum_tr += tr
    return sum_tr / n


# ────────────────────────────────────────────────────────────────
# build_order — compose a KernelOrder from signal + price + atr
# ────────────────────────────────────────────────────────────────

def build_order(
    signal: SignalSide,
    price: float,
    atr: float,
    *,
    position_usdt: Optional[float] = None,
    leverage: Optional[float] = None,
) -> Optional[LiveSignalDecision]:
    """Shape the pre-trade intent from the signal + price + atr.

    Returns None on HOLD or any non-positive notional — matches TS
    `buildOrder` which returned `KernelOrder | null`. ATR stop/TP
    distances are carried in the decision so callers can append them
    to the order payload downstream.

    position_usdt / leverage overrides are for tests. In live use
    they stay None and the module-level INITIAL_POSITION_USDT /
    DEFAULT_LEVERAGE are authoritative.
    """
    if signal == "HOLD":
        return None
    side: Literal["long", "short"] = "long" if signal == "BUY" else "short"

    pos = float(position_usdt) if position_usdt is not None else INITIAL_POSITION_USDT
    lev = float(leverage) if leverage is not None else DEFAULT_LEVERAGE
    notional = pos * lev

    if notional <= 0 or not math.isfinite(price) or price <= 0:
        return None

    return LiveSignalDecision(
        side=side,
        leverage=lev,
        notional=notional,
        price=float(price),
        atr=float(atr),
        atr_stop_distance=float(atr) * ATR_STOP_MULTIPLIER,
        atr_tp_distance=float(atr) * ATR_TAKE_PROFIT_MULTIPLIER,
    )


# ────────────────────────────────────────────────────────────────
# signal_passes_entry_gate — top-level yes/no gate for new positions
# ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class EntryGateResult:
    """Explicit yes/no + reason for the entry gate. Callers use
    `.passed` for the bool path and `.reason` for logging / telemetry."""
    passed: bool
    reason: str


def signal_passes_entry_gate(
    signal: SignalSide,
    strength: float,
    effective_strength: Optional[float] = None,
    *,
    min_strength: float = MIN_SIGNAL_STRENGTH,
) -> EntryGateResult:
    """Does this signal clear the entry bar?

    Three failure modes tracked for telemetry:
      - "hold": signal is HOLD, don't enter anything
      - "weak": signal is directional but under min_strength
      - "passed": enters

    effective_strength (if provided) is the bandit-weighted strength;
    falls back to raw strength when the bandit is still exploring.
    TS reference uses MIN_SIGNAL_STRENGTH against raw; the bandit
    layer (v0.8.7c) gets the effective-strength version.
    """
    if signal == "HOLD":
        return EntryGateResult(False, "hold")
    s = effective_strength if effective_strength is not None else strength
    if s < min_strength:
        return EntryGateResult(
            False,
            f"weak ({s:.3f} < {min_strength:.3f})",
        )
    return EntryGateResult(True, f"passed (strength={s:.3f})")
