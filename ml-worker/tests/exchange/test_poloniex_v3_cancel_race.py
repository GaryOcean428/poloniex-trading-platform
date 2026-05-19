"""
test_poloniex_v3_cancel_race.py — idempotent cancel_order on code=11008.

When the order has already filled (or been cancelled by another path)
between the bot's stale-decision and the DELETE arriving, the exchange
returns {code: 11008, msg: "The order does not exist"}. The desired
terminal state — no live order with that id — is already true, so
cancel_order must catch and return a raceResolved sentinel so callers
can advance their state-machine to reconcile from the next poll.

Mirrors the TS swallow path in apps/api/src/services/poloniexFuturesService.js.

Uses asyncio.run directly — no pytest-asyncio dependency.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from exchange.poloniex_v3 import PoloniexV3Client, PoloniexV3Error


def _client() -> PoloniexV3Client:
    # Credentials can be None — _request is mocked, signing is not exercised.
    return PoloniexV3Client()


def test_cancel_order_swallows_11008_race() -> None:
    async def _run() -> Any:
        client = _client()
        err = PoloniexV3Error(
            endpoint="/trade/order",
            code=11008,
            msg="The order does not exist",
        )
        client._request = AsyncMock(side_effect=err)  # type: ignore[method-assign]
        return await client.cancel_order(
            order_id="579679007277432832", symbol="BTC_USDT_PERP",
        )

    result = asyncio.run(_run())
    assert result == {"ok": True, "raceResolved": True, "code": 11008}


def test_cancel_order_rethrows_non_11008() -> None:
    async def _run() -> None:
        client = _client()
        err = PoloniexV3Error(
            endpoint="/trade/order",
            code=10001,
            msg="Invalid signature",
        )
        client._request = AsyncMock(side_effect=err)  # type: ignore[method-assign]
        await client.cancel_order(order_id="999", symbol="BTC_USDT_PERP")

    try:
        asyncio.run(_run())
    except PoloniexV3Error as exc:
        assert exc.poloniex_code == 10001
    else:
        raise AssertionError("expected PoloniexV3Error to propagate, got none")


def test_cancel_order_uses_v3_ordId_field_name() -> None:
    """Regression: the TS client got `orderId` vs `ordId` wrong historically.

    Python was sending {orderId: ...} which would fail with 401 once the
    flag flipped. PR #826 corrects to {ordId: ...} matching v3 spec +
    the TS cancelOrder body.
    """
    captured: dict[str, Any] = {}

    async def _run() -> None:
        client = _client()
        mock_request = AsyncMock(return_value={"ok": True})
        client._request = mock_request  # type: ignore[method-assign]
        await client.cancel_order(order_id="abc123", symbol="ETH_USDT_PERP")
        captured["call"] = mock_request.await_args

    asyncio.run(_run())
    call = captured["call"]
    body = call.kwargs["body"]
    assert body == {"symbol": "ETH_USDT_PERP", "ordId": "abc123"}
    assert "orderId" not in body
