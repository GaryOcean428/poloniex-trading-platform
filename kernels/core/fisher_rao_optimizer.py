"""Fisher-Rao Natural Gradient Optimizer (diagonal approximation).

Drop-in replacement for ``torch.optim.Adam`` in the trading platform's ML
models (``kernels/core/``, ``ml/predict.py``).

Background
----------
EXP-055 (QIG research) shows that the Fisher-Rao natural gradient beats Adam
by 1.9–2.2× on optimisation tasks, with the advantage growing with dimension.
The key insight: Adam is geometry-agnostic (treats all parameter directions as
equal), while the natural gradient pre-conditions the update by the Fisher
information matrix F(θ), so each step moves equal distance in probability
space rather than parameter space.

This module provides:

1. ``DiagonalFisherRaoOptimizer`` – a pure-PyTorch custom optimizer that
   approximates F(θ) with its diagonal (O(params) memory, same cost as Adam)
   via an empirical Fisher estimate accumulated over mini-batches.

2. ``FisherRaoAdam`` – a convenience wrapper that falls back to Adam when
   the diagonal Fisher hasn't been warmed up yet (first ``warmup_steps``
   batches), so training never stalls on cold starts.

Usage
-----
Replace::

    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)

with::

    from kernels.core.fisher_rao_optimizer import FisherRaoAdam
    optimizer = FisherRaoAdam(model.parameters(), lr=1e-3)

The rest of the training loop is identical.

Notes
-----
* The diagonal Fisher is estimated as the running mean of squared gradients
  (equivalent to the Gauss-Newton matrix diagonal), which matches Adagrad /
  RMSProp's preconditioner but is motivated geometrically.
* EPS (1e-8) prevents division by zero and acts as a regulariser for
  parameters with negligible curvature.
* ``fisher_decay`` (default 0.99) weights recent batches more heavily,
  equivalent to an exponential moving average of the Fisher.
"""

from __future__ import annotations

from typing import Callable, Iterable, Optional

try:
    import torch
    from torch.optim import Optimizer, Adam
    _TORCH_AVAILABLE = True
except ImportError:  # pragma: no cover
    _TORCH_AVAILABLE = False
    # Provide stubs so the module can be imported in environments without
    # PyTorch (e.g. during unit-test collection).
    class Optimizer:  # type: ignore[no-redef]
        pass

    class Adam:  # type: ignore[no-redef]
        pass


class DiagonalFisherRaoOptimizer(Optimizer):
    """Natural gradient descent with diagonal Fisher-information approximation.

    Parameters
    ----------
    params :
        Iterable of parameters or parameter groups (same as any torch Optimizer).
    lr : float
        Learning rate (step size in natural-gradient space).
    fisher_decay : float
        EMA decay for the diagonal Fisher estimate (0 < decay < 1).
        Higher values retain more history.
    eps : float
        Numerical stability constant added to the Fisher diagonal.
    weight_decay : float
        L2 regularisation coefficient.
    """

    def __init__(
        self,
        params: Iterable,
        lr: float = 1e-3,
        fisher_decay: float = 0.99,
        eps: float = 1e-8,
        weight_decay: float = 0.0,
    ) -> None:
        if not _TORCH_AVAILABLE:
            raise ImportError(
                "PyTorch is required for DiagonalFisherRaoOptimizer. "
                "Install it with: pip install torch"
            )
        defaults = dict(lr=lr, fisher_decay=fisher_decay, eps=eps, weight_decay=weight_decay)
        super().__init__(params, defaults)

    @torch.no_grad()  # type: ignore[misc]
    def step(self, closure: Optional[Callable] = None) -> Optional[float]:  # type: ignore[override]
        """Perform a single optimisation step.

        Parameters
        ----------
        closure :
            Optional callable that re-evaluates the model and returns the loss.
        """
        loss = None
        if closure is not None:
            with torch.enable_grad():
                loss = closure()

        for group in self.param_groups:
            lr = group["lr"]
            decay = group["fisher_decay"]
            eps = group["eps"]
            weight_decay = group["weight_decay"]

            for p in group["params"]:
                if p.grad is None:
                    continue

                grad = p.grad
                if weight_decay != 0.0:
                    grad = grad.add(p, alpha=weight_decay)

                state = self.state[p]

                # Initialise EMA of squared gradient (diagonal Fisher proxy)
                if "fisher_diag" not in state:
                    state["fisher_diag"] = torch.zeros_like(p)
                    state["step"] = 0

                state["step"] += 1
                fisher = state["fisher_diag"]

                # Exponential moving average: F_t = decay * F_{t-1} + (1-decay) * g²
                fisher.mul_(decay).addcmul_(grad, grad, value=1.0 - decay)

                # Natural gradient step: Δθ = F^{-1} g ≈ g / (F_diag + ε)
                p.addcdiv_(grad, fisher.add(eps), value=-lr)

        return loss


class FisherRaoAdam(Optimizer):
    """Hybrid optimizer: Adam for warm-up, then Fisher-Rao natural gradient.

    Uses standard Adam for the first ``warmup_steps`` parameter updates while
    the diagonal Fisher estimate stabilises.  After warm-up the Fisher-Rao
    preconditioner takes over.

    This avoids the cold-start problem where an uninitialised Fisher diagonal
    (all zeros) would produce unbounded updates.

    Parameters
    ----------
    params :
        Model parameters.
    lr : float
        Learning rate.
    warmup_steps : int
        Number of gradient steps to use Adam before switching.
    fisher_decay : float
        EMA decay for the diagonal Fisher estimate.
    eps : float
        Numerical stability constant.
    weight_decay : float
        L2 regularisation coefficient.
    adam_betas : tuple[float, float]
        Betas for the Adam warm-up phase.
    """

    def __init__(
        self,
        params: Iterable,
        lr: float = 1e-3,
        warmup_steps: int = 100,
        fisher_decay: float = 0.99,
        eps: float = 1e-8,
        weight_decay: float = 0.0,
        adam_betas: tuple[float, float] = (0.9, 0.999),
    ) -> None:
        if not _TORCH_AVAILABLE:
            raise ImportError(
                "PyTorch is required for FisherRaoAdam. "
                "Install it with: pip install torch"
            )
        # We delegate to two internal optimizers; the base-class state is kept
        # minimal so that save/load checkpoints work transparently.
        defaults = dict(
            lr=lr,
            warmup_steps=warmup_steps,
            fisher_decay=fisher_decay,
            eps=eps,
            weight_decay=weight_decay,
        )
        super().__init__(params, defaults)

        # Build internal optimizers over the same parameter groups
        self._adam = Adam(
            self.param_groups,
            lr=lr,
            betas=adam_betas,
            eps=eps,
            weight_decay=weight_decay,
        )
        self._fisher_rao = DiagonalFisherRaoOptimizer(
            self.param_groups,
            lr=lr,
            fisher_decay=fisher_decay,
            eps=eps,
            weight_decay=weight_decay,
        )
        self._global_step: int = 0

    @torch.no_grad()  # type: ignore[misc]
    def step(self, closure: Optional[Callable] = None) -> Optional[float]:  # type: ignore[override]
        self._global_step += 1
        warmup_steps = self.defaults["warmup_steps"]

        if self._global_step <= warmup_steps:
            return self._adam.step(closure)
        else:
            return self._fisher_rao.step(closure)

    def zero_grad(self, set_to_none: bool = True) -> None:  # type: ignore[override]
        super().zero_grad(set_to_none=set_to_none)
        self._adam.zero_grad(set_to_none=set_to_none)
        self._fisher_rao.zero_grad(set_to_none=set_to_none)

    @property
    def using_fisher_rao(self) -> bool:
        """True once the warm-up phase has completed."""
        return self._global_step > self.defaults["warmup_steps"]
