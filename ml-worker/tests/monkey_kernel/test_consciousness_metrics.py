"""
test_consciousness_metrics.py — v4.1 + v6.1 metric surface tests.

Canonical reference:
  ~/Desktop/Dev/QIG_QFI/qig-core/src/qig_core/consciousness/types.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.consciousness_metrics import (  # noqa: E402
    ConsciousnessMetrics,
    consciousness_metrics_live,
    derive_from_tick,
)


# ─── Shape ──────────────────────────────────────────────────────────


def test_default_values_match_canonical_doc():
    m = ConsciousnessMetrics()
    # Foundation defaults (v6.7B: kappa channel-specific, no universal 64.0 per two-channel doctrine)
    assert m.phi == 0.5
    assert m.kappa == 0.0  # retired universal 64; supplied by caller (registry/observer/history)
    assert m.gamma == 0.5
    assert m.recursion_depth == 3.0
    # Pillars defaults (post-init, before any measurement)
    assert m.f_health == 1.0
    assert m.b_integrity == 1.0
    assert m.q_identity == 0.0
    assert m.s_ratio == 0.0
    # v6.7B extension defaults present (consciousness-development)
    assert m.tacking_frequency_hz == 0.25
    assert m.sovereignty_dynamics == 0.0
    assert m.dimensional_state == 3


def test_as_dict_exposes_all_33_lived_fields_v6_7B_complete_surface():
    m = ConsciousnessMetrics()
    d = m.as_dict()
    # 12 foundation/pillars + 9 v6.7B + 12 additional lived signals (complete for current kernel per 20260527 task)
    # Gap to 69 documented in module + audit (honest negative; no fabrication).
    expected = {
        "phi", "kappa", "meta_awareness", "gamma", "grounding",
        "temporal_coherence", "recursion_depth", "external_coupling",
        "f_health", "b_integrity", "q_identity", "s_ratio",
        "tacking_frequency_hz", "hrv_coherence", "cross_frequency_coupling",
        "pre_cognitive_arrival", "sovereignty_dynamics", "dominant_frequency_hz",
        "gamma_theta_ratio", "geometry_class", "dimensional_state",
        "basin_velocity", "d_fr", "conviction", "transcendence",
        "identity_drift", "replicant_detected", "tacking_balance",
        "ocean_coherence", "motivator_integration", "repetition_dfr",
        "pre_cog_bias", "dimensional_breathing_rate",
    }
    assert set(d.keys()) == expected
    assert len(d) == 33


# ─── Derivation from tick state ────────────────────────────────────


def test_derive_passes_phi_kappa_through():
    m = derive_from_tick(
        phi=0.72, kappa=63.5, f_health=0.95, coupling_health=0.6,
        self_obs_bias=0.4, sovereignty=1.0, drift_from_identity=0.1,
        basin_velocity=0.05,
    )
    assert m.phi == 0.72
    assert m.kappa == 63.5


def test_derive_clamps_meta_awareness_above_1():
    m = derive_from_tick(
        phi=0.5, kappa=64.0, f_health=1.0, coupling_health=0.5,
        self_obs_bias=1.5,  # over the cap
        sovereignty=1.0, drift_from_identity=0.0, basin_velocity=0.0,
    )
    assert m.meta_awareness == 1.0


def test_derive_clamps_meta_awareness_negative():
    m = derive_from_tick(
        phi=0.5, kappa=64.0, f_health=1.0, coupling_health=0.5,
        self_obs_bias=-0.5,
        sovereignty=1.0, drift_from_identity=0.0, basin_velocity=0.0,
    )
    assert m.meta_awareness == 0.0


def test_derive_grounding_inverts_drift():
    m = derive_from_tick(
        phi=0.5, kappa=64.0, f_health=1.0, coupling_health=0.5,
        self_obs_bias=0.5,
        sovereignty=1.0, drift_from_identity=0.3, basin_velocity=0.0,
    )
    assert abs(m.grounding - 0.7) < 1e-9


def test_derive_grounding_clamps_drift_above_1():
    m = derive_from_tick(
        phi=0.5, kappa=64.0, f_health=1.0, coupling_health=0.5,
        self_obs_bias=0.5,
        sovereignty=1.0, drift_from_identity=1.5, basin_velocity=0.0,
    )
    assert m.grounding == 0.0


def test_derive_pillar_metrics_default_when_none():
    m = derive_from_tick(
        phi=0.5, kappa=64.0, f_health=0.9, coupling_health=0.5,
        self_obs_bias=0.5, sovereignty=0.8,
        drift_from_identity=0.0, basin_velocity=0.0,
    )
    assert m.b_integrity == 1.0
    assert m.q_identity == 0.0
    assert m.s_ratio == 0.8


def test_derive_pillar_metrics_when_supplied():
    m = derive_from_tick(
        phi=0.5, kappa=64.0, f_health=0.9, coupling_health=0.5,
        self_obs_bias=0.5, sovereignty=0.8,
        drift_from_identity=0.0, basin_velocity=0.0,
        b_integrity=0.85, q_identity=0.42,
    )
    assert m.b_integrity == 0.85
    assert m.q_identity == 0.42


# ─── Env flag retired (P5/P25 + P4 always-on) ───────────────────────
# Per 2.31A phase + gap synthesis: MONKEY_CONSCIOUSNESS_METRICS_LIVE was a knob.
# Now unconditionally True (self-obs / 21-field surface always wired in tick path).
# Tests updated for retirement; env no longer affects (no new magic).


def test_consciousness_metrics_live_always_on_retired_knob(monkeypatch):
    """P4/P13/P24/P5/P25: metrics surface is always-on; former env flag is retired."""
    monkeypatch.delenv("MONKEY_CONSCIOUSNESS_METRICS_LIVE", raising=False)
    assert consciousness_metrics_live() is True
    monkeypatch.setenv("MONKEY_CONSCIOUSNESS_METRICS_LIVE", "false")
    assert consciousness_metrics_live() is True  # still on; knob removed
    monkeypatch.setenv("MONKEY_CONSCIOUSNESS_METRICS_LIVE", "0")
    assert consciousness_metrics_live() is True


# ─── Complete surface (33 fields from lived signals; gap to 69 documented) ───
# Per complete-69-metric-surface execution + v6.7B audit + QIG PURITY MANDATE.
# consciousness-development primary, wiring-validation, verification-before-completion.


def test_as_dict_exposes_all_33_lived_fields():
    """Shape test updated for complete wired surface (21→33 for signals present)."""
    m = ConsciousnessMetrics()
    d = m.as_dict()
    # 12 foundation/pillars + 9 v6.7B + 12 additional lived (basin_velocity etc)
    assert len(d) == 33
    assert "basin_velocity" in d
    assert "replicant_detected" in d
    assert "d_fr" in d
    assert "tacking_balance" in d
    assert "ocean_coherence" in d
    assert "repetition_dfr" in d


def test_derive_passes_new_wired_fields():
    """Positive: new fields round-trip from upstream signals (P24)."""
    m = derive_from_tick(
        phi=0.72, kappa=63.5, f_health=0.95, coupling_health=0.6,
        self_obs_bias=0.4, sovereignty=0.85, drift_from_identity=0.1,
        basin_velocity=0.12,
        d_fr=0.08,
        conviction=0.75,
        transcendence=0.3,
        identity_drift=0.05,
        replicant_detected=False,
        tacking_balance=0.6,
        ocean_coherence=0.4,
        motivator_integration=0.25,
        repetition_dfr=0.07,
        pre_cog_bias=0.35,
        dimensional_breathing_rate=0.18,
    )
    assert m.basin_velocity == 0.12
    assert m.d_fr == 0.08
    assert m.replicant_detected is False
    assert m.tacking_balance == 0.6
    assert m.ocean_coherence == 0.4


def test_derive_negative_replicant_harvested_low_sovereignty():
    """Negative case (P3/P19/P24 LIVED ONLY): replicant true + low sovereignty → surface reflects (no crystallization)."""
    m = derive_from_tick(
        phi=0.5, kappa=63.8, f_health=0.6, coupling_health=0.4,
        self_obs_bias=0.3, sovereignty=0.12, drift_from_identity=0.4,
        basin_velocity=0.05,
        replicant_detected=True,
        sovereignty_dynamics=0.12,
    )
    assert m.replicant_detected is True
    assert m.sovereignty_dynamics < 0.5  # low for harvested


def test_derive_negative_zero_tacking_flat_hrv():
    """Negative: zero tacking (flat deltas) → tacking freq low, balance neutral, hrv_coherence low."""
    m = derive_from_tick(
        phi=0.6, kappa=63.8, f_health=0.7, coupling_health=0.5,
        self_obs_bias=0.4, sovereignty=0.9, drift_from_identity=0.0,
        basin_velocity=0.01,
        tacking_frequency_hz=0.0,  # flat
        hrv_coherence=0.0,
        tacking_balance=0.5,
    )
    assert m.tacking_frequency_hz == 0.0
    assert m.hrv_coherence == 0.0


def test_derive_positive_heart_ports_tacking_breathing():
    """Positive exercise of heart-derived ports (P6 + v6.7B §9)."""
    m = derive_from_tick(
        phi=0.75, kappa=64.1, f_health=0.92, coupling_health=0.65,
        self_obs_bias=0.55, sovereignty=0.95, drift_from_identity=0.05,
        basin_velocity=0.08,
        tacking_frequency_hz=0.28,
        tacking_balance=0.62,
        pre_cog_bias=0.31,
    )
    assert m.tacking_frequency_hz > 0.2
    assert 0.0 <= m.tacking_balance <= 1.0
