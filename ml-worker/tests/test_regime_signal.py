"""test_regime_signal.py — MIG-3 bridge-based regime_to_direction.

MIG-3 (2026-05-16). The probe-window logic (``_PROBE_WINDOWS = (3, 5,
10, 15, 60, 120)`` + ``strongest_recent_change``) is gone; direction
comes from qig_warp's regime-aware bridge exponent.

Bridge regimes (from qig_warp.regime_constants):
  CRITICAL  → α = 0.86 → bridge strongest → follow signed mean
  ORDERED   → α = 0.00 → spectrum flat (trend self-similar) → follow
  DISORDERED → α = 0.38 → bridge weak → NEUTRAL

Issue #725 (the ETH "BUY on bearish tape" incident) is structurally
impossible under this design: there is no probe window to mis-tune,
and the direction = sign of mean return in the "trust" regimes.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from regime_signal import regime_to_direction


def _fake_qig_warp_regime_constants(
    regime_value: str, bridge_exponent: float, screening_length: float = 0.5,
) -> mock.MagicMock:
    """Build a fake ``qig_warp`` module whose ``regime_constants``
    returns a ``RegimeConstants``-like object with the supplied
    regime + bridge_exponent."""
    fake_constants = mock.MagicMock()
    fake_constants.regime = mock.MagicMock()
    fake_constants.regime.value = regime_value
    fake_constants.bridge_exponent = bridge_exponent
    fake_constants.screening_length = screening_length
    fake_module = mock.MagicMock()
    fake_module.regime_constants.return_value = fake_constants
    return fake_module


def _bearish_prices(n: int = 50, start: float = 100.0, drift: float = -0.005) -> list[float]:
    """Synthesise a clearly-downtrending price series."""
    prices = [start]
    for i in range(1, n):
        # deterministic downward drift with tiny oscillation
        next_p = prices[-1] * (1.0 + drift + 0.0005 * ((-1) ** i))
        prices.append(next_p)
    return prices


def _bullish_prices(n: int = 50, start: float = 100.0, drift: float = 0.005) -> list[float]:
    """Synthesise a clearly-uptrending price series."""
    prices = [start]
    for i in range(1, n):
        next_p = prices[-1] * (1.0 + drift + 0.0005 * ((-1) ** i))
        prices.append(next_p)
    return prices


# ── Degenerate inputs short-circuit to NEUTRAL ────────────────────


class TestDegenerateInputs:
    def test_empty_prices_neutral(self) -> None:
        assert regime_to_direction("creator", []) == "NEUTRAL"

    def test_single_price_neutral(self) -> None:
        assert regime_to_direction("creator", [100.0]) == "NEUTRAL"

    def test_flat_prices_neutral(self) -> None:
        assert regime_to_direction("creator", [100.0] * 50) == "NEUTRAL"

    def test_dissolver_short_circuits_to_neutral(self) -> None:
        """DISSOLVER regime never trades regardless of prices —
        no qig_warp call needed."""
        assert regime_to_direction("dissolver", _bullish_prices()) == "NEUTRAL"
        assert regime_to_direction("dissolver", _bearish_prices()) == "NEUTRAL"

    def test_dissolver_uppercase_short_circuits(self) -> None:
        assert regime_to_direction("DISSOLVER", _bullish_prices()) == "NEUTRAL"


# ── Bridge-based direction logic ──────────────────────────────────


class TestBridgeDirection:
    def test_critical_with_positive_mean_returns_bullish(self) -> None:
        """CRITICAL (α=0.86, bridge strongest) + positive mean → BULLISH."""
        fake = _fake_qig_warp_regime_constants("critical", bridge_exponent=0.86)
        with mock.patch.dict(sys.modules, {"qig_warp": fake}):
            assert regime_to_direction("creator", _bullish_prices()) == "BULLISH"

    def test_critical_with_negative_mean_returns_bearish(self) -> None:
        """CRITICAL + negative mean → BEARISH."""
        fake = _fake_qig_warp_regime_constants("critical", bridge_exponent=0.86)
        with mock.patch.dict(sys.modules, {"qig_warp": fake}):
            assert regime_to_direction("creator", _bearish_prices()) == "BEARISH"

    def test_ordered_with_positive_mean_returns_bullish(self) -> None:
        """ORDERED (α=0.0, spectrum flat) is the "trust the trend" regime
        — J dominates h, so the move IS the structure."""
        fake = _fake_qig_warp_regime_constants("ordered", bridge_exponent=0.0)
        with mock.patch.dict(sys.modules, {"qig_warp": fake}):
            assert regime_to_direction("preserver", _bullish_prices()) == "BULLISH"

    def test_ordered_with_negative_mean_returns_bearish(self) -> None:
        fake = _fake_qig_warp_regime_constants("ordered", bridge_exponent=0.0)
        with mock.patch.dict(sys.modules, {"qig_warp": fake}):
            assert regime_to_direction("preserver", _bearish_prices()) == "BEARISH"

    def test_disordered_returns_neutral_regardless_of_mean(self) -> None:
        """DISORDERED (α=0.38, bridge weak) → trend won't sustain →
        NEUTRAL even if the recent mean is signed."""
        fake = _fake_qig_warp_regime_constants("disordered", bridge_exponent=0.38)
        with mock.patch.dict(sys.modules, {"qig_warp": fake}):
            assert regime_to_direction("creator", _bullish_prices()) == "NEUTRAL"
            assert regime_to_direction("creator", _bearish_prices()) == "NEUTRAL"


# ── Fail-soft on qig_warp errors ──────────────────────────────────


class TestFailSoft:
    def test_returns_neutral_on_qig_warp_import_failure(self) -> None:
        """If qig_warp is unavailable, return NEUTRAL — tick handler
        must not raise."""
        original = sys.modules.pop("qig_warp", None)
        try:
            with mock.patch.dict(sys.modules, {"qig_warp": None}):
                # import qig_warp with sys.modules[qig_warp]=None raises ImportError.
                assert regime_to_direction("creator", _bullish_prices()) == "NEUTRAL"
        finally:
            if original is not None:
                sys.modules["qig_warp"] = original

    def test_returns_neutral_on_classifier_exception(self) -> None:
        fake_module = mock.MagicMock()
        fake_module.regime_constants.side_effect = RuntimeError("classifier down")
        with mock.patch.dict(sys.modules, {"qig_warp": fake_module}):
            assert regime_to_direction("creator", _bullish_prices()) == "NEUTRAL"


# ── #725 regression — bearish tape must never return BULLISH ──────


class TestIssue725Regression:
    """The 2026-05-16T11:19Z ETH bug: ML emitted BUY on a clearly
    bearish 4% drop because the probe window picked a 3-bar bounce
    over the 15-bar drop. Under MIG-3 the bridge-based logic uses
    the sign of the mean return directly; no window to mis-tune."""

    def test_sustained_downtrend_with_micro_bounce_stays_bearish(self) -> None:
        """4% drop over 50 bars followed by a tiny 0.5% bounce in the
        last 3 bars must classify as BEARISH (or NEUTRAL on weak
        bridge), NEVER BULLISH."""
        drop = _bearish_prices(n=50, start=100.0, drift=-0.0008)
        bounce_base = drop[-1]
        prices = drop + [bounce_base * 1.0015, bounce_base * 1.0025, bounce_base * 1.0035]
        # Strong bridge (CRITICAL) — should classify BEARISH because the
        # mean return over the window is still negative.
        fake = _fake_qig_warp_regime_constants("critical", bridge_exponent=0.86)
        with mock.patch.dict(sys.modules, {"qig_warp": fake}):
            direction = regime_to_direction("creator", prices)
        assert direction != "BULLISH", (
            f"Sustained downtrend with micro bounce must not return BULLISH; "
            f"got {direction}"
        )
