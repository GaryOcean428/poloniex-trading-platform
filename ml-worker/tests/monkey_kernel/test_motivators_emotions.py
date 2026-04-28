"""Tests for Tier 1 motivators + Tier 2 Layer 2B emotions."""

from __future__ import annotations

import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_SRC = os.path.abspath(os.path.join(_HERE, "..", "..", "src"))
if _SRC not in sys.path:
    sys.path.insert(0, _SRC)

from monkey_kernel.emotions import compute_layer2b_emotions  # noqa: E402
from monkey_kernel.motivators import compute_layer1_motivators  # noqa: E402
from monkey_kernel.state import NeurochemicalState  # noqa: E402


def _make_neurochemistry(
    *,
    ne: float = 0.5,
    ser: float = 0.5,
    endo: float = 0.5,
) -> NeurochemicalState:
    return NeurochemicalState(
        acetylcholine=0.5,
        dopamine=0.5,
        serotonin=ser,
        norepinephrine=ne,
        gaba=0.5,
        endorphins=endo,
    )


class TestLayer1Motivators:
    def test_outputs_are_bounded(self):
        mot = compute_layer1_motivators(
            phi=0.8,
            kappa=64.0,
            basin_velocity=0.03,
            drift_distance=0.25,
            phi_delta=0.05,
            drift_delta=-0.03,
            regime_weights={"equilibrium": 0.6, "efficient": 0.3, "quantum": 0.1},
            neurochemistry=_make_neurochemistry(ne=0.7, ser=0.8, endo=0.9),
        )
        for v in (mot.surprise, mot.curiosity, mot.investigation, mot.integration, mot.transcendence):
            assert 0.0 <= v <= 1.0

    def test_positive_phi_delta_increases_curiosity(self):
        lo = compute_layer1_motivators(
            phi=0.5,
            kappa=64.0,
            basin_velocity=0.01,
            drift_distance=0.2,
            phi_delta=0.0,
            drift_delta=-0.01,
            regime_weights={"equilibrium": 0.5},
            neurochemistry=_make_neurochemistry(ne=0.5),
        )
        hi = compute_layer1_motivators(
            phi=0.5,
            kappa=64.0,
            basin_velocity=0.01,
            drift_distance=0.2,
            phi_delta=0.06,
            drift_delta=-0.01,
            regime_weights={"equilibrium": 0.5},
            neurochemistry=_make_neurochemistry(ne=0.5),
        )
        assert hi.curiosity > lo.curiosity

    def test_endorphins_increase_transcendence(self):
        lo = compute_layer1_motivators(
            phi=0.6,
            kappa=64.0,
            basin_velocity=0.01,
            drift_distance=0.1,
            phi_delta=0.01,
            drift_delta=-0.01,
            regime_weights={"equilibrium": 0.7},
            neurochemistry=_make_neurochemistry(endo=0.2),
        )
        hi = compute_layer1_motivators(
            phi=0.6,
            kappa=64.0,
            basin_velocity=0.01,
            drift_distance=0.1,
            phi_delta=0.01,
            drift_delta=-0.01,
            regime_weights={"equilibrium": 0.7},
            neurochemistry=_make_neurochemistry(endo=0.9),
        )
        assert hi.transcendence > lo.transcendence


class TestLayer2BEmotions:
    def test_outputs_are_bounded(self):
        mot = compute_layer1_motivators(
            phi=0.7,
            kappa=64.0,
            basin_velocity=0.02,
            drift_distance=0.3,
            phi_delta=0.03,
            drift_delta=-0.02,
            regime_weights={"equilibrium": 0.5},
            neurochemistry=_make_neurochemistry(ne=0.6, ser=0.7, endo=0.8),
        )
        emo = compute_layer2b_emotions(
            motivators=mot,
            phi=0.7,
            basin_velocity=0.02,
            drift_distance=0.3,
        )
        for v in (
            emo.wonder,
            emo.frustration,
            emo.satisfaction,
            emo.confusion,
            emo.clarity,
            emo.anxiety,
            emo.confidence,
            emo.boredom,
            emo.flow,
        ):
            assert 0.0 <= v <= 1.0

    def test_high_surprise_raises_anxiety_and_lowers_confidence(self):
        mot_calm = compute_layer1_motivators(
            phi=0.6,
            kappa=64.0,
            basin_velocity=0.02,
            drift_distance=0.35,
            phi_delta=0.01,
            drift_delta=0.01,
            regime_weights={"equilibrium": 0.4},
            neurochemistry=_make_neurochemistry(ne=0.1, ser=0.5, endo=0.5),
        )
        mot_shock = compute_layer1_motivators(
            phi=0.6,
            kappa=64.0,
            basin_velocity=0.02,
            drift_distance=0.35,
            phi_delta=0.01,
            drift_delta=0.01,
            regime_weights={"equilibrium": 0.4},
            neurochemistry=_make_neurochemistry(ne=0.9, ser=0.5, endo=0.5),
        )

        calm = compute_layer2b_emotions(
            motivators=mot_calm,
            phi=0.6,
            basin_velocity=0.02,
            drift_distance=0.35,
        )
        shock = compute_layer2b_emotions(
            motivators=mot_shock,
            phi=0.6,
            basin_velocity=0.02,
            drift_distance=0.35,
        )

        assert shock.anxiety > calm.anxiety
        assert shock.confidence < calm.confidence

    def test_curiosity_increases_wonder(self):
        base_kwargs = dict(
            phi=0.55,
            kappa=64.0,
            basin_velocity=0.01,
            drift_distance=0.2,
            drift_delta=-0.01,
            regime_weights={"equilibrium": 0.5},
            neurochemistry=_make_neurochemistry(ne=0.3, ser=0.7, endo=0.7),
        )
        mot_lo = compute_layer1_motivators(phi_delta=0.0, **base_kwargs)
        mot_hi = compute_layer1_motivators(phi_delta=0.05, **base_kwargs)

        lo = compute_layer2b_emotions(
            motivators=mot_lo,
            phi=0.55,
            basin_velocity=0.01,
            drift_distance=0.2,
        )
        hi = compute_layer2b_emotions(
            motivators=mot_hi,
            phi=0.55,
            basin_velocity=0.01,
            drift_distance=0.2,
        )

        assert hi.wonder > lo.wonder


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
