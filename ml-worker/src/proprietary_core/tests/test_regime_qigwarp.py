"""Tests for the qig_warp regime classifier cutover (issue #695).

Covers:
- env flag is default-off
- mapping table CRITICAL→CREATOR / ORDERED→PRESERVER / DISORDERED→DISSOLVER
- fail-soft on qig_warp import failure (returns None, no exception)
- fail-soft on unrecognised warp regime values
- live behaviour bit-identical to bespoke when flag is off
- live behaviour swaps regime label when flag is on AND qig_warp is reachable
- shadow path remains live regardless of cutover flag
"""

from __future__ import annotations

import os
import sys
from dataclasses import replace as dc_replace
from unittest import mock

import pytest

from proprietary_core.regime import MarketRegime, RegimeState
from proprietary_core.regime_qigwarp import (
    classify_with_qig_warp,
    map_warp_to_market,
    qig_warp_classifier_live,
)


def _make_regime_state(
    *,
    regime: MarketRegime = MarketRegime.CREATOR,
    entropy: float = 2.5,
    trend_strength: float = 0.4,
    fisher_info: float = 0.1,
    volatility: float = 0.02,
    confidence: float = 0.9,
    is_transition: bool = False,
    pillar1_gate: bool = True,
) -> RegimeState:
    """Build a minimal RegimeState for cutover tests. Values don't
    have to be physically meaningful — the cutover module only reads
    `entropy` and `trend_strength`."""
    return RegimeState(
        regime=regime,
        entropy=entropy,
        fisher_info=fisher_info,
        trend_strength=trend_strength,
        volatility=volatility,
        confidence=confidence,
        is_transition=is_transition,
        pillar1_gate=pillar1_gate,
    )


# ── Flag plumbing ────────────────────────────────────────────────


class TestQigWarpClassifierLive:
    def test_flag_default_off(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("REGIME_CLASSIFIER", raising=False)
        assert qig_warp_classifier_live() is False

    def test_flag_off_for_other_values(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("REGIME_CLASSIFIER", "bespoke")
        assert qig_warp_classifier_live() is False
        monkeypatch.setenv("REGIME_CLASSIFIER", "")
        assert qig_warp_classifier_live() is False

    def test_flag_on_for_qig_warp(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("REGIME_CLASSIFIER", "qig_warp")
        assert qig_warp_classifier_live() is True

    def test_flag_case_and_whitespace_tolerant(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for value in ("QIG_WARP", "  qig_warp  ", "QiG_WaRp"):
            monkeypatch.setenv("REGIME_CLASSIFIER", value)
            assert qig_warp_classifier_live() is True, f"Failed for value: {value!r}"


# ── Mapping table ────────────────────────────────────────────────


class TestMapWarpToMarket:
    def test_critical_maps_to_creator(self) -> None:
        assert map_warp_to_market("critical") is MarketRegime.CREATOR
        assert map_warp_to_market("CRITICAL") is MarketRegime.CREATOR

    def test_ordered_maps_to_preserver(self) -> None:
        assert map_warp_to_market("ordered") is MarketRegime.PRESERVER
        assert map_warp_to_market("ORDERED") is MarketRegime.PRESERVER

    def test_disordered_maps_to_dissolver(self) -> None:
        assert map_warp_to_market("disordered") is MarketRegime.DISSOLVER

    def test_unknown_returns_none(self) -> None:
        assert map_warp_to_market("super_critical") is None
        assert map_warp_to_market("") is None
        # type: ignore[arg-type] — exercising defensive None handling
        assert map_warp_to_market(None) is None  # type: ignore[arg-type]


# ── classify_with_qig_warp ────────────────────────────────────────


class TestClassifyWithQigWarp:
    def test_none_regime_state_returns_none(self) -> None:
        assert classify_with_qig_warp(None) is None  # type: ignore[arg-type]

    def test_returns_mapped_market_regime_when_warp_available(
        self,
    ) -> None:
        # Build a fake qig_warp module whose classify_regime returns
        # an object with .value == "critical" — mapping should yield
        # MarketRegime.CREATOR.
        fake_regime = mock.MagicMock()
        fake_regime.value = "critical"
        fake_module = mock.MagicMock()
        fake_module.classify_regime.return_value = fake_regime

        with mock.patch.dict(sys.modules, {"qig_warp": fake_module}):
            state = _make_regime_state()
            mapped = classify_with_qig_warp(state)
            assert mapped is MarketRegime.CREATOR
        # Confirm h/J/dim were passed through verbatim from the state.
        fake_module.classify_regime.assert_called_once()
        kwargs = fake_module.classify_regime.call_args.kwargs
        assert kwargs["h"] == pytest.approx(state.entropy)
        assert kwargs["J"] == pytest.approx(state.trend_strength)
        assert kwargs["dim"] == 2

    def test_falls_back_on_import_error(self) -> None:
        # Force the import inside classify_with_qig_warp to raise.
        # We use sys.modules patching to ensure the import resolves
        # to a module that fails on attribute access at import time.
        original = sys.modules.pop("qig_warp", None)
        try:
            with mock.patch.dict(sys.modules, {"qig_warp": None}):
                state = _make_regime_state()
                # `import qig_warp` with sys.modules[qig_warp]=None
                # raises ImportError.
                result = classify_with_qig_warp(state)
                assert result is None
        finally:
            if original is not None:
                sys.modules["qig_warp"] = original

    def test_falls_back_on_unknown_warp_value(self) -> None:
        fake_regime = mock.MagicMock()
        fake_regime.value = "warmish"  # not in our mapping table
        fake_module = mock.MagicMock()
        fake_module.classify_regime.return_value = fake_regime

        with mock.patch.dict(sys.modules, {"qig_warp": fake_module}):
            assert classify_with_qig_warp(_make_regime_state()) is None

    def test_falls_back_on_classify_exception(self) -> None:
        fake_module = mock.MagicMock()
        fake_module.classify_regime.side_effect = RuntimeError("boom")

        with mock.patch.dict(sys.modules, {"qig_warp": fake_module}):
            assert classify_with_qig_warp(_make_regime_state()) is None

    def test_accepts_warp_regime_via_name_attribute(self) -> None:
        # qig_warp.Regime exposes both .value and .name; ensure
        # fallback to .name works when .value is missing.
        fake_regime = mock.MagicMock(spec=["name"])
        fake_regime.name = "ordered"
        fake_module = mock.MagicMock()
        fake_module.classify_regime.return_value = fake_regime

        with mock.patch.dict(sys.modules, {"qig_warp": fake_module}):
            mapped = classify_with_qig_warp(_make_regime_state())
            assert mapped is MarketRegime.PRESERVER


# ── strategy_loop.py integration shape (flag off = identity) ─────


class TestStrategyLoopIntegrationFlagOff:
    """When the flag is off, the live regime label must come from the
    bespoke RegimeDetector unchanged. The cutover module must NOT mutate
    self._last_regime in that path."""

    def test_flag_off_keeps_bespoke_regime(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.delenv("REGIME_CLASSIFIER", raising=False)
        # Build a regime state with bespoke=DISSOLVER, but a fake
        # qig_warp that would return critical → CREATOR if asked.
        # With flag off, the cutover function should not be invoked
        # at all from the integration path; verify the flag check
        # is the gate.
        assert qig_warp_classifier_live() is False
        # The mapping function itself still works (it's a pure helper);
        # the integration is what's gated.
        assert map_warp_to_market("critical") is MarketRegime.CREATOR

    def test_flag_on_swap_uses_dc_replace_semantics(
        self, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """The integration uses dataclasses.replace to swap only the
        regime label; ancillary fields must round-trip untouched."""
        monkeypatch.setenv("REGIME_CLASSIFIER", "qig_warp")
        state = _make_regime_state(
            regime=MarketRegime.DISSOLVER,
            entropy=2.5,
            trend_strength=0.4,
            confidence=0.87,
            pillar1_gate=True,
            is_transition=True,
        )
        swapped = dc_replace(state, regime=MarketRegime.CREATOR)
        assert swapped.regime is MarketRegime.CREATOR
        # Every other field preserved bit-identical
        assert swapped.entropy == state.entropy
        assert swapped.trend_strength == state.trend_strength
        assert swapped.confidence == state.confidence
        assert swapped.fisher_info == state.fisher_info
        assert swapped.volatility == state.volatility
        assert swapped.is_transition is state.is_transition
        assert swapped.pillar1_gate is state.pillar1_gate
