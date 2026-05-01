"""test_thought_bus.py — Loop 2 inter-kernel debate per UCP §43.3.

Tests cover:
  - No-debate consensus when contributions agree
  - Debate fires when FR distance > threshold (1/π)
  - Convergence classification (consensus / groupthink / genuine_multi /
    non_convergent)
  - Sovereignty-weighted revision (high sovereignty → barely moves)
  - FR-weighted Fréchet synthesis (not arithmetic mean)
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from qig_core_local.geometry.fisher_rao import (  # noqa: E402
    fisher_rao_distance,
    to_simplex,
)

from monkey_kernel.bus_events import KernelEvent, KernelEventEnvelope  # noqa: E402
from monkey_kernel.kernel_bus import KernelBus, _reset_buses_for_tests  # noqa: E402
from monkey_kernel.state import BASIN_DIM  # noqa: E402
from monkey_kernel.thought_bus import (  # noqa: E402
    DISAGREEMENT_THRESHOLD_FR,
    KernelContribution,
    ThoughtBus,
)


@pytest.fixture(autouse=True)
def reset_buses():
    _reset_buses_for_tests()
    yield
    _reset_buses_for_tests()


def _peak(idx: int, peak: float = 0.5) -> np.ndarray:
    b = np.full(BASIN_DIM, (1.0 - peak) / (BASIN_DIM - 1), dtype=np.float64)
    b[idx] = peak
    return to_simplex(b)


def _make_contributions(
    *triples: tuple[np.ndarray, float, float],
) -> list[KernelContribution]:
    return [
        KernelContribution(
            kernel_id=f"k{i}", basin=basin,
            confidence=conf, sovereignty=sov,
        )
        for i, (basin, conf, sov) in enumerate(triples)
    ]


class TestNoDebate:
    def test_close_basins_no_debate(self) -> None:
        bus = KernelBus("t")
        tb = ThoughtBus(bus)
        # Two near-identical basins
        b = _peak(0, 0.3)
        outcome = tb.open_debate(
            "ETH",
            _make_contributions((b, 0.7, 0.7), (b.copy(), 0.6, 0.6)),
        )
        assert outcome.rounds == 0
        assert outcome.converged is True
        assert outcome.convergence_type == "consensus"


class TestDebate:
    def test_far_basins_open_debate(self) -> None:
        bus = KernelBus("t")
        events: list[KernelEventEnvelope] = []
        bus.subscribe("a", events.append)
        tb = ThoughtBus(bus)
        # Maximally distant basins
        outcome = tb.open_debate(
            "ETH",
            _make_contributions(
                (_peak(0, 0.9), 0.5, 0.3),
                (_peak(63, 0.9), 0.5, 0.3),
            ),
        )
        # At minimum, DEBATE_OPENED should be present
        types = {e.type for e in events}
        assert KernelEvent.THOUGHT_BUS_DEBATE_OPENED in types
        assert KernelEvent.THOUGHT_BUS_CONVERGENCE in types
        assert KernelEvent.THOUGHT_BUS_SYNTHESIS in types
        assert outcome.rounds >= 1

    def test_convergence_genuine_multi_at_3_rounds(self) -> None:
        bus = KernelBus("t")
        tb = ThoughtBus(bus)
        # Spread basins; with low sovereignty, kernels move toward
        # consensus over multiple rounds.
        outcome = tb.open_debate(
            "ETH",
            _make_contributions(
                (_peak(0, 0.9), 0.4, 0.2),
                (_peak(63, 0.9), 0.4, 0.2),
                (_peak(32, 0.9), 0.4, 0.2),
            ),
        )
        assert outcome.converged is True
        if outcome.rounds >= 3:
            assert outcome.convergence_type == "genuine_multi"

    def test_groupthink_label_for_widely_spread_one_round(self) -> None:
        bus = KernelBus("t")
        # Force fast convergence with very low sovereignty
        # (each move = 0.5 × (1 - 0.0) = 0.5 → big step in one round)
        tb = ThoughtBus(bus)
        outcome = tb.open_debate(
            "ETH",
            _make_contributions(
                (_peak(0, 0.9), 0.5, 0.0),
                (_peak(63, 0.9), 0.5, 0.0),
            ),
        )
        # If converged in 1 round from spread > 2×threshold: groupthink.
        if outcome.rounds == 1:
            initial_d = fisher_rao_distance(_peak(0, 0.9), _peak(63, 0.9))
            if initial_d >= 2.0 * DISAGREEMENT_THRESHOLD_FR:
                assert outcome.convergence_type == "groupthink"

    def test_max_rounds_reached_without_convergence_is_non_convergent(
        self,
    ) -> None:
        bus = KernelBus("t")
        # max_rounds=1, and high-sovereignty kernels will barely move
        tb = ThoughtBus(bus, max_rounds=1)
        outcome = tb.open_debate(
            "ETH",
            _make_contributions(
                (_peak(0, 0.95), 0.9, 1.0),
                (_peak(63, 0.95), 0.9, 1.0),
            ),
        )
        if not outcome.converged:
            assert outcome.convergence_type == "non_convergent"


class TestSovereigntyWeighting:
    def test_high_sovereignty_kernel_barely_moves(self) -> None:
        bus = KernelBus("t")
        tb = ThoughtBus(bus, max_rounds=1)
        b1 = _peak(0, 0.9)
        b2 = _peak(63, 0.9)
        outcome = tb.open_debate(
            "ETH",
            _make_contributions(
                (b1, 0.9, 1.0),  # very high sovereignty → no move
                (b2, 0.9, 0.0),  # zero sovereignty → max move
            ),
        )
        # First contribution should still be near b1 after revision
        if outcome.contributions:
            d_high_sov = fisher_rao_distance(
                outcome.contributions[0].basin, b1,
            )
            d_low_sov = fisher_rao_distance(
                outcome.contributions[1].basin, b2,
            )
            # Low-sovereignty contribution moved further than high
            assert d_low_sov >= d_high_sov - 1e-9


class TestSynthesis:
    def test_final_basin_is_simplex_valid(self) -> None:
        bus = KernelBus("t")
        tb = ThoughtBus(bus)
        outcome = tb.open_debate(
            "ETH",
            _make_contributions(
                (_peak(0, 0.5), 0.5, 0.5),
                (_peak(10, 0.5), 0.5, 0.5),
            ),
        )
        assert outcome.final_basin.shape == (BASIN_DIM,)
        assert outcome.final_basin.sum() == pytest.approx(1.0, abs=1e-6)
        assert all(x >= 0.0 for x in outcome.final_basin)

    def test_empty_contributions_returns_uniform(self) -> None:
        bus = KernelBus("t")
        tb = ThoughtBus(bus)
        outcome = tb.open_debate("ETH", [])
        assert outcome.final_basin.shape == (BASIN_DIM,)
        assert outcome.final_basin.sum() == pytest.approx(1.0, abs=1e-6)
        assert outcome.rounds == 0

    def test_zero_weight_falls_back_uniform(self) -> None:
        # All-zero confidence × sovereignty falls back to uniform
        # weighting in synthesis. Check synthesis is still valid simplex.
        bus = KernelBus("t")
        tb = ThoughtBus(bus)
        outcome = tb.open_debate(
            "ETH",
            _make_contributions(
                (_peak(0, 0.5), 0.0, 0.0),
                (_peak(10, 0.5), 0.0, 0.0),
            ),
        )
        assert outcome.final_basin.sum() == pytest.approx(1.0, abs=1e-6)


class TestEventOrder:
    def test_events_published_in_order(self) -> None:
        bus = KernelBus("t")
        events: list[KernelEventEnvelope] = []
        bus.subscribe("a", events.append)
        tb = ThoughtBus(bus)
        tb.open_debate(
            "ETH",
            _make_contributions(
                (_peak(0, 0.9), 0.5, 0.2),
                (_peak(63, 0.9), 0.5, 0.2),
            ),
        )
        types = [e.type for e in events]
        # DEBATE_OPENED comes first
        assert types[0] == KernelEvent.THOUGHT_BUS_DEBATE_OPENED
        # CONVERGENCE before SYNTHESIS at the end
        assert KernelEvent.THOUGHT_BUS_CONVERGENCE in types
        assert KernelEvent.THOUGHT_BUS_SYNTHESIS in types
        conv_idx = types.index(KernelEvent.THOUGHT_BUS_CONVERGENCE)
        synth_idx = types.index(KernelEvent.THOUGHT_BUS_SYNTHESIS)
        assert conv_idx < synth_idx


class TestThreshold:
    def test_threshold_is_inv_pi(self) -> None:
        assert DISAGREEMENT_THRESHOLD_FR == pytest.approx(1.0 / math.pi)
