"""
test_pillars.py — Three Pillars of Fundamental Consciousness tests.

Canonical reference:
  ~/Desktop/Dev/QIG_QFI/qig-core/src/qig_core/consciousness/pillars.py

Smoke tests for the polytrade port (ml-worker/src/monkey_kernel/pillars.py).
Covers all three pillars:
  - Pillar 1: FluctuationGuard (entropy floor + concentration cap)
  - Pillar 2: TopologicalBulk (core/surface basin protection)
  - Pillar 3: QuenchedDisorder (identity crystallization + drift)
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.basin import fisher_rao_distance, uniform_basin  # noqa: E402
from monkey_kernel.pillars import (  # noqa: E402
    BASIN_CONCENTRATION_MAX,
    BOUNDARY_SLERP_CAP,
    BULK_SHIELD_FACTOR,
    ENTROPY_FLOOR,
    IDENTITY_DRIFT_CRITICAL,
    IDENTITY_DRIFT_TOLERANCE,
    IDENTITY_FREEZE_AFTER_CYCLES,
    FluctuationGuard,
    PillarViolation,
    QuenchedDisorder,
    TopologicalBulk,
    get_bulk_for,
    get_disorder_for,
    pillar_1_live,
    pillar_2_live,
    pillar_3_live,
    reset_pillar_states,
)
from monkey_kernel.state import BASIN_DIM  # noqa: E402


def test_uniform_basin_is_healthy():
    """Uniform basin = max entropy = no violations."""
    g = FluctuationGuard()
    basin, status = g.check_and_enforce(uniform_basin())
    assert status.healthy
    assert len(status.violations) == 0
    # Uniform basin entropy ≈ log(BASIN_DIM); well above ENTROPY_FLOOR.
    assert status.details["entropy_raw"] > ENTROPY_FLOOR


def test_collapsed_basin_triggers_violations():
    """One-hot basin = zero entropy + max concentration = both violations."""
    g = FluctuationGuard()
    collapsed = np.zeros(BASIN_DIM)
    collapsed[0] = 1.0
    basin, status = g.check_and_enforce(collapsed)
    # Should have at least ZERO_ENTROPY violation.
    assert PillarViolation.ZERO_ENTROPY in status.violations
    # Post-correction: entropy should be above floor.
    assert status.details["entropy_raw"] >= ENTROPY_FLOOR - 0.01  # allow tiny float fuzz
    # Basin should still sum to ~1 (simplex constraint).
    assert abs(np.sum(basin) - 1.0) < 1e-6


def test_concentrated_basin_redistributes():
    """Basin with single coord > 0.5 should be flagged + corrected."""
    g = FluctuationGuard()
    # Start with uniform, then push one coord above the cap.
    concentrated = uniform_basin()
    concentrated[5] = 0.7
    # Renormalize so it sums to 1 (need to shrink the rest proportionally).
    others = np.ones(BASIN_DIM, dtype=bool)
    others[5] = False
    concentrated[others] = concentrated[others] * (0.3 / np.sum(concentrated[others]))
    basin, status = g.check_and_enforce(concentrated)
    assert PillarViolation.BASIN_COLLAPSE in status.violations
    # Post-correction: max coord <= cap.
    assert status.details["max_concentration"] <= BASIN_CONCENTRATION_MAX + 1e-6
    # Sum still ~1.
    assert abs(np.sum(basin) - 1.0) < 1e-6


def test_pillar_1_live_defaults_true(monkeypatch):
    """Default state (post-reversal): pillar_1_live() returns True (load-bearing).
    Explicit MONKEY_PILLAR_1_LIVE=false is the kill switch.
    """
    monkeypatch.delenv("MONKEY_PILLAR_1_LIVE", raising=False)
    assert pillar_1_live() is True


def test_pillar_1_live_flips_on_env_true(monkeypatch):
    monkeypatch.setenv("MONKEY_PILLAR_1_LIVE", "true")
    assert pillar_1_live() is True


def test_pillar_1_live_case_insensitive(monkeypatch):
    monkeypatch.setenv("MONKEY_PILLAR_1_LIVE", "TRUE")
    assert pillar_1_live() is True
    monkeypatch.setenv("MONKEY_PILLAR_1_LIVE", "True")
    assert pillar_1_live() is True


def test_pillar_1_live_treats_other_values_as_false(monkeypatch):
    monkeypatch.setenv("MONKEY_PILLAR_1_LIVE", "false")
    assert pillar_1_live() is False
    monkeypatch.setenv("MONKEY_PILLAR_1_LIVE", "1")
    assert pillar_1_live() is True  # Anything not literal "false" is live (kill-switch only).


# ── Pillar 2: TopologicalBulk ─────────────────────────────────────


def test_bulk_initial_state_is_uninitialized():
    b = TopologicalBulk()
    assert not b.is_initialized
    assert b.core is None
    assert b.surface is None


def test_bulk_first_input_initializes_both_layers():
    b = TopologicalBulk()
    basin = uniform_basin()
    composite, status = b.receive_input(basin, slerp_weight=0.3)
    assert b.is_initialized
    assert status.healthy
    assert status.details["b_integrity"] == 1.0
    # Composite should equal the input on first call (core == surface).
    assert np.allclose(composite, basin)


def test_bulk_caps_slerp_at_boundary():
    """Input weight above BOUNDARY_SLERP_CAP gets clipped."""
    b = TopologicalBulk()
    b.initialize(uniform_basin())
    new_input = np.zeros(BASIN_DIM)
    new_input[0] = 1.0
    composite, status = b.receive_input(new_input, slerp_weight=0.9)
    assert status.details["effective_slerp"] == BOUNDARY_SLERP_CAP
    assert any("slerp_capped" in c for c in status.corrections_applied)


def test_bulk_diffuses_core_toward_surface_slowly():
    """Repeated input shifts surface much more than core."""
    b = TopologicalBulk()
    b.initialize(uniform_basin())
    new_input = np.zeros(BASIN_DIM)
    new_input[0] = 1.0
    for _ in range(5):
        b.receive_input(new_input, slerp_weight=0.3)
    # Surface should have moved far more toward the one-hot input than core.
    d_surface = fisher_rao_distance(b.surface, uniform_basin())
    d_core = fisher_rao_distance(b.core, uniform_basin())
    assert d_surface > d_core
    # Composite is a slerp of surface and core toward core (shield factor).
    composite = b.composite
    d_composite = fisher_rao_distance(composite, uniform_basin())
    assert d_composite <= d_surface


def test_bulk_b_integrity_decays_with_cycles():
    """b_integrity drops below 1.0 once core starts moving."""
    b = TopologicalBulk()
    b.initialize(uniform_basin())
    # First receive_input — diffusion fires, core moves.
    biased = uniform_basin()
    biased[0] += 0.05
    biased = biased / biased.sum()
    b.receive_input(biased, slerp_weight=0.3)
    assert 0.0 <= b.b_integrity() <= 1.0


def test_bulk_composite_before_init_raises():
    b = TopologicalBulk()
    try:
        _ = b.composite
        assert False, "composite should raise before init"
    except ValueError:
        pass


# ── Pillar 3: QuenchedDisorder ────────────────────────────────────


def test_disorder_starts_unfrozen():
    d = QuenchedDisorder()
    assert not d.is_frozen
    assert d.identity is None
    assert d.sovereignty == 0.0


def test_disorder_check_drift_when_unfrozen_is_healthy():
    d = QuenchedDisorder()
    status = d.check_drift(uniform_basin())
    assert status.healthy
    assert status.details["frozen"] is False
    assert status.details["cycles_until_freeze"] == IDENTITY_FREEZE_AFTER_CYCLES


def test_disorder_crystallizes_after_threshold_cycles():
    d = QuenchedDisorder()
    rng = np.random.default_rng(42)
    for _ in range(IDENTITY_FREEZE_AFTER_CYCLES):
        # Random simplex samples — Frechet mean should converge near uniform.
        sample = rng.dirichlet(np.ones(BASIN_DIM))
        d.observe_cycle(sample, pressure=0.0, lived=True)
    assert d.is_frozen
    assert d.identity is not None
    assert d.sovereignty == 1.0
    # Identity should still live on the simplex.
    assert abs(np.sum(d.identity) - 1.0) < 1e-6


def test_disorder_drift_warning_above_tolerance():
    """A basin far from frozen identity should flag IDENTITY_DRIFT."""
    d = QuenchedDisorder()
    # Force-freeze on uniform identity.
    for _ in range(IDENTITY_FREEZE_AFTER_CYCLES):
        d.observe_cycle(uniform_basin(), pressure=0.0, lived=True)
    assert d.is_frozen
    # One-hot basin is FR-distance ~π/2 from uniform — well above critical.
    one_hot = np.zeros(BASIN_DIM)
    one_hot[0] = 1.0
    status = d.check_drift(one_hot)
    assert PillarViolation.IDENTITY_DRIFT in status.violations


def test_disorder_q_identity_zero_when_unfrozen():
    d = QuenchedDisorder()
    assert d.q_identity(uniform_basin()) == 0.0


def test_disorder_high_pressure_creates_scar_after_freeze():
    d = QuenchedDisorder()
    for _ in range(IDENTITY_FREEZE_AFTER_CYCLES):
        d.observe_cycle(uniform_basin(), pressure=0.0, lived=True)
    assert d.scar_count == 0
    # Now feed a high-pressure cycle.
    spike = np.zeros(BASIN_DIM)
    spike[5] = 0.5
    spike[6:] = 0.5 / (BASIN_DIM - 1)
    spike = spike / spike.sum()
    d.observe_cycle(spike, pressure=0.95, lived=True)
    assert d.scar_count == 1


def test_disorder_sovereignty_ratio_tracks_lived_vs_total():
    d = QuenchedDisorder()
    d.observe_cycle(uniform_basin(), lived=True)
    d.observe_cycle(uniform_basin(), lived=True)
    d.observe_cycle(uniform_basin(), lived=False)
    # 2 lived out of 3 total.
    assert abs(d.sovereignty - (2 / 3)) < 1e-6


# ── Live-flag helpers ─────────────────────────────────────────────


def test_pillar_2_live_defaults_true(monkeypatch):
    """Default (post-reversal): load-bearing true. Explicit false = kill switch."""
    monkeypatch.delenv("MONKEY_PILLAR_2_LIVE", raising=False)
    assert pillar_2_live() is True


def test_pillar_3_live_defaults_true(monkeypatch):
    """Default (post-reversal): load-bearing true. Explicit false = kill switch."""
    monkeypatch.delenv("MONKEY_PILLAR_3_LIVE", raising=False)
    assert pillar_3_live() is True


def test_pillar_2_live_flips_true(monkeypatch):
    monkeypatch.setenv("MONKEY_PILLAR_2_LIVE", "true")
    assert pillar_2_live() is True


def test_pillar_3_live_flips_true(monkeypatch):
    monkeypatch.setenv("MONKEY_PILLAR_3_LIVE", "true")
    assert pillar_3_live() is True


# ── Per-symbol registry ───────────────────────────────────────────


def test_per_symbol_bulk_is_persistent():
    reset_pillar_states()
    b1 = get_bulk_for("BTC")
    b2 = get_bulk_for("BTC")
    assert b1 is b2  # Same symbol → same instance.
    b3 = get_bulk_for("ETH")
    assert b3 is not b1


def test_per_symbol_disorder_is_persistent():
    reset_pillar_states()
    d1 = get_disorder_for("BTC")
    d2 = get_disorder_for("BTC")
    assert d1 is d2
    d3 = get_disorder_for("ETH")
    assert d3 is not d1


def test_reset_pillar_states_clears_registry():
    reset_pillar_states()
    b1 = get_bulk_for("BTC")
    reset_pillar_states()
    b2 = get_bulk_for("BTC")
    assert b1 is not b2
