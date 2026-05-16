"""Optimizer factory for ml-worker model training.

MIG-5 (2026-05-16). The legacy ``USE_FISHER_RAO`` flag and the
Euclidean optimizer fallback have been removed; the natural-gradient
optimizer on the QIG geometric manifold is the sole training path.
Per directive: if any model weights are updated online, route through
the Fisher-Rao natural gradient — never through Euclidean optimizers.

Resolution order (first available wins; both are diagonal-Fisher
implementations validated against each other):

  1. ``qig_core.optimization.DiagonalNaturalGradient``   (qig-core ≥2.7)
  2. ``qigkernels.DiagonalNaturalGradient``              (qigkernels)

If neither is importable, ``get_optimizer`` raises ``RuntimeError`` —
the deploy is broken and silently falling back to a Euclidean
optimizer (the legacy behaviour) would defeat the migration.

Usage::

    from proprietary_core.training import get_optimizer

    optimizer = get_optimizer(model.parameters(), lr=1e-3)
    for epoch in range(n_epochs):
        optimizer.zero_grad()
        loss = criterion(model(x), y)
        loss.backward()
        optimizer.step()

``DiagonalNaturalGradient`` accepts the same constructor signature as
the standard PyTorch optimizers and exposes the same ``step()`` /
``zero_grad()`` interface, so it is drop-in. Validated to deliver a
1.9–2.2× convergence improvement on coupled-regime forecasting tasks
(internal experiment EXP-055).
"""

from __future__ import annotations

import logging
from typing import Any, Iterator

logger = logging.getLogger(__name__)


def get_optimizer(
    params: Iterator[Any],
    lr: float = 1e-3,
    **kwargs: Any,
) -> Any:
    """Return the QIG natural-gradient optimizer for model training.

    Parameters
    ----------
    params:
        Iterable of parameters to optimise (e.g. ``model.parameters()``).
    lr:
        Learning rate.
    **kwargs:
        Additional keyword arguments forwarded to the optimizer
        constructor.

    Returns
    -------
    torch.optim.Optimizer
        ``DiagonalNaturalGradient`` from qig-core (preferred) or
        qigkernels (fallback). Both expose the standard optimizer API.

    Raises
    ------
    RuntimeError
        Neither qig-core nor qigkernels exposes
        ``DiagonalNaturalGradient`` — ml-worker deploy is broken and
        the legacy Euclidean fallback is intentionally not present.
    """
    try:
        from qig_core.optimization import DiagonalNaturalGradient  # type: ignore[import]
        logger.info(
            "[training] DiagonalNaturalGradient optimizer "
            "(qig-core, geometry-aware; EXP-055)",
        )
        return DiagonalNaturalGradient(params, lr=lr, **kwargs)
    except ImportError as qig_core_exc:
        logger.debug(
            "[training] qig_core.optimization unavailable (%s); "
            "trying qigkernels", qig_core_exc,
        )
    try:
        from qigkernels import DiagonalNaturalGradient  # type: ignore[import]
        logger.info(
            "[training] DiagonalNaturalGradient optimizer "
            "(qigkernels fallback)",
        )
        return DiagonalNaturalGradient(params, lr=lr, **kwargs)
    except ImportError as qigkernels_exc:
        raise RuntimeError(
            "DiagonalNaturalGradient is unavailable from both qig-core "
            "and qigkernels — ml-worker deploy is broken. Euclidean "
            "fallback deliberately removed in MIG-5; geometric training "
            "is non-negotiable. Errors: qig-core: {0}; qigkernels: {1}".format(
                qig_core_exc, qigkernels_exc,
            ),
        ) from qigkernels_exc
