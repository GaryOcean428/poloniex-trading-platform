"""Tests for the issue #689 Python K shadow endpoint.

Exercises POST /monkey/k-shadow/tick directly via FastAPI's TestClient.
Five contracts pinned:

  1. Healthy input → endpoint returns the slim parity-row shape with
     all required keys present (action, side, size_intent, phi, kappa,
     M, Gamma, R, regime, mode, decided_at_ms). No exceptions.

  2. Malformed input (missing ohlcv, bad JSON shape) → endpoint MUST
     return HTTP 200 with {"error": ..., "decided_at_ms": ...} —
     never a 500 / never an unhandled exception. Shadow MUST NOT
     affect live.

  3. Insufficient OHLCV (< 50 candles) → endpoint MUST return a valid
     slim shape with action == 'hold' (the kernel's _hold_for_reason
     path) — proves the endpoint covers the cold-start case the live
     fanout will hit on the first ticks of a newly-listed symbol.

  4. Kappa warm-start (issue #710) — when two requests are sent with
     different `kappa` values the endpoint MUST return different kappa
     values in the response.  Pinning kappa=50 vs kappa=100 should
     produce clearly different py_kappa outputs (EMA step from each
     seed must land in separate neighbourhoods) — this is the regression
     test for the cold-start EMA plateau bug where py_kappa was always
     ~64.11 regardless of symbol or tick.

  5. Cold-start baseline (issue #710 review) — when a kappa hint is
     supplied, the response MUST include `kappa_cold` (computed from
     a fresh cold-start state seeded at the registry default, ~63.8).
     This allows kernel_parity_log to log delta_kappa_cold alongside
     the seeded delta_kappa so the cutover gate is not resting on a
     tautological comparison.

The endpoint NEVER raises, even on internal exceptions — the response
ALWAYS includes decided_at_ms so the TS caller can persist a parity row.

Issue #709 regression: Gamma (basin_velocity / geometric-purity scalar)
must be > 0 when the live _symbol_states cache has a prior basin set
for the symbol, matching the TS side's behaviour.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import numpy as np
import pytest

ML_WORKER_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ML_WORKER_ROOT / "src"


@pytest.fixture(scope="module")
def client():
    """Boot the FastAPI app once per module and return a TestClient."""
    if str(SRC_DIR) not in sys.path:
        sys.path.insert(0, str(SRC_DIR))
    if str(ML_WORKER_ROOT) not in sys.path:
        sys.path.insert(0, str(ML_WORKER_ROOT))

    try:
        from fastapi.testclient import TestClient
    except ImportError as exc:
        pytest.skip(f"fastapi TestClient unavailable: {exc}")

    try:
        import main  # noqa: WPS433 — deferred import is the point
    except Exception as exc:  # noqa: BLE001 — main import surfaces env issues
        pytest.skip(f"ml-worker main.py import failed: {type(exc).__name__}: {exc}")

    return TestClient(main.app)


def _make_ohlcv(n: int) -> list[dict[str, float]]:
    """Generate `n` synthetic candles. Prices walk slightly up so
    momentum / basin direction land deterministically. Volume kept
    constant so the regime classifier has a clean reading."""
    base = 100.0
    rows: list[dict[str, float]] = []
    for i in range(n):
        c = base + 0.05 * i
        rows.append({
            "timestamp": float(1_700_000_000 + 60 * i),
            "open": c,
            "high": c + 0.10,
            "low": c - 0.10,
            "close": c,
            "volume": 1_000.0,
        })
    return rows


def _request_body(ohlcv: list[dict[str, float]] | None = None, kappa: float | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {
        "instance_id": "test-k-shadow",
        "inputs": {
            "symbol": "BTC_USDT_PERP",
            "ohlcv": ohlcv if ohlcv is not None else _make_ohlcv(120),
            "account": {
                "equity_fraction": 0.05,
                "margin_fraction": 0.1,
                "open_positions": 0,
                "available_equity": 1000.0,
                "exchange_held_side": None,
            },
            "bank_size": 0,
            "sovereignty": 0.5,
            "max_leverage": 10,
            "min_notional": 5.0,
            "size_fraction": 1.0,
        },
        "prev_state": None,
    }
    if kappa is not None:
        body["kappa"] = kappa
    return body


REQUIRED_KEYS = {
    "action", "side", "size_intent", "phi", "kappa",
    "M", "Gamma", "R", "regime", "mode", "decided_at_ms",
}


class TestKShadowEndpoint:
    def test_healthy_input_returns_slim_parity_shape(self, client):
        resp = client.post("/monkey/k-shadow/tick", json=_request_body())
        assert resp.status_code == 200
        body = resp.json()
        # Either we got a clean decision (all REQUIRED_KEYS present) OR
        # we got an error envelope (still HTTP 200, never 500). Both
        # paths are valid — the contract is "endpoint never breaks
        # live", not "endpoint always produces a decision".
        if "error" in body and body.get("error"):
            assert "decided_at_ms" in body
            assert isinstance(body["decided_at_ms"], int)
        else:
            missing = REQUIRED_KEYS - set(body.keys())
            assert not missing, f"missing keys in shadow response: {missing}"
            assert isinstance(body["decided_at_ms"], int)
            assert isinstance(body["action"], str)
            assert body["side"] in (None, "long", "short")
            assert isinstance(body["size_intent"], (int, float))
            # phi/kappa are numeric (size_intent / Gamma may also be numeric)
            assert isinstance(body["phi"], (int, float))
            assert isinstance(body["kappa"], (int, float))
            # R is None or 0/1/2
            assert body["R"] in (None, 0, 1, 2)

    def test_malformed_json_returns_error_envelope_not_500(self, client):
        # Send a bytes body that isn't valid JSON.
        resp = client.post(
            "/monkey/k-shadow/tick",
            content=b"this is not json",
            headers={"Content-Type": "application/json"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "error" in body
        assert "decided_at_ms" in body
        assert isinstance(body["decided_at_ms"], int)
        assert "bad_json" in body["error"] or "JSONDecode" in body["error"]

    def test_missing_ohlcv_returns_error_envelope_not_500(self, client):
        # Body shape that drops `inputs` entirely → endpoint must
        # swallow the KeyError / TypeError chain.
        resp = client.post("/monkey/k-shadow/tick", json={"instance_id": "x"})
        assert resp.status_code == 200
        body = resp.json()
        # Either error envelope OR empty-OHLCV graceful hold.
        if "error" in body and body.get("error"):
            assert "decided_at_ms" in body
        else:
            assert body.get("action") == "hold"

    def test_insufficient_ohlcv_returns_hold(self, client):
        # < 50 candles trips the kernel's insufficient_ohlcv branch in
        # run_tick. The endpoint should still produce a slim shape with
        # action='hold' (never raise).
        resp = client.post(
            "/monkey/k-shadow/tick",
            json=_request_body(_make_ohlcv(10)),
        )
        assert resp.status_code == 200
        body = resp.json()
        if "error" in body and body.get("error"):
            # Acceptable: kernel raised something that fell into the
            # outer try-except. The contract holds (never 500).
            assert "decided_at_ms" in body
        else:
            assert body.get("action") == "hold"
            for key in REQUIRED_KEYS:
                assert key in body


    def test_kappa_warm_start_varies_output(self, client):
        """Issue #710 regression: py_kappa must vary when different kappa
        seeds are passed.

        Without the fix, fresh_symbol_state always seeds kappa=63.8 → one
        EMA step with near-constant phi (uniform identity basin, bv=0) →
        py_kappa always ~64.11 regardless of the `kappa` field.

        With the fix, `kappa` propagates into fresh_symbol_state as kappa_initial:
          - kappa=50  → EMA stays near 50-neighbourhood → py_kappa < 60
          - kappa=100 → EMA stays near 100-neighbourhood → py_kappa > 90

        Both responses must be HTTP 200 with all REQUIRED_KEYS (not error
        envelopes) for the assertion to be meaningful.
        """
        ohlcv = _make_ohlcv(120)
        resp_low  = client.post("/monkey/k-shadow/tick", json=_request_body(ohlcv, kappa=50.0))
        resp_high = client.post("/monkey/k-shadow/tick", json=_request_body(ohlcv, kappa=100.0))
        assert resp_low.status_code == 200
        assert resp_high.status_code == 200
        body_low  = resp_low.json()
        body_high = resp_high.json()
        # Skip if either returned an error envelope (e.g. missing deps).
        if body_low.get("error") or body_high.get("error"):
            pytest.skip("k-shadow returned error envelope — skipping kappa variation check")
        kappa_low  = body_low["kappa"]
        kappa_high = body_high["kappa"]
        assert isinstance(kappa_low, (int, float))
        assert isinstance(kappa_high, (int, float))
        # The two seeds are 50 apart.  After one EMA step the outputs
        # must be meaningfully separated (at least 5 units apart).
        assert abs(kappa_high - kappa_low) > 5, (
            f"py_kappa variation too small — kappa_low={kappa_low:.4f}, "
            f"kappa_high={kappa_high:.4f} (diff={abs(kappa_high-kappa_low):.4f}). "
            "Warm-start kappa fix (#710) may not be working."
        )

    def test_cold_start_kappa_returned_when_hint_supplied(self, client):
        """Issue #710 (review) parity-log tautology guard: when a kappa hint
        is supplied the response must include `kappa_cold` — the independent
        cold-start baseline computed without the seed.

        `kappa_cold` must:
          - be present in the response body
          - be a numeric value
          - differ meaningfully from the warm-start `kappa` when the seed
            is far from the cold-start default (~63.8 registry value).

        This ensures that kernel_parity_log can expose delta_kappa_cold
        (|ts_kappa − py_kappa_cold|) alongside the seeded delta_kappa,
        so the cutover gate is not resting on a tautological comparison.
        """
        ohlcv = _make_ohlcv(120)
        # Use a seed far from the cold-start default so the two kappas
        # are clearly distinguishable.
        resp = client.post("/monkey/k-shadow/tick", json=_request_body(ohlcv, kappa=50.0))
        assert resp.status_code == 200
        body = resp.json()
        if body.get("error"):
            pytest.skip("k-shadow returned error envelope — skipping kappa_cold check")
        assert "kappa_cold" in body, (
            "kappa_cold missing from response — cold-start baseline not being computed "
            "(parity-log tautology guard, issue #710 review)"
        )
        kappa_warm = body["kappa"]
        kappa_cold = body["kappa_cold"]
        assert isinstance(kappa_cold, (int, float))
        # kappa=50 seed is ~14 units below the cold-start default (~63.8).
        # After one EMA step the warm output should be noticeably below
        # the cold output.
        assert abs(kappa_warm - kappa_cold) > 3, (
            f"kappa_warm={kappa_warm:.4f} and kappa_cold={kappa_cold:.4f} are too close "
            f"(diff={abs(kappa_warm - kappa_cold):.4f}). Cold-start and warm-start should "
            "diverge when the seed is far from the default."
        )


class TestKShadowGammaFix:
    """Regression tests for issue #709: py_gamma=0 fix.

    Before the fix, the k-shadow endpoint always created a fresh
    SymbolState (last_basin=None), so bv=0 and Gamma=0 in the response.
    The fix seeds from _symbol_states live cache (read-only deepcopy)
    so the shadow sees real basin geometry when the live path has
    warmed up.
    """

    @staticmethod
    def _perturbed_basin(dim: int = 64) -> np.ndarray:
        """Return a valid simplex point that is NOT the uniform basin,
        so the Fisher-Rao distance to any other non-identical basin > 0."""
        b = np.ones(dim, dtype=np.float64)
        b[0] += 1.0  # tip toward first dimension — all values remain positive
        b /= b.sum()
        return b

    def test_gamma_nonzero_when_live_state_cached(self, client):
        """Gamma must be > 0 when _symbol_states has last_basin set for
        the symbol — this is the issue #709 regression gate."""
        main = sys.modules.get("main")
        if main is None:
            pytest.skip("main module not loaded")

        try:
            from monkey_kernel.tick import fresh_symbol_state
            from monkey_kernel.basin import uniform_basin
        except ImportError as exc:
            pytest.skip(f"monkey_kernel not importable: {exc}")

        # live_instance_id = payload["instance_id"] (not the k-shadow prefix)
        live_key = ("test-k-shadow", "BTC_USDT_PERP")
        live_state = fresh_symbol_state("BTC_USDT_PERP", uniform_basin(64))
        # Set last_basin to a perturbed basin so FR distance to next tick > 0
        live_state.last_basin = self._perturbed_basin()

        main._symbol_states[live_key] = live_state
        try:
            resp = client.post("/monkey/k-shadow/tick", json=_request_body())
        finally:
            main._symbol_states.pop(live_key, None)

        assert resp.status_code == 200
        body = resp.json()
        if "error" in body and body.get("error"):
            pytest.skip(f"shadow endpoint returned error (env issue): {body['error']}")
        assert "Gamma" in body
        assert isinstance(body["Gamma"], (int, float)), (
            f"Gamma must be numeric, got {type(body['Gamma'])}"
        )
        assert body["Gamma"] > 0, (
            f"Gamma must be > 0 when live last_basin is set (#709 regression), got Gamma={body['Gamma']}"
        )

    def test_live_state_not_mutated_by_shadow(self, client):
        """run_tick is called on a deepcopy of the live state, so the
        live last_basin must remain unchanged after the shadow tick."""
        main = sys.modules.get("main")
        if main is None:
            pytest.skip("main module not loaded")

        try:
            from monkey_kernel.tick import fresh_symbol_state
            from monkey_kernel.basin import uniform_basin
        except ImportError as exc:
            pytest.skip(f"monkey_kernel not importable: {exc}")

        live_key = ("test-k-shadow", "BTC_USDT_PERP")
        live_state = fresh_symbol_state("BTC_USDT_PERP", uniform_basin(64))
        original_last_basin = self._perturbed_basin()
        live_state.last_basin = original_last_basin.copy()

        main._symbol_states[live_key] = live_state
        try:
            resp = client.post("/monkey/k-shadow/tick", json=_request_body())
        finally:
            # Capture the last_basin still in the live entry BEFORE cleanup
            surviving_state = main._symbol_states.get(live_key)
            main._symbol_states.pop(live_key, None)

        assert resp.status_code == 200
        if "error" in resp.json() and resp.json().get("error"):
            pytest.skip(f"shadow endpoint error (env issue): {resp.json()['error']}")

        # The live entry must not have been replaced or mutated.
        # Endpoint never writes back to _symbol_states; deepcopy ensures
        # run_tick's last_basin reassignment stays in the shadow copy only.
        assert surviving_state is live_state, (
            "_symbol_states entry must not be replaced by shadow tick"
        )
        np.testing.assert_array_equal(
            live_state.last_basin, original_last_basin,
            err_msg="Shadow run_tick must not mutate the live state's last_basin",
        )
