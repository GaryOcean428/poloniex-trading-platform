"""
test_pillars.py — Pillar 1 (FluctuationGuard) tests.

Canonical reference:
  ~/Desktop/Dev/QIG_QFI/qig-core/src/qig_core/consciousness/pillars.py

Smoke tests for the polytrade port (ml-worker/src/monkey_kernel/pillars.py).
Verifies entropy floor + concentration cap enforcement on the canonical
edge cases (uniform basin, collapsed basin, near-floor basin).
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.basin import uniform_basin  # noqa: E402
from monkey_kernel.pillars import (  # noqa: E402
    BASIN_CONCENTRATION_MAX,
    ENTROPY_FLOOR,
    FluctuationGuard,
    PillarViolation,
    pillar_1_live,
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


def test_pillar_1_live_defaults_false(monkeypatch):
    """Default state: pillar_1_live() returns False (safe-rollout default)."""
    monkeypatch.delenv("MONKEY_PILLAR_1_LIVE", raising=False)
    assert pillar_1_live() is False


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
    assert pillar_1_live() is False  # Strict "true" only — matches the doctrine.
