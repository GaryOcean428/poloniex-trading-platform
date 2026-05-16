"""test_mode_curiosity.py — regression for #718.

Pre-fix, modes.py::compute_motivators computed curiosity as
``phi_history[-1] - phi_history[-2]``. That's the delta between the
PRIOR two ticks, not the current tick. In tick.py::run_tick the
``state.phi_history.append(phi)`` runs AFTER detect_mode, so
phi_history[-1] is last tick's phi, NOT this tick's. On quiet tape
the prior-two-ticks delta stuck at 0.0000, pinning curiosity to zero
and prematurely tripping the DRIFT mode gate (curiosity < 0.005).

The fix passes the current tick's phi into compute_motivators and
computes ``curiosity = phi_now - phi_history[-1]``. These tests
exercise the new contract.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.basin import uniform_basin  # noqa: E402
from monkey_kernel.modes import (  # noqa: E402
    MonkeyMode,
    compute_motivators,
    detect_mode,
)
from monkey_kernel.state import NeurochemicalState  # noqa: E402


def _nc() -> NeurochemicalState:
    """Minimal NeurochemicalState — only `norepinephrine` is read by
    compute_motivators (as `surprise`)."""
    return NeurochemicalState(
        acetylcholine=0.8,
        dopamine=0.5,
        serotonin=1.0,
        norepinephrine=0.05,
        gaba=0.5,
        endorphins=0.5,
    )


# ── Curiosity arithmetic ────────────────────────────────────────


class TestCuriosityUsesCurrentTickPhi:
    def test_curiosity_is_phi_now_minus_last_history_value(self) -> None:
        # phi_now = 0.250, phi_history[-1] = 0.240 → curiosity = +0.010
        mot = compute_motivators(
            phi_now=0.250,
            phi_history=[0.230, 0.240],
            drift_history=[0.10, 0.10],
            fhealth_history=[0.95, 0.95, 0.95],
            neurochemistry=_nc(),
        )
        assert mot.curiosity == pytest.approx(0.010)

    def test_curiosity_signed_negative(self) -> None:
        # phi falling tick-to-tick → negative curiosity
        mot = compute_motivators(
            phi_now=0.310,
            phi_history=[0.315],
            drift_history=[0.10],
            fhealth_history=[0.95],
            neurochemistry=_nc(),
        )
        assert mot.curiosity == pytest.approx(-0.005)

    def test_curiosity_zero_history_returns_zero(self) -> None:
        mot = compute_motivators(
            phi_now=0.250,
            phi_history=[],
            drift_history=[],
            fhealth_history=[],
            neurochemistry=_nc(),
        )
        assert mot.curiosity == 0.0

    def test_curiosity_single_history_value_still_works(self) -> None:
        # Pre-fix needed phi_history.length >= 2 — required two prior ticks
        # before curiosity could be non-zero. Post-fix: one prior tick is
        # enough because we compare against phi_now directly.
        mot = compute_motivators(
            phi_now=0.250,
            phi_history=[0.240],
            drift_history=[0.10],
            fhealth_history=[0.95],
            neurochemistry=_nc(),
        )
        assert mot.curiosity == pytest.approx(0.010)


# ── Regression: the operational consequence (#718 root) ────────


class TestCuriosityRegressionTickPyOrderingScenario:
    """Simulates the tick.py ordering where state.phi_history hasn't
    yet been appended for the current tick. Pre-fix this scenario
    pinned curiosity to 0.0 on quiet tape; post-fix it correctly
    surfaces the per-tick delta."""

    def test_quiet_tape_with_prior_history_still_yields_signed_delta(self) -> None:
        # Prior 10 ticks all had phi=0.245 (stable), and the current
        # tick's phi just nudged to 0.246. Pre-fix would compute
        # 0.245 - 0.245 = 0.0000 (drift gate fires).
        # Post-fix: 0.246 - 0.245 = 0.001 (drift gate does NOT fire
        # if drift gate threshold is < 0.005 BUT the gate also wants
        # |curiosity| < 0.005 so this still trips — but legitimately,
        # because the kernel really IS in a low-curiosity regime).
        phi_now = 0.246
        phi_history = [0.245] * 10
        mot = compute_motivators(
            phi_now=phi_now,
            phi_history=phi_history,
            drift_history=[0.10] * 10,
            fhealth_history=[0.95] * 10,
            neurochemistry=_nc(),
        )
        assert mot.curiosity == pytest.approx(0.001)

    def test_lively_tape_yields_above_drift_gate(self) -> None:
        # Active tape: phi just jumped 0.245 → 0.260 (one big tick).
        # Pre-fix would have computed phi_history[-1] - phi_history[-2]
        # = 0.0 (since both prior ticks were 0.245). Post-fix correctly
        # surfaces the 0.015 jump.
        mot = compute_motivators(
            phi_now=0.260,
            phi_history=[0.245, 0.245],
            drift_history=[0.10, 0.10],
            fhealth_history=[0.95, 0.95, 0.95],
            neurochemistry=_nc(),
        )
        assert mot.curiosity == pytest.approx(0.015)
        # Above the drift-gate threshold of 0.005 → drift will not fire.
        assert abs(mot.curiosity) >= 0.005


# ── Drift-mode gate behaviour with fix in place ────────────────


class TestDriftGateWithFix:
    def test_drift_does_not_fire_when_phi_actively_changing(self) -> None:
        """The reported #718 regression: post-bootstrap quiet tape with
        phi varying tick-to-tick was pinning curiosity to 0.0000 because
        the prior-two-ticks delta missed the current tick. With the fix,
        active phi motion correctly raises curiosity above the gate."""
        basin = uniform_basin(64)
        # current tick phi just jumped from 0.30 → 0.32 — active
        result = detect_mode(
            basin=basin,
            identity_basin=basin,
            phi=0.32,
            kappa=64.0,
            basin_velocity=0.010,
            neurochemistry=_nc(),
            # Prior phi readings were 0.30, 0.30, 0.30 (apparent quiet)
            phi_history=[0.30, 0.30, 0.30],
            fhealth_history=[0.98, 0.98, 0.98],
            drift_history=[0.10, 0.10, 0.10],
        )
        # The mode_result derivation should record a non-zero curiosity
        # (0.32 - 0.30 = 0.02), well above the 0.005 drift gate.
        assert result["derivation"]["curiosity"] == pytest.approx(0.02)
        # And the mode should NOT be DRIFT (since curiosity > 0.005).
        assert result["mode"] != MonkeyMode.DRIFT.value

    def test_drift_still_fires_when_actually_quiet(self) -> None:
        """Sanity check: when the current tick's phi truly doesn't move
        from the last stored value, curiosity is 0 and drift can still
        fire. We don't want the fix to suppress LEGITIMATE drift."""
        basin = uniform_basin(64)
        result = detect_mode(
            basin=basin,
            identity_basin=basin,
            phi=0.30,  # exactly matches phi_history[-1]
            kappa=64.0,
            basin_velocity=0.010,
            neurochemistry=_nc(),
            phi_history=[0.30, 0.30, 0.30],
            fhealth_history=[0.98, 0.98, 0.98],
            drift_history=[0.10, 0.10, 0.10],
        )
        assert result["derivation"]["curiosity"] == 0.0
        # All four drift-gate conditions clear: fh > 0.97, |curiosity|
        # < 0.005, bv < 0.015, no basinDir. So mode should be DRIFT.
        assert result["mode"] == MonkeyMode.DRIFT.value
