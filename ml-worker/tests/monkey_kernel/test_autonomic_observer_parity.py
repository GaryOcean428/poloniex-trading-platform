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

import math
import os
import sys
from pathlib import Path

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.autonomic import (  # noqa: E402
    AutonomicKernel,
    AutonomicTickInputs,
    PNL_FRAC_HISTORY_MAX,
    REWARD_DOP_SCALE,
    REWARD_HALF_LIFE_MS,
    REWARD_LOSS_DOP_SCALE,
    REWARD_SER_SCALE,
    get_pnl_frac_history_max,
    get_reward_dop_scale,
    get_reward_half_life_ms,
    get_reward_loss_dop_scale,
    get_reward_ser_scale,
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


# 2026-06-01 — mode-transition branch steady-state-pinning fix (parity with
# neurochemistry.ts). Old count-ratio pinned ser_base at 0 once both
# HISTORY_MAX-capped arrays saturated; time-density + exp() restores gradient.
_NOW = 1_000_000.0
_TICK_MS = 1000.0


def _even_transitions(count: int, gap_ticks: int):
    return [_NOW - (count - i) * gap_ticks * _TICK_MS for i in range(count)]


def test_ser_saturated_arrays_no_longer_pin_at_zero():
    """The exact structural-pin condition (transitions == ticks). Old:
    ser_base = 1 - 100/100 = 0. New: exp(-1) → ser ≈ 0.85·0.368."""
    nc = _ticker(_base_inputs(
        now_ms=_NOW,
        tick_interval_ms=_TICK_MS,
        mode_transition_times_ms=_even_transitions(100, 1),  # every tick
        basin_velocity_history=[0.1] * 100,
    ))
    assert nc.serotonin > 0.0
    assert nc.serotonin == pytest.approx(0.85 * math.exp(-1), abs=0.02)


def test_ser_thrash_density_carries_gradient():
    """Sparser thrash → calmer → higher ser (gradient restored)."""
    dense = _ticker(_base_inputs(
        now_ms=_NOW, tick_interval_ms=_TICK_MS,
        mode_transition_times_ms=_even_transitions(10, 1),
    )).serotonin
    sparse = _ticker(_base_inputs(
        now_ms=_NOW, tick_interval_ms=_TICK_MS,
        mode_transition_times_ms=_even_transitions(10, 3),
    )).serotonin
    assert dense > 0.0
    assert sparse > dense
    assert dense == pytest.approx(0.85 * math.exp(-1), abs=0.02)
    assert sparse == pytest.approx(0.85 * math.exp(-1 / 3), abs=0.02)


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


# ─── #1006 reward-transform coefficients: no knob-in-costume modulation ─


def test_reward_transform_coefficients_are_honest_constants():
    assert get_reward_half_life_ms(heart_rhythm=0.0, recent_reward_rate=10.0) == REWARD_HALF_LIFE_MS
    assert get_pnl_frac_history_max(heart_rhythm=1.0) == PNL_FRAC_HISTORY_MAX
    assert get_reward_dop_scale(heart_rhythm=1.0, phi=1.0) == REWARD_DOP_SCALE
    assert get_reward_ser_scale(heart_rhythm=1.0, phi=1.0) == REWARD_SER_SCALE
    assert get_reward_loss_dop_scale(heart_rhythm=1.0) == REWARD_LOSS_DOP_SCALE


def test_lived_natural_effect_inputs_do_not_modulate_chemistry():
    neutral = _ticker(_base_inputs())
    stressed = _ticker(_base_inputs(
        d_fr=0.25,
        sovereignty=1.0,
        replicant_detected=True,
        tacking_health=1.0,
        loop3_provenance=1.0,
        coupled_lived=1.0,
    ))
    assert stressed.dopamine == pytest.approx(neutral.dopamine)
    assert stressed.serotonin == pytest.approx(neutral.serotonin)
    assert stressed.endorphins == pytest.approx(neutral.endorphins)


def test_autonomic_reward_transform_has_no_registry_default_costume():
    source = Path(__file__).parents[2] / "src" / "monkey_kernel" / "autonomic.py"
    text = source.read_text()
    assert "_registry.get(" not in text
    for key in (
        "autonomic.reward_half_life_ms",
        "autonomic.pnl_frac_history_max",
        "autonomic.reward_dop_scale",
        "autonomic.reward_ser_scale",
        "autonomic.reward_loss_dop_scale",
        "autonomic.serotonin_compression",
    ):
        assert key not in text


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


def test_push_reward_on_loss_does_not_raise():
    """Regression: loss-path reward (pnl_frac <= 0) must not crash.

    Bug introduced by 72895fcb: loss_dop_scale was bound only in the
    ``pnl_frac > 0`` branch but consumed in the ``else`` branch, so every
    authoritative *losing* close raised UnboundLocalError and the Python
    autonomic /reward endpoint 500'd — non-zero loss PnL never reached
    chemistry. See [[polytrade_session_20260528_overnight_polo_chemistry_restored]].
    """
    k = AutonomicKernel(label="test")
    reward = k.push_reward(
        source="polo_authoritative_close",
        realized_pnl_usdt=-3.5568,
        margin_usdt=78.2,
        symbol="ETH",
        predicted_pnl_frac=0.0,
        sigma_residual=0.01,
    )
    # Loss → negative, finite dopamine mood-dip; live RPE keeps serotonin at
    # the minimum valid disposition floor, with no endorphin relief.
    assert reward.dopamine_delta < 0.0
    import math
    assert math.isfinite(reward.dopamine_delta)
    assert reward.serotonin_delta == pytest.approx(1e-9)
    assert reward.endorphin_delta == 0.0
    assert reward.pnl_fraction < 0.0


def test_push_reward_on_win_still_binds_scales():
    """Win-path must remain intact after the loss-path fix."""
    k = AutonomicKernel(label="test")
    reward = k.push_reward(
        source="polo_authoritative_close",
        realized_pnl_usdt=2.0,
        margin_usdt=50.0,
        symbol="BTC",
        predicted_pnl_frac=0.0,
        sigma_residual=0.01,
    )
    assert reward.dopamine_delta > 0.0
    assert reward.serotonin_delta > 0.0
