"""Proprietary Core — intelligence layer for the Poloniex Trading Platform.

MIG-2 (2026-05-16): bespoke RegimeDetector deleted; regime classification
is now ``regime_adapter.RegimeAdapter`` wrapping the canonical
``regime_qigwarp.classify_with_qig_warp`` (qig_warp.classify_regime).

Modules:
    regime          — MarketRegime enum + RegimeState dataclass
    regime_adapter  — Stateful per-symbol qig_warp wrapper (drop-in for
                      the deleted RegimeDetector)
    regime_qigwarp  — Canonical qig_warp regime classifier + mapping
    lattice_inputs  — (h, J) computation from log returns
    coupling        — Strategy coupling estimator (κ, R²)
    sizing          — Adaptive position sizing based on regime + coupling
"""

from .coupling import CouplingEstimator, CouplingState
from .regime import MarketRegime, RegimeState
from .regime_adapter import RegimeAdapter
from .sizing import AdaptiveSizer, SizeDecision

__all__ = [
    "MarketRegime",
    "RegimeAdapter",
    "RegimeState",
    "CouplingEstimator",
    "CouplingState",
    "AdaptiveSizer",
    "SizeDecision",
]
