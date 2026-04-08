"""Tests for the optimizer factory (training.py).

These tests do NOT require torch or qig_core to be installed — they verify
the factory's env-var branching logic by monkeypatching the heavy imports.
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers: create lightweight mock optimizer objects
# ---------------------------------------------------------------------------

def _make_mock_adam():
    """Return a mock that mimics torch.optim.Adam."""
    adam_cls = MagicMock(name="Adam")
    adam_instance = MagicMock(name="adam_instance")
    adam_cls.return_value = adam_instance
    return adam_cls, adam_instance


def _make_mock_dng():
    """Return a mock that mimics qig_core.optimization.DiagonalNaturalGradient."""
    dng_cls = MagicMock(name="DiagonalNaturalGradient")
    dng_instance = MagicMock(name="dng_instance")
    dng_cls.return_value = dng_instance
    return dng_cls, dng_instance


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_default_uses_adam(monkeypatch):
    """When USE_FISHER_RAO is not set, Adam is returned."""
    monkeypatch.delenv("USE_FISHER_RAO", raising=False)

    adam_cls, adam_instance = _make_mock_adam()

    # Build a fake torch module
    fake_torch = types.ModuleType("torch")
    fake_optim = types.ModuleType("torch.optim")
    fake_optim.Adam = adam_cls
    fake_torch.optim = fake_optim
    sys.modules["torch"] = fake_torch
    sys.modules["torch.optim"] = fake_optim

    # Remove cached training module so env changes take effect
    sys.modules.pop("proprietary_core.training", None)

    from proprietary_core.training import get_optimizer  # noqa: PLC0415

    params = iter([MagicMock()])
    result = get_optimizer(params, lr=1e-3)

    adam_cls.assert_called_once()
    assert result is adam_instance


def test_use_fisher_rao_true_returns_dng(monkeypatch):
    """When USE_FISHER_RAO=true, DiagonalNaturalGradient is returned."""
    monkeypatch.setenv("USE_FISHER_RAO", "true")

    dng_cls, dng_instance = _make_mock_dng()

    # Fake qig_core.optimization module
    fake_qig = types.ModuleType("qig_core")
    fake_qig_opt = types.ModuleType("qig_core.optimization")
    fake_qig_opt.DiagonalNaturalGradient = dng_cls
    fake_qig.optimization = fake_qig_opt
    sys.modules["qig_core"] = fake_qig
    sys.modules["qig_core.optimization"] = fake_qig_opt

    sys.modules.pop("proprietary_core.training", None)

    from proprietary_core.training import get_optimizer  # noqa: PLC0415

    params = iter([MagicMock()])
    result = get_optimizer(params, lr=2e-4)

    dng_cls.assert_called_once()
    assert result is dng_instance


def test_use_fisher_rao_false_uses_adam(monkeypatch):
    """Explicit USE_FISHER_RAO=false keeps Adam."""
    monkeypatch.setenv("USE_FISHER_RAO", "false")

    adam_cls, adam_instance = _make_mock_adam()

    fake_torch = types.ModuleType("torch")
    fake_optim = types.ModuleType("torch.optim")
    fake_optim.Adam = adam_cls
    fake_torch.optim = fake_optim
    sys.modules["torch"] = fake_torch
    sys.modules["torch.optim"] = fake_optim

    sys.modules.pop("proprietary_core.training", None)

    from proprietary_core.training import get_optimizer  # noqa: PLC0415

    result = get_optimizer(iter([MagicMock()]), lr=1e-3)

    adam_cls.assert_called_once()
    assert result is adam_instance


def test_fisher_rao_import_error_falls_back_to_adam(monkeypatch):
    """If qig_core is unavailable, fall back to Adam even when USE_FISHER_RAO=true."""
    monkeypatch.setenv("USE_FISHER_RAO", "true")

    # Remove qig_core from sys.modules so the real import fails
    sys.modules.pop("qig_core", None)
    sys.modules.pop("qig_core.optimization", None)

    adam_cls, adam_instance = _make_mock_adam()

    fake_torch = types.ModuleType("torch")
    fake_optim = types.ModuleType("torch.optim")
    fake_optim.Adam = adam_cls
    fake_torch.optim = fake_optim
    sys.modules["torch"] = fake_torch
    sys.modules["torch.optim"] = fake_optim

    sys.modules.pop("proprietary_core.training", None)

    with patch.dict(sys.modules, {"qig_core": None, "qig_core.optimization": None}):
        from proprietary_core.training import get_optimizer  # noqa: PLC0415
        result = get_optimizer(iter([MagicMock()]), lr=1e-3)

    adam_cls.assert_called_once()
    assert result is adam_instance


def test_lr_and_kwargs_forwarded(monkeypatch):
    """Extra kwargs are forwarded to the chosen optimizer."""
    monkeypatch.delenv("USE_FISHER_RAO", raising=False)

    adam_cls, _ = _make_mock_adam()

    fake_torch = types.ModuleType("torch")
    fake_optim = types.ModuleType("torch.optim")
    fake_optim.Adam = adam_cls
    fake_torch.optim = fake_optim
    sys.modules["torch"] = fake_torch
    sys.modules["torch.optim"] = fake_optim

    sys.modules.pop("proprietary_core.training", None)

    from proprietary_core.training import get_optimizer  # noqa: PLC0415

    get_optimizer(iter([MagicMock()]), lr=5e-4, weight_decay=1e-5)

    call_kwargs = adam_cls.call_args[1]
    assert call_kwargs["lr"] == 5e-4
    assert call_kwargs["weight_decay"] == 1e-5
