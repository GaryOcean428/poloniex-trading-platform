"""
exchange — Python port of TS exchange IO.

v0.8.2 scope: Poloniex v3 Futures REST client. Async, HMAC-SHA256 auth,
matching the TS signing scheme bit-for-bit. Port of
apps/api/src/services/poloniexFuturesService.js.

Future: poloniex_ws.py for WebSocket (deferred to v0.8.7 if REST polling
is insufficient).
"""

from .poloniex_v3 import (
    PoloniexV3Client,
    PoloniexV3Credentials,
    PoloniexV3Error,
    generate_signature,
)

__all__ = [
    "PoloniexV3Client",
    "PoloniexV3Credentials",
    "PoloniexV3Error",
    "generate_signature",
]
