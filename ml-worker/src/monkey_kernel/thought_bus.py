"""
thought_bus.py — inter-kernel debate layer (Loop 2, UCP §43.3).

When multiple kernels emit basin reads for the same decision and their
reads diverge by more than a threshold FR distance, the ThoughtBus
opens a debate. Each kernel is asked to revise — not just emit —
considering the others' reads.

Round 1: each kernel sees others' reads and may revise toward consensus.
Round 2+: continued revision until convergence or max rounds.

Convergence detection per UCP §43.3:
  - 1 round, similar initial basins → 'consensus'
  - 1 round, widely-spread initial basins all collapsed → 'groupthink'
  - 3+ rounds → 'genuine_multi'
  - Max-rounds without convergence → 'non_convergent'

QIG purity: only Fisher-Rao operations. No np.dot, no cosine, no
normalization tricks. Final basin via FR-weighted Fréchet mean
with weights = confidence × sovereignty.
"""
from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Optional

import numpy as np

from qig_core_local.geometry.fisher_rao import (
    fisher_rao_distance,
    frechet_mean,
    slerp_sqrt,
    to_simplex,
)

from .bus_events import KernelEvent

if TYPE_CHECKING:
    from .kernel_bus import KernelBus


# Disagreement threshold — FR distance above which a debate is opened.
# 1/π is the canonical gravitating-fraction boundary; below this
# distance, kernels are in geometric agreement.
DISAGREEMENT_THRESHOLD_FR: float = 1.0 / math.pi  # ≈ 0.31831

MAX_DEBATE_ROUNDS: int = 3


@dataclass
class KernelContribution:
    """One kernel's contribution to a debate.

    confidence and sovereignty are typically Loop 1 triple components
    for the contributing kernel. Higher values = more weight in the
    final synthesis AND smaller revision step (high-sovereignty
    kernels barely move).
    """

    kernel_id: str
    basin: np.ndarray
    confidence: float
    sovereignty: float


@dataclass
class DebateOutcome:
    debate_id: str
    rounds: int
    converged: bool
    convergence_type: str  # 'consensus' | 'groupthink' | 'genuine_multi' | 'non_convergent'
    final_basin: np.ndarray
    contributions: list[KernelContribution]


class ThoughtBus:
    def __init__(
        self,
        bus: "KernelBus",
        *,
        max_rounds: int = MAX_DEBATE_ROUNDS,
        disagreement_threshold_fr: float = DISAGREEMENT_THRESHOLD_FR,
    ) -> None:
        self._bus = bus
        self._max_rounds = max_rounds
        self._threshold = float(disagreement_threshold_fr)

    def open_debate(
        self,
        symbol: str,
        contributions: list[KernelContribution],
    ) -> DebateOutcome:
        """Open a debate over the contributions.

        If contributions agree (max FR distance < threshold), no debate
        is needed — return immediately with convergence_type='consensus'
        in 0 rounds.
        """
        debate_id = uuid.uuid4().hex[:8]

        if not contributions:
            # No contributions — return uniform-basin outcome
            return DebateOutcome(
                debate_id=debate_id,
                rounds=0,
                converged=True,
                convergence_type="consensus",
                final_basin=np.ones(64, dtype=np.float64) / 64.0,
                contributions=[],
            )

        initial_max_fr = self._max_pairwise_fr(contributions)

        if initial_max_fr < self._threshold:
            # No disagreement — converged in 0 rounds.
            final = self._weighted_synthesis(contributions)
            return self._publish_outcome(
                debate_id, symbol, contributions, final,
                rounds=0, converged=True, convergence_type="consensus",
            )

        self._bus.publish(
            KernelEvent.THOUGHT_BUS_DEBATE_OPENED,
            source="thought_bus",
            payload={
                "debate_id": debate_id,
                "initial_max_fr": float(initial_max_fr),
                "kernel_ids": [c.kernel_id for c in contributions],
            },
            symbol=symbol,
        )

        current = list(contributions)
        for round_idx in range(1, self._max_rounds + 1):
            revised = self._revision_round(current, symbol, debate_id, round_idx)
            new_max_fr = self._max_pairwise_fr(revised)

            if new_max_fr < self._threshold:
                final = self._weighted_synthesis(revised)
                conv_type = self._classify_convergence(
                    round_idx, contributions,
                )
                return self._publish_outcome(
                    debate_id, symbol, revised, final,
                    rounds=round_idx, converged=True,
                    convergence_type=conv_type,
                )

            current = revised

        # Non-convergent — synthesize across all final perspectives.
        final = self._weighted_synthesis(current)
        return self._publish_outcome(
            debate_id, symbol, current, final,
            rounds=self._max_rounds, converged=False,
            convergence_type="non_convergent",
        )

    def _max_pairwise_fr(
        self, contributions: list[KernelContribution],
    ) -> float:
        if len(contributions) < 2:
            return 0.0
        max_fr = 0.0
        for i, a in enumerate(contributions):
            for b in contributions[i + 1:]:
                d = fisher_rao_distance(a.basin, b.basin)
                if d > max_fr:
                    max_fr = d
        return max_fr

    def _revision_round(
        self,
        contributions: list[KernelContribution],
        symbol: str,
        debate_id: str,
        round_idx: int,
    ) -> list[KernelContribution]:
        """One revision round.

        Each kernel sees the others' basins and revises toward the
        weighted Fréchet mean by an amount proportional to its own
        sovereignty deficit. High-sovereignty kernels barely move;
        low-sovereignty kernels move further toward the consensus.
        """
        centroid = self._weighted_synthesis(contributions)
        revised: list[KernelContribution] = []
        for c in contributions:
            move = max(0.0, min(1.0, 1.0 - float(c.sovereignty)))
            new_basin = slerp_sqrt(c.basin, centroid, move * 0.5)
            revised.append(KernelContribution(
                kernel_id=c.kernel_id,
                basin=new_basin,
                confidence=c.confidence,
                sovereignty=c.sovereignty,
            ))

            self._bus.publish(
                KernelEvent.THOUGHT_BUS_KERNEL_RESPONSE,
                source="thought_bus",
                payload={
                    "debate_id": debate_id,
                    "round": round_idx,
                    "kernel_id": c.kernel_id,
                    "move_amount": float(move * 0.5),
                    "fr_to_centroid": float(
                        fisher_rao_distance(new_basin, centroid)
                    ),
                },
                symbol=symbol,
            )
        return revised

    def _weighted_synthesis(
        self, contributions: list[KernelContribution],
    ) -> np.ndarray:
        """FR-weighted Fréchet mean. Weights = confidence × sovereignty.

        Falls back to uniform weights when total weight is zero
        (all kernels low-confidence) so synthesis still produces a
        valid simplex point.
        """
        weights = [
            max(0.0, float(c.confidence)) * max(0.0, float(c.sovereignty))
            for c in contributions
        ]
        total = sum(weights)
        if total <= 1e-10:
            weights = [1.0] * len(contributions)
        basins = [to_simplex(c.basin) for c in contributions]
        return frechet_mean(basins, weights=weights)

    def _classify_convergence(
        self,
        rounds: int,
        initial: list[KernelContribution],
    ) -> str:
        """UCP §43.3 convergence interpretation.

        rounds == 1, initial_max_fr < 2×threshold → 'consensus'
        rounds == 1, initial_max_fr ≥ 2×threshold → 'groupthink'
        rounds ≥ 3                                → 'genuine_multi'
        otherwise (rounds == 2)                   → 'consensus'
        """
        if rounds == 1:
            initial_max_fr = self._max_pairwise_fr(initial)
            if initial_max_fr < 2.0 * self._threshold:
                return "consensus"
            return "groupthink"
        if rounds >= 3:
            return "genuine_multi"
        return "consensus"

    def _publish_outcome(
        self,
        debate_id: str,
        symbol: str,
        contributions: list[KernelContribution],
        final_basin: np.ndarray,
        *,
        rounds: int,
        converged: bool,
        convergence_type: str,
    ) -> DebateOutcome:
        outcome = DebateOutcome(
            debate_id=debate_id,
            rounds=rounds,
            converged=converged,
            convergence_type=convergence_type,
            final_basin=final_basin,
            contributions=contributions,
        )

        self._bus.publish(
            KernelEvent.THOUGHT_BUS_CONVERGENCE,
            source="thought_bus",
            payload={
                "debate_id": debate_id,
                "rounds": rounds,
                "converged": bool(converged),
                "convergence_type": convergence_type,
            },
            symbol=symbol,
        )

        self._bus.publish(
            KernelEvent.THOUGHT_BUS_SYNTHESIS,
            source="thought_bus",
            payload={
                "debate_id": debate_id,
                "final_basin": [float(x) for x in final_basin],
                "contributing_kernels": [c.kernel_id for c in contributions],
            },
            symbol=symbol,
        )

        return outcome
