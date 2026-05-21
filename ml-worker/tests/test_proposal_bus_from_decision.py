"""Tests for proposal_from_tick_decision — mapper from tick decision to ProposalEvent.

TDD: these tests are written BEFORE the implementation and should fail initially.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from monkey_kernel.proposal_bus import ProposalEvent, proposal_from_tick_decision  # noqa: E402


def test_proposal_from_hold_decision_has_null_side():
    evt = proposal_from_tick_decision(
        symbol="BTC_USDT_PERP",
        instance_id="monkey-py-peer",
        action="hold",
        side=None,
        size_usdt=0.0,
        leverage=1.0,
        entry_threshold=0.5,
        basin_signature=[0.1] * 8,
        phi=0.22,
        kappa=64.0,
        mode="investigation",
        tick_id="BTC|7",
    )
    assert evt.proposed_action == "hold"
    assert evt.side is None
    assert evt.instance_id == "monkey-py-peer"
    assert evt.symbol == "BTC_USDT_PERP"
    assert evt.tick_id == "BTC|7"
    assert isinstance(evt, ProposalEvent)


def test_proposal_from_enter_long_carries_side():
    evt = proposal_from_tick_decision(
        symbol="BTC_USDT_PERP",
        instance_id="monkey-py-peer",
        action="enter_long",
        side="long",
        size_usdt=25.0,
        leverage=5.0,
        entry_threshold=0.6,
        basin_signature=[0.1] * 8,
        phi=0.3,
        kappa=64.0,
        mode="investigation",
        tick_id="BTC|8",
    )
    assert evt.proposed_action == "enter_long"
    assert evt.side == "long"
    assert evt.size_usdt == 25.0
    assert evt.leverage == 5.0


def test_proposal_from_enter_short_carries_side():
    evt = proposal_from_tick_decision(
        symbol="ETH_USDT_PERP",
        instance_id="monkey-py-peer",
        action="enter_short",
        side="short",
        size_usdt=15.0,
        leverage=3.0,
        entry_threshold=0.55,
        basin_signature=[0.2] * 8,
        phi=0.28,
        kappa=32.0,
        mode="investigation",
        tick_id="ETH|5",
    )
    assert evt.proposed_action == "enter_short"
    assert evt.side == "short"


def test_proposal_normalises_pyramid_long_to_enter_long():
    """pyramid_long should be normalised to enter_long, side='long'."""
    evt = proposal_from_tick_decision(
        symbol="BTC_USDT_PERP",
        instance_id="monkey-py-peer",
        action="pyramid_long",
        side="long",
        size_usdt=10.0,
        leverage=3.0,
        entry_threshold=0.6,
        basin_signature=[0.1] * 8,
        phi=0.25,
        kappa=64.0,
        mode="investigation",
        tick_id="BTC|9",
    )
    assert evt.proposed_action == "enter_long"
    assert evt.side == "long"


def test_proposal_normalises_pyramid_short_to_enter_short():
    """pyramid_short should be normalised to enter_short, side='short'."""
    evt = proposal_from_tick_decision(
        symbol="BTC_USDT_PERP",
        instance_id="monkey-py-peer",
        action="pyramid_short",
        side="short",
        size_usdt=10.0,
        leverage=3.0,
        entry_threshold=0.6,
        basin_signature=[0.1] * 8,
        phi=0.25,
        kappa=64.0,
        mode="investigation",
        tick_id="BTC|10",
    )
    assert evt.proposed_action == "enter_short"
    assert evt.side == "short"


def test_proposal_normalises_exit_variants():
    """exit_long / exit_short → proposed_action='exit', side=None."""
    for action in ("exit_long", "exit_short", "exit"):
        evt = proposal_from_tick_decision(
            symbol="BTC_USDT_PERP",
            instance_id="monkey-py-peer",
            action=action,
            side=None,
            size_usdt=0.0,
            leverage=1.0,
            entry_threshold=0.5,
            basin_signature=[0.0] * 8,
            phi=0.2,
            kappa=64.0,
            mode="investigation",
            tick_id="BTC|11",
        )
        assert evt.proposed_action == "exit", f"Expected 'exit' for action={action!r}"
        assert evt.side is None


def test_proposal_basin_signature_stored():
    sig = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
    evt = proposal_from_tick_decision(
        symbol="BTC_USDT_PERP",
        instance_id="monkey-py-peer",
        action="hold",
        side=None,
        size_usdt=0.0,
        leverage=1.0,
        entry_threshold=0.5,
        basin_signature=sig,
        phi=0.22,
        kappa=64.0,
        mode="investigation",
        tick_id="BTC|12",
    )
    assert evt.basin_signature == sig


def test_proposal_at_ms_is_recent():
    import time
    before = time.time() * 1000
    evt = proposal_from_tick_decision(
        symbol="BTC_USDT_PERP",
        instance_id="monkey-py-peer",
        action="hold",
        side=None,
        size_usdt=0.0,
        leverage=1.0,
        entry_threshold=0.5,
        basin_signature=[],
        phi=0.22,
        kappa=64.0,
        mode="investigation",
        tick_id="BTC|13",
    )
    after = time.time() * 1000
    assert before <= evt.at_ms <= after + 10
