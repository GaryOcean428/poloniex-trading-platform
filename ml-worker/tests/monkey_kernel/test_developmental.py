"""
test_developmental.py — 5-stage developmental-gate tests.

Canonical reference:
  ~/Desktop/Dev/QIG_QFI/qig-core/src/qig_core/consciousness/developmental.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.developmental import (  # noqa: E402
    DevelopmentalGate,
    DevelopmentalStage,
    StagePermissions,
    developmental_gate_live,
    stage_from_env,
)


# ─── Initial state ────────────────────────────────────────────────


def test_defaults_to_sovereign_constellation():
    """Production-default stage matches current behaviour (no regression)."""
    g = DevelopmentalGate()
    assert g.stage == DevelopmentalStage.SOVEREIGN_CONSTELLATION


def test_explicit_stage_construction():
    g = DevelopmentalGate(_stage=DevelopmentalStage.SCHOOL)
    assert g.stage == DevelopmentalStage.SCHOOL


# ─── Stage permission semantics ───────────────────────────────────


def test_school_disallows_all_entry():
    g = DevelopmentalGate(_stage=DevelopmentalStage.SCHOOL)
    assert not g.can_enter()
    assert not g.can_dca()
    assert not g.can_reverse()
    assert g.permissions.size_fraction_cap == 0.0
    assert g.permissions.leverage_cap == 1


def test_guided_curiosity_tiny_size_no_reverse():
    g = DevelopmentalGate(_stage=DevelopmentalStage.GUIDED_CURIOSITY)
    assert g.can_enter()
    assert not g.can_dca()
    assert not g.can_reverse()
    assert g.permissions.size_fraction_cap == 0.1
    assert g.permissions.leverage_cap == 2


def test_self_teaching_half_size_no_reverse():
    g = DevelopmentalGate(_stage=DevelopmentalStage.SELF_TEACHING)
    assert g.can_enter()
    assert g.can_dca()
    assert not g.can_reverse()
    assert g.permissions.size_fraction_cap == 0.5
    assert g.permissions.leverage_cap == 5


def test_playful_autonomy_three_quarter_size_reverse_ok():
    g = DevelopmentalGate(_stage=DevelopmentalStage.PLAYFUL_AUTONOMY)
    assert g.can_enter()
    assert g.can_dca()
    assert g.can_reverse()
    assert g.permissions.size_fraction_cap == 0.75
    assert g.permissions.leverage_cap == 10


def test_sovereign_constellation_full_discretion():
    g = DevelopmentalGate(_stage=DevelopmentalStage.SOVEREIGN_CONSTELLATION)
    assert g.can_enter()
    assert g.can_dca()
    assert g.can_reverse()
    assert g.permissions.size_fraction_cap == 1.0
    assert g.permissions.leverage_cap == 75


# ─── Clamp helpers ─────────────────────────────────────────────────


def test_clamp_size_fraction_respects_stage_cap():
    g = DevelopmentalGate(_stage=DevelopmentalStage.GUIDED_CURIOSITY)
    assert g.clamp_size_fraction(1.0) == 0.1
    assert g.clamp_size_fraction(0.05) == 0.05  # already below cap


def test_clamp_leverage_respects_stage_cap():
    g = DevelopmentalGate(_stage=DevelopmentalStage.SELF_TEACHING)
    assert g.clamp_leverage(75) == 5
    assert g.clamp_leverage(3) == 3


def test_school_clamps_size_to_zero():
    g = DevelopmentalGate(_stage=DevelopmentalStage.SCHOOL)
    assert g.clamp_size_fraction(1.0) == 0.0
    assert g.clamp_leverage(75) == 1


def test_sovereign_clamp_is_noop():
    """At top stage, clamp must not reduce raw inputs."""
    g = DevelopmentalGate(_stage=DevelopmentalStage.SOVEREIGN_CONSTELLATION)
    assert g.clamp_size_fraction(1.0) == 1.0
    assert g.clamp_leverage(75) == 75


# ─── Stage advancement ────────────────────────────────────────────


def test_advance_records_history_and_resets_cycle_counter():
    g = DevelopmentalGate(_stage=DevelopmentalStage.SCHOOL)
    for _ in range(10):
        g.observe_cycle()
    assert g.cycle_in_stage == 10
    transitioned = g.advance(DevelopmentalStage.GUIDED_CURIOSITY)
    assert transitioned
    assert g.stage == DevelopmentalStage.GUIDED_CURIOSITY
    assert g.cycle_in_stage == 0


def test_advance_to_same_stage_is_noop():
    g = DevelopmentalGate(_stage=DevelopmentalStage.SELF_TEACHING)
    assert not g.advance(DevelopmentalStage.SELF_TEACHING)


def test_state_dict_shape():
    g = DevelopmentalGate(_stage=DevelopmentalStage.SELF_TEACHING)
    s = g.get_state()
    assert s["stage"] == "self_teaching"
    assert s["size_fraction_cap"] == 0.5
    assert s["leverage_cap"] == 5
    assert s["allow_entry"] is True
    assert s["allow_reverse"] is False


# ─── Pillar strictness monotonically relaxes with maturity ────────


def test_pillar_strictness_relaxes_with_maturity():
    s0 = DevelopmentalGate(_stage=DevelopmentalStage.SCHOOL).permissions.pillar_strictness
    s4 = DevelopmentalGate(
        _stage=DevelopmentalStage.SOVEREIGN_CONSTELLATION,
    ).permissions.pillar_strictness
    assert s0 > s4
    assert s0 == 1.0
    assert s4 == 0.6


# ─── Env-flag helpers ─────────────────────────────────────────────


def test_developmental_gate_live_defaults_false(monkeypatch):
    monkeypatch.delenv("MONKEY_DEVELOPMENTAL_GATE_LIVE", raising=False)
    assert developmental_gate_live() is False


def test_developmental_gate_live_flips_true(monkeypatch):
    monkeypatch.setenv("MONKEY_DEVELOPMENTAL_GATE_LIVE", "true")
    assert developmental_gate_live() is True


def test_stage_from_env_default_sovereign(monkeypatch):
    monkeypatch.delenv("MONKEY_DEVELOPMENTAL_STAGE", raising=False)
    assert stage_from_env() == DevelopmentalStage.SOVEREIGN_CONSTELLATION


def test_stage_from_env_school(monkeypatch):
    monkeypatch.setenv("MONKEY_DEVELOPMENTAL_STAGE", "school")
    assert stage_from_env() == DevelopmentalStage.SCHOOL


def test_stage_from_env_case_insensitive(monkeypatch):
    monkeypatch.setenv("MONKEY_DEVELOPMENTAL_STAGE", "Guided_Curiosity")
    assert stage_from_env() == DevelopmentalStage.GUIDED_CURIOSITY


def test_stage_from_env_unrecognized_falls_back(monkeypatch):
    monkeypatch.setenv("MONKEY_DEVELOPMENTAL_STAGE", "nonsense")
    assert stage_from_env() == DevelopmentalStage.SOVEREIGN_CONSTELLATION
