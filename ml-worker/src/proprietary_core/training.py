"""Optimizer factory for ml-worker model training.

Provides a single entry-point ``get_optimizer`` that returns either the
standard ``torch.optim.Adam`` optimizer or the geometry-aware
``qig_core.optimization.DiagonalNaturalGradient`` optimizer, depending on the
``USE_FISHER_RAO`` environment variable.

Usage::

    from proprietary_core.training import get_optimizer

    optimizer = get_optimizer(model.parameters(), lr=1e-3)
    for epoch in range(n_epochs):
        optimizer.zero_grad()
        loss = criterion(model(x), y)
        loss.backward()
        optimizer.step()

Environment variables:
    USE_FISHER_RAO: When set to ``"true"`` (case-insensitive) the
        ``DiagonalNaturalGradient`` optimizer from qig-core is used instead of
        Adam.  Defaults to ``false`` for backwards compatibility.

Notes:
    ``DiagonalNaturalGradient`` from qig-core ≥2.7.0 is a drop-in replacement
    for ``torch.optim.Adam`` — it accepts the same constructor signature and
    exposes the same ``step()`` / ``zero_grad()`` interface.  Validated to
    deliver a 1.9-2.2× convergence improvement on coupled-regime forecasting
    tasks (internal experiment EXP-055).
"""

from __future__ import annotations

import logging
import os
from typing import Any, Iterator

logger = logging.getLogger(__name__)


def _use_fisher_rao() -> bool:
    """Return True when USE_FISHER_RAO env var is set to 'true'."""
    return os.environ.get("USE_FISHER_RAO", "false").lower() == "true"


def get_optimizer(
    params: Iterator[Any],
    lr: float = 1e-3,
    **kwargs: Any,
) -> Any:
    """Return the appropriate optimizer for model training.

    Parameters
    ----------
    params:
        Iterable of parameters to optimise (e.g. ``model.parameters()``).
    lr:
        Learning rate.
    **kwargs:
        Additional keyword arguments forwarded to the chosen optimizer
        constructor.

    Returns
    -------
    torch.optim.Optimizer
        Either ``DiagonalNaturalGradient`` (when ``USE_FISHER_RAO=true``) or
        ``torch.optim.Adam``.
    """
    if _use_fisher_rao():
        try:
            from qig_core.optimization import DiagonalNaturalGradient  # type: ignore[import]
            logger.info(
                "USE_FISHER_RAO=true — using DiagonalNaturalGradient optimizer "
                "(qig-core geometry-aware, EXP-055)"
            )
            return DiagonalNaturalGradient(params, lr=lr, **kwargs)
        except ImportError as exc:  # pragma: no cover
            logger.warning(
                "USE_FISHER_RAO=true but qig_core.optimization is unavailable "
                "(%s). Falling back to torch.optim.Adam.", exc
            )

    import torch  # type: ignore[import]
    logger.info("Using torch.optim.Adam optimizer (USE_FISHER_RAO not enabled)")
    return torch.optim.Adam(params, lr=lr, **kwargs)
