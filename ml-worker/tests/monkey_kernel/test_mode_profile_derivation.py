"""Tests for v0.8.5 MODE_PROFILES anchor-simplex derivation.

P25: operational thresholds emerge from geometric state. Safety bounds
are the only permitted hardcoded constants.

Anchor-simplex pattern: per-mode anchors (SAFETY_BOUND) preserve mode
distinction; state-derived modulation (Φ, neurochemistry, regime weights)
produces the effective profile. At nominal state, effective == anchor.
"""
from __future__ import annotations

import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.modes import (  # noqa: E402
    MODE_PROFILES,
    MonkeyMode,
    effective_profile,
)


# ────────────────────────────────────────────────────────────────
# Nominal anchor preservation
# ────────────────────────────────────────────────────────────────


class TestNominalAnchor:
    """At nominal state (0.5 across all dimensions) effective == anchor."""

    @pytest.mark.parametrize("mode", list(MonkeyMode))
    def test_all_state_dims_at_nominal_match_anchor(self, mode: MonkeyMode):
        anchor = MODE_PROFILES[mode]
        eff = effective_profile(
            mode,
            phi=0.5, serotonin=0.5, norepinephrine=0.5,
            equilibrium_weight=0.5,
        )
        assert eff.tp_base_frac == pytest.approx(anchor.tp_base_frac, abs=1e-9)
        assert eff.sl_ratio == pytest.approx(anchor.sl_ratio, abs=1e-9)
        assert eff.entry_threshold_scale == pytest.approx(
            anchor.entry_threshold_scale, abs=1e-9
        )
        assert eff.size_floor == pytest.approx(anchor.size_floor, abs=1e-9)
        assert eff.sovereign_cap_floor == anchor.sovereign_cap_floor
        assert eff.tick_ms == anchor.tick_ms
        assert eff.can_enter == anchor.can_enter


# ────────────────────────────────────────────────────────────────
# DRIFT lockout is a SAFETY_BOUND — passes through unmodulated
# ────────────────────────────────────────────────────────────────


class TestDriftLockout:
    def test_drift_entry_scale_invariant_to_neurochem(self):
        """No matter the state, DRIFT mode never allows entries."""
        for ne in [0.0, 0.25, 0.5, 0.75, 1.0]:
            eff = effective_profile(
                MonkeyMode.DRIFT, phi=0.9, serotonin=0.1,
                norepinephrine=ne, equilibrium_weight=0.1,
            )
            assert eff.entry_threshold_scale == 99.0

    def test_drift_cannot_enter_flag_preserved(self):
        eff = effective_profile(
            MonkeyMode.DRIFT, phi=0.5, serotonin=0.5,
            norepinephrine=0.5, equilibrium_weight=0.5,
        )
        assert eff.can_enter is False


# ────────────────────────────────────────────────────────────────
# Regime → tp_base_frac
# ────────────────────────────────────────────────────────────────


class TestTpDerivation:
    def test_quantum_regime_widens_tp(self):
        """Volatile regime (low eq_weight) → wider TP."""
        quantum = effective_profile(
            MonkeyMode.INVESTIGATION, phi=0.5, serotonin=0.5,
            norepinephrine=0.5, equilibrium_weight=0.0,
        )
        equilib = effective_profile(
            MonkeyMode.INVESTIGATION, phi=0.5, serotonin=0.5,
            norepinephrine=0.5, equilibrium_weight=1.0,
        )
        assert quantum.tp_base_frac > equilib.tp_base_frac
        # anchor=0.008, quantum multiplier=1.25, equilib=0.75
        assert quantum.tp_base_frac == pytest.approx(0.010, abs=1e-9)
        assert equilib.tp_base_frac == pytest.approx(0.006, abs=1e-9)


# ────────────────────────────────────────────────────────────────
# Serotonin → sl_ratio
# ────────────────────────────────────────────────────────────────


class TestSlDerivation:
    def test_high_serotonin_tightens_sl(self):
        """High stability → tighter SL (let winners run)."""
        hi = effective_profile(
            MonkeyMode.INVESTIGATION, phi=0.5, serotonin=1.0,
            norepinephrine=0.5, equilibrium_weight=0.5,
        )
        lo = effective_profile(
            MonkeyMode.INVESTIGATION, phi=0.5, serotonin=0.0,
            norepinephrine=0.5, equilibrium_weight=0.5,
        )
        assert hi.sl_ratio < lo.sl_ratio
        # Multipliers: hi-ser → 0.85; lo-ser → 1.15. Anchor read at runtime
        # so the test stays correct if the anchor moves (Phase B promoted
        # INVESTIGATION sl_ratio anchor 0.5 → 0.7 in 558667a).
        anchor = MODE_PROFILES[MonkeyMode.INVESTIGATION].sl_ratio
        assert hi.sl_ratio == pytest.approx(anchor * 0.85, abs=1e-9)
        assert lo.sl_ratio == pytest.approx(anchor * 1.15, abs=1e-9)


# ────────────────────────────────────────────────────────────────
# Norepinephrine → entry_threshold_scale
# ────────────────────────────────────────────────────────────────


class TestEntryThresholdDerivation:
    def test_high_ne_lowers_threshold_easier_entry(self):
        """High surprise (NE) → easier entry, lower threshold scale."""
        hi_ne = effective_profile(
            MonkeyMode.INVESTIGATION, phi=0.5, serotonin=0.5,
            norepinephrine=1.0, equilibrium_weight=0.5,
        )
        lo_ne = effective_profile(
            MonkeyMode.INVESTIGATION, phi=0.5, serotonin=0.5,
            norepinephrine=0.0, equilibrium_weight=0.5,
        )
        assert hi_ne.entry_threshold_scale < lo_ne.entry_threshold_scale

    def test_drift_unaffected_by_ne(self):
        hi_ne = effective_profile(
            MonkeyMode.DRIFT, phi=0.5, serotonin=0.5,
            norepinephrine=1.0, equilibrium_weight=0.5,
        )
        lo_ne = effective_profile(
            MonkeyMode.DRIFT, phi=0.5, serotonin=0.5,
            norepinephrine=0.0, equilibrium_weight=0.5,
        )
        assert hi_ne.entry_threshold_scale == lo_ne.entry_threshold_scale == 99.0


# ────────────────────────────────────────────────────────────────
# Φ → size_floor
# ────────────────────────────────────────────────────────────────


class TestSizeFloorDerivation:
    def test_high_phi_raises_floor(self):
        hi_phi = effective_profile(
            MonkeyMode.INVESTIGATION, phi=1.0, serotonin=0.5,
            norepinephrine=0.5, equilibrium_weight=0.5,
        )
        lo_phi = effective_profile(
            MonkeyMode.INVESTIGATION, phi=0.0, serotonin=0.5,
            norepinephrine=0.5, equilibrium_weight=0.5,
        )
        assert hi_phi.size_floor > lo_phi.size_floor
        # anchor=0.10; phi=1.0 mult=1.5 → 0.15; phi=0.0 mult=0.5 → 0.05
        assert hi_phi.size_floor == pytest.approx(0.15, abs=1e-9)
        assert lo_phi.size_floor == pytest.approx(0.05, abs=1e-9)


# ────────────────────────────────────────────────────────────────
# Mode distinction survives derivation (anchor-simplex hazard test)
# ────────────────────────────────────────────────────────────────


class TestAnchorSimplexDistinction:
    """Hazard: if every field derives purely from state, the 4 modes
    collapse to identical profiles at any given state. The anchor-simplex
    approach prevents this — the anchor supplies the per-mode identity.
    """

    def test_tp_ordering_preserved_across_state_space(self):
        """exploration < investigation < integration in tp width at every
        sampled state, because anchors differ. DRIFT is separate family."""
        for phi in [0.0, 0.5, 1.0]:
            for ser in [0.0, 0.5, 1.0]:
                for ne in [0.0, 0.5, 1.0]:
                    for eq in [0.0, 0.5, 1.0]:
                        e = effective_profile(
                            MonkeyMode.EXPLORATION,
                            phi=phi, serotonin=ser,
                            norepinephrine=ne, equilibrium_weight=eq,
                        )
                        i = effective_profile(
                            MonkeyMode.INVESTIGATION,
                            phi=phi, serotonin=ser,
                            norepinephrine=ne, equilibrium_weight=eq,
                        )
                        n = effective_profile(
                            MonkeyMode.INTEGRATION,
                            phi=phi, serotonin=ser,
                            norepinephrine=ne, equilibrium_weight=eq,
                        )
                        assert e.tp_base_frac < i.tp_base_frac < n.tp_base_frac, (
                            f"tp ordering broken at phi={phi} ser={ser} "
                            f"ne={ne} eq={eq}: "
                            f"e={e.tp_base_frac} i={i.tp_base_frac} n={n.tp_base_frac}"
                        )

    def test_size_floor_ordering_preserved_across_state_space(self):
        """exploration < investigation < integration in size floor (anchors
        ordered 0.08 < 0.10 < 0.12); multiplier is shared so ordering holds.
        DRIFT (anchor=0) times any multiplier is still 0."""
        for phi in [0.0, 0.25, 0.5, 0.75, 1.0]:
            e = effective_profile(
                MonkeyMode.EXPLORATION, phi=phi,
                serotonin=0.5, norepinephrine=0.5, equilibrium_weight=0.5,
            )
            i = effective_profile(
                MonkeyMode.INVESTIGATION, phi=phi,
                serotonin=0.5, norepinephrine=0.5, equilibrium_weight=0.5,
            )
            n = effective_profile(
                MonkeyMode.INTEGRATION, phi=phi,
                serotonin=0.5, norepinephrine=0.5, equilibrium_weight=0.5,
            )
            d = effective_profile(
                MonkeyMode.DRIFT, phi=phi,
                serotonin=0.5, norepinephrine=0.5, equilibrium_weight=0.5,
            )
            assert e.size_floor < i.size_floor < n.size_floor
            assert d.size_floor == 0.0  # DRIFT anchor=0, stays 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
