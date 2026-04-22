"""Tests for the basin detector."""

import numpy as np
import pytest

from proprietary_core.basins import BasinDetector


def test_detects_support_resistance():
    """A bimodal price distribution should produce two basins."""
    rng = np.random.default_rng(42)
    # Price oscillates between two levels
    prices_low = rng.normal(100.0, 0.5, 200).tolist()
    prices_high = rng.normal(110.0, 0.5, 200).tolist()
    prices = prices_low + prices_high  # transition from 100 to 110

    det = BasinDetector(window=400, bandwidth_pct=0.02)
    det.update_batch(prices)
    basin_map = det.detect(current_price=108.0)

    assert basin_map is not None
    assert len(basin_map.basins) >= 2

    # Levels should be near 100 and 110
    levels = sorted([b.level for b in basin_map.basins])
    assert any(abs(l - 100.0) < 3 for l in levels), f"Expected basin near 100, got {levels}"
    assert any(abs(l - 110.0) < 3 for l in levels), f"Expected basin near 110, got {levels}"

    # At price 108, the 100 basin is support, 110 basin is resistance
    assert basin_map.nearest_support is not None
    assert basin_map.nearest_resistance is not None


def test_flat_price_single_basin():
    """A single price level should produce one basin."""
    prices = np.random.default_rng(42).normal(50.0, 0.2, 300).tolist()
    det = BasinDetector(window=300)
    det.update_batch(prices)
    basin_map = det.detect()

    assert basin_map is not None
    assert len(basin_map.basins) >= 1
    # The main basin should be near 50
    main = max(basin_map.basins, key=lambda b: b.density)
    assert abs(main.level - 50.0) < 2.0


def test_insufficient_data():
    """Too few prices should return None."""
    det = BasinDetector()
    det.update_batch([100.0, 101.0, 99.5])
    assert det.detect() is None
