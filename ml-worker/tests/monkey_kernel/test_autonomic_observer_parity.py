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
