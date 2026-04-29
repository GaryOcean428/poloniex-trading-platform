"""test_figure8.py — Tier 10 figure-8 loop topology tests.

Loop assignment + loop-aware retrieval with the canonical
1/π gravitating-fraction and 1/φ crossing-anchor weights.
"""
from __future__ import annotations

import math
import os
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.figure8 import (  # noqa: E402
    Loop, assign_loop, figure8_retrieval_live,
    loop_aware_score_nearest, measured_gravitating_fraction,
)
from monkey_kernel.state import BASIN_DIM  # noqa: E402
from monkey_kernel.topology_constants import (  # noqa: E402
    PI_STRUCT_BOUNDARY_R_SQUARED, PI_STRUCT_DEAD_ZONE_BOUNDARY,
    PI_STRUCT_GRAVITATING_FRACTION,
)


def _uniform() -> np.ndarray:
    return np.full(BASIN_DIM, 1.0 / BASIN_DIM, dtype=np.float64)


def _peak(idx: int = 0, mass: float = 0.6) -> np.ndarray:
    rest = (1.0 - mass) / (BASIN_DIM - 1)
    b = np.full(BASIN_DIM, rest, dtype=np.float64)
    b[idx] = mass
    return b


# ─────────────────────────────────────────────────────────────────
# Loop assignment
# ─────────────────────────────────────────────────────────────────


class TestAssignLoop:
    def test_long_side_yields_long_loop(self) -> None:
        assert assign_loop("long") == Loop.LONG_LOOP

    def test_short_side_yields_short_loop(self) -> None:
        assert assign_loop("short") == Loop.SHORT_LOOP

    def test_buy_alias_yields_long_loop(self) -> None:
        assert assign_loop("buy") == Loop.LONG_LOOP

    def test_sell_alias_yields_short_loop(self) -> None:
        assert assign_loop("sell") == Loop.SHORT_LOOP

    def test_no_side_yields_crossing(self) -> None:
        assert assign_loop(None) == Loop.CROSSING

    def test_exit_near_identity_yields_crossing(self) -> None:
        # Distance < 1/(3π) → crossing regardless of side
        b = _uniform()
        result = assign_loop("long", exit_basin=b, identity_basin=b)
        assert result == Loop.CROSSING

    def test_exit_far_from_identity_keeps_side_loop(self) -> None:
        result = assign_loop(
            "long", exit_basin=_peak(0, 0.9), identity_basin=_uniform(),
        )
        assert result == Loop.LONG_LOOP


# ─────────────────────────────────────────────────────────────────
# Loop-aware retrieval — canonical weights
# ─────────────────────────────────────────────────────────────────


class TestLoopAwareScoreNearest:
    def _entry(
        self, idx: int, basin: np.ndarray, loop: Loop, pnl: float = 0.5,
    ) -> dict:
        return {
            "id": f"e{idx}",
            "entry_basin": basin,
            "loop": loop.value,
            "realized_pnl": pnl,
        }

    def test_same_loop_weighted_at_one(self) -> None:
        same = self._entry(1, _peak(0, 0.5), Loop.LONG_LOOP)
        result = loop_aware_score_nearest(
            query_basin=_peak(0, 0.5),
            query_loop=Loop.LONG_LOOP,
            entries=[same],
        )
        assert len(result) == 1
        assert result[0].weight_applied == 1.0
        # raw and effective distance equal at weight=1
        assert result[0].effective_distance == pytest.approx(
            result[0].raw_distance, abs=1e-9,
        )

    def test_cross_loop_weighted_at_one_over_pi(self) -> None:
        cross = self._entry(1, _peak(0, 0.5), Loop.SHORT_LOOP)
        result = loop_aware_score_nearest(
            query_basin=_peak(0, 0.5),
            query_loop=Loop.LONG_LOOP,
            entries=[cross],
        )
        assert result[0].weight_applied == pytest.approx(
            PI_STRUCT_GRAVITATING_FRACTION, abs=1e-12,
        )
        # effective distance = raw / weight ≈ raw × π
        assert result[0].effective_distance == pytest.approx(
            result[0].raw_distance / PI_STRUCT_GRAVITATING_FRACTION, abs=1e-9,
        )

    def test_crossing_weighted_at_one_over_phi(self) -> None:
        crossing = self._entry(1, _peak(0, 0.5), Loop.CROSSING)
        result = loop_aware_score_nearest(
            query_basin=_peak(0, 0.5),
            query_loop=Loop.LONG_LOOP,
            entries=[crossing],
        )
        assert result[0].weight_applied == pytest.approx(
            PI_STRUCT_BOUNDARY_R_SQUARED, abs=1e-12,
        )

    def test_same_loop_ranks_above_cross_loop_at_equal_distance(self) -> None:
        # Query is at peak(idx=5); both entries are at peak(idx=10) so
        # raw FR distances are equal but non-zero. Same-loop entry
        # gets weight 1.0; cross-loop gets weight 1/π → effective
        # distance scales by π for cross-loop, so same-loop ranks first.
        query = _peak(5, 0.5)
        entry_basin = _peak(10, 0.5)
        same = self._entry(1, entry_basin, Loop.LONG_LOOP)
        cross = self._entry(2, entry_basin, Loop.SHORT_LOOP)
        result = loop_aware_score_nearest(
            query_basin=query,
            query_loop=Loop.LONG_LOOP,
            entries=[cross, same],
            top_k=2,
        )
        assert result[0].entry_id == "e1"
        assert result[0].loop == Loop.LONG_LOOP
        assert result[1].entry_id == "e2"

    def test_top_k_caps_results(self) -> None:
        entries = [
            self._entry(i, _peak(i % BASIN_DIM, 0.5), Loop.LONG_LOOP)
            for i in range(20)
        ]
        result = loop_aware_score_nearest(
            query_basin=_peak(0, 0.5),
            query_loop=Loop.LONG_LOOP,
            entries=entries,
            top_k=5,
        )
        assert len(result) == 5


# ─────────────────────────────────────────────────────────────────
# measured_gravitating_fraction validation helper
# ─────────────────────────────────────────────────────────────────


class TestMeasuredFraction:
    def test_empty_neighbors_yield_zero(self) -> None:
        assert measured_gravitating_fraction([], Loop.LONG_LOOP) == 0.0

    def test_all_same_loop_yields_zero_cross(self) -> None:
        # Build neighbors where all are LONG_LOOP query against LONG_LOOP query
        from monkey_kernel.figure8 import LoopAwareNeighbor
        neighbors = [
            LoopAwareNeighbor(
                entry_id=f"e{i}", entry_basin=_peak(0), realized_pnl=0,
                loop=Loop.LONG_LOOP, raw_distance=0.1, effective_distance=0.1,
                weight_applied=1.0,
            )
            for i in range(5)
        ]
        assert measured_gravitating_fraction(neighbors, Loop.LONG_LOOP) == 0.0

    def test_mixed_yields_canonical_fraction(self) -> None:
        # 5 same-loop + 5 cross-loop → fraction = 0.5
        from monkey_kernel.figure8 import LoopAwareNeighbor
        neighbors = (
            [LoopAwareNeighbor("a", _peak(0), 0, Loop.LONG_LOOP, 0.1, 0.1, 1.0)] * 5
            + [LoopAwareNeighbor("b", _peak(0), 0, Loop.SHORT_LOOP, 0.1, 0.31, 0.318)] * 5
        )
        f = measured_gravitating_fraction(neighbors, Loop.LONG_LOOP)
        assert f == pytest.approx(0.5, abs=1e-9)


# ─────────────────────────────────────────────────────────────────
# Flag default-on
# ─────────────────────────────────────────────────────────────────


class TestFigure8RetrievalLiveFlag:
    def test_default_is_true(self, monkeypatch) -> None:
        monkeypatch.delenv("FIGURE8_RETRIEVAL_LIVE", raising=False)
        assert figure8_retrieval_live() is True

    def test_explicit_false(self, monkeypatch) -> None:
        monkeypatch.setenv("FIGURE8_RETRIEVAL_LIVE", "false")
        assert figure8_retrieval_live() is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
