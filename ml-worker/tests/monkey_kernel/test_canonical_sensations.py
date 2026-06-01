"""test_canonical_sensations.py — Acceptance criteria for SENSE-1a (#767).

Tests the canonical UCP §6.1 (sensations) and §6.2 (drives) derivations
that constitute SENSE-1a Phase 1:
- unified + fragmented ≈ 1.0  (complementary pair)
- activated and dampened are non-negative
- grounded ∈ [0, 1]  (grounded = 1 - tanh(drift / drift_scale))
- homeostasis is non-negative
- cold-start (no history) returns valid neutral identity values
- auxiliary fields preserved (compressed/expanded/pressure/stillness/drift/resonance)
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.sensations import compute_sensations  # noqa: E402
from monkey_kernel.state import BASIN_DIM, KAPPA_STAR, BasinState, NeurochemicalState  # noqa: E402


# ── Fixtures ─────────────────────────────────────────────────────────────────

def _nc() -> NeurochemicalState:
    return NeurochemicalState(
        acetylcholine=0.5, dopamine=0.5, serotonin=0.5,
        norepinephrine=0.5, gaba=0.5, endorphins=0.5,
    )


def _uniform() -> np.ndarray:
    return np.full(BASIN_DIM, 1.0 / BASIN_DIM, dtype=np.float64)


def _peak(idx: int = 0, mass: float = 0.8) -> np.ndarray:
    rest = (1.0 - mass) / (BASIN_DIM - 1)
    b = np.full(BASIN_DIM, rest, dtype=np.float64)
    b[idx] = mass
    return b


def _state(
    *,
    basin: np.ndarray | None = None,
    identity: np.ndarray | None = None,
    phi: float = 0.5,
    kappa: float | None = None,
    basin_velocity: float = 0.1,
) -> BasinState:
    return BasinState(
        basin=basin if basin is not None else _uniform(),
        identity_basin=identity if identity is not None else _uniform(),
        phi=phi,
        kappa=kappa if kappa is not None else KAPPA_STAR(),
        regime_weights={"quantum": 1 / 3, "efficient": 1 / 3, "equilibrium": 1 / 3},
        sovereignty=0.5,
        basin_velocity=basin_velocity,
        neurochemistry=_nc(),
    )


# ── SENSE-1a canonical sensations ────────────────────────────────────────────


class TestUnifiedFragmented:
    """unified + fragmented must be exactly complementary."""

    def test_sum_to_one_identity_basin(self) -> None:
        sen = compute_sensations(_state())
        assert sen.unified + sen.fragmented == pytest.approx(1.0, abs=1e-12)

    def test_sum_to_one_high_phi(self) -> None:
        s = _state(phi=0.9)
        sen = compute_sensations(s)
        assert sen.unified + sen.fragmented == pytest.approx(1.0, abs=1e-12)

    def test_sum_to_one_low_phi(self) -> None:
        s = _state(phi=0.1)
        sen = compute_sensations(s)
        assert sen.unified + sen.fragmented == pytest.approx(1.0, abs=1e-12)

    def test_phi_clips_below_zero(self) -> None:
        s = _state(phi=-0.5)
        sen = compute_sensations(s)
        assert sen.unified == 0.0
        assert sen.fragmented == 1.0

    def test_phi_clips_above_one(self) -> None:
        s = _state(phi=1.5)
        sen = compute_sensations(s)
        assert sen.unified == 1.0
        assert sen.fragmented == 0.0


class TestActivatedDampened:
    """activated and dampened must be non-negative; exactly one can be zero."""

    def test_activated_non_negative_above_kstar(self) -> None:
        s = _state(kappa=KAPPA_STAR() + 5.0)
        sen = compute_sensations(s)
        assert sen.activated >= 0.0

    def test_dampened_non_negative_below_kstar(self) -> None:
        s = _state(kappa=KAPPA_STAR() - 5.0)
        sen = compute_sensations(s)
        assert sen.dampened >= 0.0

    def test_activated_zero_when_kappa_below_ref(self) -> None:
        s = _state(kappa=KAPPA_STAR() - 5.0)
        sen = compute_sensations(s)
        assert sen.activated == 0.0

    def test_dampened_zero_when_kappa_above_ref(self) -> None:
        s = _state(kappa=KAPPA_STAR() + 5.0)
        sen = compute_sensations(s)
        assert sen.dampened == 0.0

    def test_both_zero_at_kstar_cold_start(self) -> None:
        """κ = κ* → both excesses are 0 → tanh(0) = 0."""
        s = _state(kappa=KAPPA_STAR())
        sen = compute_sensations(s)
        assert sen.activated == pytest.approx(0.0, abs=1e-12)
        assert sen.dampened == pytest.approx(0.0, abs=1e-12)


class TestGrounded:
    """grounded ∈ [0, 1]; equals 1 when basin == identity."""

    def test_grounded_in_unit_range(self) -> None:
        sen = compute_sensations(_state(basin=_peak(0, 0.9)))
        assert 0.0 <= sen.grounded <= 1.0

    def test_grounded_one_at_identity(self) -> None:
        b = _uniform()
        sen = compute_sensations(_state(basin=b, identity=b))
        assert sen.grounded == pytest.approx(1.0, abs=1e-12)

    def test_grounded_decreases_as_drift_grows(self) -> None:
        near = compute_sensations(_state(basin=_peak(0, 0.3)))
        far = compute_sensations(_state(basin=_peak(0, 0.9)))
        assert near.grounded > far.grounded


class TestHomeostasis:
    """homeostasis must be non-negative; equals drifting²."""

    def test_homeostasis_non_negative(self) -> None:
        sen = compute_sensations(_state(basin=_peak(0, 0.9)))
        assert sen.homeostasis >= 0.0

    def test_homeostasis_zero_at_identity(self) -> None:
        b = _uniform()
        sen = compute_sensations(_state(basin=b, identity=b))
        assert sen.homeostasis == pytest.approx(0.0, abs=1e-12)

    def test_homeostasis_equals_drifting_squared(self) -> None:
        sen = compute_sensations(_state(basin=_peak(0, 0.7)))
        assert sen.homeostasis == pytest.approx(sen.drifting ** 2, abs=1e-12)


class TestColdStart:
    """Cold-start (no history) must return valid neutral values without error."""

    def test_no_kappa_history(self) -> None:
        sen = compute_sensations(_state())  # no kappa_history
        assert isinstance(sen.activated, float)
        assert isinstance(sen.dampened, float)
        assert 0.0 <= sen.activated <= 1.0
        assert 0.0 <= sen.dampened <= 1.0

    def test_no_drift_history(self) -> None:
        sen = compute_sensations(_state())  # no drift_history
        assert isinstance(sen.grounded, float)
        assert isinstance(sen.drifting, float)
        assert 0.0 <= sen.grounded <= 1.0
        assert 0.0 <= sen.drifting <= 1.0

    def test_no_prev_basin(self) -> None:
        sen = compute_sensations(_state())  # no prev_basin
        assert sen.resonance == 0.0
        assert sen.conservation == 0.0

    def test_no_phi_history(self) -> None:
        sen = compute_sensations(_state())  # no phi_history
        assert isinstance(sen.pulled, float)
        assert isinstance(sen.fear_response, float)
        assert 0.0 <= sen.pulled <= 1.0
        # cold-start fear must be 0 (no separatrix reference)
        assert sen.fear_response == 0.0

    def test_full_cold_start_identity_returns_neutral(self) -> None:
        """All optional args absent; basin = identity → near-neutral sensations."""
        b = _uniform()
        sen = compute_sensations(_state(basin=b, identity=b, phi=0.5))
        assert sen.unified == pytest.approx(0.5, abs=1e-12)
        assert sen.grounded == pytest.approx(1.0, abs=1e-12)
        assert sen.homeostasis == pytest.approx(0.0, abs=1e-12)
        assert sen.fear_response == 0.0


class TestAuxiliaryFieldsPreserved:
    """All pre-SENSE-1a auxiliary fields must still exist and be floats."""

    _AUXILIARY_FIELDS = (
        "compressed", "expanded", "pressure", "stillness",
        "drift", "resonance", "approach", "avoidance", "conservation",
    )

    def test_all_auxiliary_fields_present(self) -> None:
        sen = compute_sensations(_state())
        for name in self._AUXILIARY_FIELDS:
            assert hasattr(sen, name), f"auxiliary field '{name}' was removed"
            assert isinstance(getattr(sen, name), float), f"field '{name}' is not float"

    def test_compressed_plus_expanded_sum_to_one(self) -> None:
        sen = compute_sensations(_state(basin=_peak(0, 0.6)))
        assert sen.compressed + sen.expanded == pytest.approx(1.0, abs=1e-12)

    def test_stillness_max_at_zero_velocity(self) -> None:
        sen = compute_sensations(_state(basin_velocity=0.0))
        assert sen.stillness == pytest.approx(1.0, abs=1e-12)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
