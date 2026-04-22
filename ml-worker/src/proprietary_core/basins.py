"""Basin detector: identifies support/resistance levels as probability attractors.

Price basins are levels where the price repeatedly returns and dwells.
Implemented via kernel density estimation (KDE) on price history.
Modes of the density = support/resistance levels.
Basin depth = density × dwell time (how "sticky" the level is).

Used for:
  - Stop placement (below the nearest support basin)
  - Target selection (next resistance basin above entry)
  - Regime confirmation (price near a basin mode = Preserver territory)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np


@dataclass
class Basin:
    """A detected price basin (support/resistance level)."""

    level: float  # price level (mode of the KDE)
    density: float  # height of the KDE at this mode
    depth: float  # density × dwell_fraction (how sticky)
    dwell_fraction: float  # fraction of time price spent within bandwidth of level
    is_support: bool  # True if price is currently above this level
    is_resistance: bool  # True if price is currently below this level


@dataclass
class BasinMap:
    """Current basin landscape for a symbol."""

    basins: list[Basin]
    current_price: float
    nearest_support: Optional[Basin]
    nearest_resistance: Optional[Basin]
    n_prices: int  # number of price observations used


@dataclass
class BasinDetector:
    """Detects price basins via kernel density estimation.

    Parameters
    ----------
    window : int
        Number of price observations to use.
    n_eval_points : int
        Number of points to evaluate the KDE at.
    bandwidth_pct : float
        KDE bandwidth as a percentage of price range.
    min_prominence : float
        Minimum peak prominence to count as a basin (fraction of max density).
    """

    window: int = 500
    n_eval_points: int = 200
    bandwidth_pct: float = 0.01
    min_prominence: float = 0.1

    _prices: list[float] = field(default_factory=list)

    def update(self, price: float) -> None:
        """Add a new price observation."""
        self._prices.append(price)
        if len(self._prices) > self.window * 2:
            self._prices = self._prices[-self.window :]

    def update_batch(self, prices: list[float]) -> None:
        """Add a batch of price observations."""
        self._prices.extend(prices)
        if len(self._prices) > self.window * 2:
            self._prices = self._prices[-self.window :]

    def detect(self, current_price: Optional[float] = None) -> Optional[BasinMap]:
        """Run basin detection on accumulated prices."""
        prices = np.array(self._prices[-self.window :])
        n = len(prices)
        if n < 20:
            return None

        if current_price is None:
            current_price = float(prices[-1])

        p_min, p_max = float(np.min(prices)), float(np.max(prices))
        p_range = p_max - p_min
        if p_range < 1e-12:
            return None

        # KDE with Gaussian kernel
        bandwidth = p_range * self.bandwidth_pct
        if bandwidth < 1e-12:
            bandwidth = p_range * 0.01

        eval_points = np.linspace(p_min - bandwidth * 2, p_max + bandwidth * 2, self.n_eval_points)
        density = np.zeros(self.n_eval_points)

        for p in prices:
            density += np.exp(-0.5 * ((eval_points - p) / bandwidth) ** 2)
        density /= n * bandwidth * np.sqrt(2 * np.pi)

        # Find peaks (local maxima)
        peaks = self._find_peaks(density, eval_points)

        if not peaks:
            return BasinMap(
                basins=[], current_price=current_price,
                nearest_support=None, nearest_resistance=None, n_prices=n,
            )

        # Filter by prominence
        max_density = max(p[1] for p in peaks)
        prominent_peaks = [
            (level, dens) for level, dens in peaks
            if dens > max_density * self.min_prominence
        ]

        # Build Basin objects with dwell fraction
        basins = []
        for level, dens in prominent_peaks:
            # Dwell fraction: what fraction of prices are within 1 bandwidth of this level
            in_basin = np.sum(np.abs(prices - level) < bandwidth) / n
            depth = dens * in_basin

            basins.append(Basin(
                level=level,
                density=dens,
                depth=depth,
                dwell_fraction=in_basin,
                is_support=current_price > level,
                is_resistance=current_price < level,
            ))

        # Sort by level
        basins.sort(key=lambda b: b.level)

        # Find nearest support and resistance
        supports = [b for b in basins if b.is_support]
        resistances = [b for b in basins if b.is_resistance]

        nearest_support = max(supports, key=lambda b: b.level) if supports else None
        nearest_resistance = min(resistances, key=lambda b: b.level) if resistances else None

        return BasinMap(
            basins=basins,
            current_price=current_price,
            nearest_support=nearest_support,
            nearest_resistance=nearest_resistance,
            n_prices=n,
        )

    def _find_peaks(self, density: np.ndarray, eval_points: np.ndarray) -> list[tuple[float, float]]:
        """Find local maxima in the density curve."""
        peaks = []
        for i in range(1, len(density) - 1):
            if density[i] > density[i - 1] and density[i] > density[i + 1]:
                peaks.append((float(eval_points[i]), float(density[i])))
        return peaks

    def reset(self) -> None:
        """Clear all internal state."""
        self._prices.clear()
