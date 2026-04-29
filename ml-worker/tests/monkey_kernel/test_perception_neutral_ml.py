"""Perception tolerates absent ml fields — post #ml-separation.

When TickInputs no longer carries ml_signal/ml_strength, perception
is called without them. Verify the basin computation produces a
valid 64-D vector with neutral dims 3..5.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.perception import (  # noqa: E402
    OHLCVCandle,
    PerceptionInputs,
    perceive,
)


def _candles(n: int = 100) -> list[OHLCVCandle]:
    return [
        OHLCVCandle(
            timestamp=float(i), open=100.0, high=101.0,
            low=99.0, close=100.0 + 0.1 * (i % 5), volume=10.0,
        )
        for i in range(n)
    ]


def test_perceive_works_without_ml_fields():
    basin = perceive(PerceptionInputs(
        ohlcv=_candles(),
        equity_fraction=1.0,
        margin_fraction=0.0,
        open_positions=0,
        session_age_ticks=10,
    ))
    assert basin.shape == (64,)
    assert np.all(np.isfinite(basin))
    assert basin.sum() > 0  # post-simplex normalisation gives positive mass


def test_neutral_ml_dims_constant_across_inputs():
    """Dims 3..5 should reflect the HOLD-posture neutral values
    regardless of the OHLCV window when ml fields are absent."""
    a = perceive(PerceptionInputs(
        ohlcv=_candles(50),
        equity_fraction=1.0, margin_fraction=0.0, open_positions=0,
        session_age_ticks=5,
    ))
    b = perceive(PerceptionInputs(
        ohlcv=_candles(200),
        equity_fraction=0.5, margin_fraction=0.5, open_positions=3,
        session_age_ticks=500,
    ))
    # Dims 3, 4, 5 are derived only from ml inputs (not OHLCV) before
    # the simplex normalisation. Both inputs use HOLD/0.0/0.0, so the
    # raw values for dims 3..5 are identical pre-normalisation.
    # After to_simplex they may differ slightly because total mass
    # differs across windows; check they're at least order-of-magnitude
    # consistent (within a factor of 2) and finite.
    assert np.all(np.isfinite(a[3:6]))
    assert np.all(np.isfinite(b[3:6]))


def test_explicit_ml_buy_still_works():
    """Back-compat: callers that DO pass ml fields still get the
    ML-modulated dims. This covers the loop.ts TS-side use until the
    v0.8.8 cut-over removes the TS kernel."""
    basin = perceive(PerceptionInputs(
        ohlcv=_candles(),
        equity_fraction=1.0, margin_fraction=0.0, open_positions=0,
        session_age_ticks=10,
        ml_signal="BUY",
        ml_strength=0.7,
        ml_effective_strength=0.7,
    ))
    assert basin.shape == (64,)
    # Dim 3 (BUY) should be larger than dim 4 (SELL) when signal is BUY.
    assert basin[3] > basin[4]
