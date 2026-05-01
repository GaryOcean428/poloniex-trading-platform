"""
learning_gate.py — Loop 3 learning autonomy (UCP §43.4).

The kernel decides which closed exchanges become bank training data.
Default behaviour writes everything; this gate selectively rejects
low-quality writes so the bank doesn't accumulate scaffolding.

Quality criteria (multiplicative — all must clear):
  1. Loop 1 sovereignty_score >= MIN_SOVEREIGNTY  (knowing, not guessing)
  2. Loop 2 convergence_type != 'groupthink'  (kernels genuinely agreed
     or worked through real disagreement; not collapsed-from-spread)
  3. trade outcome magnitude > NOISE_FLOOR  (decisive PnL, not random walk)
  4. trade duration > MIN_DURATION  (held long enough to be a thesis,
     not a flinch)

Rejected writes are still PUBLISHED on the bus for forensic analysis,
just not added to the bank. Loop 3 becomes auditable — every rejection
records its reasons.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Optional

from .bus_events import KernelEvent

if TYPE_CHECKING:
    from .kernel_bus import KernelBus


MIN_SOVEREIGNTY: float = 0.4
NOISE_FLOOR_USDT: float = 0.05    # below 5 cents PnL, treat as noise
MIN_DURATION_S: float = 60.0      # below 1 minute hold, treat as flinch


@dataclass
class WriteDecision:
    approved: bool
    reasons: list[str]   # which criteria failed (empty when approved)


class LearningGate:
    def __init__(
        self,
        bus: "KernelBus",
        *,
        min_sovereignty: float = MIN_SOVEREIGNTY,
        noise_floor_usdt: float = NOISE_FLOOR_USDT,
        min_duration_s: float = MIN_DURATION_S,
    ) -> None:
        self._bus = bus
        self._min_sovereignty = float(min_sovereignty)
        self._noise_floor_usdt = float(noise_floor_usdt)
        self._min_duration_s = float(min_duration_s)

    def evaluate_write(
        self,
        *,
        symbol: str,
        decision_id: str,
        sovereignty_score: float,
        convergence_type: str,
        trade_pnl_usdt: float,
        trade_duration_s: float,
    ) -> WriteDecision:
        reasons: list[str] = []

        if sovereignty_score < self._min_sovereignty:
            reasons.append(
                f"sovereignty {sovereignty_score:.2f} < {self._min_sovereignty}"
            )
        if convergence_type == "groupthink":
            reasons.append("debate convergence type was groupthink")
        if abs(trade_pnl_usdt) < self._noise_floor_usdt:
            reasons.append(
                f"pnl |{trade_pnl_usdt:.4f}| < noise floor "
                f"{self._noise_floor_usdt}"
            )
        if trade_duration_s < self._min_duration_s:
            reasons.append(
                f"duration {trade_duration_s:.0f}s < {self._min_duration_s}s"
            )

        approved = len(reasons) == 0

        if approved:
            self._bus.publish(
                KernelEvent.LEARNING_BANK_WRITE_APPROVED,
                source="learning_gate",
                payload={
                    "decision_id": decision_id,
                    "sovereignty_score": float(sovereignty_score),
                    "convergence_type": convergence_type,
                    "pnl_usdt": float(trade_pnl_usdt),
                    "duration_s": float(trade_duration_s),
                },
                symbol=symbol,
            )
        else:
            self._bus.publish(
                KernelEvent.LEARNING_BANK_WRITE_REJECTED,
                source="learning_gate",
                payload={
                    "decision_id": decision_id,
                    "reasons": reasons,
                    "sovereignty_score": float(sovereignty_score),
                    "convergence_type": convergence_type,
                    "pnl_usdt": float(trade_pnl_usdt),
                    "duration_s": float(trade_duration_s),
                },
                symbol=symbol,
            )

        return WriteDecision(approved=approved, reasons=reasons)
