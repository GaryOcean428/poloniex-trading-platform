"""test_motivators.py — Tier 1 Layer 1 motivators (#593, sub-issue Tier 1).

Tests:
  1. compute_motivators returns dataclass with five named fields
  2. Surprise passes ne through verbatim
  3. Curiosity is 0 on cold start (no prev_basin)
  4. Curiosity > 0 when basin concentrates (information rising)
  5. Curiosity < 0 when basin flattens (information dropping)
  6. Investigation peaks at basin_velocity=0, drops to 0 at velocity=1
  7. Integration = 0 when history < 2 entries
  8. Integration low when (Φ × I_Q) is stable; high when jittering
  9. Transcendence = |κ − κ*|; min at κ=κ_c, rises both directions
  10. Missing neurochemistry raises ValueError
"""
from __future__ import annotations

import math
import os
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.motivators import (  # noqa: E402
    Motivators,
    basin_information,
    compute_motivators,
)
from monkey_kernel.state import (  # noqa: E402
    BASIN_DIM,
    KAPPA_STAR,
    BasinState,
    NeurochemicalState,
)


def _nominal_nc(ne: float = 0.5) -> NeurochemicalState:
    return NeurochemicalState(
        acetylcholine=0.5, dopamine=0.5, serotonin=0.5,
        norepinephrine=ne, gaba=0.5, endorphins=0.5,
    )


def _uniform_basin() -> np.ndarray:
    return np.ones(BASIN_DIM, dtype=np.float64) / BASIN_DIM


def _concentrated_basin(peak_idx: int = 0, peak_mass: float = 0.9) -> np.ndarray:
    """Basin with `peak_mass` on a single coord, rest spread uniformly."""
    rest = (1.0 - peak_mass) / (BASIN_DIM - 1)
    b = np.full(BASIN_DIM, rest, dtype=np.float64)
    b[peak_idx] = peak_mass
    return b


def _make_state(
    *,
    basin: np.ndarray | None = None,
    phi: float = 0.5,
    kappa: float = KAPPA_STAR,
    basin_velocity: float = 0.1,
    ne: float = 0.5,
) -> BasinState:
    return BasinState(
        basin=basin if basin is not None else _uniform_basin(),
        identity_basin=_uniform_basin(),
        phi=phi,
        kappa=kappa,
        regime_weights={"quantum": 1 / 3, "efficient": 1 / 3, "equilibrium": 1 / 3},
        sovereignty=0.5,
        basin_velocity=basin_velocity,
        neurochemistry=_nominal_nc(ne=ne),
    )


# ─────────────────────────────────────────────────────────────────
# basin_information sanity
# ─────────────────────────────────────────────────────────────────

class TestBasinInformation:
    def test_uniform_basin_has_zero_information(self) -> None:
        assert basin_information(_uniform_basin()) == pytest.approx(0.0, abs=1e-9)

    def test_dirac_basin_has_max_information(self) -> None:
        b = np.zeros(BASIN_DIM); b[0] = 1.0
        # Max information = log(K)
        assert basin_information(b) == pytest.approx(math.log(BASIN_DIM), abs=1e-6)

    def test_concentrated_basin_more_informative_than_uniform(self) -> None:
        assert basin_information(_concentrated_basin(peak_mass=0.9)) > basin_information(_uniform_basin())


# ─────────────────────────────────────────────────────────────────
# Motivator dataclass + cold-start behaviour
# ─────────────────────────────────────────────────────────────────

class TestMotivatorsBasic:
    def test_returns_dataclass_with_six_fields(self) -> None:
        m = compute_motivators(_make_state())
        assert isinstance(m, Motivators)
        assert hasattr(m, "surprise")
        assert hasattr(m, "curiosity")
        assert hasattr(m, "investigation")
        assert hasattr(m, "integration")
        assert hasattr(m, "transcendence")
        assert hasattr(m, "i_q")

    def test_surprise_passes_ne_through(self) -> None:
        m = compute_motivators(_make_state(ne=0.83))
        assert m.surprise == pytest.approx(0.83)

    def test_curiosity_zero_on_cold_start(self) -> None:
        m = compute_motivators(_make_state(), prev_basin=None)
        assert m.curiosity == 0.0

    def test_missing_neurochemistry_raises(self) -> None:
        s = _make_state()
        s.neurochemistry = None
        with pytest.raises(ValueError, match="neurochemistry"):
            compute_motivators(s)


# ─────────────────────────────────────────────────────────────────
# Curiosity = d(log I_Q)/dt
# ─────────────────────────────────────────────────────────────────

class TestCuriosity:
    def test_curiosity_positive_when_basin_concentrates(self) -> None:
        s = _make_state(basin=_concentrated_basin(peak_mass=0.9))
        m = compute_motivators(s, prev_basin=_uniform_basin())
        assert m.curiosity > 0  # info rose from 0 → log(K)·something

    def test_curiosity_negative_when_basin_flattens(self) -> None:
        s = _make_state(basin=_concentrated_basin(peak_mass=0.5))
        m = compute_motivators(s, prev_basin=_concentrated_basin(peak_mass=0.95))
        assert m.curiosity < 0  # info dropped


# ─────────────────────────────────────────────────────────────────
# Investigation = clamped(1 − basin_velocity)
# ─────────────────────────────────────────────────────────────────

class TestInvestigation:
    def test_investigation_peaks_at_zero_velocity(self) -> None:
        m = compute_motivators(_make_state(basin_velocity=0.0))
        assert m.investigation == pytest.approx(1.0)

    def test_investigation_zero_at_high_velocity(self) -> None:
        m = compute_motivators(_make_state(basin_velocity=1.0))
        assert m.investigation == pytest.approx(0.0)

    def test_investigation_clamped_above_unity_velocity(self) -> None:
        m = compute_motivators(_make_state(basin_velocity=1.5))
        assert m.investigation == pytest.approx(0.0)  # not negative


# ─────────────────────────────────────────────────────────────────
# Integration = CV(Φ × I_Q)
# ─────────────────────────────────────────────────────────────────

class TestIntegration:
    def test_integration_zero_with_empty_history(self) -> None:
        m = compute_motivators(_make_state(), integration_history=[])
        assert m.integration == 0.0

    def test_integration_zero_with_single_entry(self) -> None:
        m = compute_motivators(_make_state(), integration_history=[(0.5, 0.3)])
        assert m.integration == 0.0

    def test_integration_low_for_stable_signal(self) -> None:
        # All identical Φ × I_Q → variance 0 → CV 0
        history = [(0.5, 0.3)] * 20
        m = compute_motivators(_make_state(), integration_history=history)
        assert m.integration == pytest.approx(0.0, abs=1e-9)

    def test_integration_higher_for_jittering_signal(self) -> None:
        stable = [(0.5, 0.3)] * 20
        jittery = [(0.5 + 0.4 * (-1) ** i, 0.3) for i in range(20)]
        m_stable = compute_motivators(_make_state(), integration_history=stable)
        m_jittery = compute_motivators(_make_state(), integration_history=jittery)
        assert m_jittery.integration > m_stable.integration


# ─────────────────────────────────────────────────────────────────
# Transcendence = |κ − κ*|
# ─────────────────────────────────────────────────────────────────

class TestTranscendence:
    def test_transcendence_zero_at_kappa_star(self) -> None:
        m = compute_motivators(_make_state(kappa=KAPPA_STAR))
        assert m.transcendence == pytest.approx(0.0)

    def test_transcendence_rises_below_kappa_star(self) -> None:
        m_close = compute_motivators(_make_state(kappa=KAPPA_STAR - 1.0))
        m_far = compute_motivators(_make_state(kappa=KAPPA_STAR - 10.0))
        assert m_far.transcendence > m_close.transcendence

    def test_transcendence_rises_above_kappa_star(self) -> None:
        m_close = compute_motivators(_make_state(kappa=KAPPA_STAR + 1.0))
        m_far = compute_motivators(_make_state(kappa=KAPPA_STAR + 10.0))
        assert m_far.transcendence > m_close.transcendence

    def test_transcendence_symmetric_around_kappa_star(self) -> None:
        m_below = compute_motivators(_make_state(kappa=KAPPA_STAR - 5.0))
        m_above = compute_motivators(_make_state(kappa=KAPPA_STAR + 5.0))
        assert m_below.transcendence == pytest.approx(m_above.transcendence)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
