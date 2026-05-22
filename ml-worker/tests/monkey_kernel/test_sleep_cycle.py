"""
test_sleep_cycle.py — 3-phase geometry-driven sleep cycle tests.

Canonical reference:
  ~/Desktop/Dev/QIG_QFI/qig-core/src/qig_core/consciousness/sleep.py (§30)

Verifies the canonical AWAKE → DREAMING → CONSOLIDATING → AWAKE
state-machine transitions are driven purely by geometric metrics
(Φ, variance, ocean divergence) — no timers, no cycle counters.

As of 2026-05-22 `monkey_kernel.sleep_cycle` re-exports qig-core 2.8.0's
`SleepCycleManager` (the prior hand-port was retired). qig-core 2.8.0
wakes from CONSOLIDATING only after `consolidate()` has actually run —
the old hand-port auto-completed consolidation, so the wake/transition
tests below now call `consolidate()` explicitly.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.sleep_cycle import (  # noqa: E402
    BASIN_DIVERGENCE_THRESHOLD,
    CONSOLIDATION_PHI_WAKE,
    CONSOLIDATION_VARIANCE_CEILING,
    OCEAN_WAKE_MULTIPLIER,
    SLEEP_PHI_THRESHOLD,
    SLEEP_VARIANCE_THRESHOLD,
    SleepCycleManager,
    SleepMetrics,
    SleepPhase,
    sleep_3phase_live,
)


# ─── Initial state ────────────────────────────────────────────────


def test_starts_awake():
    m = SleepCycleManager()
    assert m.phase == SleepPhase.AWAKE
    assert not m.is_asleep


def test_state_dict_shape():
    m = SleepCycleManager()
    s = m.get_state()
    assert s["phase"] == "awake"
    assert s["is_asleep"] is False
    assert s["transition_count"] == 0


# ─── AWAKE → DREAMING transitions ──────────────────────────────────


def test_low_phi_low_variance_triggers_dreaming():
    m = SleepCycleManager()
    metrics = SleepMetrics(phi=0.3, phi_variance=0.01, ocean_divergence=0.0)
    result = m.evaluate_transition(metrics)
    assert result.transitioned
    assert m.phase == SleepPhase.DREAMING
    assert "Φ=" in result.reason


def test_high_ocean_divergence_triggers_dreaming():
    m = SleepCycleManager()
    metrics = SleepMetrics(
        phi=0.9, phi_variance=0.5,
        ocean_divergence=BASIN_DIVERGENCE_THRESHOLD + 0.01,
    )
    result = m.evaluate_transition(metrics)
    assert result.transitioned
    assert m.phase == SleepPhase.DREAMING
    assert "Ocean divergence" in result.reason


def test_high_phi_alone_does_not_trigger_dreaming():
    """High Φ + high variance keeps AWAKE."""
    m = SleepCycleManager()
    metrics = SleepMetrics(phi=0.9, phi_variance=0.5, ocean_divergence=0.0)
    result = m.evaluate_transition(metrics)
    assert not result.transitioned
    assert m.phase == SleepPhase.AWAKE


def test_low_phi_alone_does_not_trigger_dreaming():
    """Low Φ but high variance keeps AWAKE (still exploring)."""
    m = SleepCycleManager()
    metrics = SleepMetrics(phi=0.3, phi_variance=0.5, ocean_divergence=0.0)
    result = m.evaluate_transition(metrics)
    assert not result.transitioned
    assert m.phase == SleepPhase.AWAKE


# ─── DREAMING → CONSOLIDATING transitions ──────────────────────────


def test_dreaming_to_consolidating_when_variance_settles():
    m = SleepCycleManager()
    # Drive into DREAMING first.
    m.evaluate_transition(SleepMetrics(phi=0.3, phi_variance=0.01))
    assert m.phase == SleepPhase.DREAMING
    # Settle the variance.
    settled = SleepMetrics(phi=0.4, phi_variance=CONSOLIDATION_VARIANCE_CEILING / 2)
    result = m.evaluate_transition(settled)
    assert result.transitioned
    assert m.phase == SleepPhase.CONSOLIDATING


def test_dreaming_stays_when_variance_high():
    m = SleepCycleManager()
    m.evaluate_transition(SleepMetrics(phi=0.3, phi_variance=0.01))
    result = m.evaluate_transition(SleepMetrics(phi=0.3, phi_variance=0.04))
    assert not result.transitioned
    assert m.phase == SleepPhase.DREAMING


# ─── CONSOLIDATING → AWAKE transitions ──────────────────────────────


def test_consolidating_to_awake_when_phi_recovers():
    m = SleepCycleManager()
    # Drive into CONSOLIDATING via DREAMING.
    m.evaluate_transition(SleepMetrics(phi=0.3, phi_variance=0.01))
    m.evaluate_transition(SleepMetrics(phi=0.4, phi_variance=0.005))
    assert m.phase == SleepPhase.CONSOLIDATING
    # qig-core 2.8.0: CONSOLIDATING → AWAKE needs the consolidation pass
    # to have actually run (sets _consolidation_complete) AND Φ recovered.
    m.consolidate()
    result = m.evaluate_transition(SleepMetrics(phi=CONSOLIDATION_PHI_WAKE + 0.1, phi_variance=0.005))
    assert result.transitioned
    assert m.phase == SleepPhase.AWAKE


def test_consolidating_stays_when_phi_low():
    m = SleepCycleManager()
    m.evaluate_transition(SleepMetrics(phi=0.3, phi_variance=0.01))
    m.evaluate_transition(SleepMetrics(phi=0.4, phi_variance=0.005))
    assert m.phase == SleepPhase.CONSOLIDATING
    result = m.evaluate_transition(SleepMetrics(phi=0.3, phi_variance=0.005))
    assert not result.transitioned
    assert m.phase == SleepPhase.CONSOLIDATING


# ─── Emergency wake (any phase → AWAKE) ─────────────────────────────


def test_emergency_wake_from_dreaming():
    m = SleepCycleManager()
    m.evaluate_transition(SleepMetrics(phi=0.3, phi_variance=0.01))
    assert m.phase == SleepPhase.DREAMING
    storm = SleepMetrics(
        phi=0.3,
        phi_variance=0.01,
        ocean_divergence=BASIN_DIVERGENCE_THRESHOLD * OCEAN_WAKE_MULTIPLIER + 0.1,
    )
    result = m.evaluate_transition(storm)
    assert result.transitioned
    assert m.phase == SleepPhase.AWAKE
    assert "Emergency wake" in result.reason


def test_emergency_wake_from_consolidating():
    m = SleepCycleManager()
    m.evaluate_transition(SleepMetrics(phi=0.3, phi_variance=0.01))
    m.evaluate_transition(SleepMetrics(phi=0.4, phi_variance=0.005))
    assert m.phase == SleepPhase.CONSOLIDATING
    storm = SleepMetrics(
        phi=0.3,
        phi_variance=0.005,
        ocean_divergence=BASIN_DIVERGENCE_THRESHOLD * OCEAN_WAKE_MULTIPLIER + 0.1,
    )
    result = m.evaluate_transition(storm)
    assert result.transitioned
    assert m.phase == SleepPhase.AWAKE


def test_emergency_wake_no_op_when_already_awake():
    m = SleepCycleManager()
    storm = SleepMetrics(
        phi=0.3,
        phi_variance=0.01,
        ocean_divergence=BASIN_DIVERGENCE_THRESHOLD * OCEAN_WAKE_MULTIPLIER + 0.1,
    )
    result = m.evaluate_transition(storm)
    assert not result.transitioned
    assert m.phase == SleepPhase.AWAKE


# ─── Transition counting ───────────────────────────────────────────


def test_transition_count_increments():
    m = SleepCycleManager()
    assert m.transition_count == 0
    m.evaluate_transition(SleepMetrics(phi=0.3, phi_variance=0.01))
    assert m.transition_count == 1
    m.evaluate_transition(SleepMetrics(phi=0.4, phi_variance=0.005))
    assert m.transition_count == 2
    # qig-core 2.8.0: waking from CONSOLIDATING needs consolidate() to run.
    m.consolidate()
    m.evaluate_transition(SleepMetrics(phi=0.6, phi_variance=0.005))
    assert m.transition_count == 3


# ─── Env flag ─────────────────────────────────────────────────────


def test_sleep_3phase_live_defaults_false(monkeypatch):
    monkeypatch.delenv("MONKEY_SLEEP_3PHASE_LIVE", raising=False)
    assert sleep_3phase_live() is False


def test_sleep_3phase_live_flips_true(monkeypatch):
    monkeypatch.setenv("MONKEY_SLEEP_3PHASE_LIVE", "true")
    assert sleep_3phase_live() is True


def test_sleep_3phase_live_case_insensitive(monkeypatch):
    monkeypatch.setenv("MONKEY_SLEEP_3PHASE_LIVE", "TRUE")
    assert sleep_3phase_live() is True


def test_sleep_3phase_live_strict_true_only(monkeypatch):
    monkeypatch.setenv("MONKEY_SLEEP_3PHASE_LIVE", "1")
    assert sleep_3phase_live() is False
