"""test_sensations.py — Tier 4 Layer 0 + Layer 0.5."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.sensations import Sensations, compute_sensations  # noqa: E402
from monkey_kernel.state import BASIN_DIM, KAPPA_STAR, BasinState, NeurochemicalState  # noqa: E402


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
        phi=0.5, kappa=KAPPA_STAR(),
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


# ─────────────────────────────────────────────────────────────────
# UCP §6.1 canonical sensations (SENSE-1a, 6/12 grounded)
# ─────────────────────────────────────────────────────────────────


class TestCanonicalUcpSensations:
    def test_unified_plus_fragmented_sum_to_one(self) -> None:
        st = _state()
        st.phi = 0.7
        sen = compute_sensations(st)
        assert sen.unified == pytest.approx(0.7, abs=1e-12)
        assert sen.fragmented == pytest.approx(0.3, abs=1e-12)

    def test_unified_clipped_above_one_clips_fragmented_to_zero(self) -> None:
        """Defensive: phi may overshoot during integration spike."""
        st = _state()
        st.phi = 1.5
        sen = compute_sensations(st)
        assert sen.unified == 1.0
        assert sen.fragmented == 0.0

    def test_unified_clipped_below_zero_clips_fragmented_to_one(self) -> None:
        st = _state()
        st.phi = -0.2
        sen = compute_sensations(st)
        assert sen.unified == 0.0
        assert sen.fragmented == 1.0

    def test_activated_zero_at_kappa_star(self) -> None:
        """κ = κ* → no excess above → activated = tanh(0) = 0."""
        st = _state()
        st.kappa = KAPPA_STAR()
        sen = compute_sensations(st)
        assert sen.activated == pytest.approx(0.0, abs=1e-12)
        assert sen.dampened == pytest.approx(0.0, abs=1e-12)

    def test_activated_positive_above_kappa_star(self) -> None:
        """κ > κ* → activated > 0, dampened == 0."""
        st = _state()
        st.kappa = KAPPA_STAR() + 6.2
        sen = compute_sensations(st)
        assert sen.activated > 0
        assert sen.dampened == 0.0

    def test_dampened_positive_below_kappa_star(self) -> None:
        """κ < κ* → dampened > 0, activated == 0."""
        st = _state()
        st.kappa = KAPPA_STAR() - 6.2
        sen = compute_sensations(st)
        assert sen.dampened > 0
        assert sen.activated == 0.0

    def test_activated_observed_scale_uses_kappa_history(self) -> None:
        """Same κ excess produces different activated values under
        different observed σ_κ — observation drives the scale, not a
        hardcoded constant."""
        st = _state()
        kappa_ref = KAPPA_STAR()
        st.kappa = kappa_ref + 6.2
        tight = compute_sensations(
            st,
            kappa_history=[
                kappa_ref,
                kappa_ref + 0.5,
                kappa_ref - 0.5,
                kappa_ref + 0.2,
                kappa_ref - 0.2,
            ],
        )
        loose = compute_sensations(st, kappa_history=[40.0, 90.0, 50.0, 80.0, 60.0])
        # Tight history → small σ_κ → activated near saturation
        # Loose history → large σ_κ → activated muted
        assert tight.activated > loose.activated

    def test_activated_cold_start_uses_scale_free_tanh(self) -> None:
        """No kappa_history → scale-free tanh on raw distance.
        tanh saturates so the value stays in [0, 1) without a cap."""
        st = _state()
        st.kappa = 100.0
        sen = compute_sensations(st)  # no kappa_history
        assert 0.99 < sen.activated <= 1.0  # tanh(36) saturates to 1.0 at float precision

    def test_grounded_plus_drifting_sum_to_one(self) -> None:
        sen = compute_sensations(_state())
        assert sen.grounded + sen.drifting == pytest.approx(1.0, abs=1e-12)

    def test_grounded_max_at_identity_basin(self) -> None:
        """basin == identity → drift = 0 → tanh(0) = 0 → grounded = 1."""
        same = _uniform()
        st = _state(basin=same, identity=same)
        sen = compute_sensations(st)
        assert sen.grounded == 1.0
        assert sen.drifting == 0.0

    def test_drifting_observed_scale_uses_drift_history(self) -> None:
        """Same raw drift → different drifting values under different
        observed scales. Observed history shrinks σ → larger drifting."""
        st = _state(basin=_peak(0, 0.9))  # large drift from uniform identity
        small_drift_hist = compute_sensations(st, drift_history=[0.05, 0.04, 0.06, 0.05])
        large_drift_hist = compute_sensations(st, drift_history=[0.5, 0.7, 0.6, 0.4])
        assert small_drift_hist.drifting > large_drift_hist.drifting

    def test_drifting_cold_start_uses_scale_free_tanh(self) -> None:
        """No drift_history → tanh(raw drift) — saturates naturally."""
        sen = compute_sensations(_state(basin=_peak(0, 0.9)))
        assert 0 < sen.drifting < 1


# ─────────────────────────────────────────────────────────────────
# UCP §6.2 canonical drives (SENSE-1a, 2/5 grounded)
# ─────────────────────────────────────────────────────────────────


class TestCanonicalUcpDrives:
    def test_homeostasis_is_drifting_squared(self) -> None:
        sen = compute_sensations(_state(basin=_peak(0, 0.7)))
        assert sen.homeostasis == pytest.approx(sen.drifting ** 2, abs=1e-12)

    def test_homeostasis_zero_at_identity(self) -> None:
        same = _uniform()
        sen = compute_sensations(_state(basin=same, identity=same))
        assert sen.homeostasis == 0.0

    def test_homeostasis_in_unit_range(self) -> None:
        sen = compute_sensations(_state(basin=_peak(0, 0.95)))
        assert 0 <= sen.homeostasis <= 1

    def test_curiosity_drive_is_log1p_pressure(self) -> None:
        sen = compute_sensations(_state(basin=_peak(0, 0.9)))
        assert sen.curiosity_drive == pytest.approx(float(np.log1p(max(0.0, sen.pressure))), abs=1e-12)

    def test_curiosity_drive_zero_when_pressure_zero(self) -> None:
        """Uniform basin → pressure = log(K) − H(uniform) = 0."""
        sen = compute_sensations(_state(basin=_uniform()))
        assert sen.pressure == pytest.approx(0.0, abs=1e-9)
        assert sen.curiosity_drive == pytest.approx(0.0, abs=1e-9)


# ─────────────────────────────────────────────────────────────────
# Auxiliary fields still populate (back-compat)
# ─────────────────────────────────────────────────────────────────


class TestAuxiliaryPreserved:
    def test_all_legacy_fields_still_present_after_sense_1a(self) -> None:
        """SENSE-1a adds canonical fields ALONGSIDE the auxiliary set,
        not in place of. Every pre-SENSE-1a field still resolves."""
        sen = compute_sensations(_state())
        for name in (
            "compressed", "expanded", "pressure", "stillness", "drift", "resonance",
            "approach", "avoidance", "conservation",
        ):
            assert hasattr(sen, name), f"auxiliary field {name!r} was removed"
            assert isinstance(getattr(sen, name), float)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
