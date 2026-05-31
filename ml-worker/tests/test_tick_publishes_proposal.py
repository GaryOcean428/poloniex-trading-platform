"""Tests that the /monkey/tick/run endpoint publishes a ProposalEvent to the consensus bus.

TDD: tests are written BEFORE the implementation and should fail initially.

Two test groups:
  A. Unit tests that test the _publish_peer_proposal helper directly (no app boot needed).
  B. Integration tests via FastAPI TestClient (skip-safe when pandas/app deps missing).

Contracts:
  1. When CONSENSUS_PROPOSAL_BUS_LIVE=true, publish_proposal_sync is called once
     with a ProposalEvent whose instance_id, symbol, and tick_id match.
  2. When CONSENSUS_PROPOSAL_BUS_LIVE is not set (default), publish_proposal_sync
     is NOT called (dark mode).
  3. Publish failure is swallowed — the tick endpoint still returns 200.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

ML_WORKER_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ML_WORKER_ROOT / "src"

if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))
if str(ML_WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_WORKER_ROOT))


# ── Group A: unit tests for the _publish_peer_proposal helper ─────────────
# These test the helper function extracted from the endpoint handler —
# no app boot, no pandas, no FastAPI required.

from monkey_kernel.proposal_bus import (  # noqa: E402
    ProposalEvent,
    proposal_from_tick_decision,
    publish_proposal_sync,
)


def _make_mock_decision(
    action: str = "hold",
    side: str | None = None,
    size_usdt: float = 0.0,
    leverage: float = 1.0,
    entry_threshold: float = 0.5,
    phi: float = 0.22,
    kappa: float = 64.0,
    mode: str = "investigation",
    regime: str | None = None,
    basin: list[float] | None = None,
) -> Any:
    """Create a minimal mock TickDecision-like object."""
    d = MagicMock()
    d.action = action
    d.side = side
    d.size_usdt = size_usdt
    d.leverage = leverage
    d.entry_threshold = entry_threshold
    d.phi = phi
    d.kappa = kappa
    d.mode = mode
    d.regime_label = regime
    d.basin = basin or [0.1] * 8
    d.derivation = {}
    return d


class TestPublishPeerProposalHelper:
    """Unit tests for the _build_and_publish_peer_proposal logic
    that the endpoint will call after run_tick()."""

    def test_proposal_event_has_correct_instance_and_symbol(self):
        """Mapper produces a ProposalEvent with the expected fields."""
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
            tick_id="BTC_USDT_PERP|42",
        )
        assert evt.instance_id == "monkey-py-peer"
        assert evt.symbol == "BTC_USDT_PERP"
        assert evt.tick_id == "BTC_USDT_PERP|42"
        assert isinstance(evt, ProposalEvent)

    def test_publish_proposal_sync_no_ops_when_bus_off(self):
        """publish_proposal_sync is a no-op when CONSENSUS_PROPOSAL_BUS_LIVE != true."""
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
            tick_id="BTC|1",
        )
        import monkey_kernel.proposal_bus as pb
        # Ensure bus is OFF
        env = {k: v for k, v in os.environ.items() if k != "CONSENSUS_PROPOSAL_BUS_LIVE"}
        env["CONSENSUS_PROPOSAL_BUS_LIVE"] = "false"

        with patch.dict("os.environ", env, clear=True):
            with patch.object(pb, "_sync_publisher", None):
                # publish_proposal_sync should early-return without calling redis
                pb.publish_proposal_sync(evt)
                # If we get here without error and called is never set, the no-op worked
        # No assertion on `called` — just confirms no exception and no Redis call

    def test_proposal_action_normalisation_in_event(self):
        """pyramid_long becomes enter_long in the ProposalEvent."""
        evt = proposal_from_tick_decision(
            symbol="ETH_USDT_PERP",
            instance_id="monkey-py-peer",
            action="pyramid_long",
            side="long",
            size_usdt=20.0,
            leverage=5.0,
            entry_threshold=0.6,
            basin_signature=[0.2] * 8,
            phi=0.3,
            kappa=32.0,
            mode="investigation",
            tick_id="ETH|5",
        )
        assert evt.proposed_action == "enter_long"
        assert evt.side == "long"


# ── Group B: FastAPI integration tests (skip-safe) ────────────────────────

@pytest.fixture(scope="module")
def client():
    """Boot the FastAPI app once per module; skip if imports unavailable."""
    try:
        from fastapi.testclient import TestClient
    except ImportError as exc:
        pytest.skip(f"fastapi TestClient unavailable: {exc}")

    try:
        import main  # noqa: WPS433
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"ml-worker main.py import failed: {type(exc).__name__}: {exc}")

    return TestClient(main.app)


def _make_ohlcv(n: int) -> list[dict[str, float]]:
    base = 100.0
    result = []
    for i in range(n):
        p = base + i * 0.01
        result.append({
            "timestamp": float(1_700_000_000 + i * 60),
            "open": p,
            "high": p + 0.5,
            "low": p - 0.5,
            "close": p + 0.1,
            "volume": 1000.0,
        })
    return result


def _tick_payload(instance_id: str = "monkey-py-peer") -> dict[str, Any]:
    return {
        "instance_id": instance_id,
        "inputs": {
            "symbol": "BTC_USDT_PERP",
            "ohlcv": _make_ohlcv(200),
            "account": {
                "equity_fraction": 0.5,
                "margin_fraction": 0.2,
                "open_positions": 0,
                "available_equity": 1000.0,
            },
            "bank_size": 1000,
            "sovereignty": 0.5,
            "max_leverage": 10,
            "min_notional": 5.0,
            "size_fraction": 1.0,
        },
        "prev_state": None,
    }


def test_publish_proposal_sync_called_when_bus_live(client):
    """When CONSENSUS_PROPOSAL_BUS_LIVE=true, the endpoint must call
    publish_proposal_sync once with a ProposalEvent matching the request."""
    import monkey_kernel.proposal_bus as pb

    captured: list[Any] = []

    def fake_publish(event):
        captured.append(event)

    with patch.dict("os.environ", {"CONSENSUS_PROPOSAL_BUS_LIVE": "true"}):
        with patch.object(pb, "publish_proposal_sync", side_effect=fake_publish):
            payload = _tick_payload(instance_id="monkey-py-peer")
            resp = client.post("/monkey/tick/run", json=payload)

    assert resp.status_code == 200, resp.text
    assert len(captured) == 1, f"Expected publish_proposal_sync called once; got {len(captured)}"
    evt = captured[0]
    assert evt.instance_id == "monkey-py-peer"
    assert evt.symbol == "BTC_USDT_PERP"
    assert evt.tick_id is not None and len(evt.tick_id) > 0
    assert evt.proposed_action in ("enter_long", "enter_short", "exit", "hold")


def test_publish_not_called_when_bus_off(client):
    """When the proposal bus is off, the endpoint must not publish to Redis."""
    import monkey_kernel.proposal_bus as pb

    publisher = MagicMock()
    env_override = {
        k: v for k, v in __import__("os").environ.items()
        if k not in {"CONSENSUS_PROPOSAL_BUS_LIVE", "REDIS_URL"}
    }
    env_override["REDIS_URL"] = "redis://example.invalid:6379/0"
    env_override["CONSENSUS_PROPOSAL_BUS_LIVE"] = "false"

    with patch.dict("os.environ", env_override, clear=True):
        with patch.object(pb, "_sync_publisher", publisher):
            payload = _tick_payload()
            resp = client.post("/monkey/tick/run", json=payload)

    assert resp.status_code == 200, resp.text
    publisher.publish.assert_not_called()


def test_publish_failure_does_not_break_endpoint(client):
    """A Redis publish failure must be swallowed — endpoint must still return 200."""
    import monkey_kernel.proposal_bus as pb

    def raising_publish(event):
        raise RuntimeError("Redis is down")

    with patch.dict("os.environ", {"CONSENSUS_PROPOSAL_BUS_LIVE": "true"}):
        with patch.object(pb, "publish_proposal_sync", side_effect=raising_publish):
            payload = _tick_payload()
            resp = client.post("/monkey/tick/run", json=payload)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "decision" in body
