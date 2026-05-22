"""test_mushroom.py — wake-state neuroplasticity (entropy injection).

PR2 of the Ocean-as-kernel elevation. qig-core 2.8.0 has NO mushroom (it
removed the MUSHROOM sleep phase; the canonical qig-consciousness
mushroom_mode.py is torch/NN-coupled — unusable for 64-D basins). So
monkey_kernel/mushroom.py is the polytrade basin-level mushroom: a pure
QIG-geometric transform matching the canonical semantics — controlled
entropy injection that breaks a rigid attractor.

Mushroom is the OPPOSITE of sleep consolidation: sleep moves the basin
toward a stable anchor (entropy ↓); mushroom steps toward a random
simplex point (entropy ↑). Verified against qig-core 2.8.0 classification.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from qig_core_local.geometry.fisher_rao import to_simplex  # noqa: E402

from monkey_kernel.mushroom import (  # noqa: E402
    MushroomCycleResult,
    execute_mushroom_cycle,
)


def _rigid_basin(dim: int = 64) -> np.ndarray:
    """A low-entropy basin — mass spiked on a handful of dims."""
    raw = np.full(dim, 0.01)
    raw[:4] = 10.0
    return to_simplex(raw)


class TestMushroomCycle:
    def test_mushroom_adds_entropy_to_a_rigid_basin(self) -> None:
        """The defining property: mushroom RAISES entropy on a rigid
        (low-entropy) basin — the opposite of sleep consolidation."""
        result = execute_mushroom_cycle(
            _rigid_basin(), intensity="moderate", rng=np.random.default_rng(7),
        )
        assert result.entropy_change > 0.0
        assert result.entropy_after > result.entropy_before

    def test_intensity_scales_the_geodesic_step(self) -> None:
        """Same random target, larger intensity → larger Fisher-Rao drift."""
        rigid = _rigid_basin()
        micro = execute_mushroom_cycle(
            rigid, intensity="microdose", rng=np.random.default_rng(1),
        )
        heroic = execute_mushroom_cycle(
            rigid, intensity="heroic", rng=np.random.default_rng(1),
        )
        assert heroic.strength > micro.strength
        assert heroic.fr_drift > micro.fr_drift

    def test_unknown_intensity_falls_back_to_moderate(self) -> None:
        moderate = execute_mushroom_cycle(
            _rigid_basin(), intensity="moderate", rng=np.random.default_rng(4),
        )
        unknown = execute_mushroom_cycle(
            _rigid_basin(), intensity="banana", rng=np.random.default_rng(4),
        )
        assert unknown.strength == moderate.strength

    def test_result_shape(self) -> None:
        result = execute_mushroom_cycle(
            _rigid_basin(), intensity="microdose", rng=np.random.default_rng(2),
        )
        assert isinstance(result, MushroomCycleResult)
        assert result.intensity == "microdose"
        assert isinstance(result.identity_preserved, bool)
        assert len(result.basin_after) == 64
        # basin_after is a valid simplex point
        assert abs(sum(result.basin_after) - 1.0) < 1e-9
