"""Tests for the canonical qig_warp regime classifier.

MIG-2 (2026-05-16). The flag-gated cutover and the bespoke fallback
have been retired; ``classify_with_qig_warp`` is the only regime
authority and raises ``RuntimeError`` on any failure.

Covers:
- canonical mapping table CRITICAL→CREATOR / ORDERED→PRESERVER /
  DISORDERED→DISSOLVER (validated against qig-warp/src/qig_warp/regime.py
  and EXP-035-E / EXP-042-E / EXP-079)
- raise-on-failure on qig_warp import failure
- raise-on-failure on unrecognised regime values
- raise-on-failure on classifier exceptions
- accepts qig_warp.Regime via .value or .name
"""

from __future__ import annotations

import sys
from unittest import mock

import pytest

from proprietary_core.regime import MarketRegime
from proprietary_core.regime_qigwarp import (
    classify_with_qig_warp,
    map_warp_to_market,
)


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
        assert map_warp_to_market("DISORDERED") is MarketRegime.DISSOLVER

    def test_unknown_returns_none(self) -> None:
        assert map_warp_to_market("super_critical") is None
        assert map_warp_to_market("") is None
        # type: ignore[arg-type] — exercising defensive None handling
        assert map_warp_to_market(None) is None  # type: ignore[arg-type]


# ── classify_with_qig_warp ────────────────────────────────────────


class TestClassifyWithQigWarp:
    def test_returns_mapped_market_regime_when_warp_available(self) -> None:
        fake_regime = mock.MagicMock()
        fake_regime.value = "critical"
        fake_module = mock.MagicMock()
        fake_module.classify_regime.return_value = fake_regime

        with mock.patch.dict(sys.modules, {"qig_warp": fake_module}):
            assert classify_with_qig_warp(h=2.5, j=0.4, dim=2) is MarketRegime.CREATOR
        # Confirm h/J/dim were passed through verbatim.
        fake_module.classify_regime.assert_called_once()
        kwargs = fake_module.classify_regime.call_args.kwargs
        assert kwargs["h"] == pytest.approx(2.5)
        assert kwargs["J"] == pytest.approx(0.4)
        assert kwargs["dim"] == 2

    def test_ordered_maps_to_preserver_through_classify(self) -> None:
        fake_regime = mock.MagicMock()
        fake_regime.value = "ordered"
        fake_module = mock.MagicMock()
        fake_module.classify_regime.return_value = fake_regime

        with mock.patch.dict(sys.modules, {"qig_warp": fake_module}):
            assert classify_with_qig_warp(h=1.0, j=2.5) is MarketRegime.PRESERVER

    def test_disordered_maps_to_dissolver_through_classify(self) -> None:
        fake_regime = mock.MagicMock()
        fake_regime.value = "disordered"
        fake_module = mock.MagicMock()
        fake_module.classify_regime.return_value = fake_regime

        with mock.patch.dict(sys.modules, {"qig_warp": fake_module}):
            assert classify_with_qig_warp(h=4.5, j=0.05) is MarketRegime.DISSOLVER

    def test_raises_on_import_error(self) -> None:
        original = sys.modules.pop("qig_warp", None)
        try:
            with mock.patch.dict(sys.modules, {"qig_warp": None}):
                # `import qig_warp` with sys.modules[qig_warp]=None raises ImportError.
                with pytest.raises(RuntimeError, match="qig_warp is unavailable"):
                    classify_with_qig_warp(h=2.5, j=0.4)
        finally:
            if original is not None:
                sys.modules["qig_warp"] = original

    def test_raises_on_unknown_warp_value(self) -> None:
        fake_regime = mock.MagicMock()
        fake_regime.value = "warmish"  # not in our mapping table
        fake_module = mock.MagicMock()
        fake_module.classify_regime.return_value = fake_regime

        with mock.patch.dict(sys.modules, {"qig_warp": fake_module}):
            with pytest.raises(RuntimeError, match="unrecognised regime"):
                classify_with_qig_warp(h=2.5, j=0.4)

    def test_raises_on_classify_exception(self) -> None:
        fake_module = mock.MagicMock()
        fake_module.classify_regime.side_effect = ValueError("boom")

        with mock.patch.dict(sys.modules, {"qig_warp": fake_module}):
            with pytest.raises(RuntimeError, match="classify_regime raised"):
                classify_with_qig_warp(h=2.5, j=0.4)

    def test_accepts_warp_regime_via_name_attribute(self) -> None:
        fake_regime = mock.MagicMock(spec=["name"])
        fake_regime.name = "ordered"
        fake_module = mock.MagicMock()
        fake_module.classify_regime.return_value = fake_regime

        with mock.patch.dict(sys.modules, {"qig_warp": fake_module}):
            assert classify_with_qig_warp(h=1.0, j=2.5) is MarketRegime.PRESERVER
