"""test_prediction_chemistry_parity.py — parity tests for the prediction-
error chemistry cache (#941 Phase 3).

Pins the structural contract:
  - push_prediction_chemistry REPLACES (not appends) the cached delta
  - tick() folds the cached delta additively into reward_sums
  - wake clears the cache (stale signal post-sleep)

Mirror of apps/api/src/services/monkey/__tests__/predictionRewardEmitter.test.ts
(pure-transform tests). The TS side computes the deltas from DB and POSTs
them to /monkey/autonomic/prediction_reward, which calls
push_prediction_chemistry on this kernel.
"""
from __future__ import annotations

import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.autonomic import (  # noqa: E402
    AutonomicKernel,
    AutonomicTickInputs,
)


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


def test_cache_initialised_to_zero():
    k = AutonomicKernel(label="t")
    assert k._cached_prediction_chemistry == {
        "dopamine_delta": 0.0,
        "serotonin_delta": 0.0,
        "n": 0.0,
    }


def test_push_replaces_not_appends():
    k = AutonomicKernel(label="t")
    k.push_prediction_chemistry(dopamine_delta=0.3, serotonin_delta=-0.1, n=12)
    k.push_prediction_chemistry(dopamine_delta=0.1, serotonin_delta=-0.05, n=15)
    # Second call REPLACES — first call's delta is gone.
    assert k._cached_prediction_chemistry["dopamine_delta"] == pytest.approx(0.1)
    assert k._cached_prediction_chemistry["serotonin_delta"] == pytest.approx(-0.05)
    assert k._cached_prediction_chemistry["n"] == pytest.approx(15.0)


def test_tick_folds_cached_delta_into_reward_sums():
    k = AutonomicKernel(label="t")
    # Baseline tick with zero cache.
    baseline = k.tick(_base_inputs())
    assert baseline.reward_sums["dopamine"] == pytest.approx(0.0)
    assert baseline.reward_sums["serotonin"] == pytest.approx(0.0)

    # Push a positive dop delta, negative ser delta.
    k.push_prediction_chemistry(dopamine_delta=0.25, serotonin_delta=-0.1, n=20)
    after = k.tick(_base_inputs())
    assert after.reward_sums["dopamine"] == pytest.approx(0.25)
    assert after.reward_sums["serotonin"] == pytest.approx(-0.1)


def test_wake_clears_cached_prediction_chemistry():
    k = AutonomicKernel(label="t")
    k.push_prediction_chemistry(dopamine_delta=0.4, serotonin_delta=0.1, n=30)
    # Tick with woke=True signals wake transition.
    k.tick(_base_inputs(woke=True))
    assert k._cached_prediction_chemistry == {
        "dopamine_delta": 0.0,
        "serotonin_delta": 0.0,
        "n": 0.0,
    }


def test_cache_does_not_compound_across_ticks():
    """Per-tick reads do NOT accumulate. A pushed delta of +0.2 is the same
    signal on tick 1 and tick 2; it doesn't compound."""
    k = AutonomicKernel(label="t")
    k.push_prediction_chemistry(dopamine_delta=0.2, serotonin_delta=0.0, n=10)
    t1 = k.tick(_base_inputs())
    t2 = k.tick(_base_inputs())
    assert t1.reward_sums["dopamine"] == pytest.approx(t2.reward_sums["dopamine"])


def test_endorphin_is_untouched_by_prediction_channel():
    """P14 — prediction-error channel only routes to dop + ser; endorphin
    stays as-is from the trade-outcome reward queue (here: empty = 0)."""
    k = AutonomicKernel(label="t")
    k.push_prediction_chemistry(dopamine_delta=0.5, serotonin_delta=0.5, n=50)
    res = k.tick(_base_inputs())
    assert res.reward_sums["endorphin"] == pytest.approx(0.0)
