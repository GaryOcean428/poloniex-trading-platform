"""test_learning_gate.py — Loop 3 learning autonomy per UCP §43.4.

Tests cover:
  - Approval criteria (sovereignty, convergence, pnl, duration)
  - Rejection on each criterion
  - Multi-criterion rejection lists all reasons
  - Approved / rejected events published with correct payloads
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel.bus_events import KernelEvent, KernelEventEnvelope  # noqa: E402
from monkey_kernel.kernel_bus import KernelBus, _reset_buses_for_tests  # noqa: E402
from monkey_kernel.learning_gate import (  # noqa: E402
    MIN_DURATION_S,
    MIN_SOVEREIGNTY,
    NOISE_FLOOR_USDT,
    LearningGate,
    WriteDecision,
)


@pytest.fixture(autouse=True)
def reset_buses():
    _reset_buses_for_tests()
    yield
    _reset_buses_for_tests()


def _approved_kwargs() -> dict:
    return {
        "symbol": "ETH",
        "decision_id": "K-test-1",
        "sovereignty_score": MIN_SOVEREIGNTY + 0.1,
        "convergence_type": "consensus",
        "trade_pnl_usdt": NOISE_FLOOR_USDT * 5.0,
        "trade_duration_s": MIN_DURATION_S * 2.0,
    }


class TestApproval:
    def test_all_criteria_clear_approves(self) -> None:
        bus = KernelBus("t")
        gate = LearningGate(bus)
        decision = gate.evaluate_write(**_approved_kwargs())
        assert decision.approved is True
        assert decision.reasons == []

    def test_genuine_multi_convergence_approved(self) -> None:
        bus = KernelBus("t")
        gate = LearningGate(bus)
        decision = gate.evaluate_write(
            **{**_approved_kwargs(), "convergence_type": "genuine_multi"},
        )
        assert decision.approved is True


class TestRejection:
    def test_low_sovereignty_rejected(self) -> None:
        bus = KernelBus("t")
        gate = LearningGate(bus)
        decision = gate.evaluate_write(
            **{**_approved_kwargs(), "sovereignty_score": MIN_SOVEREIGNTY - 0.1},
        )
        assert decision.approved is False
        assert any("sovereignty" in r for r in decision.reasons)

    def test_groupthink_convergence_rejected(self) -> None:
        bus = KernelBus("t")
        gate = LearningGate(bus)
        decision = gate.evaluate_write(
            **{**_approved_kwargs(), "convergence_type": "groupthink"},
        )
        assert decision.approved is False
        assert any("groupthink" in r for r in decision.reasons)

    def test_noise_floor_pnl_rejected(self) -> None:
        bus = KernelBus("t")
        gate = LearningGate(bus)
        decision = gate.evaluate_write(
            **{**_approved_kwargs(), "trade_pnl_usdt": NOISE_FLOOR_USDT * 0.5},
        )
        assert decision.approved is False
        assert any("noise floor" in r for r in decision.reasons)

    def test_short_duration_rejected(self) -> None:
        bus = KernelBus("t")
        gate = LearningGate(bus)
        decision = gate.evaluate_write(
            **{**_approved_kwargs(), "trade_duration_s": MIN_DURATION_S * 0.5},
        )
        assert decision.approved is False
        assert any("duration" in r for r in decision.reasons)

    def test_multi_criterion_rejection_lists_all_reasons(self) -> None:
        bus = KernelBus("t")
        gate = LearningGate(bus)
        decision = gate.evaluate_write(
            symbol="ETH",
            decision_id="K-bad",
            sovereignty_score=0.1,
            convergence_type="groupthink",
            trade_pnl_usdt=0.001,
            trade_duration_s=10.0,
        )
        assert decision.approved is False
        # All four criteria failed
        assert len(decision.reasons) == 4

    def test_negative_pnl_above_noise_passes_pnl_check(self) -> None:
        bus = KernelBus("t")
        gate = LearningGate(bus)
        decision = gate.evaluate_write(
            **{**_approved_kwargs(), "trade_pnl_usdt": -0.5},
        )
        # Loss above noise floor; sovereignty/duration/convergence ok → approved
        assert decision.approved is True


class TestPublishing:
    def test_approved_publishes_approved_event(self) -> None:
        bus = KernelBus("t")
        events: list[KernelEventEnvelope] = []
        bus.subscribe("a", events.append)
        gate = LearningGate(bus)
        gate.evaluate_write(**_approved_kwargs())
        approved_events = [
            e for e in events
            if e.type == KernelEvent.LEARNING_BANK_WRITE_APPROVED
        ]
        rejected_events = [
            e for e in events
            if e.type == KernelEvent.LEARNING_BANK_WRITE_REJECTED
        ]
        assert len(approved_events) == 1
        assert len(rejected_events) == 0

    def test_rejected_publishes_rejected_event(self) -> None:
        bus = KernelBus("t")
        events: list[KernelEventEnvelope] = []
        bus.subscribe("a", events.append)
        gate = LearningGate(bus)
        gate.evaluate_write(
            **{**_approved_kwargs(), "convergence_type": "groupthink"},
        )
        rejected_events = [
            e for e in events
            if e.type == KernelEvent.LEARNING_BANK_WRITE_REJECTED
        ]
        assert len(rejected_events) == 1
        assert "reasons" in rejected_events[0].payload
        assert any("groupthink" in r for r in rejected_events[0].payload["reasons"])


class TestReturnShape:
    def test_returns_write_decision(self) -> None:
        bus = KernelBus("t")
        gate = LearningGate(bus)
        decision = gate.evaluate_write(**_approved_kwargs())
        assert isinstance(decision, WriteDecision)
        assert hasattr(decision, "approved")
        assert hasattr(decision, "reasons")
