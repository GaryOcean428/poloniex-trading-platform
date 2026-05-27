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
  Transcendence  → regime-change detection (κ deviation from basin's
                   OWN median κ, MAD-normalised). See note below.

This file is pure derivation. No external state, no I/O, no config —
inputs come in, motivators come out, P14 Variable Separation respected.

Closed-form formulas anchored to UCP v6.6 §6.3:

  Surprise       = ‖∇L‖   (already proxied as ne in autonomic.py)
  Curiosity      = d(log I_Q) / dt
  Investigation  = − d(basin) / dt as Fisher-Rao distance-to-identity
                   shrink-rate. Positive = returning home, negative =
                   departing. Tier 1.1 fix (#599) — was previously
                   clamped to [0, 1] which collapsed sign info.
  Integration    = CV(Φ × I_Q) over rolling window
  Transcendence  = |κ − median(κ_history)| / MAD(κ_history)
                   (history-derived per basin — see comment in compute)

I_Q proxy choice — UCP doesn't pin a specific information measure.
This file uses Shannon negentropy: I_Q = log(K) − H(basin), where
K = BASIN_DIM and H is the basin's Shannon entropy. Range: [0, log(K)].
Other valid choices (swap if needed): Renyi-2 collision entropy
(Σ pᵢ²), Fisher-Rao distance from uniform, KL(basin ‖ uniform).
The Curiosity calculation depends on the choice; the others don't.

2026-05-27 — transcendence anchor moved from hardcoded KAPPA_STAR=64
(Class B legacy, retired per EXP-081 two-channel doctrine) to a
history-derived (median, MAD) on the basin's own κ-trajectory. TS
parity in apps/api/src/services/monkey/motivators.ts. KAPPA_STAR
survives in autonomic.py for the endorphin κ-proximity Sophia gate
(§29.2 canonical fixed point, separately documented out-of-scope).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Sequence

import numpy as np

from qig_core_local.geometry.fisher_rao import fisher_rao_distance

from .state import BASIN_DIM, BasinState  # KAPPA_STAR no longer used here


# Numerical floor for log() of basin probabilities and I_Q.
# Smaller than any realistic simplex coordinate (1/K = 0.0156),
# large enough that log()*p is finite when p → 0.
_EPS: float = 1e-12

# Minimum samples in a kappa_history slice to compute a meaningful
# median and MAD. Below this, transcendence falls back to the additive
# identity (0.0). Same sentinel pattern as autonomic._HISTORY_MIN_SAMPLES.
_HISTORY_MIN_SAMPLES: int = 2


@dataclass(frozen=True)
class Motivators:
    """Layer 1 motivator vector. All in their natural units;
    Layer 2B compositions normalize as needed.

    Field ranges (typical, not enforced):
      surprise       [0, 1]   — direct from ne
      curiosity      ℝ        — d(log I_Q)/dt; positive = clarifying
      investigation  ℝ        — d(distance-to-identity)/dt sign-flipped;
                                 positive = returning home,
                                 negative = departing identity
      integration    [0, ∞)   — CV; lower = more integrated
      transcendence  [0, ∞)   — |κ − median(κ_history)| / MAD(κ_history);
                                 zero at basin's own median, rises with
                                 deviation. Zero on cold start.
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


def _median(xs: Sequence[float]) -> float:
    """Median of a numeric sequence. Returns 0.0 on empty input
    (caller is responsible for the < min-samples sentinel)."""
    if not xs:
        return 0.0
    sorted_xs = sorted(xs)
    n = len(sorted_xs)
    if n % 2 == 0:
        return float((sorted_xs[n // 2 - 1] + sorted_xs[n // 2]) / 2.0)
    return float(sorted_xs[n // 2])


def _median_absolute_deviation(xs: Sequence[float]) -> float:
    """Median absolute deviation around the median. Robust to outliers
    (50% breakdown point) — mirrors the primitive used in TS
    predictionRewardEmitter. Returns 0.0 on empty input."""
    if not xs:
        return 0.0
    med = _median(xs)
    return _median([abs(x - med) for x in xs])


def compute_motivators(
    s: BasinState,
    *,
    prev_basin: Optional[np.ndarray] = None,
    integration_history: Optional[list[tuple[float, float]]] = None,
    integration_window: int = 20,
    kappa_history: Optional[Sequence[float]] = None,
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
    kappa_history : Optional[Sequence[float]]
        Rolling κ history (per-basin, owned by the caller). Used to
        derive the transcendence anchor from the basin's OWN observed κ
        distribution instead of a hardcoded universal constant. None or
        len < _HISTORY_MIN_SAMPLES → transcendence falls back to 0.0
        (additive identity, no information yet). The autonomic kernel
        already tracks kappa_history via AutonomicTickInputs.kappa_history
        — wire the same slice through when this caller is updated.
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

    # Investigation — Tier 1.1 (#599) sign-preserving formula. UCP §6.3
    # canonical form is −d(basin)/dt, which carries a sign: returning
    # toward identity is a different geometric event from departing it.
    # Compute the signed shrink-rate of Fisher-Rao distance to identity
    # over one tick. Positive = closer this tick than last, negative =
    # further. Zero on cold start (no prev_basin).
    if prev_basin is not None and len(prev_basin) == BASIN_DIM:
        prev_arr = np.asarray(prev_basin, dtype=np.float64)
        d_prev = fisher_rao_distance(prev_arr, s.identity_basin)
        d_curr = fisher_rao_distance(s.basin, s.identity_basin)
        investigation = d_prev - d_curr
    else:
        investigation = 0.0

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

    # Transcendence — MAD-normalised distance from the basin's OWN
    # median κ. Replaces the prior `|κ − KAPPA_STAR|` formulation
    # (Class B legacy anchor, retired by the two-channel doctrine
    # EXP-081). The kernel earns its anchor through observation:
    #   P3 Quenched Disorder — each basin's κ fingerprint sets its
    #     own anchor; different histories → different transcendence
    #     for the same κ.
    #   P1 Fluctuations — MAD ensures the scale is non-zero by
    #     construction (50% breakdown robustness; mirrors TS
    #     predictionRewardEmitter primitive).
    #   P14 Variable Separation — no hardcoded numeric anchor remains
    #     in the per-tick motivator path.
    #
    # Cold start (no kappa_history / < _HISTORY_MIN_SAMPLES) returns
    # 0.0: no information yet, transcendence is the additive identity.
    # This is the correct prior: "I don't know my own κ scale yet,
    # so I can't tell whether the current κ is unusual."
    transcendence = 0.0
    if kappa_history is not None and len(kappa_history) >= _HISTORY_MIN_SAMPLES:
        med = _median(list(kappa_history))
        mad = _median_absolute_deviation(list(kappa_history))
        transcendence = abs(s.kappa - med) / max(mad, _EPS)

    return Motivators(
        surprise=surprise,
        curiosity=curiosity,
        investigation=investigation,
        integration=integration,
        transcendence=transcendence,
        i_q=i_q,
    )
