"""Proprietary Core — ML and intelligence layer for Poloniex Trading Platform.

Modules:
    regime   — Market regime detector (Creator/Preserver/Dissolver)
    coupling — Strategy coupling estimator (κ, R²)
    sizing   — Adaptive position sizing based on regime + coupling
    models   — Pydantic models for API validation
"""

from .regime import MarketRegime, RegimeDetector, RegimeState
from .coupling import CouplingEstimator, CouplingState
from .sizing import AdaptiveSizer, SizeDecision

__all__ = [
    "MarketRegime",
    "RegimeDetector",
    "RegimeState",
    "CouplingEstimator",
    "CouplingState",
    "AdaptiveSizer",
    "SizeDecision",
]
