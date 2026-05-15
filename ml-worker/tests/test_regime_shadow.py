"""Tests for proprietary_core.regime_shadow (issue #695).

The qig_warp call itself isn't exercised here (the test environment
may or may not have qig_warp installed). What IS tested:
  - shadow_classify always returns a row, even when qig_warp raises
    or is missing — the live path must never see an exception
  - the row schema is stable (live_regime, shadow_regime,
    shadow_error, h, J, dim, timing fields)
  - the parity log is a bounded ring buffer (FIFO eviction)
  - None input is a no-op (no row appended, returns None)

A separate parity-log integration test would run the live tape
through StrategyLoop and verify rows accumulate; that's better
exercised on Railway, not in unit tests.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the `src/` package layout importable when pytest is run from
# the ml-worker/ root (no pyproject.toml / conftest yet).
_SRC = Path(__file__).resolve().parents[1] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from proprietary_core.regime import MarketRegime, RegimeState  # noqa: E402
from proprietary_core.regime_shadow import (  # noqa: E402
    SHADOW_EQUIVALENCE_GUESS,
    _REGIME_PARITY_LOG,
    _REGIME_PARITY_LOG_MAX,
    get_regime_parity_log,
    shadow_classify,
)


def _make_state(regime: MarketRegime = MarketRegime.CREATOR) -> RegimeState:
    return RegimeState(
        regime=regime,
        entropy=2.7,
        fisher_info=0.5,
        trend_strength=0.18,
        volatility=0.012,
        confidence=0.6,
        is_transition=False,
        pillar1_gate=True,
    )


def _reset_log() -> None:
    _REGIME_PARITY_LOG.clear()


class TestShadowClassify:
    def test_none_input_returns_none_no_row(self):
        _reset_log()
        row = shadow_classify(None, symbol="BTC")
        assert row is None
        assert get_regime_parity_log() == []

    def test_returns_row_with_stable_schema(self):
        _reset_log()
        state = _make_state(MarketRegime.PRESERVER)
        row = shadow_classify(state, symbol="ETH_USDT_PERP")
        assert row is not None
        for key in (
            "timestamp",
            "symbol",
            "live_regime",
            "shadow_regime",
            "shadow_error",
            "h",
            "J",
            "dim",
            "live_confidence",
            "live_volatility",
            "live_fisher_info",
            "live_is_transition",
            "shadow_latency_ms",
        ):
            assert key in row, f"missing key in parity row: {key}"
        assert row["symbol"] == "ETH_USDT_PERP"
        assert row["live_regime"] == "preserver"
        assert row["h"] == 2.7
        assert row["J"] == 0.18
        assert row["dim"] == 2
        # One of shadow_regime / shadow_error MUST be populated.
        assert (row["shadow_regime"] is not None) or (row["shadow_error"] is not None)

    def test_appends_to_parity_log(self):
        _reset_log()
        shadow_classify(_make_state(), symbol="BTC")
        shadow_classify(_make_state(MarketRegime.DISSOLVER), symbol="ETH")
        rows = get_regime_parity_log()
        assert len(rows) == 2
        assert rows[0]["symbol"] == "BTC"
        assert rows[1]["symbol"] == "ETH"
        assert rows[1]["live_regime"] == "dissolver"

    def test_never_raises_on_qig_warp_failure(self, monkeypatch):
        # Force the qig_warp import inside shadow_classify to fail.
        import importlib
        real_import = importlib.__import__

        def fake_import(name, *args, **kwargs):
            if name == "qig_warp":
                raise RuntimeError("simulated qig_warp explosion")
            return real_import(name, *args, **kwargs)

        # Patch builtins.__import__ so the in-function `from qig_warp
        # import classify_regime` goes through our fake.
        monkeypatch.setattr("builtins.__import__", fake_import)

        _reset_log()
        row = shadow_classify(_make_state(), symbol="BTC")
        assert row is not None
        assert row["shadow_regime"] is None
        assert row["shadow_error"] is not None
        assert "RuntimeError" in row["shadow_error"]

    def test_parity_log_is_bounded(self):
        _reset_log()
        # Push more than _REGIME_PARITY_LOG_MAX rows; ring buffer must
        # cap at MAX (with a 10% FIFO eviction when full).
        for _ in range(_REGIME_PARITY_LOG_MAX + 250):
            shadow_classify(_make_state(), symbol="BTC")
        assert len(get_regime_parity_log()) <= _REGIME_PARITY_LOG_MAX


class TestEquivalenceGuess:
    """The SHADOW_EQUIVALENCE_GUESS is used by /governance/regime-parity
    to surface mapping accuracy at-a-glance. It's a guess; the parity
    log itself is the authority. These tests just pin the guess
    contract so a refactor doesn't silently re-shape it."""

    def test_guess_covers_all_market_regimes(self):
        for mr in MarketRegime:
            assert mr.value in SHADOW_EQUIVALENCE_GUESS

    def test_guess_values_are_qig_warp_regime_names(self):
        # qig_warp.Regime members: CRITICAL, DISORDERED, ORDERED.
        valid = {"CRITICAL", "DISORDERED", "ORDERED"}
        for v in SHADOW_EQUIVALENCE_GUESS.values():
            assert v in valid, f"{v} is not a qig_warp.Regime member"
