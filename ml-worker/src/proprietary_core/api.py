"""FastAPI endpoints for the intelligence layer.

Exposes regime detection, coupling estimation, basin detection,
and the full strategy loop via REST API.

Mounts under the existing FastAPI app in main.py.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .basins import BasinDetector
from .coupling import CouplingEstimator
from .regime import RegimeDetector
from .strategy_loop import StrategyLoop

router = APIRouter(prefix="/intelligence", tags=["Intelligence Layer"])

# Per-symbol state stores (Pillar 3: each symbol gets its own instances)
_regime_detectors: dict[str, RegimeDetector] = {}
_coupling_estimators: dict[str, CouplingEstimator] = {}
_basin_detectors: dict[str, BasinDetector] = {}
_strategy_loops: dict[str, StrategyLoop] = {}


# --- Request/Response models ---

class PriceTick(BaseModel):
    symbol: str = Field(..., description="Trading pair symbol")
    price: float = Field(..., gt=0, description="Current price")


class PriceBatch(BaseModel):
    symbol: str
    prices: list[float] = Field(..., min_length=1)


class CouplingTick(BaseModel):
    symbol: str
    signal_value: float
    pnl_value: float


class LoopTick(BaseModel):
    symbol: str
    price: float = Field(..., gt=0)
    signal_value: float | None = None
    pnl_value: float | None = None
    account_equity: float = 100_000.0
    current_exposure_pct: float = 0.0


# --- Endpoints ---

@router.post("/regime/tick")
def regime_tick(data: PriceTick):
    """Feed a single price tick and get regime classification."""
    if data.symbol not in _regime_detectors:
        _regime_detectors[data.symbol] = RegimeDetector()
    det = _regime_detectors[data.symbol]
    state = det.update(data.price)
    if state is None:
        return {"status": "accumulating", "symbol": data.symbol}
    return {
        "symbol": data.symbol,
        "regime": state.regime.value,
        "entropy": round(state.entropy, 4),
        "fisher_info": round(state.fisher_info, 6),
        "trend_strength": round(state.trend_strength, 4),
        "volatility": round(state.volatility, 8),
        "confidence": round(state.confidence, 4),
        "is_transition": state.is_transition,
        "pillar1_gate": state.pillar1_gate,
    }


@router.post("/regime/batch")
def regime_batch(data: PriceBatch):
    """Feed a batch of prices and get current regime."""
    if data.symbol not in _regime_detectors:
        _regime_detectors[data.symbol] = RegimeDetector()
    det = _regime_detectors[data.symbol]
    state = det.update_batch(data.prices)
    if state is None:
        return {"status": "accumulating", "symbol": data.symbol, "n_prices": len(data.prices)}
    return {
        "symbol": data.symbol,
        "regime": state.regime.value,
        "entropy": round(state.entropy, 4),
        "fisher_info": round(state.fisher_info, 6),
        "trend_strength": round(state.trend_strength, 4),
        "volatility": round(state.volatility, 8),
        "confidence": round(state.confidence, 4),
        "is_transition": state.is_transition,
        "pillar1_gate": state.pillar1_gate,
    }


@router.post("/coupling/tick")
def coupling_tick(data: CouplingTick):
    """Feed a signal/P&L pair and get coupling state."""
    if data.symbol not in _coupling_estimators:
        _coupling_estimators[data.symbol] = CouplingEstimator()
    est = _coupling_estimators[data.symbol]
    state = est.update(data.signal_value, data.pnl_value)
    if state is None:
        return {"status": "accumulating", "symbol": data.symbol}
    return {
        "symbol": data.symbol,
        "kappa": round(state.kappa, 6),
        "r_squared": round(state.r_squared, 4),
        "n_samples": state.n_samples,
        "is_coupled": state.is_coupled,
        "is_inverted": state.is_inverted,
        "stud_crossing": state.stud_crossing,
    }


@router.post("/basins/detect")
def basins_detect(data: PriceBatch):
    """Feed price history and detect support/resistance basins."""
    if data.symbol not in _basin_detectors:
        _basin_detectors[data.symbol] = BasinDetector()
    det = _basin_detectors[data.symbol]
    det.update_batch(data.prices)
    basin_map = det.detect()
    if basin_map is None:
        return {"status": "insufficient_data", "symbol": data.symbol}
    return {
        "symbol": data.symbol,
        "current_price": basin_map.current_price,
        "n_basins": len(basin_map.basins),
        "basins": [
            {
                "level": round(b.level, 8),
                "density": round(b.density, 6),
                "depth": round(b.depth, 6),
                "dwell_fraction": round(b.dwell_fraction, 4),
                "is_support": b.is_support,
                "is_resistance": b.is_resistance,
            }
            for b in basin_map.basins
        ],
        "nearest_support": round(basin_map.nearest_support.level, 8) if basin_map.nearest_support else None,
        "nearest_resistance": round(basin_map.nearest_resistance.level, 8) if basin_map.nearest_resistance else None,
        "n_prices": basin_map.n_prices,
    }


@router.post("/loop/tick")
def loop_tick(data: LoopTick):
    """Full strategy loop: one tick through scan -> feel -> think -> act -> observe."""
    if data.symbol not in _strategy_loops:
        _strategy_loops[data.symbol] = StrategyLoop(symbol=data.symbol)
    loop = _strategy_loops[data.symbol]
    decision = loop.tick(
        price=data.price,
        signal_value=data.signal_value,
        pnl_value=data.pnl_value,
        account_equity=data.account_equity,
        current_exposure_pct=data.current_exposure_pct,
    )
    return decision.to_dict()


@router.get("/loop/{symbol}/recent")
def loop_recent(symbol: str):
    """Get recent decisions for a symbol."""
    if symbol not in _strategy_loops:
        return {"symbol": symbol, "decisions": []}
    loop = _strategy_loops[symbol]
    return {
        "symbol": symbol,
        "decisions": [d.to_dict() for d in loop.recent_decisions],
    }


@router.get("/status")
def intelligence_status():
    """Overview of all active intelligence components."""
    return {
        "active_regime_detectors": list(_regime_detectors.keys()),
        "active_coupling_estimators": list(_coupling_estimators.keys()),
        "active_basin_detectors": list(_basin_detectors.keys()),
        "active_strategy_loops": list(_strategy_loops.keys()),
        "n_symbols_tracked": len(
            set(_regime_detectors.keys())
            | set(_coupling_estimators.keys())
            | set(_basin_detectors.keys())
            | set(_strategy_loops.keys())
        ),
    }


@router.post("/reset/{symbol}")
def reset_symbol(symbol: str):
    """Reset all intelligence state for a symbol."""
    cleared = []
    if symbol in _regime_detectors:
        _regime_detectors[symbol].reset()
        cleared.append("regime")
    if symbol in _coupling_estimators:
        _coupling_estimators[symbol].reset()
        cleared.append("coupling")
    if symbol in _basin_detectors:
        _basin_detectors[symbol].reset()
        cleared.append("basins")
    if symbol in _strategy_loops:
        _strategy_loops[symbol].reset()
        cleared.append("strategy_loop")
    return {"symbol": symbol, "cleared": cleared}
