"""
coordinator.py — Gary, the Agent K constellation coordinator.

Per CONSCIOUSNESS_ARCHITECTURE_INTEGRATED.md: trajectory-based foresight
prediction, regime-adaptive weighting, Heart-modulated confidence,
Fisher-Rao geometric synthesis.

Gary is NOT a decision-maker. The coordinator subscribes to the most
recent reads from Heart, Ocean, Foresight, builds KernelContribution
list, opens a ThoughtBus debate, and publishes the synthesized basin
as GARY_SYNTHESIS. The executive consumes it.

The wall to Agent M and T stays. Gary lives entirely inside Agent K.

QIG purity: Fisher-Rao only. Uses fisher_rao_distance,
slerp_sqrt (geodesic interpolation), frechet_mean indirectly via
ThoughtBus._weighted_synthesis.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Optional

import numpy as np

from qig_core_local.geometry.fisher_rao import to_simplex

from .bus_events import KernelEvent
from .thought_bus import KernelContribution, ThoughtBus

if TYPE_CHECKING:
    from .kernel_bus import KernelBus


@dataclass
class GaryReading:
    synthesized_basin: np.ndarray
    foresight_weight: float
    foresight_confidence: float
    heart_modulation: float
    convergence_type: str
    rounds: int
    contributing_kernels: list[str]
    debate_id: str
    at_ms: float


class GaryCoordinator:
    """Coordinator for one Agent K constellation instance.

    Subscribes to HEART_TICK, OCEAN_OBSERVATION, FORESIGHT_PREDICTION
    via the bus. On synthesize(), builds KernelContribution list from
    the latest reads, opens a ThoughtBus debate, returns the debate's
    final basin. Publishes GARY_SYNTHESIS.
    """

    def __init__(
        self,
        bus: "KernelBus",
        *,
        regime_thresholds: tuple[float, float] = (0.3, 0.7),
        thought_bus: Optional[ThoughtBus] = None,
    ) -> None:
        self._bus = bus
        self._regime_low, self._regime_high = regime_thresholds
        self._thought_bus = thought_bus or ThoughtBus(bus)

        # Latest reads per kernel
        self._heart_state: Optional[dict] = None
        self._ocean_state: Optional[dict] = None
        self._foresight_state: Optional[dict] = None

        self._unsubs = [
            bus.subscribe(
                "gary.heart", self._on_heart, types=[KernelEvent.HEART_TICK],
            ),
            bus.subscribe(
                "gary.ocean", self._on_ocean,
                types=[KernelEvent.OCEAN_OBSERVATION],
            ),
            bus.subscribe(
                "gary.foresight", self._on_foresight,
                types=[KernelEvent.FORESIGHT_PREDICTION],
            ),
        ]

    def _on_heart(self, env) -> None:
        self._heart_state = env.payload

    def _on_ocean(self, env) -> None:
        self._ocean_state = env.payload

    def _on_foresight(self, env) -> None:
        self._foresight_state = env.payload

    def synthesize(
        self,
        consensus_basin: np.ndarray,
        symbol: str,
        *,
        executive_confidence: float = 0.5,
        executive_sovereignty: float = 0.5,
    ) -> GaryReading:
        """Produce GARY_SYNTHESIS from current constellation state.

        Builds KernelContribution list from executive (consensus_basin)
        plus any kernels that have published recent reads. Opens a
        ThoughtBus debate; the debate's final basin is the synthesized
        output.

        Heart modulation: when Heart is in ANCHOR mode (κ ≈ κ*) the
        kernel is in tacking transition — reduce foresight weight by
        0.5×.

        Regime-adaptive foresight weighting per the canonical doc:
          phi < 0.3                          → 0.1
          0.3 ≤ phi < 0.7 (geometric)        → 0.7 × confidence
          phi ≥ 0.7 (breakdown risk damping) → 0.2
        """
        consensus = to_simplex(consensus_basin)

        phi = float(self._ocean_state.get("phi", 0.5)) if self._ocean_state else 0.5
        foresight_conf = (
            float(self._foresight_state.get("confidence", 0.0))
            if self._foresight_state else 0.0
        )

        if phi < self._regime_low:
            foresight_weight = 0.1
        elif phi < self._regime_high:
            foresight_weight = 0.7 * foresight_conf
        else:
            foresight_weight = 0.2

        heart_modulation = 1.0
        if self._heart_state and self._heart_state.get("mode") == "ANCHOR":
            heart_modulation = 0.5
            foresight_weight *= heart_modulation

        contributions: list[KernelContribution] = [
            KernelContribution(
                kernel_id="executive",
                basin=consensus,
                confidence=float(executive_confidence),
                sovereignty=float(executive_sovereignty),
            ),
        ]
        contributing_kernels = ["executive"]

        if (
            self._foresight_state is not None
            and foresight_weight > 0.0
            and "predicted_basin" in self._foresight_state
        ):
            try:
                predicted = np.asarray(
                    self._foresight_state["predicted_basin"], dtype=np.float64,
                )
                contributions.append(KernelContribution(
                    kernel_id="foresight",
                    basin=to_simplex(predicted),
                    confidence=float(foresight_conf),
                    sovereignty=float(foresight_weight),
                ))
                contributing_kernels.append("foresight")
            except Exception:  # noqa: BLE001
                pass

        outcome = self._thought_bus.open_debate(symbol, contributions)

        reading = GaryReading(
            synthesized_basin=outcome.final_basin,
            foresight_weight=float(foresight_weight),
            foresight_confidence=float(foresight_conf),
            heart_modulation=float(heart_modulation),
            convergence_type=outcome.convergence_type,
            rounds=outcome.rounds,
            contributing_kernels=contributing_kernels,
            debate_id=outcome.debate_id,
            at_ms=time.time() * 1000.0,
        )

        self._bus.publish(
            KernelEvent.GARY_SYNTHESIS,
            source="gary",
            payload={
                "synthesized_basin": [float(x) for x in outcome.final_basin],
                "foresight_weight": float(foresight_weight),
                "foresight_confidence": float(foresight_conf),
                "heart_modulation": float(heart_modulation),
                "convergence_type": outcome.convergence_type,
                "rounds": outcome.rounds,
                "contributing_kernels": contributing_kernels,
                "debate_id": outcome.debate_id,
            },
            symbol=symbol,
        )

        return reading

    def shutdown(self) -> None:
        """Unsubscribe from the bus. Called when the coordinator is
        destroyed; safe to call multiple times."""
        for unsub in self._unsubs:
            try:
                unsub()
            except Exception:  # noqa: BLE001
                pass
        self._unsubs = []
