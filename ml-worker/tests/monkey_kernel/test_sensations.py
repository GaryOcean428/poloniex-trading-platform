"""test_sensations.py — Tier 4 Layer 0 + Layer 0.5."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.sensations import Sensations, compute_sensations  # noqa: E402
from monkey_kernel.state import BASIN_DIM, BasinState, NeurochemicalState  # noqa: E402


def _nc(dop: float = 0.5, gaba: float = 0.5, ne: float = 0.5) -> NeurochemicalState:
    return NeurochemicalState(
        acetylcholine=0.5, dopamine=dop, serotonin=0.5,
        norepinephrine=ne, gaba=gaba, endorphins=0.5,
    )


def _uniform() -> np.ndarray:
    return np.full(BASIN_DIM, 1.0 / BASIN_DIM, dtype=np.float64)


def _peak(idx: int = 0, mass: float = 0.9) -> np.ndarray:
    rest = (1.0 - mass) / (BASIN_DIM - 1)
    b = np.full(BASIN_DIM, rest, dtype=np.float64)
    b[idx] = mass
    return b


def _state(
    *, basin=None, identity=None, basin_velocity: float = 0.1,
    dop: float = 0.5, gaba: float = 0.5, ne: float = 0.5,
) -> BasinState:
    return BasinState(
        basin=basin if basin is not None else _uniform(),
        identity_basin=identity if identity is not None else _uniform(),
        phi=0.5, kappa=64.0,
        regime_weights={"quantum": 1 / 3, "efficient": 1 / 3, "equilibrium": 1 / 3},
        sovereignty=0.5, basin_velocity=basin_velocity,
        neurochemistry=_nc(dop=dop, gaba=gaba, ne=ne),
    )


# ─────────────────────────────────────────────────────────────────
# Layer 0 sensations
# ─────────────────────────────────────────────────────────────────


class TestLayer0:
    def test_compressed_plus_expanded_sum_to_one(self) -> None:
        s = compute_sensations(_state(basin=_peak(0, 0.7)))
        assert s.compressed + s.expanded == pytest.approx(1.0, abs=1e-12)

    def test_compressed_high_for_concentrated_basin(self) -> None:
        s = compute_sensations(_state(basin=_peak(0, 0.95)))
        assert s.compressed > 0.9

    def test_expanded_high_for_uniform_basin(self) -> None:
        s = compute_sensations(_state(basin=_uniform()))
        # uniform: max_mass = 1/K = 0.0156; expanded ≈ 0.984
        assert s.expanded > 0.95

    def test_pressure_zero_for_uniform_basin(self) -> None:
        s = compute_sensations(_state(basin=_uniform()))
        assert s.pressure == pytest.approx(0.0, abs=1e-9)

    def test_pressure_max_for_dirac_basin(self) -> None:
        b = np.zeros(BASIN_DIM)
        b[0] = 1.0
        s = compute_sensations(_state(basin=b))
        # pressure = log(K) − 0 = log(64)
        assert s.pressure == pytest.approx(np.log(BASIN_DIM), abs=1e-6)

    def test_stillness_max_at_zero_velocity(self) -> None:
        s = compute_sensations(_state(basin_velocity=0.0))
        assert s.stillness == pytest.approx(1.0, abs=1e-12)

    def test_stillness_decreases_with_velocity(self) -> None:
        s_lo = compute_sensations(_state(basin_velocity=0.0))
        s_hi = compute_sensations(_state(basin_velocity=2.0))
        assert s_lo.stillness > s_hi.stillness

    def test_drift_zero_when_basin_equals_identity(self) -> None:
        b = _uniform()
        s = compute_sensations(_state(basin=b, identity=b))
        assert s.drift == pytest.approx(0.0, abs=1e-9)

    def test_drift_positive_when_basin_diverges_from_identity(self) -> None:
        s = compute_sensations(_state(basin=_peak(0, 0.9), identity=_uniform()))
        assert s.drift > 0.0

    def test_resonance_one_when_basin_unchanged(self) -> None:
        b = _uniform()
        s = compute_sensations(_state(basin=b), prev_basin=b)
        assert s.resonance == pytest.approx(1.0, abs=1e-9)

    def test_resonance_zero_on_cold_start(self) -> None:
        s = compute_sensations(_state(basin=_uniform()), prev_basin=None)
        assert s.resonance == 0.0


# ─────────────────────────────────────────────────────────────────
# Layer 0.5 drives
# ─────────────────────────────────────────────────────────────────


class TestLayer05:
    def test_approach_positive_when_dopamine_dominates(self) -> None:
        s = compute_sensations(_state(dop=0.9, gaba=0.1))
        assert s.approach == pytest.approx(0.8, abs=1e-12)

    def test_approach_negative_when_gaba_dominates(self) -> None:
        s = compute_sensations(_state(dop=0.1, gaba=0.9))
        assert s.approach == pytest.approx(-0.8, abs=1e-12)

    def test_avoidance_passes_ne_through(self) -> None:
        s = compute_sensations(_state(ne=0.73))
        assert s.avoidance == pytest.approx(0.73, abs=1e-12)

    def test_conservation_zero_on_cold_start(self) -> None:
        s = compute_sensations(_state())
        assert s.conservation == 0.0

    def test_conservation_positive_when_returning_to_identity(self) -> None:
        s = compute_sensations(
            _state(basin=_peak(0, 0.5), identity=_uniform()),
            prev_basin=_peak(0, 0.95),
        )
        assert s.conservation > 0.0

    def test_conservation_negative_when_departing(self) -> None:
        s = compute_sensations(
            _state(basin=_peak(0, 0.95), identity=_uniform()),
            prev_basin=_peak(0, 0.5),
        )
        assert s.conservation < 0.0


# ─────────────────────────────────────────────────────────────────
# Missing neurochemistry must raise
# ─────────────────────────────────────────────────────────────────


class TestPrecondition:
    def test_missing_neurochemistry_raises(self) -> None:
        st = _state()
        st.neurochemistry = None
        with pytest.raises(ValueError, match="neurochemistry"):
            compute_sensations(st)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
