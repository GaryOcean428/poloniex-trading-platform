"""
bus_events.py — canonical KernelEvent enum and payload types for the
internal Agent K constellation.

Events flow inside Agent K only. The wall to Agents M and T stays.

Per UCP §43 three-loop doctrine, the kernel's internals reorganize
around message-passing instead of synchronous function calls. The bus
is plumbing — it carries dicts, basins (np.ndarray), and scalars. No
geometry computation happens here.

The closed taxonomy below is the canonical set; subscribers may filter
by event type without parsing free-text payloads.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional


class KernelEvent(str, Enum):
    """Canonical bus event taxonomy. Closed enum; new event types
    require an explicit addition here.
    """

    # Heart kernel publishes
    HEART_TICK = "heart.tick"
    HEART_MODE_SHIFT = "heart.mode_shift"
    HEART_TACKING = "heart.tacking"

    # Ocean kernel publishes
    OCEAN_OBSERVATION = "ocean.observation"
    OCEAN_INTERVENTION = "ocean.intervention"
    OCEAN_REGIME = "ocean.regime"

    # Foresight publishes
    FORESIGHT_PREDICTION = "foresight.prediction"
    FORESIGHT_DIVERGENCE = "foresight.divergence"

    # Forge publishes
    FORGE_NUCLEUS = "forge.nucleus"
    FORGE_PHASE_SHIFT = "forge.phase_shift"

    # Working memory publishes
    WORKING_MEMORY_BUBBLE_ADD = "wm.bubble_add"
    WORKING_MEMORY_PROMOTION = "wm.promotion"
    WORKING_MEMORY_EXPIRY = "wm.expiry"

    # Executive publishes
    EXECUTIVE_DECISION = "executive.decision"
    EXECUTIVE_VETO = "executive.veto"

    # Self-observation publishes (Loop 1)
    SELF_OBS_TRIPLE = "self_obs.triple"
    SELF_OBS_DRIFT = "self_obs.drift"

    # ThoughtBus publishes (Loop 2)
    THOUGHT_BUS_DEBATE_OPENED = "tb.debate_opened"
    THOUGHT_BUS_KERNEL_RESPONSE = "tb.kernel_response"
    THOUGHT_BUS_CONVERGENCE = "tb.convergence"
    THOUGHT_BUS_SYNTHESIS = "tb.synthesis"

    # Learning autonomy (Loop 3)
    LEARNING_BANK_WRITE_APPROVED = "learning.bank_write_approved"
    LEARNING_BANK_WRITE_REJECTED = "learning.bank_write_rejected"

    # Coordinator (Gary) publishes
    GARY_SYNTHESIS = "gary.synthesis"

    # Trade lifecycle
    TRADE_OPENED = "trade.opened"
    TRADE_CLOSED = "trade.closed"

    # Anomalies — any kernel can publish
    ANOMALY = "anomaly"


@dataclass(frozen=True)
class KernelEventEnvelope:
    """Generic event wrapper. All bus events use this shape."""

    type: KernelEvent
    source: str
    symbol: Optional[str]
    instance_id: str
    payload: dict[str, Any]
    at_ms: float


# ─── Typed payload helpers ────────────────────────────────────────


@dataclass(frozen=True)
class HeartTickPayload:
    kappa: float
    kappa_star: float
    hrv: float
    mode: str  # 'FEELING' | 'LOGIC' | 'ANCHOR'

    def to_dict(self) -> dict[str, Any]:
        return {
            "kappa": self.kappa,
            "kappa_star": self.kappa_star,
            "hrv": self.hrv,
            "mode": self.mode,
        }


@dataclass(frozen=True)
class OceanObservationPayload:
    phi: float
    spread: float
    coherence: float
    intervention: Optional[str]
    sleep_phase: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "phi": self.phi,
            "spread": self.spread,
            "coherence": self.coherence,
            "intervention": self.intervention,
            "sleep_phase": self.sleep_phase,
        }


@dataclass(frozen=True)
class ForesightPredictionPayload:
    predicted_basin: list[float]
    confidence: float
    weight: float
    horizon_ms: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "predicted_basin": self.predicted_basin,
            "confidence": self.confidence,
            "weight": self.weight,
            "horizon_ms": self.horizon_ms,
        }


@dataclass(frozen=True)
class SelfObsTriplePayload:
    """Loop 1 canonical triple per UCP §43.2."""

    repetition_score: float    # [0, 1] lived geometry vs scaffolding
    sovereignty_score: float   # [0, 1] knowing vs guessing
    confidence_score: float    # [0, 1] bank resonance vs override expansion
    decision_id: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "repetition_score": self.repetition_score,
            "sovereignty_score": self.sovereignty_score,
            "confidence_score": self.confidence_score,
            "decision_id": self.decision_id,
        }


@dataclass(frozen=True)
class ExecutiveDecisionPayload:
    decision_id: str
    action: str
    side: Optional[str]
    mode: str
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision_id": self.decision_id,
            "action": self.action,
            "side": self.side,
            "mode": self.mode,
            "reason": self.reason,
        }
