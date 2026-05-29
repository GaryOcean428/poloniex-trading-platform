from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from monkey_kernel import expectation_bubble as eb  # noqa: E402


class _FakeWarpBubble:
    regime_label = "CRITICAL"

    @classmethod
    def qig_regime(cls, *, h: float, J: float, dim: int):
        assert h > 0
        assert J > 0
        assert dim == 2
        return SimpleNamespace(
            rules=SimpleNamespace(bridge_exponent=0.86, screening_length=1.0),
            regime=SimpleNamespace(regime=SimpleNamespace(value=cls.regime_label)),
        )


def test_adapter_flip_to_basin_on_reverse_tape(monkeypatch):
    monkeypatch.setattr(eb, "WarpBubble", _FakeWarpBubble)
    decision = eb.TradingExpectationBubble().evaluate(
        tape_trend=-0.65,
        basin_direction=0.18,
        recent_returns=[0.01, -0.004, 0.003, 0.002],
        position_context={"decision_surface": "entry", "proposed_side": "short"},
    )

    assert decision.qig_warp_source == "QIG_WARP_RUNTIME"
    assert decision.reverse_tape_window is True
    assert decision.expectation_action == "flip_to_basin"
    assert decision.expectation_direction == "long"


def test_adapter_maps_held_adverse_basin_to_exit_action(monkeypatch):
    monkeypatch.setattr(eb, "WarpBubble", _FakeWarpBubble)
    decision = eb.TradingExpectationBubble().evaluate(
        tape_trend=-0.65,
        basin_direction=0.18,
        recent_returns=[0.01, -0.004, 0.003, 0.002],
        position_context={"decision_surface": "exit", "held_side": "short"},
    )

    assert decision.expectation_action == "exit_now"
    assert "invalidated" in decision.expectation_reason
