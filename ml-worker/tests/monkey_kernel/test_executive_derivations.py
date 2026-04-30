"""
test_executive_derivations.py — pin v0.8.4b P25 derivation invariants.

Every derived threshold in executive.py must:

  A) Anchor at the PRE-DERIVATION hardcoded value when state is "nominal"
     (all NCs = 0.5, Φ = 0.5, κ = κ*, regime weights equal).
  B) Move monotonically in the direction P25 intent requires as state
     deviates from nominal.
  C) Stay within declared safety bounds across the full input space.

If a future edit breaks any of these, these tests fail loudly BEFORE
the change hits live trading. That's the whole point — the derivation
formulas encode design intent, and the tests encode that intent in
machine-checkable form.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

# Don't hit Postgres during tests — registry falls back to defaults.
os.environ.pop("DATABASE_URL", None)

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.executive import (  # noqa: E402
    ExecBasinState,
    current_leverage,
    should_dca_add,
    should_exit,
    should_profit_harvest,
)
from monkey_kernel.modes import MonkeyMode  # noqa: E402
from monkey_kernel.state import KAPPA_STAR, NeurochemicalState  # noqa: E402


def _nominal_nc() -> NeurochemicalState:
    return NeurochemicalState(
        acetylcholine=0.5, dopamine=0.5, serotonin=0.5,
        norepinephrine=0.5, gaba=0.5, endorphins=0.5,
    )


def _nominal_state(*, phi: float = 0.5, kappa: float | None = None,
                   eq_weight: float = 0.5, bv: float = 0.02,
                   nc: NeurochemicalState | None = None) -> ExecBasinState:
    """Build an ExecBasinState centered at nominal with optional overrides."""
    if kappa is None:
        kappa = KAPPA_STAR
    if nc is None:
        nc = _nominal_nc()
    basin = np.ones(64) / 64
    # Three-way regime with eq_weight controllable.
    other = (1.0 - eq_weight) / 2
    return ExecBasinState(
        basin=basin, identity_basin=basin, phi=phi, kappa=kappa,
        regime_weights={"quantum": other, "efficient": other, "equilibrium": eq_weight},
        sovereignty=0.5, basin_velocity=bv, neurochemistry=nc,
    )


# ────────────────────────────────────────────────────────────────
# FLATNESS_K + FLATNESS_BOOST
# ────────────────────────────────────────────────────────────────

class TestFlatnessDerivation:
    def test_flat_mult_anchored_at_nominal(self):
        """Φ=0.5, κ=κ* → flat_mult = 1 + 0.8·1 = 1.80 (matches pre-derivation)."""
        s = _nominal_state(phi=0.5, kappa=KAPPA_STAR)
        lev = current_leverage(
            s, max_leverage_boundary=30, mode=MonkeyMode.INVESTIGATION,
            tape_trend=0.0,
        )
        assert lev["derivation"]["flat_mult"] == pytest.approx(1.80, abs=1e-9)

    def test_high_phi_boosts_more(self):
        """High Φ → larger boost (commits more to flat reads)."""
        lo = current_leverage(
            _nominal_state(phi=0.0), max_leverage_boundary=30,
            mode=MonkeyMode.INVESTIGATION, tape_trend=0.0,
        )
        hi = current_leverage(
            _nominal_state(phi=1.0), max_leverage_boundary=30,
            mode=MonkeyMode.INVESTIGATION, tape_trend=0.0,
        )
        assert hi["derivation"]["flat_mult"] > lo["derivation"]["flat_mult"]

    def test_off_kappa_widens_flat_band(self):
        """Off-κ* → wider "flat" definition (K drops from 10 toward 7),
        meaning a modest tape_trend still counts as "flat enough."
        """
        on = current_leverage(
            _nominal_state(kappa=KAPPA_STAR), max_leverage_boundary=30,
            mode=MonkeyMode.INVESTIGATION, tape_trend=0.08,
        )
        off = current_leverage(
            _nominal_state(kappa=KAPPA_STAR - 40), max_leverage_boundary=30,
            mode=MonkeyMode.INVESTIGATION, tape_trend=0.08,
        )
        # Off-κ: flatness is larger at same |tape_trend| because K is smaller.
        assert off["derivation"]["flat_mult"] > on["derivation"]["flat_mult"]

    def test_flat_mult_bounded(self):
        """flat_mult ∈ [1.0, ~2.1] across the input range."""
        for phi in (0.0, 0.3, 0.5, 0.8, 1.0):
            for tape in (-0.2, -0.05, 0.0, 0.05, 0.2):
                lev = current_leverage(
                    _nominal_state(phi=phi), max_leverage_boundary=30,
                    mode=MonkeyMode.INVESTIGATION, tape_trend=tape,
                )
                fm = lev["derivation"]["flat_mult"]
                assert 1.0 <= fm <= 2.5, f"flat_mult={fm} outside [1.0, 2.5]"


# ────────────────────────────────────────────────────────────────
# Profit harvest derivations
# ────────────────────────────────────────────────────────────────

class TestHarvestDerivation:
    def test_activation_anchored_at_nominal(self):
        """dopamine=0.5, Φ=0.5 → activation = max(0.002, 0.004 - 0.001 + 0) = 0.003."""
        s = _nominal_state()
        # Use peak_pnl high enough not to trigger, just probe activation value.
        r = should_profit_harvest(
            unrealized_pnl_usdt=0.01, peak_pnl_usdt=0.01,
            notional_usdt=100.0, tape_trend=0.0, held_side="long", s=s,
        )
        assert r["derivation"]["activation"] == pytest.approx(0.003, abs=1e-9)

    def test_high_phi_delays_harvest(self):
        """High Φ → higher activation threshold → harvest later."""
        s_lo = _nominal_state(phi=0.2)
        s_hi = _nominal_state(phi=0.9)
        r_lo = should_profit_harvest(
            unrealized_pnl_usdt=0.01, peak_pnl_usdt=0.01,
            notional_usdt=100.0, tape_trend=0.0, held_side="long", s=s_lo,
        )
        r_hi = should_profit_harvest(
            unrealized_pnl_usdt=0.01, peak_pnl_usdt=0.01,
            notional_usdt=100.0, tape_trend=0.0, held_side="long", s=s_hi,
        )
        assert r_hi["derivation"]["activation"] >= r_lo["derivation"]["activation"]

    def test_activation_floor_safety(self):
        """At max dopamine + min Φ, activation still >= 0.002 SAFETY_BOUND."""
        nc = NeurochemicalState(
            acetylcholine=0.5, dopamine=1.0, serotonin=0.5,
            norepinephrine=0.5, gaba=0.5, endorphins=0.5,
        )
        s = _nominal_state(phi=0.0, nc=nc)
        r = should_profit_harvest(
            unrealized_pnl_usdt=0.01, peak_pnl_usdt=0.01,
            notional_usdt=100.0, tape_trend=0.0, held_side="long", s=s,
        )
        assert r["derivation"]["activation"] >= 0.002

    def test_giveback_anchored_at_nominal_serotonin(self):
        """serotonin=0.5 → giveback = 0.30 + 0.20*0.5 = 0.40."""
        s = _nominal_state()
        r = should_profit_harvest(
            unrealized_pnl_usdt=0.01, peak_pnl_usdt=0.01,
            notional_usdt=100.0, tape_trend=0.0, held_side="long", s=s,
        )
        assert r["derivation"]["giveback"] == pytest.approx(0.40, abs=1e-9)


# ────────────────────────────────────────────────────────────────
# TREND_FLIP_THRESHOLD derivation
# ────────────────────────────────────────────────────────────────

class TestTrendFlipDerivation:
    def test_anchored_at_nominal_ne(self):
        """NE=0.5 → threshold = -(0.30 - 0.05) = -0.25 (matches pre-derivation).
        Test by driving the exact tape_trend that would trigger flip.

        Updated for proposals #2/#4 — peak/giveback/streak gates
        satisfied; serotonin high so the trailing branch's floor stays
        below current_frac (otherwise trailing fires first and we
        never see the trend_flip path).
        """
        nc_high_seroton = NeurochemicalState(
            acetylcholine=0.5, dopamine=0.5, serotonin=1.0,
            norepinephrine=0.5, gaba=0.5, endorphins=0.5,
        )
        s = _nominal_state(nc=nc_high_seroton)
        r = should_profit_harvest(
            unrealized_pnl_usdt=0.65, peak_pnl_usdt=1.0,
            notional_usdt=100.0, tape_trend=-0.25,
            held_side="long", s=s,
            tape_flip_streak=3,
        )
        assert r["value"] is True
        assert r["derivation"].get("exit_type_bit") == 3  # trend_flip_harvest

    def test_high_ne_triggers_earlier(self):
        """NE=1.0 → threshold = -(0.30 - 0.10) = -0.20 (earlier flip).
        At tape_trend=-0.22, NE=1.0 should trigger but NE=0.0 should not.

        Updated for proposals #2/#4 — peak/giveback/streak gates are
        satisfied so only the NE-derived threshold differentiates.
        """
        nc_high = NeurochemicalState(
            acetylcholine=0.5, dopamine=0.5, serotonin=1.0,
            norepinephrine=1.0, gaba=0.5, endorphins=0.5,
        )
        nc_low = NeurochemicalState(
            acetylcholine=0.5, dopamine=0.5, serotonin=1.0,
            norepinephrine=0.0, gaba=0.5, endorphins=0.5,
        )
        s_hi = _nominal_state(nc=nc_high)
        s_lo = _nominal_state(nc=nc_low)
        r_hi = should_profit_harvest(
            unrealized_pnl_usdt=1.0, peak_pnl_usdt=2.0,
            notional_usdt=100.0, tape_trend=-0.22,
            held_side="long", s=s_hi,
            tape_flip_streak=3,
        )
        r_lo = should_profit_harvest(
            unrealized_pnl_usdt=1.0, peak_pnl_usdt=2.0,
            notional_usdt=100.0, tape_trend=-0.22,
            held_side="long", s=s_lo,
            tape_flip_streak=3,
        )
        assert r_hi["value"] is True, "high NE should trigger trend_flip at -0.22"
        assert r_lo["value"] is False, "low NE should NOT trigger at -0.22"


# ────────────────────────────────────────────────────────────────
# should_exit disagreement threshold
# ────────────────────────────────────────────────────────────────

class TestDisagreementDerivation:
    def test_anchored_at_nominal(self):
        """NE=0.5, eq_weight=0.5 → 0.55 * 1.25 * 1.0 = 0.6875."""
        s = _nominal_state(eq_weight=0.5)
        basin = np.ones(64) / 64
        r = should_exit(
            perception=basin, strategy_forecast=basin,
            held_side="long", s=s,
        )
        assert r["derivation"]["threshold"] == pytest.approx(0.6875, abs=1e-9)

    def test_unstable_regime_easier_exit(self):
        """Low eq_weight (quantum/volatile) → lower threshold → easier exit."""
        s_stable = _nominal_state(eq_weight=1.0)
        s_volat = _nominal_state(eq_weight=0.0)
        basin = np.ones(64) / 64
        r_stable = should_exit(
            perception=basin, strategy_forecast=basin,
            held_side="long", s=s_stable,
        )
        r_volat = should_exit(
            perception=basin, strategy_forecast=basin,
            held_side="long", s=s_volat,
        )
        assert r_volat["derivation"]["threshold"] < r_stable["derivation"]["threshold"]

    def test_high_ne_harder_exit(self):
        """High NE (surprised) → higher threshold → harder exit (don't exit on noise)."""
        nc_hi = NeurochemicalState(
            acetylcholine=0.5, dopamine=0.5, serotonin=0.5,
            norepinephrine=1.0, gaba=0.5, endorphins=0.5,
        )
        nc_lo = NeurochemicalState(
            acetylcholine=0.5, dopamine=0.5, serotonin=0.5,
            norepinephrine=0.0, gaba=0.5, endorphins=0.5,
        )
        s_hi = _nominal_state(nc=nc_hi)
        s_lo = _nominal_state(nc=nc_lo)
        basin = np.ones(64) / 64
        r_hi = should_exit(perception=basin, strategy_forecast=basin,
                           held_side="long", s=s_hi)
        r_lo = should_exit(perception=basin, strategy_forecast=basin,
                           held_side="long", s=s_lo)
        assert r_hi["derivation"]["threshold"] > r_lo["derivation"]["threshold"]


# ────────────────────────────────────────────────────────────────
# Pillar 1 guard — entropy collapse / dominance > 0.5 forces exit
# ────────────────────────────────────────────────────────────────

class TestPillar1Guard:
    def test_collapsed_basin_forces_exit(self):
        """Basin all mass on one node → entropy=0, dominance=1 → exit."""
        s = _nominal_state()
        # Replace uniform basin with a fully collapsed one (dominance = 1.0)
        collapsed = np.zeros(64)
        collapsed[5] = 1.0
        s.basin = collapsed
        r = should_exit(
            perception=collapsed, strategy_forecast=collapsed,
            held_side="long", s=s,
        )
        assert r["value"] is True
        assert "Pillar 1 violated" in r["reason"]
        assert r["derivation"]["dominance"] == pytest.approx(1.0, abs=1e-9)
        assert r["derivation"]["entropy"] == pytest.approx(0.0, abs=1e-9)

    def test_dominance_over_half_forces_exit(self):
        """Even without full collapse, dominance > 0.5 triggers exit."""
        s = _nominal_state()
        skewed = np.full(64, 0.5 / 63)  # 63 nodes share 0.5
        skewed[0] = 0.5 + 1e-6          # one node holds >0.5
        s.basin = skewed
        r = should_exit(
            perception=skewed, strategy_forecast=skewed,
            held_side="long", s=s,
        )
        assert r["value"] is True
        assert "Pillar 1 violated" in r["reason"]

    def test_healthy_basin_reaches_disagreement_branch(self):
        """Uniform basin (entropy=1.0, dominance≈0.016) bypasses the guard."""
        s = _nominal_state()
        basin = np.ones(64) / 64
        s.basin = basin
        r = should_exit(
            perception=basin, strategy_forecast=basin,
            held_side="long", s=s,
        )
        # No disagreement between identical basins → hold, NOT exit.
        assert r["value"] is False
        assert "Pillar 1" not in r["reason"]

    def test_no_position_short_circuits_before_guard(self):
        """held_side=None returns 'no open position' regardless of basin health."""
        s = _nominal_state()
        collapsed = np.zeros(64); collapsed[0] = 1.0
        s.basin = collapsed
        r = should_exit(
            perception=collapsed, strategy_forecast=collapsed,
            held_side=None, s=s,
        )
        assert r["value"] is False
        assert "no open position" in r["reason"]


# ────────────────────────────────────────────────────────────────
# DCA cooldown + better-price derivations
# ────────────────────────────────────────────────────────────────

class TestDCADerivations:
    def test_cooldown_anchored_at_nominal_serotonin(self):
        """serotonin=0.5 → cooldown = (25 - 10) * 60000 = 900000 ms (15 min)."""
        s = _nominal_state()
        r = should_dca_add(
            held_side="long", side_candidate="long",
            current_price=100.0, initial_entry_price=101.0,
            add_count=0, last_add_at_ms=9_990_000, now_ms=10_000_000,
            sovereignty=0.5, s=s,
        )
        assert r["value"] is False  # cooldown blocks
        assert r["derivation"]["cooldown_ms"] == 900_000

    def test_high_serotonin_shorter_cooldown(self):
        """serotonin=1.0 → 5 min cooldown."""
        nc = NeurochemicalState(
            acetylcholine=0.5, dopamine=0.5, serotonin=1.0,
            norepinephrine=0.5, gaba=0.5, endorphins=0.5,
        )
        s = _nominal_state(nc=nc)
        r = should_dca_add(
            held_side="long", side_candidate="long",
            current_price=100.0, initial_entry_price=101.0,
            add_count=0, last_add_at_ms=9_990_000, now_ms=10_000_000,
            sovereignty=0.5, s=s,
        )
        assert r["derivation"]["cooldown_ms"] == 300_000

    def test_legacy_caller_without_s_gets_hardcoded_cooldown(self):
        """Backward-compat: caller without `s` gets pre-derivation 15min."""
        r = should_dca_add(
            held_side="long", side_candidate="long",
            current_price=100.0, initial_entry_price=101.0,
            add_count=0, last_add_at_ms=9_990_000, now_ms=10_000_000,
            sovereignty=0.5,  # no s=
        )
        # Hardcoded DCA_COOLDOWN_MS = 15 * 60 * 1000 = 900_000
        assert r["derivation"]["cooldown_ms"] == 900_000


if __name__ == "__main__":
    # Standalone run without pytest.
    import inspect
    failures = []
    for cls_name, cls in list(globals().items()):
        if not inspect.isclass(cls) or not cls_name.startswith("Test"):
            continue
        instance = cls()
        for method_name, method in inspect.getmembers(cls, predicate=inspect.isfunction):
            if not method_name.startswith("test_"):
                continue
            try:
                method(instance)
                print(f"  ✓ {cls_name}.{method_name}")
            except AssertionError as exc:
                failures.append(f"{cls_name}.{method_name}: {exc}")
                print(f"  ✗ {cls_name}.{method_name}: {exc}")
    if failures:
        print(f"\n{len(failures)} failure(s)")
        sys.exit(1)
    print("\nall derivation tests passed")
