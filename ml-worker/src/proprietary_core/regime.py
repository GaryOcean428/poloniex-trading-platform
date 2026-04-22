"""Market regime detector using information-geometric principles.

Three regimes mapped from QIG three-sphere framework:
  - Creator:   High entropy, high Fisher information. Volatile, price discovery.
               Momentum/breakout strategies work here.
  - Preserver:  Low entropy, trend present. Orderly, coupled.
               Trend-follow / mean-reversion strategies work here.
  - Dissolver:  Low entropy, no trend. Dead market, noise dominates.
               Best strategy: DON'T TRADE (Pillar 1 gate).

The regime detector uses Shannon entropy of discretised price returns
and Fisher information (sensitivity of the return distribution to
time-window shifts) to classify the current market state.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import numpy as np


class MarketRegime(str, Enum):
    """Three qualitatively different market states."""

    CREATOR = "creator"  # volatile, price discovery, high entropy
    PRESERVER = "preserver"  # trending, orderly, low entropy + trend
    DISSOLVER = "dissolver"  # dead, noise, low entropy + no trend


@dataclass
class RegimeState:
    """Current regime classification with supporting metrics."""

    regime: MarketRegime
    entropy: float  # Shannon entropy of return distribution
    fisher_info: float  # Fisher information (sensitivity to shift)
    trend_strength: float  # absolute value of mean return / std
    volatility: float  # standard deviation of returns
    confidence: float  # 0-1, how clearly the regime is identified
    is_transition: bool  # True if Fisher info suggests regime change
    pillar1_gate: bool  # True = safe to trade (T > 0, fluctuations exist)


@dataclass
class RegimeDetector:
    """Classifies market regime from price returns.

    Parameters
    ----------
    window : int
        Number of returns to use for regime calculation.
    n_bins : int
        Number of bins for discretising the return distribution.
    entropy_threshold : float
        Boundary between high and low entropy regimes.
    trend_threshold : float
        Minimum |mean/std| to classify as trending (Preserver vs Dissolver).
    fisher_spike_mult : float
        Fisher info > fisher_spike_mult × rolling_mean triggers transition alert.
    min_volatility : float
        Below this, Pillar 1 gate closes (no fluctuations = no geometry).
    """

    window: int = 100
    n_bins: int = 20
    entropy_threshold: float = 2.5
    trend_threshold: float = 0.15
    fisher_spike_mult: float = 2.0
    min_volatility: float = 1e-8

    # Internal state
    _returns: deque = field(default_factory=lambda: deque(maxlen=200))
    _fisher_history: deque = field(default_factory=lambda: deque(maxlen=50))
    _last_price: Optional[float] = field(default=None)

    def update(self, price: float) -> Optional[RegimeState]:
        """Feed a new price tick. Returns RegimeState once enough data exists."""
        if self._last_price is not None and self._last_price > 0:
            ret = (price - self._last_price) / self._last_price
            self._returns.append(ret)
        self._last_price = price

        if len(self._returns) < self.window:
            return None

        return self._classify()

    def update_batch(self, prices: list[float]) -> Optional[RegimeState]:
        """Feed a batch of prices. Returns final RegimeState."""
        state = None
        for p in prices:
            state = self.update(p)
        return state

    def _classify(self) -> RegimeState:
        """Core classification logic."""
        returns = np.array(list(self._returns))[-self.window :]

        # Basic statistics
        vol = float(np.std(returns))
        mean_ret = float(np.mean(returns))
        trend_strength = abs(mean_ret) / max(vol, 1e-12)

        # Pillar 1 gate: no fluctuations = no geometry = don't trade
        pillar1 = vol > self.min_volatility

        # Shannon entropy of discretised return distribution
        entropy = self._compute_entropy(returns)

        # Fisher information: sensitivity of distribution to window shift
        fisher = self._compute_fisher_info(returns)
        self._fisher_history.append(fisher)

        # Transition detection: Fisher spike above rolling mean
        fisher_mean = float(np.mean(list(self._fisher_history)))
        is_transition = fisher > self.fisher_spike_mult * max(fisher_mean, 1e-12)

        # Regime classification
        if entropy > self.entropy_threshold:
            regime = MarketRegime.CREATOR
            confidence = min(1.0, (entropy - self.entropy_threshold) / self.entropy_threshold)
        elif trend_strength > self.trend_threshold:
            regime = MarketRegime.PRESERVER
            confidence = min(1.0, trend_strength / (self.trend_threshold * 3))
        else:
            regime = MarketRegime.DISSOLVER
            confidence = min(
                1.0,
                (self.trend_threshold - trend_strength) / self.trend_threshold,
            )

        return RegimeState(
            regime=regime,
            entropy=entropy,
            fisher_info=fisher,
            trend_strength=trend_strength,
            volatility=vol,
            confidence=confidence,
            is_transition=is_transition,
            pillar1_gate=pillar1,
        )

    def _compute_entropy(self, returns: np.ndarray) -> float:
        """Shannon entropy of the discretised return distribution."""
        if len(returns) < 2:
            return 0.0

        # Adaptive binning: use range of actual data
        r_min, r_max = float(np.min(returns)), float(np.max(returns))
        if r_max - r_min < 1e-15:
            return 0.0  # all returns identical = zero entropy

        counts, _ = np.histogram(returns, bins=self.n_bins, range=(r_min, r_max))
        probs = counts / counts.sum()
        probs = probs[probs > 0]  # remove zeros for log

        return float(-np.sum(probs * np.log2(probs)))

    def _compute_fisher_info(self, returns: np.ndarray) -> float:
        """Fisher information: sensitivity of distribution to window shift.

        Computed as the squared difference between two adjacent
        half-window distributions, normalised. A spike indicates
        the return distribution is changing rapidly = regime boundary.
        """
        n = len(returns)
        if n < 10:
            return 0.0

        mid = n // 2
        first_half = returns[:mid]
        second_half = returns[mid:]

        r_min = float(min(np.min(first_half), np.min(second_half)))
        r_max = float(max(np.max(first_half), np.max(second_half)))
        if r_max - r_min < 1e-15:
            return 0.0

        bins = np.linspace(r_min, r_max, self.n_bins + 1)
        p1, _ = np.histogram(first_half, bins=bins)
        p2, _ = np.histogram(second_half, bins=bins)

        # Normalise to probability distributions
        p1 = p1.astype(float)
        p2 = p2.astype(float)
        s1, s2 = p1.sum(), p2.sum()
        if s1 < 1 or s2 < 1:
            return 0.0
        p1 /= s1
        p2 /= s2

        # Fisher-like divergence: sum of (p2 - p1)^2 / (p1 + eps)
        # This measures how much the distribution shifted between halves
        eps = 1e-12
        fisher = float(np.sum((p2 - p1) ** 2 / (0.5 * (p1 + p2) + eps)))
        return fisher

    def reset(self) -> None:
        """Clear all internal state."""
        self._returns.clear()
        self._fisher_history.clear()
        self._last_price = None
