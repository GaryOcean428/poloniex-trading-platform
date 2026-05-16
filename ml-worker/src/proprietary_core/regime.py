"""Market regime types — MarketRegime enum + RegimeState dataclass.

MIG-2 (2026-05-16): the bespoke ``RegimeDetector`` (entropy + trend
classification) has been deleted. Regime classification now lives in
``regime_adapter.RegimeAdapter`` which calls ``qig_warp.classify_regime``
as the canonical authority and writes to the same ``RegimeState``
shape that downstream consumers (_select_strategy, _sizer.compute)
already read.

Three regimes mapped from the QIG three-sphere framework:
  - Creator:    high entropy, decoupled. Volatile, price discovery.
                Momentum / breakout strategies work here.
  - Preserver:  low entropy, coupled. Orderly, trending.
                Trend-follow / mean-reversion strategies work here.
  - Dissolver:  phase boundary / critical. Best strategy:
                DON'T TRADE (Pillar-1 gate).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class MarketRegime(str, Enum):
    """Three qualitatively different market states."""

    CREATOR = "creator"      # volatile, price discovery (← qig_warp DISORDERED)
    PRESERVER = "preserver"  # trending, orderly         (← qig_warp ORDERED)
    DISSOLVER = "dissolver"  # phase boundary, no signal (← qig_warp CRITICAL)


@dataclass
class RegimeState:
    """Current regime classification with supporting metrics.

    Produced by ``regime_adapter.RegimeAdapter.update``. The bespoke
    fields (entropy, fisher_info, trend_strength, volatility,
    confidence, is_transition, pillar1_gate) remain because
    downstream strategy selection + sizing still read them.
    """

    regime: MarketRegime
    entropy: float          # Shannon entropy of return distribution (h)
    fisher_info: float      # window-half divergence (transition detector)
    trend_strength: float   # |mean / std| of returns (J)
    volatility: float       # std of returns
    confidence: float       # [0, 1] decisiveness of the regime label
    is_transition: bool     # Fisher spike → regime change suspected
    pillar1_gate: bool      # vol > min → fluctuations exist → safe to trade
