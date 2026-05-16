"""lattice_inputs.py — derive (h, J) inputs for qig_warp.classify_regime.

MIG-2 (2026-05-16). Extracted from the deleted ``RegimeDetector`` so
the lattice-input computation is a single pure helper, callable from
the regime adapter, tests, and any future ops tooling without dragging
in classifier state.

  h:  Shannon entropy of the discretised log-return distribution
      (information content of the recent window)
  J:  |mean / std| of the same returns (coupling strength / trend
      magnitude on the lattice)

Both fields feed ``qig_warp.classify_regime(h, J, dim=2)`` to produce
the canonical regime label (CRITICAL / ORDERED / DISORDERED), which
``regime_qigwarp.classify_with_qig_warp`` then maps onto the trading
regime enum (CREATOR / PRESERVER / DISSOLVER).
"""

from __future__ import annotations

import numpy as np


def market_to_lattice_inputs(
    returns: np.ndarray, n_bins: int = 20,
) -> tuple[float, float]:
    """Compute (h, J) from a window of log returns.

    Returns (0.0, 0.0) for degenerate inputs (length < 2, zero
    variance, zero range) so the caller can route to a safe regime
    without raising. Both fields are guaranteed finite.
    """
    if len(returns) < 2:
        return 0.0, 0.0
    vol = float(np.std(returns))
    if vol < 1e-15:
        return 0.0, 0.0
    mean_ret = float(np.mean(returns))
    j_value = abs(mean_ret) / vol

    r_min, r_max = float(np.min(returns)), float(np.max(returns))
    if r_max - r_min < 1e-15:
        return 0.0, j_value
    counts, _ = np.histogram(returns, bins=n_bins, range=(r_min, r_max))
    probs = counts / counts.sum()
    probs = probs[probs > 0]
    h_value = float(-np.sum(probs * np.log2(probs)))
    return h_value, j_value
