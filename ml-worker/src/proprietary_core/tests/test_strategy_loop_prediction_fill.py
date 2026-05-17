"""GAP 5 from QIG audit — basin prediction-fill provenance tests.

The basin detector only runs every 20 ticks after a 50-tick warmup; on
intermediate ticks the LoopDecision.basins field carries the last-known
("held") value. This file verifies the new telemetry that surfaces:
  - LoopDecision.basin_fill_kind  ("fresh" | "held" | "none")
  - LoopDecision.ticks_since_basin_detection
  - StrategyLoop.prediction_fill_ratio property

Audit reference: ~/.claude/plans/hidden-coalescing-noodle.md GAP 5.
"""
from __future__ import annotations

import numpy as np

from proprietary_core.strategy_loop import LoopDecision, StrategyLoop


def _make_prices(n: int, base: float = 100.0, vol: float = 0.02, seed: int = 42) -> list[float]:
    rng = np.random.default_rng(seed)
    returns = rng.normal(0.0, vol, n)
    prices = [base]
    for r in returns:
        prices.append(prices[-1] * (1 + r))
    return prices


class TestBasinFillKind:
    """LoopDecision.basin_fill_kind reflects the basin field's provenance."""

    def test_none_when_no_detection_yet(self):
        """Before the 50-tick warmup, basin_fill_kind = 'none' and basins is None."""
        loop = StrategyLoop(symbol="X")
        d = loop.tick(price=100.0)
        assert d.basin_fill_kind == "none"
        assert d.basins is None
        assert d.ticks_since_basin_detection == 1  # incremented; no fresh yet

    def test_fresh_on_first_detection_tick(self):
        """Tick 50 should be 'fresh' — first detection."""
        loop = StrategyLoop(symbol="X")
        prices = _make_prices(60, base=100.0, vol=0.03)
        decisions: list[LoopDecision] = []
        for p in prices[:60]:
            decisions.append(loop.tick(price=p))
        # Detection runs when len(_basins._prices) >= 50 AND
        # len(_basins._prices) % 20 == 0 — i.e. tick 60 (since the
        # detector populates one price per tick after warmup).
        # First fresh tick is when this condition is first true.
        fresh_ticks = [i for i, d in enumerate(decisions) if d.basin_fill_kind == "fresh"]
        assert len(fresh_ticks) >= 1, f"no fresh ticks observed, fills={[d.basin_fill_kind for d in decisions]}"
        first_fresh = fresh_ticks[0]
        # ticks_since_basin_detection should be 0 on a fresh tick
        assert decisions[first_fresh].ticks_since_basin_detection == 0

    def test_held_between_detections(self):
        """Ticks between detection events should be 'held' with growing counter."""
        loop = StrategyLoop(symbol="X")
        prices = _make_prices(100, base=100.0, vol=0.03)
        decisions = [loop.tick(price=p) for p in prices]

        # Find consecutive fresh→held pattern. After a fresh tick,
        # subsequent ticks should be held with increasing counter.
        for i, d in enumerate(decisions):
            if d.basin_fill_kind == "fresh" and i + 1 < len(decisions):
                # Walk forward through held streak
                streak = 0
                for j in range(i + 1, len(decisions)):
                    if decisions[j].basin_fill_kind == "held":
                        streak += 1
                        assert decisions[j].ticks_since_basin_detection == streak
                    else:
                        # Next fresh tick or no-data — break out
                        break
                # Must have observed at least one held tick after a fresh
                # (otherwise the cadence is broken)
                if streak > 0:
                    break
        else:
            assert False, "no fresh→held transition observed"

    def test_to_dict_surfaces_new_fields(self):
        """LoopDecision.to_dict() must expose basin_fill_kind + counter."""
        loop = StrategyLoop(symbol="X", regime_window=50)
        prices = _make_prices(150, base=100.0, vol=0.03)
        for p in prices:
            loop.tick(price=p)
        d = loop.last_decision.to_dict()
        assert "basin_fill_kind" in d
        assert "ticks_since_basin_detection" in d
        assert d["basin_fill_kind"] in ("none", "fresh", "held")


class TestPredictionFillRatio:
    """StrategyLoop.prediction_fill_ratio property trends to ~19/20 at steady state."""

    def test_zero_at_construction(self):
        loop = StrategyLoop(symbol="X")
        assert loop.prediction_fill_ratio == 0.0

    def test_one_at_first_tick_before_any_detection(self):
        """First tick: 0 fresh / 1 total = 1.0 (all held — actually 'none')."""
        loop = StrategyLoop(symbol="X")
        loop.tick(price=100.0)
        # 1 tick, 0 fresh detections → ratio = 1.0
        assert loop.prediction_fill_ratio == 1.0

    def test_trends_toward_19_over_20_at_steady_state(self):
        """After many ticks past warmup, detection runs ~every 20 ticks →
        fill ratio settles near 19/20 = 0.95."""
        loop = StrategyLoop(symbol="X")
        prices = _make_prices(500, base=100.0, vol=0.03)
        for p in prices:
            loop.tick(price=p)
        ratio = loop.prediction_fill_ratio
        # Allow generous tolerance for warmup effects (first 50 ticks
        # are all "none" but count toward the denominator).
        assert 0.92 <= ratio <= 0.99, (
            f"prediction_fill_ratio {ratio:.3f} outside expected band"
        )

    def test_reset_clears_counters(self):
        loop = StrategyLoop(symbol="X")
        prices = _make_prices(100, base=100.0, vol=0.03)
        for p in prices:
            loop.tick(price=p)
        assert loop.prediction_fill_ratio > 0.0
        loop.reset()
        assert loop.prediction_fill_ratio == 0.0
        # Internal counters all back to zero
        assert loop._ticks_total == 0
        assert loop._ticks_with_basin_fresh == 0
        assert loop._ticks_since_basin_detection == 0
