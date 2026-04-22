"""Coupling estimator: measures how strongly a strategy is connected to the market.

Based on the QIG constitutive law G = κT:
  - κ = slope of regression between signal changes (ΔG) and P&L changes (ΔT)
  - R² = coupling quality (is the strategy actually connected to the market?)
  - κ > 0: strategy is positively coupled (signal predicts P&L direction)
  - κ < 0: strategy is INVERSELY coupled (signal predicts OPPOSITE of P&L)
  - κ ≈ 0: strategy is decoupled (signal has no predictive power)

The stud crossing (κ passing through zero) is the most important signal:
it means the strategy's relationship with the market has fundamentally changed.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Optional

import numpy as np


@dataclass
class CouplingState:
    """Current coupling measurement."""

    kappa: float  # regression slope (coupling coefficient)
    r_squared: float  # regression quality (0-1)
    n_samples: int  # number of data points in window
    is_coupled: bool  # True if R² > threshold and κ > 0
    is_inverted: bool  # True if κ < 0 significantly
    stud_crossing: bool  # True if κ just changed sign
    signal_mean: float
    pnl_mean: float


@dataclass
class CouplingEstimator:
    """Rolling regression between strategy signals and P&L outcomes.

    Parameters
    ----------
    window : int
        Number of signal/P&L pairs to use for regression.
    min_samples : int
        Minimum pairs needed before producing a CouplingState.
    r2_threshold : float
        Below this R², the strategy is considered decoupled.
    kappa_sign_threshold : float
        κ must cross this magnitude to count as a sign change (prevents noise).
    """

    window: int = 50
    min_samples: int = 10
    r2_threshold: float = 0.3
    kappa_sign_threshold: float = 0.01

    _signals: deque = field(default_factory=lambda: deque(maxlen=100))
    _pnls: deque = field(default_factory=lambda: deque(maxlen=100))
    _last_kappa_sign: Optional[int] = field(default=None)  # +1, -1, or None

    def update(self, signal_value: float, pnl_value: float) -> Optional[CouplingState]:
        """Add a new signal/P&L observation and compute coupling."""
        self._signals.append(signal_value)
        self._pnls.append(pnl_value)

        if len(self._signals) < self.min_samples:
            return None

        return self._compute()

    def _compute(self) -> CouplingState:
        """Ordinary least squares regression: P&L = κ × signal + intercept."""
        signals = np.array(list(self._signals))[-self.window :]
        pnls = np.array(list(self._pnls))[-self.window :]
        n = len(signals)

        sig_mean = float(np.mean(signals))
        pnl_mean = float(np.mean(pnls))

        # Centered values
        sig_c = signals - sig_mean
        pnl_c = pnls - pnl_mean

        ss_sig = float(np.sum(sig_c**2))
        if ss_sig < 1e-15:
            # Signal is constant — no coupling measurable
            return CouplingState(
                kappa=0.0,
                r_squared=0.0,
                n_samples=n,
                is_coupled=False,
                is_inverted=False,
                stud_crossing=False,
                signal_mean=sig_mean,
                pnl_mean=pnl_mean,
            )

        # κ = Cov(signal, pnl) / Var(signal)
        kappa = float(np.sum(sig_c * pnl_c)) / ss_sig

        # R² = 1 - SS_res / SS_tot
        predicted = sig_mean + kappa * sig_c
        ss_res = float(np.sum((pnls - predicted) ** 2))
        ss_tot = float(np.sum(pnl_c**2))
        r_squared = 1.0 - ss_res / max(ss_tot, 1e-15) if ss_tot > 1e-15 else 0.0
        r_squared = max(0.0, r_squared)  # numerical floor

        # Coupling assessment
        is_coupled = r_squared > self.r2_threshold and kappa > self.kappa_sign_threshold
        is_inverted = kappa < -self.kappa_sign_threshold and r_squared > self.r2_threshold

        # Stud crossing detection: κ changed sign
        current_sign = 1 if kappa > self.kappa_sign_threshold else (-1 if kappa < -self.kappa_sign_threshold else 0)
        stud_crossing = False
        if self._last_kappa_sign is not None and current_sign != 0:
            stud_crossing = current_sign != self._last_kappa_sign and self._last_kappa_sign != 0
        if current_sign != 0:
            self._last_kappa_sign = current_sign

        return CouplingState(
            kappa=kappa,
            r_squared=r_squared,
            n_samples=n,
            is_coupled=is_coupled,
            is_inverted=is_inverted,
            stud_crossing=stud_crossing,
            signal_mean=sig_mean,
            pnl_mean=pnl_mean,
        )

    def reset(self) -> None:
        """Clear all internal state."""
        self._signals.clear()
        self._pnls.clear()
        self._last_kappa_sign = None
