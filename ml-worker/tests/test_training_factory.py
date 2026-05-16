"""test_training_factory.py — MIG-5 natural-gradient training factory.

Tests the rewritten ``proprietary_core.training.get_optimizer`` factory.
The legacy USE_FISHER_RAO flag and the Euclidean fallback are gone;
natural gradient on the QIG manifold is the sole training path.

Coverage:
  - qig-core DiagonalNaturalGradient is the preferred backend
  - qigkernels DiagonalNaturalGradient is the fallback when qig-core
    is unavailable
  - RuntimeError raised when BOTH are unavailable (deploy is broken;
    no silent Euclidean fallback)
  - lr + kwargs forwarded verbatim to the chosen optimizer
  - USE_FISHER_RAO env var has no effect (flag retired)
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest import mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from proprietary_core.training import get_optimizer  # noqa: E402


def _make_qig_core_module(class_marker: str = "qig_core_DNG") -> mock.MagicMock:
    """Build a fake ``qig_core.optimization`` module whose
    ``DiagonalNaturalGradient`` returns a tagged sentinel — used to
    confirm which backend the factory resolved to."""
    instance = mock.MagicMock()
    instance.__class_marker__ = class_marker
    cls = mock.MagicMock(return_value=instance)
    optimization = mock.MagicMock(DiagonalNaturalGradient=cls)
    return mock.MagicMock(optimization=optimization), cls, instance


def _make_qigkernels_module(class_marker: str = "qigkernels_DNG") -> mock.MagicMock:
    instance = mock.MagicMock()
    instance.__class_marker__ = class_marker
    cls = mock.MagicMock(return_value=instance)
    return mock.MagicMock(DiagonalNaturalGradient=cls), cls, instance


class TestGetOptimizer:
    def test_resolves_to_qig_core_when_available(self) -> None:
        qig_core_mod, cls, instance = _make_qig_core_module()
        with mock.patch.dict(sys.modules, {
            "qig_core": qig_core_mod,
            "qig_core.optimization": qig_core_mod.optimization,
        }):
            opt = get_optimizer([mock.MagicMock()], lr=1e-3)
        assert opt is instance
        assert opt.__class_marker__ == "qig_core_DNG"
        cls.assert_called_once()

    def test_falls_back_to_qigkernels_when_qig_core_unavailable(self) -> None:
        qigkernels_mod, cls, instance = _make_qigkernels_module()
        # qig_core.optimization unavailable → ImportError on import.
        original = sys.modules.pop("qig_core", None)
        original_opt = sys.modules.pop("qig_core.optimization", None)
        try:
            with mock.patch.dict(sys.modules, {
                "qig_core.optimization": None,
                "qigkernels": qigkernels_mod,
            }):
                opt = get_optimizer([mock.MagicMock()], lr=1e-3)
            assert opt is instance
            assert opt.__class_marker__ == "qigkernels_DNG"
            cls.assert_called_once()
        finally:
            if original is not None:
                sys.modules["qig_core"] = original
            if original_opt is not None:
                sys.modules["qig_core.optimization"] = original_opt

    def test_raises_when_both_unavailable(self) -> None:
        """No silent Euclidean fallback — deploy is broken, surface it."""
        original_qc = sys.modules.pop("qig_core", None)
        original_qco = sys.modules.pop("qig_core.optimization", None)
        original_qk = sys.modules.pop("qigkernels", None)
        try:
            with mock.patch.dict(sys.modules, {
                "qig_core.optimization": None,
                "qigkernels": None,
            }):
                with pytest.raises(RuntimeError, match="DiagonalNaturalGradient is unavailable"):
                    get_optimizer([mock.MagicMock()], lr=1e-3)
        finally:
            if original_qc is not None:
                sys.modules["qig_core"] = original_qc
            if original_qco is not None:
                sys.modules["qig_core.optimization"] = original_qco
            if original_qk is not None:
                sys.modules["qigkernels"] = original_qk

    def test_lr_and_kwargs_forwarded(self) -> None:
        qig_core_mod, cls, _ = _make_qig_core_module()
        params = [mock.MagicMock()]
        with mock.patch.dict(sys.modules, {
            "qig_core": qig_core_mod,
            "qig_core.optimization": qig_core_mod.optimization,
        }):
            get_optimizer(params, lr=5e-4, damping=1e-2, momentum=0.95)
        cls.assert_called_once_with(params, lr=5e-4, damping=1e-2, momentum=0.95)

    def test_use_fisher_rao_env_has_no_effect(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """The USE_FISHER_RAO flag was removed in MIG-5; setting it
        either way must not change the resolution path."""
        qig_core_mod, cls, instance = _make_qig_core_module()
        for value in ("true", "false", "", "yes", "no"):
            monkeypatch.setenv("USE_FISHER_RAO", value)
            cls.reset_mock()
            with mock.patch.dict(sys.modules, {
                "qig_core": qig_core_mod,
                "qig_core.optimization": qig_core_mod.optimization,
            }):
                opt = get_optimizer([mock.MagicMock()], lr=1e-3)
            assert opt is instance, f"USE_FISHER_RAO={value!r} altered resolution"
            assert cls.call_count == 1
