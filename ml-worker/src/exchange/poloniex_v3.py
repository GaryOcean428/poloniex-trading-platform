"""
poloniex_v3.py — Python port of Poloniex v3 Futures REST client.

Source of truth: apps/api/src/services/poloniexFuturesService.js.
The HMAC-SHA256 signing scheme is reproduced EXACTLY — identical inputs
must produce identical signatures across the TS and Python clients (this
is asserted in tests/test_poloniex_v3_signer.py with a known vector).

Poloniex v3 API envelope: {code, data, msg}. A non-200 body code is an
application error even when HTTP is 200 — most commonly seen on
POST /v3/trade/order, where HTTP returns 200 but body is
{code: <non-200>, msg: "<reason>"} with no data. Diagnosed 2026-04-19
after phantom orders were being "placed" that never executed. This
client raises PoloniexV3Error on application errors so callers don't
silently swallow them.

Purity: this module is NOT QIG cognition — it's BOUNDARY (per P14).
Exchange IO is explicitly outside the purity-check scope. No Δ⁶³
operations happen here.

v0.8.2 — client only, no orchestration wiring. v0.8.7 will migrate
call-sites from TS to this client as part of risk_kernel +
live_signal + autonomous_trader ports.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import quote

logger = logging.getLogger("exchange.poloniex_v3")

DEFAULT_BASE_URL = "https://api.poloniex.com"
DEFAULT_TIMEOUT_S = 30.0

# JavaScript encodeURIComponent leaves these characters unescaped:
#   A-Z a-z 0-9 - _ . ! ~ * ' ( )
# Python urllib.parse.quote's `safe` arg controls the same thing.
# Match byte-for-byte so the signed paramString matches the TS output.
_URI_COMPONENT_SAFE = "-_.!~*'()"


@dataclass(frozen=True)
class PoloniexV3Credentials:
    """API credentials for authenticated endpoints.

    Public endpoints (klines, contract info, trading info) do not require
    credentials — pass None where credentials are optional.
    """

    api_key: str
    api_secret: str


class PoloniexV3Error(RuntimeError):
    """Raised when Poloniex returns an application-level error.

    Application errors arrive as HTTP 200 with a non-200 body code:
      {code: 10001, msg: "Param error", data: null}
    Attributes mirror the TS side (poloniexCode, poloniexMsg, endpoint)
    so existing callers' error handling translates directly.
    """

    def __init__(
        self,
        endpoint: str,
        code: Any,
        msg: Optional[str],
        http_status: int = 200,
    ):
        super().__init__(
            f"Poloniex {endpoint} returned code={code}: {msg or 'no message'}"
        )
        self.endpoint = endpoint
        self.poloniex_code = code
        self.poloniex_msg = msg
        self.http_status = http_status


def normalize_symbol(symbol: str) -> str:
    """Normalize a symbol to Poloniex v3 futures form (…_PERP).

    BTC_USDT → BTC_USDT_PERP
    BTC-USDT → BTC_USDT_PERP
    BTC_USDT_PERP → BTC_USDT_PERP (unchanged)

    Matches poloniexFuturesService.normalizeSymbol() exactly.
    """
    if not symbol:
        return symbol
    base = symbol.replace("-", "_")
    if base.endswith("_PERP") or "PERP" in base:
        return base
    return f"{base}_PERP"


def generate_signature(
    method: str,
    request_path: str,
    params: Optional[dict[str, Any]],
    body: Optional[dict[str, Any]],
    timestamp: str,
    api_secret: str,
) -> str:
    """Reproduce the TS HMAC-SHA256 signing scheme.

    Three paramString shapes (matches poloniexFuturesService.js:65-102):

      POST/PUT with body:
        requestBody=<json>&signTimestamp=<ts>

      GET/DELETE with params:
        <key1>=<val1>&<key2>=<val2>&...&signTimestamp=<ts>
        (keys sorted ASCII, values URL-encoded)

      No params, no body:
        signTimestamp=<ts>

    Message: METHOD\\n<request_path>\\n<paramString>
    Sign: HMAC-SHA256(api_secret, message) → base64
    """
    method_upper = method.upper()

    if body is not None and method_upper in ("POST", "PUT"):
        # JSON.stringify produces compact form in Node; json.dumps with
        # separators=(",", ":") matches exactly.
        body_json = json.dumps(body, separators=(",", ":"))
        param_string = f"requestBody={body_json}&signTimestamp={timestamp}"
    elif params:
        # sort ASCII, url-encode values same way as encodeURIComponent
        all_params = dict(params)
        all_params["signTimestamp"] = timestamp
        sorted_keys = sorted(all_params.keys())
        encoded = [
            f"{quote(str(k), safe=_URI_COMPONENT_SAFE)}="
            f"{quote(str(all_params[k]), safe=_URI_COMPONENT_SAFE)}"
            for k in sorted_keys
        ]
        param_string = "&".join(encoded)
    else:
        param_string = f"signTimestamp={timestamp}"

    message = f"{method_upper}\n{request_path}\n{param_string}"
    digest = hmac.new(
        api_secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64.b64encode(digest).decode("ascii")


class PoloniexV3Client:
    """Async Poloniex v3 Futures REST client.

    Usage:
        async with PoloniexV3Client(credentials) as c:
            bal = await c.get_account_balance()
            positions = await c.get_positions()
            await c.place_order({
                "symbol": "BTC_USDT_PERP", "side": "BUY",
                "mgnMode": "ISOLATED", "posSide": "LONG",
                "type": "MARKET", "sz": "1",
            })

    Rate limiting: callers' responsibility — this client does not
    throttle. In v0.8.7 the risk kernel's rate-limit budget mediates
    all exchange calls (same pattern as the TS side).
    """

    def __init__(
        self,
        credentials: Optional[PoloniexV3Credentials] = None,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ):
        self._creds = credentials
        self._base_url = base_url.rstrip("/")
        self._timeout_s = timeout_s
        self._session = None  # aiohttp.ClientSession — lazy init

    async def __aenter__(self):
        await self._ensure_session()
        return self

    async def __aexit__(self, *_exc):
        await self.close()

    async def close(self) -> None:
        if self._session is not None:
            await self._session.close()
            self._session = None

    async def _ensure_session(self):
        if self._session is None:
            # Import here so module import doesn't require aiohttp
            # installed until first actual use.
            import aiohttp

            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self._timeout_s),
            )

    # ── Auth helpers ─────────────────────────────────────────────

    def _auth_headers(
        self,
        method: str,
        request_path: str,
        params: Optional[dict[str, Any]],
        body: Optional[dict[str, Any]],
    ) -> dict[str, str]:
        if self._creds is None:
            raise RuntimeError(
                "authenticated endpoint called without credentials"
            )
        timestamp = str(int(time.time() * 1000))
        signature = generate_signature(
            method, request_path, params, body, timestamp,
            self._creds.api_secret,
        )
        return {
            "Content-Type": "application/json",
            "key": self._creds.api_key,
            "signature": signature,
            "signTimestamp": timestamp,
            "signatureMethod": "hmacSHA256",
            "signatureVersion": "2",
        }

    # ── Request engines ──────────────────────────────────────────

    async def _request(
        self,
        method: str,
        endpoint: str,
        *,
        params: Optional[dict[str, Any]] = None,
        body: Optional[dict[str, Any]] = None,
        authenticated: bool = True,
    ) -> Any:
        await self._ensure_session()
        request_path = f"/v3{endpoint}"
        url = f"{self._base_url}{request_path}"

        # Symbol normalization mirrors TS client — authenticated only,
        # both body and params.
        if authenticated:
            if body and "symbol" in body:
                body = {**body, "symbol": normalize_symbol(body["symbol"])}
            if params and "symbol" in params:
                params = {**params, "symbol": normalize_symbol(params["symbol"])}

        headers = (
            self._auth_headers(method, request_path, params, body)
            if authenticated
            else {"Content-Type": "application/json"}
        )

        kwargs: dict[str, Any] = {"headers": headers}
        if params and method.upper() == "GET":
            kwargs["params"] = params
        if body is not None and method.upper() in ("POST", "PUT", "DELETE"):
            kwargs["data"] = json.dumps(body, separators=(",", ":"))

        assert self._session is not None
        async with self._session.request(method.upper(), url, **kwargs) as resp:
            text = await resp.text()
            http_status = resp.status
            try:
                payload = json.loads(text) if text else {}
            except json.JSONDecodeError:
                raise PoloniexV3Error(
                    endpoint=request_path,
                    code=None,
                    msg=f"non-JSON response: {text[:200]}",
                    http_status=http_status,
                )

        body_code = payload.get("code") if isinstance(payload, dict) else None
        body_msg = payload.get("msg") if isinstance(payload, dict) else None

        logger.debug(
            "poloniex_v3 %s %s → http=%d code=%s msg=%s",
            method.upper(), request_path, http_status, body_code, body_msg,
        )

        is_application_error = (
            body_code is not None
            and body_code != 200
            and body_code != 0
            and str(body_code).upper() != "SUCCESS"
        )
        if is_application_error:
            raise PoloniexV3Error(
                endpoint=request_path,
                code=body_code,
                msg=body_msg,
                http_status=http_status,
            )

        if isinstance(payload, dict) and "data" in payload:
            return payload["data"]
        return payload

    # ── Account ──────────────────────────────────────────────────

    async def get_account_balance(self) -> Any:
        """GET /v3/account/balance."""
        return await self._request("GET", "/account/balance")

    async def transfer_to_spot(self, amount: float) -> Any:
        """POST /v3/account/transfer-out — USDT from futures to spot."""
        return await self._request(
            "POST", "/account/transfer-out",
            body={"currency": "USDT", "amount": str(amount)},
        )

    async def get_account_bills(self, **params: Any) -> Any:
        """GET /v3/account/bills."""
        return await self._request("GET", "/account/bills", params=params or None)

    # ── Positions ────────────────────────────────────────────────

    async def get_positions(self, **params: Any) -> Any:
        """GET /v3/trade/position/opens."""
        return await self._request(
            "GET", "/trade/position/opens", params=params or None,
        )

    async def get_position_history(self, **params: Any) -> Any:
        """GET /v3/trade/position/history."""
        return await self._request(
            "GET", "/trade/position/history", params=params or None,
        )

    async def set_leverage(self, symbol: str, leverage: int, mgn_mode: str = "ISOLATED") -> Any:
        """POST /v3/position/leverage."""
        return await self._request(
            "POST", "/position/leverage",
            body={"symbol": symbol, "lever": str(leverage), "mgnMode": mgn_mode},
        )

    async def get_leverages(self, **params: Any) -> Any:
        """GET /v3/position/leverages."""
        return await self._request(
            "GET", "/position/leverages", params=params or None,
        )

    async def get_position_mode(self) -> Any:
        """GET /v3/position/mode — one-way vs hedge."""
        return await self._request("GET", "/position/mode")

    async def set_position_mode(self, mode: str) -> Any:
        """POST /v3/position/mode. mode ∈ {'ONE_WAY', 'HEDGE'}."""
        return await self._request(
            "POST", "/position/mode", body={"posMode": mode},
        )

    # ── Orders ───────────────────────────────────────────────────

    async def place_order(self, order: dict[str, Any]) -> Any:
        """POST /v3/trade/order.

        Caller must pass the v3 wire form (UPPER side/type, sz as string
        in contracts, posSide, mgnMode). The TS placeOrder() wrapper does
        extra ergonomic translation; v0.8.7 will move that translation
        here when autonomous_trader.py lands.
        """
        return await self._request("POST", "/trade/order", body=order)

    async def place_orders(self, orders: list[dict[str, Any]]) -> Any:
        """POST /v3/trade/orders — batch."""
        return await self._request("POST", "/trade/orders", body={"orders": orders})

    async def cancel_order(self, order_id: str, symbol: str) -> Any:
        """DELETE /v3/trade/order."""
        return await self._request(
            "DELETE", "/trade/order",
            body={"symbol": symbol, "orderId": order_id},
        )

    async def cancel_all_orders(self, symbol: Optional[str] = None) -> Any:
        """DELETE /v3/trade/allOrders."""
        body = {"symbol": symbol} if symbol else {}
        return await self._request("DELETE", "/trade/allOrders", body=body)

    async def get_open_orders(self, **params: Any) -> Any:
        """GET /v3/trade/order/opens."""
        return await self._request(
            "GET", "/trade/order/opens", params=params or None,
        )

    async def get_order_history(self, **params: Any) -> Any:
        """GET /v3/trade/order/history."""
        return await self._request(
            "GET", "/trade/order/history", params=params or None,
        )

    async def get_execution_details(self, **params: Any) -> Any:
        """GET /v3/trade/order/trades — fills."""
        return await self._request(
            "GET", "/trade/order/trades", params=params or None,
        )

    # ── Positions: close ─────────────────────────────────────────

    async def close_position(
        self, symbol: str, close_type: str = "close_long",
    ) -> Any:
        """POST /v3/trade/position. close_type ∈ {'close_long', 'close_short'}."""
        return await self._request(
            "POST", "/trade/position",
            body={"symbol": symbol, "type": close_type},
        )

    async def close_all_positions(self) -> Any:
        """POST /v3/trade/positionAll."""
        return await self._request("POST", "/trade/positionAll", body={})

    # ── Market data (public, no auth) ────────────────────────────

    async def get_trading_info(self, symbol: Optional[str] = None) -> Any:
        """GET /v3/market/get-trading-info."""
        params = {"symbol": symbol} if symbol else None
        return await self._request(
            "GET", "/market/get-trading-info",
            params=params, authenticated=False,
        )

    async def get_kline_data(
        self,
        symbol: str,
        granularity: int | str,
        *,
        from_ts: Optional[int] = None,
        to_ts: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> Any:
        """GET /v3/market/get-kline-data.

        granularity in minutes: 1, 5, 15, 30, 60, 120, 240, 480, 720,
        1440, 10080.
        """
        params: dict[str, Any] = {
            "symbol": symbol,
            "granularity": str(granularity),
        }
        if from_ts is not None:
            params["from"] = from_ts
        if to_ts is not None:
            params["to"] = to_ts
        if limit is not None:
            params["limit"] = limit
        return await self._request(
            "GET", "/market/get-kline-data",
            params=params, authenticated=False,
        )

    async def get_contract_info(self, symbol: Optional[str] = None) -> Any:
        """GET /v3/market/get-contract-info."""
        params = {"symbol": symbol} if symbol else None
        return await self._request(
            "GET", "/market/get-contract-info",
            params=params, authenticated=False,
        )


# ── Convenience wrapper: sync one-shot calls ─────────────────────

def run_sync(coro):
    """Run an async call from sync code (tests / ad-hoc scripts).

    Not for use in the main tick loop — that path is async throughout.
    """
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
