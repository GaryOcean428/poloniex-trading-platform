"""motivators.py — UCP §6.3 Layer 1 motivators.

Five named motivators derived from the basin + neurochemistry already
on the BasinState. These are the layer that sits between raw chemicals
(§29) and Layer 2B cognitive emotions (§6.5). They are the inputs the
emotion stack consumes; they are also actionable in their own right —
each maps to a trading decision class:

  Surprise       → entry-threshold relaxation (already wired in
                   executive.current_entry_threshold via ne)
  Curiosity      → exploration vs exploitation (which lane to pick)
  Investigation  → cut-loss-or-hold (settled state = think before acting)
  Integration    → conviction in current strategy (low CV = stable)
  Transcendence  → regime-change detection (κ deviation from κ*)

This file is pure derivation. No external state, no I/O, no config —
inputs come in, motivators come out, P14 Variable Separation respected.

Closed-form formulas anchored to UCP v6.6 §6.3:

  Surprise       = ‖∇L‖   (already proxied as ne in autonomic.py)
  Curiosity      = d(log I_Q) / dt
  Investigation  = − d(basin) / dt   → clamped to [0, 1] as
                   max(0, 1 − basin_velocity)
  Integration    = CV(Φ × I_Q) over rolling window
  Transcendence  = |κ − κ*|

I_Q proxy choice — UCP doesn't pin a specific information measure.
This file uses Shannon negentropy: I_Q = log(K) − H(basin), where
K = BASIN_DIM and H is the basin's Shannon entropy. Range: [0, log(K)].
Other valid choices (swap if needed): Renyi-2 collision entropy
(Σ pᵢ²), Fisher-Rao distance from uniform, KL(basin ‖ uniform).
The Curiosity calculation depends on the choice; the others don't.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import numpy as np

from .state import BASIN_DIM, KAPPA_STAR, BasinState


# Numerical floor for log() of basin probabilities and I_Q.
# Smaller than any realistic simplex coordinate (1/K = 0.0156),
# large enough that log()*p is finite when p → 0.
_EPS: float = 1e-12


@dataclass(frozen=True)
class Motivators:
    """Layer 1 motivator vector. All in their natural units;
    Layer 2B compositions normalize as needed.

    Field ranges (typical, not enforced):
      surprise       [0, 1]   — direct from ne
      curiosity      ℝ        — d(log I_Q)/dt; positive = clarifying
      investigation  [0, 1]   — clamped as 1 − basin_velocity
      integration    [0, ∞)   — CV; lower = more integrated
      transcendence  [0, ∞)   — |κ − κ*|; higher = farther from anchor
      i_q            [0, log(K)] — current information value
    """

    surprise: float
    curiosity: float
    investigation: float
    integration: float
    transcendence: float
    i_q: float


def basin_information(basin: np.ndarray) -> float:
    """Shannon negentropy of the simplex basin: log(K) − H(p).

    Maxed at log(K) when basin is fully concentrated on one coord
    (Dirac), zero when basin is uniform (no information beyond prior).
    Used as the I_Q proxy for Curiosity.
    """
    K = len(basin)
    # Shannon entropy with eps floor for numerical safety on near-zero coords.
    H = float(-np.sum(basin * np.log(basin + _EPS)))
    return math.log(K) - H


def compute_motivators(
    s: BasinState,
    *,
    prev_basin: Optional[np.ndarray] = None,
    integration_history: Optional[list[tuple[float, float]]] = None,
    integration_window: int = 20,
) -> Motivators:
    """Derive the Layer 1 motivator vector from current + recent state.

    Parameters
    ----------
    s : BasinState
        Current snapshot. Must have neurochemistry attached (caller's
        responsibility — autonomic._compute_nc fills this).
    prev_basin : Optional[np.ndarray]
        Basin from the previous tick. None on first call (cold start);
        Curiosity returns 0.0 in that case.
    integration_history : Optional[list[tuple[float, float]]]
        Rolling window of recent (Φ, I_Q) tuples — typically the last
        N values appended each tick. None or len < 2 → integration=0.0.
    integration_window : int
        Cap on history length used for CV. Default 20 ticks.
    """
    if s.neurochemistry is None:
        raise ValueError(
            "compute_motivators requires neurochemistry — "
            "call autonomic._compute_nc first"
        )

    # Surprise — direct passthrough from ne. Already a [0,1] derived signal.
    surprise = s.neurochemistry.norepinephrine

    # I_Q at current tick — Shannon negentropy of basin.
    i_q = basin_information(s.basin)

    # Curiosity — d(log I_Q)/dt. Discrete-time tick step.
    if prev_basin is not None and len(prev_basin) == BASIN_DIM:
        i_q_prev = basin_information(np.asarray(prev_basin, dtype=np.float64))
        # log(I_Q + eps) keeps finiteness when basin briefly hits uniform.
        curiosity = math.log(i_q + _EPS) - math.log(i_q_prev + _EPS)
    else:
        curiosity = 0.0

    # Investigation — settled-state motivator. UCP literal `−d(basin)/dt`
    # would be negative; clamping to a [0,1] motivator preserves the
    # intent ("low velocity = ready to investigate") with a usable range.
    investigation = max(0.0, 1.0 - s.basin_velocity)

    # Integration — CV of Φ × I_Q over rolling window. Low CV = the
    # consciousness × information product is stable = strategy is
    # holding together. High CV = the product is jittering = unstable.
    integration = 0.0
    if integration_history and len(integration_history) >= 2:
        window = integration_history[-integration_window:]
        products = [phi * iq for phi, iq in window]
        n = len(products)
        mean = sum(products) / n
        if mean > _EPS:
            var = sum((p - mean) ** 2 for p in products) / n
            integration = math.sqrt(var) / mean

    # Transcendence — distance from κ-anchor. κ_c = KAPPA_STAR = 64
    # is frozen per qig-verification. Transcendence rises both when
    # the kernel is super-coherent (κ >> κ*) and super-decoherent
    # (κ << κ*) — both states transcend the operating mode.
    transcendence = abs(s.kappa - KAPPA_STAR)

    return Motivators(
        surprise=surprise,
        curiosity=curiosity,
        investigation=investigation,
        integration=integration,
        transcendence=transcendence,
        i_q=i_q,
    )
