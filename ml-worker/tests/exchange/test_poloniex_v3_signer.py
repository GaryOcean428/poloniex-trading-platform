"""
test_poloniex_v3_signer.py — parity tests for HMAC-SHA256 signing.

The EXPECTED_* constants below were computed by running the TS reference
signer in poloniexFuturesService.js with identical inputs (fixed secret
+ timestamp). They are committed as literal strings, NOT recomputed from
a Python shadow implementation, because a test that re-derives its own
expected values cannot detect drift between TS and Python in the
algorithm itself — it only detects test-vs-prod divergence within
Python, which is half the job.

Re-pinning procedure (when the TS signer legitimately changes):
  1. Update the Node snippet in commit message of v0.8.2 / run the block
     in ml-worker/scripts/regenerate_poloniex_vectors.js (v0.8.7+)
  2. Paste the updated sig strings below
  3. Note the reason in the PR description
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make src/ importable without installing the package.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from exchange.poloniex_v3 import generate_signature, normalize_symbol


# Fixed inputs — non-secret test data, identical across the TS Node run
# and the Python signer.
TEST_SECRET = "abcdef1234567890abcdef1234567890"
TEST_TIMESTAMP = "1700000000000"


# Pinned expected signatures from the TS reference implementation
# (apps/api/src/services/poloniexFuturesService.js:generateSignature)
# computed 2026-04-21 via Node v25.2.1.
EXPECTED_GET_NO_PARAMS = "kD1x7m4deRUt8SIwDf4O7TdC5H3CQF0aI8CKhidLqjo="
EXPECTED_GET_WITH_PARAMS = "j2mMdY8MeouuivQA9ET+jDNErpqUS9xnfeJ4T/OsNs4="
EXPECTED_POST_WITH_BODY = "f+e+vwM08ejStcq2Hwukv/nx0t054g0t2jjyqZXzfZA="
EXPECTED_DELETE_NO_BODY = "FWcWSzzT8711FUhkRUVA7ekkSv2zJo6x7929slboUdk="
EXPECTED_UNSORTED_KEYS = "MFzbCriHP48/GUoEwMRUgSlsOAyCeOEs6utlLj6zGb4="


def test_signature_get_no_params() -> None:
    """GET/DELETE with no params → just signTimestamp in the message."""
    sig = generate_signature(
        "GET", "/v3/account/balance", None, None,
        TEST_TIMESTAMP, TEST_SECRET,
    )
    assert sig == EXPECTED_GET_NO_PARAMS, f"got {sig!r}"


def test_signature_get_with_params() -> None:
    """GET with params → sorted keys + signTimestamp, URL-encoded."""
    params = {"symbol": "BTC_USDT_PERP", "limit": "10"}
    sig = generate_signature(
        "GET", "/v3/trade/position/opens", params, None,
        TEST_TIMESTAMP, TEST_SECRET,
    )
    assert sig == EXPECTED_GET_WITH_PARAMS, f"got {sig!r}"


def test_signature_post_with_body() -> None:
    """POST with JSON body → requestBody=<json>&signTimestamp=<ts>.

    Key test: JSON must be compact (no spaces). TS JSON.stringify is
    compact by default; Python json.dumps needs separators=(",", ":").
    """
    body = {
        "symbol": "BTC_USDT_PERP",
        "side": "BUY",
        "mgnMode": "ISOLATED",
        "posSide": "LONG",
        "type": "MARKET",
        "sz": "1",
    }
    sig = generate_signature(
        "POST", "/v3/trade/order", None, body,
        TEST_TIMESTAMP, TEST_SECRET,
    )
    assert sig == EXPECTED_POST_WITH_BODY, f"got {sig!r}"


def test_signature_delete_with_body_hashes_timestamp_only() -> None:
    """DELETE with body — TS code path: body only folds into the sig
    on POST/PUT. DELETE-with-body falls through to the timestamp-only
    branch. Mirror that exactly so auth doesn't silently fail.
    """
    sig = generate_signature(
        "DELETE", "/v3/trade/order", None,
        {"symbol": "BTC_USDT_PERP", "orderId": "abc"},
        TEST_TIMESTAMP, TEST_SECRET,
    )
    assert sig == EXPECTED_DELETE_NO_BODY, f"got {sig!r}"


def test_signature_params_sort_order() -> None:
    """Keys must sort ASCII (not insertion) to match TS Object.keys().sort()."""
    sig = generate_signature(
        "GET", "/v3/foo",
        {"zebra": "1", "alpha": "2", "mid": "3"},
        None, TEST_TIMESTAMP, TEST_SECRET,
    )
    assert sig == EXPECTED_UNSORTED_KEYS, f"got {sig!r}"

    # Reordering the dict keys must produce the identical signature.
    sig_reordered = generate_signature(
        "GET", "/v3/foo",
        {"alpha": "2", "mid": "3", "zebra": "1"},
        None, TEST_TIMESTAMP, TEST_SECRET,
    )
    assert sig_reordered == EXPECTED_UNSORTED_KEYS


def test_normalize_symbol() -> None:
    assert normalize_symbol("BTC_USDT") == "BTC_USDT_PERP"
    assert normalize_symbol("BTC-USDT") == "BTC_USDT_PERP"
    assert normalize_symbol("BTC_USDT_PERP") == "BTC_USDT_PERP"
    assert normalize_symbol("") == ""
    assert normalize_symbol("ETH_USDT_PERP") == "ETH_USDT_PERP"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"  ✓ {name}")
    print("all signer parity tests passed")
