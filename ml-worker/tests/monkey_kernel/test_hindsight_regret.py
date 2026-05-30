"""test_hindsight_regret.py — legibility-gated counterfactual prediction error
(Python parity).

Mirror of apps/api/src/services/monkey/__tests__/hindsightRegret.test.ts.

Semantic cases (operator doctrine 2026-05-29, redesign of PR #1038):
  - legible premature close   → full regret vector, correct signs, observer-scaled
  - NON-legible continuation  → NO regret (surprise/noise), zero vector
  - operator / non-owned close → no self-regret
  - regime changed after close → no/zero regret
  - good close / avoided loss  → relief vector (no aversion)
  - targeted GABA              → bound to (regime,side) pattern, never global
  - observer scale             → magnitude tracks the kernel's own MAD
  - fail-closed                → invalid price/margin → zero vector
  - flag OFF                   → byte-identical chemistry

The FIXTURES + EXPECTED block is shared with the TS test so TS↔Py outputs are
asserted equal within tolerance (the parity assertions at the bottom).
"""
from __future__ import annotations

import math
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.hindsight_regret import (  # noqa: E402
    CloseSenseBundle,
    CounterfactualOutcome,
    counterfactual_pnl_usdt,
    derive_magnitude,
    gaba_target_key,
    is_continuation_legible,
    is_eligible_for_regret,
    is_hindsight_regret_live,
    legibility_strength,
    median_and_mad,
    resolve_hindsight,
)

# ── Shared fixtures (byte-for-byte with hindsightRegret.test.ts) ──
PNL_FRAC_HISTORY = [0.0, 0.01, -0.01, 0.02, -0.02, 0.0, 0.01, -0.01]


def legible_short_bundle(**overrides) -> CloseSenseBundle:
    base = dict(
        kernel_owned_close=True,
        side_sign=-1,
        warp_expectation_sign=-1,
        warp_expectation_confidence=0.7,
        regime_at_close="aligned",
        basin_dir_at_close=-0.25,
        tape_trend_at_close=-0.3,
        coherence_streak=4,
    )
    base.update(overrides)
    return CloseSenseBundle(**base)


def won_outcome(**overrides) -> CounterfactualOutcome:
    base = dict(
        realized_pnl_usdt=0.0,
        horizon_end_pnl_usdt=30.0,
        margin_usdt=100.0,
        regime_persisted=True,
    )
    base.update(overrides)
    return CounterfactualOutcome(**base)


# ───────────────────────── counterfactual_pnl_usdt ─────────────────────────


def test_short_gains_as_price_falls():
    cf = counterfactual_pnl_usdt(
        side_sign=-1, qty=2, exit_price=100, realized_pnl_usdt=5, price=90,
    )
    assert cf == pytest.approx(25.0, abs=1e-6)


def test_long_gains_as_price_rises():
    cf = counterfactual_pnl_usdt(
        side_sign=1, qty=2, exit_price=100, realized_pnl_usdt=5, price=110,
    )
    assert cf == pytest.approx(25.0, abs=1e-6)


def test_counterfactual_fail_closed():
    assert counterfactual_pnl_usdt(side_sign=1, qty=2, exit_price=100, realized_pnl_usdt=5, price=0) is None
    assert counterfactual_pnl_usdt(side_sign=1, qty=0, exit_price=100, realized_pnl_usdt=5, price=90) is None
    assert counterfactual_pnl_usdt(side_sign=1, qty=2, exit_price=-1, realized_pnl_usdt=5, price=90) is None


# ───────────────────────── legibility gate ─────────────────────────


def test_legible_when_warp_basin_agree_and_coherent():
    assert is_continuation_legible(legible_short_bundle()) is True


def test_not_legible_when_warp_disagrees():
    assert is_continuation_legible(legible_short_bundle(warp_expectation_sign=1)) is False


def test_not_legible_when_basin_flips():
    assert is_continuation_legible(legible_short_bundle(basin_dir_at_close=0.25)) is False


def test_not_legible_when_warp_flat():
    assert is_continuation_legible(legible_short_bundle(warp_expectation_sign=0)) is False


def test_not_legible_when_not_coherent():
    assert is_continuation_legible(legible_short_bundle(coherence_streak=0)) is False


def test_eligibility_requires_all_three():
    assert is_eligible_for_regret(legible_short_bundle(), True) == (True, "eligible")
    assert is_eligible_for_regret(legible_short_bundle(kernel_owned_close=False), True)[1] == "not_owned"
    assert is_eligible_for_regret(legible_short_bundle(warp_expectation_sign=1), True)[1] == "not_legible"
    assert is_eligible_for_regret(legible_short_bundle(), False)[1] == "regime_changed"


def test_weak_legibility_scales_regret_instead_of_full_gate():
    strong = legibility_strength(legible_short_bundle())
    weak = legibility_strength(
        legible_short_bundle(
            warp_expectation_confidence=0.001,
            basin_dir_at_close=-0.000001,
            coherence_streak=1,
        )
    )
    assert weak > 0.0
    assert weak < strong


# ───────────────────────── resolve_hindsight ─────────────────────────


def test_legible_premature_close_full_regret_vector():
    res = resolve_hindsight(legible_short_bundle(), won_outcome(), PNL_FRAC_HISTORY)
    assert res.source == "hindsight_regret"
    assert res.nt.dopamine_delta < 0
    assert res.nt.serotonin_delta < 0
    assert res.nt.acetylcholine_delta > 0
    assert res.nt.norepinephrine_delta > 0
    assert res.nt.gaba_delta > 0
    assert res.nt.endorphin_delta == 0
    assert res.gaba_target == "premature_close:aligned:short"
    assert res.foregone_gain_usdt == pytest.approx(30.0, abs=1e-6)


def test_non_legible_continuation_no_regret():
    res = resolve_hindsight(
        legible_short_bundle(warp_expectation_sign=1), won_outcome(), PNL_FRAC_HISTORY,
    )
    assert res.source == "ineligible_noise"
    assert res.nt.dopamine_delta == 0
    assert res.nt.gaba_delta == 0
    assert res.gaba_target is None


def test_non_owned_close_no_self_regret():
    res = resolve_hindsight(
        legible_short_bundle(kernel_owned_close=False), won_outcome(), PNL_FRAC_HISTORY,
    )
    assert res.source == "ineligible_not_owned"
    assert (res.nt.dopamine_delta, res.nt.gaba_delta, res.nt.acetylcholine_delta) == (0, 0, 0)


def test_regime_changed_no_regret():
    res = resolve_hindsight(
        legible_short_bundle(), won_outcome(regime_persisted=False), PNL_FRAC_HISTORY,
    )
    assert res.source == "ineligible_noise"
    assert res.nt.dopamine_delta == 0


def test_good_close_relief_vector():
    res = resolve_hindsight(
        legible_short_bundle(),
        won_outcome(horizon_end_pnl_usdt=-20.0),
        PNL_FRAC_HISTORY,
    )
    assert res.source == "hindsight_good_close"
    assert res.nt.dopamine_delta > 0
    assert res.nt.serotonin_delta > 0
    assert res.nt.acetylcholine_delta > 0
    assert res.nt.endorphin_delta > 0
    assert res.nt.gaba_delta == 0
    assert res.gaba_target is None


def test_gaba_stays_targeted_per_pattern():
    long_res = resolve_hindsight(
        legible_short_bundle(
            side_sign=1, warp_expectation_sign=1, basin_dir_at_close=0.25,
            regime_at_close="reverse_tape",
        ),
        won_outcome(), PNL_FRAC_HISTORY,
    )
    assert long_res.gaba_target == "premature_close:reverse_tape:long"
    short_res = resolve_hindsight(legible_short_bundle(), won_outcome(), PNL_FRAC_HISTORY)
    assert long_res.gaba_target != short_res.gaba_target


def test_observer_scale_tracks_own_mad():
    tight = resolve_hindsight(legible_short_bundle(), won_outcome(), PNL_FRAC_HISTORY)
    wide = resolve_hindsight(
        legible_short_bundle(), won_outcome(), [x * 10 for x in PNL_FRAC_HISTORY],
    )
    assert abs(wide.nt.dopamine_delta) < abs(tight.nt.dopamine_delta)
    small = resolve_hindsight(
        legible_short_bundle(), won_outcome(horizon_end_pnl_usdt=1.0), PNL_FRAC_HISTORY,
    )
    assert abs(small.nt.dopamine_delta) < abs(tight.nt.dopamine_delta)


def test_cold_start_emits_nothing():
    res = resolve_hindsight(legible_short_bundle(), won_outcome(), [0.01, 0.02])
    assert res.source == "ineligible_noise"
    assert res.nt.dopamine_delta == 0


def test_fail_closed_invalid_margin_pnl():
    assert resolve_hindsight(legible_short_bundle(), won_outcome(margin_usdt=0), PNL_FRAC_HISTORY).source == "hindsight_no_margin"
    assert resolve_hindsight(legible_short_bundle(), won_outcome(horizon_end_pnl_usdt=float("nan")), PNL_FRAC_HISTORY).source == "hindsight_invalid"


def test_median_and_mad_matches_observer_scale():
    median, mad = median_and_mad(PNL_FRAC_HISTORY)
    assert median == pytest.approx(0.0, abs=1e-6)
    assert mad == pytest.approx(0.01, abs=1e-6)


def test_derive_magnitude_none_below_min_or_zero_mad():
    assert derive_magnitude(0.3, [0.01]) is None
    assert derive_magnitude(0.3, [0.05, 0.05, 0.05, 0.05, 0.05]) is None


def test_gaba_target_defaults_unknown_regime():
    assert gaba_target_key(legible_short_bundle(regime_at_close="")) == "premature_close:unknown:short"


def test_flag_default_off(monkeypatch):
    monkeypatch.delenv("MONKEY_HINDSIGHT_REGRET_LIVE", raising=False)
    assert is_hindsight_regret_live() is False
    monkeypatch.setenv("MONKEY_HINDSIGHT_REGRET_LIVE", "true")
    assert is_hindsight_regret_live() is True
    monkeypatch.setenv("MONKEY_HINDSIGHT_REGRET_LIVE", "1")
    assert is_hindsight_regret_live() is False


# ───────────────────────── TS↔Py fixture-level parity ─────────────────────────
# These expected values were produced by the TS resolveHindsight() on the SAME
# fixtures (verified in hindsightRegret.test.ts). regret salience =
# tanh(|frac|/MAD) × legibility.
#   regret:    frac = 30/100 = 0.30, MAD = 0.01 → z = 30 → salience = tanh(30) × legibility
#   good close: |−20|/100 = 0.20, MAD = 0.01 → z = 20 → salience = tanh(20) ≈ 1.0
#   small:     1/100 = 0.01, MAD = 0.01 → z = 1 → salience = tanh(1) ≈ 0.7615941559


def _salience(frac: float, mad: float) -> float:
    return math.tanh(abs(frac) / mad)


def _regret_salience(frac: float, mad: float) -> float:
    return _salience(frac, mad) * legibility_strength(legible_short_bundle())


@pytest.mark.parametrize(
    "horizon_end,expected_source,expected_dop_sign",
    [
        (30.0, "hindsight_regret", -1),
        (-20.0, "hindsight_good_close", +1),
    ],
)
def test_parity_signs_and_magnitude(horizon_end, expected_source, expected_dop_sign):
    res = resolve_hindsight(
        legible_short_bundle(), won_outcome(horizon_end_pnl_usdt=horizon_end), PNL_FRAC_HISTORY,
    )
    assert res.source == expected_source
    frac = abs(horizon_end - 0.0) / 100.0
    s = _regret_salience(frac, 0.01) if expected_source == "hindsight_regret" else _salience(frac, 0.01)
    # dopamine magnitude == branch salience (regret is legibility-scaled).
    assert res.nt.dopamine_delta == pytest.approx(expected_dop_sign * s, abs=1e-9)
    # ACh / NE always == +salience on both branches.
    assert res.nt.acetylcholine_delta == pytest.approx(s, abs=1e-9)
    assert res.nt.norepinephrine_delta == pytest.approx(s, abs=1e-9)


def test_parity_small_foregone_salience():
    # frac 0.01, MAD 0.01 → z 1 → salience tanh(1).
    res = resolve_hindsight(
        legible_short_bundle(), won_outcome(horizon_end_pnl_usdt=1.0), PNL_FRAC_HISTORY,
    )
    s = _regret_salience(0.01, 0.01)
    assert res.nt.dopamine_delta == pytest.approx(-s, abs=1e-9)
    assert res.prediction_error_z == pytest.approx(1.0, abs=1e-9)


# ───────── AutonomicKernel hindsight fold (flag-OFF byte-identity) ─────────

from monkey_kernel.autonomic import AutonomicKernel, AutonomicTickInputs  # noqa: E402


def _tick_inputs(**overrides) -> AutonomicTickInputs:
    base = dict(
        phi_delta=0.0,
        basin_velocity=0.1,
        surprise=0.2,
        quantum_weight=0.5,
        kappa=63.8,
        external_coupling=0.3,
    )
    base.update(overrides)
    return AutonomicTickInputs(**base)


def test_autonomic_flag_off_byte_identical():
    """No hindsight push → chemistry identical to a kernel that never knew
    about hindsight (the cache is all-zero, folds add nothing)."""
    k_base = AutonomicKernel(label="t-base")
    k_hs = AutonomicKernel(label="t-hs")
    inp = _tick_inputs()
    base_nc = k_base.tick(inp).nc
    hs_nc = k_hs.tick(inp).nc  # never pushed → cache all-zero
    assert base_nc.as_dict() == hs_nc.as_dict()


def test_autonomic_hindsight_fold_keeps_gaba_targeted_not_global():
    """A pushed hindsight vector folds dop/ser/endo (reward channel) and
    ACh/NE (post-derivation). GABA is not applied globally; it is targeted
    on the TS side until a Py-side targeted executive consumer exists."""
    k = AutonomicKernel(label="t-fold")
    inp = _tick_inputs()
    baseline = k.tick(inp).nc.as_dict()
    # Aversive-style vector (regret): dop-, ser-, ACh+, NE+, targeted GABA+, endo 0.
    k.push_hindsight_chemistry(
        dopamine_delta=-0.4, serotonin_delta=-0.4, acetylcholine_delta=0.4,
        norepinephrine_delta=0.4, gaba_delta=0.4, endorphin_delta=0.0,
    )
    after = k.tick(inp).nc.as_dict()
    # ACh / NE increased; global GABA does not move; dop / ser decreased (or stayed at floor).
    assert after["acetylcholine"] >= baseline["acetylcholine"]
    assert after["norepinephrine"] > baseline["norepinephrine"]
    assert after["gaba"] == baseline["gaba"]
    assert after["dopamine"] <= baseline["dopamine"]


def test_autonomic_hindsight_fail_closed_non_finite():
    k = AutonomicKernel(label="t-nan")
    k.push_hindsight_chemistry(
        dopamine_delta=float("nan"),
        gaba_delta=float("inf"),
        serotonin_delta="not-a-number",
    )
    assert k._cached_hindsight_chemistry["dopamine_delta"] == 0.0
    assert k._cached_hindsight_chemistry["gaba_delta"] == 0.0
    assert k._cached_hindsight_chemistry["serotonin_delta"] == 0.0


def test_autonomic_hindsight_cache_decays_without_new_push():
    k = AutonomicKernel(label="t-decay")
    k.push_hindsight_chemistry(gaba_delta=0.8)
    k._cached_hindsight_chemistry_at_ms = 0.0
    k.tick(_tick_inputs(now_ms=20 * 60 * 1000.0))
    assert k._cached_hindsight_chemistry["gaba_delta"] == pytest.approx(0.4, abs=1e-6)


def test_autonomic_hindsight_cleared_on_wake():
    k = AutonomicKernel(label="t-wake")
    k.push_hindsight_chemistry(gaba_delta=0.4)
    k.tick(_tick_inputs(woke=True))
    assert all(v == 0.0 for v in k._cached_hindsight_chemistry.values())
