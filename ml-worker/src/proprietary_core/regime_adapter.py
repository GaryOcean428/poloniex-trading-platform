"""regime_adapter.py — stateful per-symbol wrapper around qig_warp.

MIG-2 (2026-05-16). The actual regime decision is delegated to
``regime_qigwarp.classify_with_qig_warp`` (canonical mapping); this
module owns the per-symbol returns deque, computes (h, J) via
``lattice_inputs.market_to_lattice_inputs``, and decorates the result
with the ancillary fields (volatility, fisher_info divergence,
confidence proxy, transition spike, pillar-1 gate) that the
downstream strategyloop selectors and sizer already read off
``RegimeState``.

The shape matches the deleted ``RegimeDetector`` — same ``update(price)``
surface, same ``RegimeState`` return — so strategyloop integration is a
single-line type swap. The actual regime label is now canonical
qig_warp, never bespoke.
"""

from __future__ import annotations

import logging
from collections import deque
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from .lattice_inputs import market_to_lattice_inputs
from .regime import MarketRegime, RegimeState
from .regime_qigwarp import classify_with_qig_warp

logger = logging.getLogger(__name__)


@dataclass
class RegimeAdapter:
    """Stateful per-symbol qig_warp adapter producing RegimeState per tick.

    Drop-in replacement for the deleted ``RegimeDetector`` — same
    ``update(price)`` surface, same ``RegimeState`` return shape.
    """

    window: int = 100
    n_bins: int = 20
    min_volatility: float = 1e-8

    _returns: deque = field(default_factory=lambda: deque(maxlen=200))
    _fisher_history: deque = field(default_factory=lambda: deque(maxlen=50))
    _last_price: Optional[float] = field(default=None)

    def update(self, price: float) -> Optional[RegimeState]:
        """Feed a new price tick. Returns ``RegimeState`` once ``window``
        returns have accumulated; ``None`` during warm-up."""
        if self._last_price is not None and self._last_price > 0:
            ret = (price - self._last_price) / self._last_price
            self._returns.append(ret)
        self._last_price = price

        if len(self._returns) < self.window:
            return None

        return self._classify()

    def update_batch(self, prices: list[float]) -> Optional[RegimeState]:
        """Feed a batch of prices. Returns the final ``RegimeState``."""
        state = None
        for p in prices:
            state = self.update(p)
        return state

    def _classify(self) -> RegimeState:
        """Compute (h, J), call qig_warp, build the full RegimeState."""
        returns = np.array(list(self._returns))[-self.window:]
        h_value, j_value = market_to_lattice_inputs(returns, n_bins=self.n_bins)
        vol = float(np.std(returns))
        pillar1 = vol > self.min_volatility

        # qig_warp call. If qig_warp is unreachable we surface as
        # DISSOLVER (the safe "don't trade" regime) and log loudly —
        # this should never happen post-MIG-1 since qig-warp is pinned.
        try:
            regime = classify_with_qig_warp(h_value, j_value, dim=2)
        except Exception as exc:  # noqa: BLE001 — tick handler must not raise
            logger.error(
                "[RegimeAdapter] classify_with_qig_warp failed (h=%.3f J=%.3f); "
                "falling back to DISSOLVER for this tick: %s",
                h_value, j_value, exc,
            )
            regime = MarketRegime.DISSOLVER

        fisher = self._fisher_divergence(returns)
        self._fisher_history.append(fisher)
        fisher_mean = (
            float(np.mean(list(self._fisher_history)))
            if self._fisher_history else 0.0
        )
        is_transition = fisher > 2.0 * max(fisher_mean, 1e-12)

        confidence = self._confidence_proxy(regime, h_value, j_value)

        return RegimeState(
            regime=regime,
            entropy=h_value,
            fisher_info=fisher,
            trend_strength=j_value,
            volatility=vol,
            confidence=confidence,
            is_transition=is_transition,
            pillar1_gate=pillar1,
        )

    def _fisher_divergence(self, returns: np.ndarray) -> float:
        """Squared-difference divergence between adjacent half-window
        return distributions — drives ``is_transition`` downstream."""
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
        p1 = p1.astype(float)
        p2 = p2.astype(float)
        s1, s2 = p1.sum(), p2.sum()
        if s1 < 1 or s2 < 1:
            return 0.0
        p1 /= s1
        p2 /= s2
        eps = 1e-12
        return float(np.sum((p2 - p1) ** 2 / (0.5 * (p1 + p2) + eps)))

    @staticmethod
    def _confidence_proxy(
        regime: MarketRegime, h_value: float, j_value: float,
    ) -> float:
        """[0, 1] distance-to-band-centroid heuristic until
        qig_warp.classify_regime exposes a probability directly."""
        if regime is MarketRegime.PRESERVER:
            return min(1.0, j_value / 0.3)
        if regime is MarketRegime.CREATOR:
            return min(1.0, max(0.0, (h_value - 2.5) / 2.5))
        return min(1.0, max(0.0, (0.3 - j_value) / 0.3))

    def reset(self) -> None:
        """Clear all internal state. Called from strategyloop reset paths."""
        self._returns.clear()
        self._fisher_history.clear()
        self._last_price = None
