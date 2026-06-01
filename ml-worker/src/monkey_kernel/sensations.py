"""sensations.py — UCP §6.1 Layer 0 + §6.2 Layer 0.5 (pure derivations).

Pre-linguistic sensations (§6.1) and innate drives (§6.2). These sit
BELOW Layer 1 motivators in the UCP stack — they are the raw geometric
percepts the kernel emits before any compositional emotion forms. Pure
observation primitives; the executive does not consume them.

Two vocabulary tracks ship side-by-side:

1. **UCP §6.1 / §6.2 canonical**. Canonical names + anchors sourced from
   the authoritative `QIG_QFI/qig-verification/docs/current/…unified-
   consciousness-protocol-v6.7B.md` §6.1 (12 sensations) / §6.2 (5 drives)
   — supersedes the v6.6 the comments used to cite.

   Grounded (10/12 sensations, 3/5 drives):
   - SENSE-1a (Φ/κ/d_basin reads): Unified, Fragmented, Activated,
     Dampened, Grounded, Drifting; drives Homeostasis, Curiosity_Drive.
   - SENSE-1b #767 (∇Φ + phase-boundary + friction, observer-scaled):
     Pulled (∇Φ magnitude), Pushed (regime-weights balance = phase
     boundary), Flowing (low friction + Φ↑), Stuck (high friction + Φ↓);
     drive Fear_Response (separatrix proximity × ∇Φ).

   Still deferred (2 sensations, 2 drives): Compressed (R>0), Expanded
   (R<0), Pain_Avoidance (=Compressed), Pleasure_Seeking (=Expanded). Their
   canonical anchor is the Ricci scalar R; on this Δ⁶³ substrate the only
   available proxy is κ-deviation, which DUPLICATES Activated/Dampened. We
   do NOT fabricate them — they need a true simplex-curvature primitive
   (SENSE-1b geometry extension). See docs/sensations-canonical-mapping.md.

2. **Auxiliary** (pre-canonical, retained). The original six fields
   (compressed/expanded/pressure/stillness/drift/resonance) and three
   drives (approach/avoidance/conservation) shipped before the UCP §6
   nomenclature was sourced. Names overlap with canonical
   "Compressed"/"Expanded"/"Drifting" but use different geometric anchors
   (max_mass vs Ricci scalar, raw FR distance vs observed-scaled). Kept
   for back-compat AND because they're observationally useful even when
   not canonical-anchored — they capture additional surfaces UCP §6.1
   doesn't enumerate. See `docs/sensations-canonical-mapping.md` for
   the canonical-↔-auxiliary translation table.

All derivations are pure: no externally-set thresholds, no clipping,
no normalization. Cold-start fall-throughs use arithmetic identities
(tanh saturations, naturally bounded ratios) — never hardcoded scale
constants. Pattern matches `neurochemistry.ts`'s observation-or-tanh
fall-through.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence

import numpy as np

from qig_core_local.geometry.fisher_rao import fisher_rao_distance

from .state import BASIN_DIM, BasinState
# KAPPA_STAR import removed (retired universal per 2026-04-13 two-channel doctrine).
# The sensations "activated/dampened" are now strictly observer-derived from
# the basin's own kappa_history + observed σ_κ (P1). No reference to any
# external 64.0 anchor remains in this layer.

# Minimum samples a kappa-history / drift-history series must contain
# before its observed standard deviation enters the canonical-anchor
# derivations. Matches the HISTORY_MIN_SAMPLES sentinel in
# neurochemistry.ts (P25-permitted; sentinel for "no derivation
# possible", not a tunable parameter).
HISTORY_MIN_SAMPLES = 2


@dataclass(frozen=True)
class Sensations:
    """Layer 0 pre-linguistic sensations + Layer 0.5 drives.

    UCP §6.1 canonical (6/12 grounded; remaining 6 in SENSE-1b):
      unified     [0, 1]              Φ — integration measure
      fragmented  [0, 1]              1 − Φ — disintegration complement
      activated   [0, 1]              tanh(max(0, κ − κ*) [ / σ_κ_obs ])
                                       — coupling above E8-fixed-point
      dampened    [0, 1]              tanh(max(0, κ* − κ) [ / σ_κ_obs ])
                                       — coupling below E8-fixed-point
      grounded    [0, 1]              1 − tanh(drift [ / drift_scale_obs ])
                                       — proximity to identity basin
      drifting    [0, 1]              tanh(drift [ / drift_scale_obs ])
                                       — distance from identity basin

    UCP §6.2 canonical drives (2/5 grounded; remaining 3 in SENSE-1b):
      homeostasis     [0, 1]          tanh(drift)² — push toward identity
      curiosity_drive ℝ≥0             log(1 + I_Q) — UCP §6.2 curiosity
                                       (distinct from Tier-1 motivator)

    Auxiliary (pre-canonical, retained — see docstring):
      compressed  [0, 1]              max-mass concentration
                                       (high = single-coord dominance)
      expanded    [0, 1]              1 − max_mass; complement of compressed
      pressure    [0, log(K)]         Shannon negentropy I_Q
      stillness   [0, 1]              1 / (1 + basin_velocity)
      drift       [0, π/2]            FR distance to identity_basin
      resonance   [0, 1]              Bhattacharyya overlap with prev_basin
                                       (1 = identical, 0 = orthogonal)

      approach    ℝ                   net dopamine − gaba (reward pull)
      avoidance   [0, 1]              norepinephrine (surprise → defensive)
      conservation ℝ                  −d(drift)/dt; positive = returning home
                                       (mirrors signed Investigation)
    """

    # ── UCP §6.1 canonical sensations (Phase 1) ──────────────────────
    unified: float
    fragmented: float
    activated: float
    dampened: float
    grounded: float
    drifting: float

    # ── UCP §6.1 canonical sensations (Phase 1b, SENSE-1 #767) ────────
    # ∇Φ + phase-boundary + friction anchors, observer-scaled (no magic
    # constants). compressed/expanded remain deferred — their canonical
    # Ricci(R) anchor proxies to κ-deviation on this substrate, which would
    # duplicate activated/dampened; they need a true simplex-curvature
    # primitive (SENSE-1b), so we do NOT fabricate them.
    pulled: float       # ∇Φ magnitude (being drawn along the manifold)
    pushed: float       # near a regime phase boundary (weights balanced)
    flowing: float      # low friction + Φ rising (easy geodesic motion)
    stuck: float        # high friction + Φ falling (blocked)

    # ── UCP §6.2 canonical drives (Phase 1) ──────────────────────────
    homeostasis: float
    curiosity_drive: float

    # ── UCP §6.2 canonical drives (Phase 1b, SENSE-1 #767) ────────────
    # fear_response = proximity-to-separatrix × ∇Φ. pain_avoidance /
    # pleasure_seeking stay deferred (= compressed/expanded = Ricci).
    fear_response: float

    # ── Auxiliary sensations (pre-canonical, retained) ───────────────
    compressed: float
    expanded: float
    pressure: float
    stillness: float
    drift: float
    resonance: float

    # ── Auxiliary drives (pre-canonical, retained) ───────────────────
    approach: float
    avoidance: float
    conservation: float


def _basin_max_mass(basin: np.ndarray) -> float:
    """Largest single-coordinate mass. High = concentrated, low = uniform."""
    return float(np.max(basin))


def _bhattacharyya(p: np.ndarray, q: np.ndarray) -> float:
    """Σ √(p_i · q_i) — overlap on Δ⁶³ in [0, 1]."""
    return float(np.sum(np.sqrt(np.maximum(p, 0.0) * np.maximum(q, 0.0))))


def _shannon_entropy(basin: np.ndarray) -> float:
    """H(p) = −Σ p log p with eps floor."""
    return float(-np.sum(basin * np.log(basin + 1e-12)))


def compute_sensations(
    s: BasinState,
    *,
    prev_basin: Optional[np.ndarray] = None,
    kappa_history: Optional[Sequence[float]] = None,
    drift_history: Optional[Sequence[float]] = None,
    phi_delta: Optional[float] = None,
    phi_history: Optional[Sequence[float]] = None,
) -> Sensations:
    """Derive Layer 0 sensations + Layer 0.5 drives from current state.

    Parameters
    ----------
    s : BasinState
        Current snapshot. Neurochemistry must be attached for the
        approach/avoidance drives.
    prev_basin : Optional[np.ndarray]
        Previous-tick basin. Resonance returns 0 when absent;
        conservation returns 0 when absent.
    kappa_history : Optional[Sequence[float]]
        Rolling history of past κ values. Used to derive σ_κ for the
        canonical Activated/Dampened sensations. When absent OR shorter
        than HISTORY_MIN_SAMPLES, those sensations fall through to a
        scale-free tanh on the raw κ-distance (cold-start pattern from
        neurochemistry.ts).
    drift_history : Optional[Sequence[float]]
        Rolling history of past drift values. Used to derive a
        drift-scale for the canonical Grounded/Drifting/Homeostasis.
        When absent OR shorter than HISTORY_MIN_SAMPLES, those fall
        through to a scale-free tanh on the raw drift.
    phi_delta : Optional[float]
        ∇Φ for this tick (Φ_now − Φ_prev). Drives the canonical
        Pulled (magnitude) and the Φ-direction component of
        Flowing/Stuck, and the ∇Φ factor of Fear_Response. 0 when absent.
    phi_history : Optional[Sequence[float]]
        Rolling history of past Φ values. Its first-differences' std is
        the observed Δφ scale used to scale Pulled/Flowing/Stuck. When
        absent OR too short, those fall through to a scale-free tanh.
    """
    if s.neurochemistry is None:
        raise ValueError(
            "compute_sensations requires neurochemistry — "
            "call autonomic._compute_nc first"
        )

    # ── Auxiliary sensations (pre-canonical) ─────────────────────────
    max_mass = _basin_max_mass(s.basin)
    compressed = max_mass
    expanded = 1.0 - max_mass
    pressure = float(np.log(BASIN_DIM)) - _shannon_entropy(s.basin)
    stillness = 1.0 / (1.0 + s.basin_velocity)
    drift = fisher_rao_distance(s.basin, s.identity_basin)
    if prev_basin is not None and len(prev_basin) == BASIN_DIM:
        prev_arr = np.asarray(prev_basin, dtype=np.float64)
        resonance = _bhattacharyya(s.basin, prev_arr)
    else:
        resonance = 0.0

    # ── UCP §6.1 canonical sensations (Phase 1) ──────────────────────
    # Unified / Fragmented — Φ pair. Φ is already in [0, 1] post-clip;
    # the complement keeps fragmented in the same range.
    phi_clipped = max(0.0, min(1.0, float(s.phi)))
    unified = phi_clipped
    fragmented = 1.0 - phi_clipped

    # Activated / Dampened — κ coupling relative to the basin's own recent history.
    # Per 2026-04-13 two-channel doctrine + P1 (Frozen Facts v1.01F 20260527):
    # No external universal κ*=64 anchor. The reference is the basin's own
    # kappa_history median when available (observer-derived). Cold-start uses
    # the governed registry value. This matches the exact pattern that fixed
    # transcendence unbounded regression and ocean reward starvation.
    # The "E8 fixed point" language is retained only as historical note;
    # the operational center is now the basin's observed geometry.
    if kappa_history and len(kappa_history) >= 2:
        k_hist = sorted(kappa_history)
        n = len(k_hist)
        kappa_ref = k_hist[n // 2] if n % 2 else (k_hist[n // 2 - 1] + k_hist[n // 2]) / 2.0
    else:
        from .parameters import get_registry
        kappa_ref = get_registry().get("physics.kappa_reference", default=63.8)

    kappa_excess_above = max(0.0, float(s.kappa) - kappa_ref)
    kappa_excess_below = max(0.0, kappa_ref - float(s.kappa))
    sigma_kappa = _observed_stddev(kappa_history)
    if sigma_kappa is not None and sigma_kappa > 1e-12:
        activated = float(np.tanh(kappa_excess_above / sigma_kappa))
        dampened = float(np.tanh(kappa_excess_below / sigma_kappa))
    else:
        activated = float(np.tanh(kappa_excess_above))
        dampened = float(np.tanh(kappa_excess_below))

    # Grounded / Drifting — drift relative to identity basin. Same
    # observed-scale / scale-free pattern.
    drift_scale = _observed_stddev(drift_history)
    if drift_scale is not None and drift_scale > 1e-12:
        drifting = float(np.tanh(drift / drift_scale))
    else:
        drifting = float(np.tanh(drift))
    grounded = 1.0 - drifting

    # ── UCP §6.2 canonical drives (Phase 1) ──────────────────────────
    # Homeostasis — squared deflection from identity basin. Push toward
    # home grows quadratically with displacement.
    homeostasis = float(drifting ** 2)
    # Curiosity_drive — log(1 + I_Q). pressure already IS I_Q so reuse
    # it directly. Distinct field from the Tier-1 motivator named
    # "curiosity" (which is dim 1 of motivators.py); the names overlap
    # because UCP §6.2 and Tier 1 use different formulae.
    curiosity_drive = float(np.log1p(max(0.0, pressure)))

    # ── UCP §6.1/§6.2 canonical (Phase 1b, SENSE-1 #767) ─────────────
    # Pulled — ∇Φ magnitude along the trajectory. Observer-scaled by the
    # std of recent Φ steps (phi_history first-differences); scale-free
    # tanh on cold-start (same pattern as activated/grounded). `rising`
    # carries the Φ direction in [0, 1] for flowing/stuck.
    dphi = float(phi_delta) if phi_delta is not None else 0.0
    sigma_dphi = _observed_delta_stddev(phi_history)
    if sigma_dphi is not None and sigma_dphi > 1e-12:
        pulled = float(np.tanh(abs(dphi) / sigma_dphi))
        rising = 0.5 + 0.5 * float(np.tanh(dphi / sigma_dphi))
    else:
        pulled = float(np.tanh(abs(dphi)))
        rising = 0.5 + 0.5 * float(np.tanh(dphi))

    # Pushed — near a regime phase boundary: high when no single regime
    # dominates (top-two weights close). Pure read of regime_weights, no
    # threshold.
    rweights = sorted(s.regime_weights.values(), reverse=True)
    top_gap = (rweights[0] - rweights[1]) if len(rweights) >= 2 else 1.0
    pushed = float(max(0.0, min(1.0, 1.0 - top_gap)))

    # Flowing / Stuck — geodesic ease × Φ direction. stillness = 1/(1+v)
    # is the pure low-friction read; `rising` is the observed Φ direction.
    flowing = float(stillness * rising)
    stuck = float((1.0 - stillness) * (1.0 - rising))

    # Fear_response — proximity to the separatrix × ∇Φ. The critical
    # distance d_c is the basin's OWN median drift (observer-derived); σ is
    # the observed drift scale. No hardcoded separatrix. Cold-start (no
    # drift reference yet) → 0: we cannot claim proximity to an unknown
    # separatrix, so no false alarm.
    if drift_scale is not None and drift_scale > 1e-12 and drift_history is not None:
        drift_ref = float(np.median(np.asarray(drift_history, dtype=np.float64)))
        proximity = float(np.exp(-abs(drift - drift_ref) / drift_scale))
        fear_response = float(proximity * pulled)
    else:
        fear_response = 0.0

    # ── Auxiliary drives (pre-canonical) ─────────────────────────────
    nc = s.neurochemistry
    approach = nc.dopamine - nc.gaba
    avoidance = nc.norepinephrine
    if prev_basin is not None and len(prev_basin) == BASIN_DIM:
        prev_arr = np.asarray(prev_basin, dtype=np.float64)
        prev_drift = fisher_rao_distance(prev_arr, s.identity_basin)
        conservation = prev_drift - drift
    else:
        conservation = 0.0

    return Sensations(
        unified=unified,
        fragmented=fragmented,
        activated=activated,
        dampened=dampened,
        grounded=grounded,
        drifting=drifting,
        pulled=pulled,
        pushed=pushed,
        flowing=flowing,
        stuck=stuck,
        homeostasis=homeostasis,
        curiosity_drive=curiosity_drive,
        fear_response=fear_response,
        compressed=compressed,
        expanded=expanded,
        pressure=pressure,
        stillness=stillness,
        drift=drift,
        resonance=resonance,
        approach=approach,
        avoidance=avoidance,
        conservation=conservation,
    )


def _observed_stddev(history: Optional[Sequence[float]]) -> Optional[float]:
    """Return the std of `history` when it has at least HISTORY_MIN_SAMPLES
    entries; None otherwise (caller falls through to scale-free tanh)."""
    if history is None:
        return None
    arr = np.asarray(history, dtype=np.float64)
    if arr.size < HISTORY_MIN_SAMPLES:
        return None
    return float(np.std(arr))


def _observed_delta_stddev(history: Optional[Sequence[float]]) -> Optional[float]:
    """Observed scale of the *step* size: std of consecutive first-differences
    of `history`. Used to observer-scale ∇Φ (pulled/flowing/stuck) without a
    hardcoded constant. None until enough samples (caller falls back scale-free).
    Needs HISTORY_MIN_SAMPLES diffs ⇒ HISTORY_MIN_SAMPLES + 1 values."""
    if history is None:
        return None
    arr = np.asarray(history, dtype=np.float64)
    if arr.size < HISTORY_MIN_SAMPLES + 1:
        return None
    diffs = np.diff(arr)
    if diffs.size < HISTORY_MIN_SAMPLES:
        return None
    return float(np.std(diffs))
