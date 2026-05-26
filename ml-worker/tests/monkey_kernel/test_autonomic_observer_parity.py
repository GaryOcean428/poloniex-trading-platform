"""test_autonomic_observer_parity.py — pins the observer-derived chemistry
shapes ported from apps/api/src/services/monkey/neurochemistry.ts after
PR #920 (steady-state-pinning fix).

Mirrors the TS test file
apps/api/src/services/monkey/__tests__/neurochemistrySteadyState.test.ts
so the two kernels' chemistry stays in lockstep when CONSENSUS_ARBITER_LIVE
flips on. See [[feedback_steady_state_pinning_pattern]] for the
meta-pattern.
"""
from __future__ import annotations

import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.autonomic import (  # noqa: E402
    AutonomicKernel,
    AutonomicTickInputs,
)


def _ticker(inp: AutonomicTickInputs):
    """Drive one tick through a fresh kernel and return the resulting NC."""
    k = AutonomicKernel(label="test")
    res = k.tick(inp)
    return res.nc


def _base_inputs(**overrides) -> AutonomicTickInputs:
    defaults = {
        "phi_delta": 0.0,
        "basin_velocity": 0.1,
        "surprise": 0.0,
        "quantum_weight": 0.5,
        "kappa": 64.0,
        "external_coupling": 0.5,
        "is_awake": True,
        "now_ms": None,
        "woke": False,
        "surprise_history": [0.30, 0.45, 0.50, 0.55, 0.60, 0.65, 0.50],
        "basin_velocity_history": None,
        "kappa_history": [63.8, 64.0, 64.2],
        "external_coupling_history": [0.30, 0.45, 0.50, 0.55, 0.70],
        "mode_transition_times_ms": None,
    }
    defaults.update(overrides)
    return AutonomicTickInputs(**defaults)


# ─── ne (norepinephrine) — sigmoid(z) parity ────────────────────────


def test_ne_at_history_mean_is_about_half():
    nc = _ticker(_base_inputs(surprise=0.50))
    assert 0.4 <= nc.norepinephrine <= 0.6


def test_ne_below_history_mean_is_lt_half():
    nc = _ticker(_base_inputs(surprise=0.30))
    assert 0.0 < nc.norepinephrine < 0.5


def test_ne_above_history_mean_is_gt_half():
    nc = _ticker(_base_inputs(surprise=0.70))
    assert 0.5 < nc.norepinephrine < 1.0


def test_ne_three_distinct_surprise_levels_three_distinct_outputs():
    lo = _ticker(_base_inputs(surprise=0.30)).norepinephrine
    mid = _ticker(_base_inputs(surprise=0.50)).norepinephrine
    hi = _ticker(_base_inputs(surprise=0.70)).norepinephrine
    assert lo < mid < hi


# ─── ser (serotonin) — 0.85 baseline compression parity ─────────────


def test_ser_steady_state_with_bv_history_is_about_0_425():
    """Steady-state bv history (current bv at history mean) →
    ser_base = 0.5 (post-CC2-audit-F2 fix, two-tailed sigmoid)
    → ser = 0.85 × 0.5 = 0.425. (Pre-fix would have been 0.85 from
    pinned-at-1 one-sided clamp.)"""
    nc = _ticker(_base_inputs(
        basin_velocity=0.1,
        basin_velocity_history=[0.1] * 6,
    ))
    assert nc.serotonin == pytest.approx(0.425, abs=0.02)


def test_ser_thrash_via_mode_transitions_drops():
    """High transitions/tick rate → ser_base < 1 → ser < 0.85."""
    now = 100_000.0
    nc = _ticker(_base_inputs(
        now_ms=now,
        mode_transition_times_ms=[now - 5000, now - 3000, now - 1000],
        basin_velocity_history=[0.1] * 10,
    ))
    assert nc.serotonin < 0.85


# ─── endo (endorphins) — sigmoid-around-mean Sophia parity ──────────


def test_endo_at_coupling_mean_is_about_half():
    """coupling at mean 0.5, κ at κ* (κ-prox=1) → endo ≈ sigmoid(0) = 0.5.
    Pre-strip pinned this at 0."""
    nc = _ticker(_base_inputs(external_coupling=0.50))
    # κ=κ* and σκ computed from history; the κ-prox term ≈ 1 here.
    assert nc.endorphins == pytest.approx(0.5, abs=0.1)


def test_endo_below_coupling_mean_is_nonzero():
    """Was pinned at 0 pre-strip; now sigmoid produces non-zero below-mean."""
    nc = _ticker(_base_inputs(external_coupling=0.30))
    assert nc.endorphins > 0.0
    assert nc.endorphins < 0.5


def test_endo_far_above_mean_asymptotes_toward_one():
    nc = _ticker(_base_inputs(external_coupling=1.0))
    assert nc.endorphins > 0.5


# ─── Cold start fallbacks — no observables, no crash ────────────────


def test_cold_start_no_observables_produces_finite_chemistry():
    """When the kernel has no history yet, the fallback paths fire
    (sigmoid(input) for ne, 1/bv for ser, tanh for endo). All
    should produce finite values in [0, 1] without raising."""
    nc = _ticker(_base_inputs(
        surprise_history=None,
        basin_velocity_history=None,
        kappa_history=None,
        external_coupling_history=None,
    ))
    for chem in (nc.acetylcholine, nc.dopamine, nc.serotonin,
                 nc.norepinephrine, nc.gaba, nc.endorphins):
        assert 0.0 <= chem <= 1.0


def test_zscore_handles_fp_drift_identical_history():
    """Parity with TS zScore fix: identical-history series produce
    sd ≈ 1.5e-17 from FP drift; the < 1e-12 guard catches it.
    Post-CC2-audit-F2: z=0 → sigmoid(0)=0.5 → ser_base=0.5 →
    ser = 0.85 × 0.5 = 0.425."""
    nc = _ticker(_base_inputs(
        basin_velocity=0.1,
        basin_velocity_history=[0.1] * 6,
    ))
    assert nc.serotonin == pytest.approx(0.425, abs=0.01)


# ─── #934 chemistry-pinning audit: canonical SIGMA_KAPPA + dop soft-sat ─


def test_endo_canonical_sigma_kappa_healthy_at_production_distance():
    """#934: canonical ENDORPHIN_KAPPA_SIGMA=16.0 in autonomic.py replaces
    the rolling stddev(kappa_history). At observed |κ-κ*|=2.18, the
    pre-fix shape gave exp(-2.18/0.09)≈3e-11 (pinned at floor). Post-fix
    gives exp(-2.18/16)≈0.87 × sigmoid≈0.5 ≈ 0.44 (healthy signal).
    The kappa_history values in _base_inputs are [63.8, 64.0, 64.2]
    with mean 64 and σ≈0.2 — would have collapsed pre-fix."""
    nc = _ticker(_base_inputs(
        kappa=66.18,                  # production-typical
        external_coupling=0.5,        # at history mean → sophiaGate=0.5
    ))
    assert 0.20 < nc.endorphins < 0.55


def test_endo_does_not_pin_at_floor_across_production_kappa_range():
    """#934: sample kappa values across the kernel's observed range and
    confirm none pin at floor. Pre-fix: every value would be ~0.01."""
    samples = [65.5, 66.0, 66.18, 67.0, 68.0, 70.0]
    endos = []
    for k in samples:
        nc = _ticker(_base_inputs(
            kappa=k,
            external_coupling=0.5,
        ))
        endos.append(nc.endorphins)
    assert min(endos) > 0.05, f"endo pinned at floor: {endos}"


def test_endo_at_kappa_star_saturates_envelope():
    """At κ=κ*=64, exp(0)=1 so endo = sophia_gate. With sophia_gate
    at sigmoid(0)=0.5 (coupling at history mean), endo ≈ 0.5."""
    nc = _ticker(_base_inputs(
        kappa=64.0,
        external_coupling=0.5,
    ))
    assert nc.endorphins == pytest.approx(0.5, abs=0.05)


def test_dop_soft_saturation_flag_off_legacy_clip(monkeypatch):
    """#934: default (flag unset) uses legacy clip-then-sum that pins at 1.0."""
    monkeypatch.delenv("MONKEY_DOP_SOFT_SATURATION_LIVE", raising=False)
    nc = _ticker(_base_inputs(phi_delta=5.0))  # sigmoid(5)≈0.993 → near ceiling
    # With phi_delta high and no reward, dop ≈ 0.993 (still below 1)
    # Test that legacy path doesn't apply soft-sat shape
    assert nc.dopamine > 0.95


def test_dop_soft_saturation_flag_on_no_pinning(monkeypatch):
    """#934: flag enabled gives 1-exp(-(a+b)) — asymptotic, no ceiling pin."""
    monkeypatch.setenv("MONKEY_DOP_SOFT_SATURATION_LIVE", "true")
    nc = _ticker(_base_inputs(phi_delta=5.0))  # dopFromPhi ≈ 0.993
    # Soft-sat at sum=0.993 → 1 - exp(-0.993) ≈ 0.629
    assert 0.55 < nc.dopamine < 0.70


def test_dop_soft_saturation_flag_on_never_reaches_one(monkeypatch):
    """#934: even at extreme input, soft-sat asymptotes to but never
    reaches 1.0."""
    monkeypatch.setenv("MONKEY_DOP_SOFT_SATURATION_LIVE", "true")
    # Drive dop_from_phi very high; even with maximal dop_from_reward
    # (which is computed internally from reward queue, hard to manipulate
    # here), the formula should never produce exactly 1.0
    nc = _ticker(_base_inputs(phi_delta=20.0))  # sigmoid(20)≈1.0 effectively
    # 1 - exp(-1.0) ≈ 0.632 (just dop_from_phi, no reward)
    assert nc.dopamine < 1.0
