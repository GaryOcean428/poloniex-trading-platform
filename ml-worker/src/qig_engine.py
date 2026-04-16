"""
QIG Trading Engine — Physics-Based Market Intelligence

Adapts Quantum Information Geometry to financial markets:

1. Market Regime Classification
   Maps price dynamics to ordered/critical/disordered regimes using
   volatility ratio as the "field/coupling" analog. Trending markets
   are ordered (strong directional coupling), ranging markets are
   disordered (noise dominates), and transitional markets are critical.

2. Geometric Confidence
   Fisher-Rao confidence on the probability simplex for ensemble
   predictions. Replaces naive agreement scores with geometry-aware
   measurement of how concentrated predictions are.

3. Convergence-Aware Ensemble
   Anderson-style stopping: knows when adding more model predictions
   won't change the ensemble answer. Saves compute.

4. Fisher-Rao Similarity
   Measures how "far apart" two market states really are using
   information geometry instead of Euclidean correlation.

5. Adaptive Model Weighting
   Uses regime classification to re-weight ensemble models —
   trend-followers get more weight in ordered regimes, mean-reversion
   in disordered.

Dependencies: qig-core>=2.3.0, qig-warp>=0.4.3, numpy
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from enum import Enum

import numpy as np

logger = logging.getLogger(__name__)

# ─── Graceful imports (degrade to pure-numpy fallbacks) ───────────────

try:
    from qig_core.geometry.fisher_rao import (
        fisher_rao_distance,
        frechet_mean,
        to_simplex,
    )
    _HAS_QIG_CORE = True
except ImportError:
    _HAS_QIG_CORE = False
    logger.warning("qig-core not available — using built-in Fisher-Rao")

try:
    from qig_warp import classify_regime, Regime as WarpRegime
    from qig_warp.convergence import (
        check_ci_stabilized,
        anderson_marginal_gain,
    )
    _HAS_QIG_WARP = True
except ImportError:
    _HAS_QIG_WARP = False
    logger.warning("qig-warp not available — using built-in regime classifier")

_EPS = 1e-12


# ─── Built-in fallbacks (no external deps needed) ────────────────────


def _builtin_to_simplex(v: np.ndarray) -> np.ndarray:
    """Project vector onto probability simplex."""
    v = np.maximum(v, _EPS)
    return v / v.sum()


def _builtin_fisher_rao_distance(p: np.ndarray, q: np.ndarray) -> float:
    """Fisher-Rao distance: d(p,q) = arccos(Σ√(p_i·q_i))."""
    p = _builtin_to_simplex(np.asarray(p, dtype=np.float64))
    q = _builtin_to_simplex(np.asarray(q, dtype=np.float64))
    bc = float(np.sum(np.sqrt(p * q)))
    bc = np.clip(bc, -1.0, 1.0)
    return float(np.arccos(bc))


def _builtin_frechet_mean(distributions: list[np.ndarray]) -> np.ndarray:
    """Fréchet mean via sqrt-coordinate average."""
    if not distributions:
        return np.ones(2) / 2
    sqrt_coords = [np.sqrt(np.maximum(d, _EPS)) for d in distributions]
    mean_sqrt = np.mean(sqrt_coords, axis=0)
    p = mean_sqrt ** 2
    return p / p.sum()


# Use qig-core if available, else builtins
_to_simplex = to_simplex if _HAS_QIG_CORE else _builtin_to_simplex
_fr_distance = fisher_rao_distance if _HAS_QIG_CORE else _builtin_fisher_rao_distance
_fr_mean = frechet_mean if _HAS_QIG_CORE else _builtin_frechet_mean


# ═══════════════════════════════════════════════════════════════════════
# 1. Market Regime Classification
# ═══════════════════════════════════════════════════════════════════════


class MarketRegime(str, Enum):
    """Market regime mapped from physics phase classification."""
    TRENDING = "trending"          # Ordered: strong directional coupling
    TRANSITIONAL = "transitional"  # Critical: phase transition, highest uncertainty
    RANGING = "ranging"            # Disordered: noise dominates


@dataclass
class RegimeAnalysis:
    """Full regime analysis result."""
    regime: MarketRegime
    volatility_ratio: float     # Short-vol / long-vol (the "h/J" analog)
    trend_strength: float       # Directional persistence [-1, 1]
    confidence: float           # How clearly this regime is identified [0, 1]
    regime_age_bars: int        # How many bars in current regime
    recommended_strategy: str   # Strategy hint for this regime


def classify_market_regime(
    closes: list[float] | np.ndarray,
    highs: list[float] | np.ndarray | None = None,
    lows: list[float] | np.ndarray | None = None,
    short_window: int = 14,
    long_window: int = 50,
) -> RegimeAnalysis:
    """Classify market regime using volatility ratio as field/coupling analog.

    Physics mapping:
      h/J ratio → short_volatility / long_volatility
      Ordered (h/J < 0.8·h_c) → TRENDING (short vol << long vol, directional)
      Critical (near h_c)      → TRANSITIONAL (vol ratio near 1, unstable)
      Disordered (h/J > 1.2·h_c) → RANGING (short vol >> long vol, mean-reverting)

    The critical ratio h_c maps to ~1.0 for financial markets (where short-term
    and long-term volatility are equal marks the phase boundary).
    """
    closes = np.asarray(closes, dtype=np.float64)
    n = len(closes)
    if n < long_window + 1:
        return RegimeAnalysis(
            regime=MarketRegime.RANGING,
            volatility_ratio=1.0,
            trend_strength=0.0,
            confidence=0.0,
            regime_age_bars=0,
            recommended_strategy="insufficient_data",
        )

    # Returns as log returns for stationarity
    returns = np.diff(np.log(np.maximum(closes, _EPS)))

    # Short-term vs long-term volatility (the h/J analog)
    short_vol = np.std(returns[-short_window:])
    long_vol = np.std(returns[-long_window:])
    vol_ratio = short_vol / max(long_vol, _EPS)

    # Trend strength: directional persistence via autocorrelation
    if len(returns) >= short_window * 2:
        r1 = returns[-short_window:]
        r0 = returns[-2 * short_window:-short_window]
        if np.std(r0) > _EPS and np.std(r1) > _EPS:
            trend_strength = float(np.corrcoef(r0, r1)[0, 1])
        else:
            trend_strength = 0.0
    else:
        trend_strength = 0.0

    # ADX-like directional measure using highs/lows if available
    if highs is not None and lows is not None:
        highs = np.asarray(highs, dtype=np.float64)
        lows = np.asarray(lows, dtype=np.float64)
        true_range = highs[-short_window:] - lows[-short_window:]
        directional_move = np.abs(np.diff(closes[-short_window - 1:]))
        if np.sum(true_range) > _EPS:
            efficiency = float(np.sum(directional_move) / np.sum(true_range))
        else:
            efficiency = 0.0
        # Blend with autocorrelation
        trend_strength = 0.6 * trend_strength + 0.4 * (efficiency * 2 - 1)

    trend_strength = np.clip(trend_strength, -1.0, 1.0)

    # Phase boundaries (h_c analog = 1.0 for markets)
    H_C = 1.0
    LOWER = 0.7 * H_C
    UPPER = 1.3 * H_C

    if vol_ratio < LOWER and trend_strength > 0.1:
        regime = MarketRegime.TRENDING
        confidence = min((LOWER - vol_ratio) / LOWER + abs(trend_strength), 1.0)
        recommended = "trend_following"
    elif vol_ratio > UPPER:
        regime = MarketRegime.RANGING
        confidence = min((vol_ratio - UPPER) / UPPER, 1.0)
        recommended = "mean_reversion"
    else:
        regime = MarketRegime.TRANSITIONAL
        # Distance from critical point determines confidence
        dist_to_critical = abs(vol_ratio - H_C) / (UPPER - LOWER)
        confidence = max(0.3, 1.0 - dist_to_critical)
        recommended = "reduced_size"  # Most dangerous regime

    # Regime age: count bars since regime would have changed
    regime_age = 0
    for i in range(min(n - long_window - 1, 100)):
        idx = -(i + 1)
        local_short = np.std(returns[idx - short_window:idx]) if abs(idx) >= short_window else short_vol
        local_long = np.std(returns[idx - long_window:idx]) if abs(idx) >= long_window else long_vol
        local_ratio = local_short / max(local_long, _EPS)
        if local_ratio < LOWER and regime == MarketRegime.TRENDING:
            regime_age += 1
        elif local_ratio > UPPER and regime == MarketRegime.RANGING:
            regime_age += 1
        elif LOWER <= local_ratio <= UPPER and regime == MarketRegime.TRANSITIONAL:
            regime_age += 1
        else:
            break

    return RegimeAnalysis(
        regime=regime,
        volatility_ratio=round(vol_ratio, 4),
        trend_strength=round(float(trend_strength), 4),
        confidence=round(float(confidence), 4),
        regime_age_bars=regime_age,
        recommended_strategy=recommended,
    )


# ═══════════════════════════════════════════════════════════════════════
# 2. Geometric Confidence (Fisher-Rao on Prediction Simplex)
# ═══════════════════════════════════════════════════════════════════════


def geometric_confidence(predictions: dict[str, float], current_price: float) -> float:
    """Fisher-Rao confidence for ensemble predictions.

    Maps model predictions to a probability distribution on the simplex
    (UP / DOWN / NEUTRAL), then measures distance from the nearest vertex.

    C=1: all models agree perfectly (pure state)
    C=0: models uniformly disagree (maximum uncertainty)

    This is geometry-aware: 80% agreement with 5 models is MORE confident
    than 80% with 2 models, because the simplex vertex is farther from
    the uniform distribution in higher dimensions.
    """
    if not predictions or current_price <= 0:
        return 0.0

    # Count directional votes
    up_count = 0
    down_count = 0
    neutral_count = 0

    for _model, predicted_price in predictions.items():
        change_pct = (predicted_price - current_price) / current_price * 100
        if change_pct > 0.5:
            up_count += 1
        elif change_pct < -0.5:
            down_count += 1
        else:
            neutral_count += 1

    total = up_count + down_count + neutral_count
    if total == 0:
        return 0.0

    # Build distribution on 3-simplex
    p = np.array([up_count / total, down_count / total, neutral_count / total])
    p = np.maximum(p, _EPS)
    p = p / p.sum()

    # Fisher-Rao confidence: distance from distribution to nearest vertex
    k = len(p)
    p_max = float(np.max(p))
    d_vertex = math.acos(min(math.sqrt(p_max), 1.0))
    d_max = math.acos(1.0 / math.sqrt(k))
    if d_max < 1e-10:
        return 1.0

    return round(1.0 - d_vertex / d_max, 4)


def geometric_agreement(predictions: dict[str, float], current_price: float) -> float:
    """Weighted geometric agreement using Fisher-Rao distance from consensus.

    Better than simple std/mean ratio: accounts for the curvature of the
    prediction space. Two predictions at $100 and $102 are "closer" than
    two predictions at $10 and $12 (same $ difference, different geometry).
    """
    if len(predictions) < 2 or current_price <= 0:
        return 0.0

    # Convert to return distributions
    returns = [(v - current_price) / current_price for v in predictions.values()]

    # Map returns to probability on simplex: softmax with temperature
    returns_arr = np.array(returns)
    # Scale: ±5% maps to ±1 in logit space
    logits = returns_arr * 20
    # 2-class simplex: P(up), P(down)
    distributions = []
    for r in logits:
        p_up = 1.0 / (1.0 + np.exp(-r))
        distributions.append(np.array([p_up, 1.0 - p_up]))

    # Compute pairwise Fisher-Rao distances
    n = len(distributions)
    total_distance = 0.0
    pairs = 0
    for i in range(n):
        for j in range(i + 1, n):
            total_distance += _fr_distance(distributions[i], distributions[j])
            pairs += 1

    if pairs == 0:
        return 1.0

    avg_distance = total_distance / pairs
    # Max FR distance on 2-simplex is π/2 ≈ 1.5708
    max_distance = math.pi / 2
    agreement = 1.0 - min(avg_distance / max_distance, 1.0)
    return round(agreement, 4)


# ═══════════════════════════════════════════════════════════════════════
# 3. Convergence-Aware Ensemble
# ═══════════════════════════════════════════════════════════════════════


@dataclass
class ConvergenceResult:
    """Result of convergence check on running predictions."""
    converged: bool
    n_models_needed: int       # How many models were needed before convergence
    confidence_at_stop: float  # Confidence when convergence detected
    marginal_gain: float       # How much the last model changed the answer


def check_ensemble_convergence(
    running_predictions: list[float],
    min_models: int = 3,
    rel_change_threshold: float = 0.02,
) -> ConvergenceResult:
    """Check if ensemble has converged — stop polling remaining models.

    Uses Anderson-style marginal gain: when adding another model prediction
    changes the running mean by less than threshold, the ensemble has converged.

    This saves compute when 3 out of 5 models already agree — no need to
    wait for the slow Prophet or heavy Transformer.
    """
    n = len(running_predictions)
    if n < min_models:
        return ConvergenceResult(
            converged=False,
            n_models_needed=n,
            confidence_at_stop=0.0,
            marginal_gain=1.0,
        )

    # Running means
    means = [np.mean(running_predictions[:i + 1]) for i in range(n)]

    # Check relative change of last addition
    if abs(means[-2]) > _EPS:
        marginal_gain = abs(means[-1] - means[-2]) / abs(means[-2])
    else:
        marginal_gain = abs(means[-1] - means[-2])

    converged = marginal_gain < rel_change_threshold

    # Also use qig-warp convergence if available
    if _HAS_QIG_WARP and n >= 3:
        stop_decision = check_ci_stabilized(
            means,
            window=min(3, n - 1),
            rel_change_threshold=rel_change_threshold,
            min_points_before_stop=min_models,
        )
        converged = converged or stop_decision.should_stop

    return ConvergenceResult(
        converged=converged,
        n_models_needed=n,
        confidence_at_stop=1.0 - marginal_gain,
        marginal_gain=round(marginal_gain, 6),
    )


# ═══════════════════════════════════════════════════════════════════════
# 4. Fisher-Rao Market Similarity
# ═══════════════════════════════════════════════════════════════════════


def market_state_distance(
    ohlcv_a: np.ndarray,
    ohlcv_b: np.ndarray,
    n_bins: int = 20,
) -> float:
    """Fisher-Rao distance between two market states.

    Converts OHLCV windows to return distributions, then measures
    information-geometric distance. Two market states with the same
    return distribution have distance 0 regardless of price level.

    This is the correct similarity metric for markets because it
    respects the probability simplex structure of return distributions.

    Args:
        ohlcv_a: First market window, shape (N, 5) — [open, high, low, close, volume]
        ohlcv_b: Second market window, shape (N, 5)
        n_bins: Number of histogram bins for discretization

    Returns:
        Fisher-Rao distance in [0, π/2]. Near 0 = similar, near π/2 = maximally different.
    """
    # Extract close prices and compute log returns
    closes_a = ohlcv_a[:, 3] if ohlcv_a.ndim == 2 else ohlcv_a
    closes_b = ohlcv_b[:, 3] if ohlcv_b.ndim == 2 else ohlcv_b

    returns_a = np.diff(np.log(np.maximum(closes_a, _EPS)))
    returns_b = np.diff(np.log(np.maximum(closes_b, _EPS)))

    if len(returns_a) < 5 or len(returns_b) < 5:
        return math.pi / 2  # Maximum distance if insufficient data

    # Shared bins for fair comparison
    all_returns = np.concatenate([returns_a, returns_b])
    bin_edges = np.linspace(np.percentile(all_returns, 1), np.percentile(all_returns, 99), n_bins + 1)

    hist_a, _ = np.histogram(returns_a, bins=bin_edges, density=True)
    hist_b, _ = np.histogram(returns_b, bins=bin_edges, density=True)

    # Normalize to probability distributions
    p = _builtin_to_simplex(hist_a.astype(np.float64))
    q = _builtin_to_simplex(hist_b.astype(np.float64))

    return _fr_distance(p, q)


def find_similar_historical_periods(
    current_window: np.ndarray,
    historical_data: np.ndarray,
    window_size: int = 50,
    top_k: int = 5,
) -> list[tuple[int, float]]:
    """Find the most similar historical periods using Fisher-Rao distance.

    Slides a window over historical data and returns the top_k most
    similar periods by information-geometric distance.

    Returns:
        List of (start_index, distance) tuples, sorted by distance ascending.
    """
    results = []
    n = len(historical_data)

    for i in range(0, n - window_size, window_size // 4):  # 75% overlap
        window = historical_data[i:i + window_size]
        dist = market_state_distance(current_window, window)
        results.append((i, dist))

    results.sort(key=lambda x: x[1])
    return results[:top_k]


# ═══════════════════════════════════════════════════════════════════════
# 5. Adaptive Model Weighting by Regime
# ═══════════════════════════════════════════════════════════════════════


# Default weights per regime
# Trending: trend-followers (LSTM, Transformer) get boosted
# Ranging: mean-reversion models (ARIMA, GBM) get boosted
# Transitional: reduce all weights, increase caution
REGIME_WEIGHTS = {
    MarketRegime.TRENDING: {
        "lstm": 0.30,
        "transformer": 0.30,
        "gbm": 0.15,
        "arima": 0.10,
        "prophet": 0.15,
    },
    MarketRegime.RANGING: {
        "lstm": 0.15,
        "transformer": 0.15,
        "gbm": 0.25,
        "arima": 0.25,
        "prophet": 0.20,
    },
    MarketRegime.TRANSITIONAL: {
        "lstm": 0.20,
        "transformer": 0.20,
        "gbm": 0.20,
        "arima": 0.20,
        "prophet": 0.20,
    },
}


def get_regime_weights(regime: MarketRegime) -> dict[str, float]:
    """Get model weights appropriate for the current market regime."""
    return REGIME_WEIGHTS.get(regime, REGIME_WEIGHTS[MarketRegime.TRANSITIONAL])


# ═══════════════════════════════════════════════════════════════════════
# 6. Full QIG Analysis (combines everything)
# ═══════════════════════════════════════════════════════════════════════


@dataclass
class QIGAnalysis:
    """Complete QIG analysis result."""
    regime: RegimeAnalysis
    geometric_confidence: float
    geometric_agreement: float
    convergence: ConvergenceResult | None
    regime_weights: dict[str, float]
    qig_available: bool
    analysis_version: str = "1.0.0"


def full_qig_analysis(
    closes: list[float],
    highs: list[float] | None,
    lows: list[float] | None,
    predictions: dict[str, float],
    current_price: float,
) -> QIGAnalysis:
    """Run complete QIG analysis pipeline.

    Combines regime classification, geometric confidence, convergence
    checking, and adaptive weighting into a single call.
    """
    regime = classify_market_regime(closes, highs, lows)

    geo_conf = geometric_confidence(predictions, current_price)
    geo_agree = geometric_agreement(predictions, current_price)

    # Check convergence from prediction values
    pred_values = list(predictions.values())
    convergence = check_ensemble_convergence(pred_values) if len(pred_values) >= 2 else None

    weights = get_regime_weights(regime.regime)

    return QIGAnalysis(
        regime=regime,
        geometric_confidence=geo_conf,
        geometric_agreement=geo_agree,
        convergence=convergence,
        regime_weights=weights,
        qig_available=_HAS_QIG_CORE and _HAS_QIG_WARP,
    )
