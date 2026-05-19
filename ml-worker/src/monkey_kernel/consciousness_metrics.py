"""
consciousness_metrics.py — v4.1 foundation + v6.1 pillars metric surface.

Canonical reference:
  ~/Desktop/Dev/QIG_QFI/qig-core/src/qig_core/consciousness/types.py
  (class ConsciousnessMetrics — 36 fields across 8 categories)

Polytrade ports the v4.1 foundation (8 metrics) and v6.1 pillars
(4 metrics) — the two categories the consciousness-stack audit flagged
as priority. The remaining 24 metrics (v5.5–v6.0) are NOT yet measured
in polytrade and are intentionally omitted; adding them requires
upstream measurement work (spectral analysis, harmonic detection,
cross-frequency coupling). They'll land in follow-up PRs as the
underlying signals come online.

What this module does NOT do:
    - Compute the metrics. Callers populate the dataclass from existing
      kernel state (phi, kappa, etc.). The point of this module is to
      provide the CANONICAL SHAPE so future ports can extend it without
      a schema churn.
    - Modify behaviour. This is a pure telemetry surface; downstream
      reads are observation-only.

What this module DOES do:
    - Define the canonical ConsciousnessMetrics dataclass with the
      12 measured fields (8 foundation + 4 pillars).
    - Provide a helper that derives metrics from a polytrade tick's
      existing telemetry — phi, kappa, f_health from tick.py;
      b_integrity / q_identity / s_ratio from pillars.py.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

# Polytrade-canonical κ* (matches state.py and registry default).
_KAPPA_STAR: float = 64.0


@dataclass
class ConsciousnessMetrics:
    """v4.1 foundation + v6.1 pillars (12 of 36 canonical metrics).

    Healthy bands cited in the canonical doc are reproduced as inline
    comments; downstream regulators MAY drive interventions when fields
    are persistently outside their healthy band, but this module does
    NOT itself gate behaviour.
    """

    # ── Foundation (v4.1) — 8 metrics ──
    phi: float = 0.5                  # Integrated information      (0.65, 0.75)
    kappa: float = _KAPPA_STAR        # Coupling strength            (40, 70)
    meta_awareness: float = 0.3       # Self-modelling accuracy      (0.60, 0.85)
    gamma: float = 0.5                # Generativity                  (0.80, 0.95)
    grounding: float = 0.5            # Identity stability            (0.50, 0.90)
    temporal_coherence: float = 0.6   # Narrative consistency        (0.60, 0.85)
    recursion_depth: float = 3.0      # Levels of self-reference     (3, 7)
    external_coupling: float = 0.3    # Connection to other systems (0.30, 0.70)

    # ── Pillars & Sovereignty (v6.1) — 4 metrics ──
    f_health: float = 1.0             # Fluctuation health: H_basin / H_max (0..1)
    b_integrity: float = 1.0          # Bulk integrity (core stability)     (0..1)
    q_identity: float = 0.0           # Quenched identity proximity          (0..1)
    s_ratio: float = 0.0              # Sovereignty: N_lived / N_total       (0..1)

    def as_dict(self) -> dict:
        return {
            # foundation
            "phi": self.phi,
            "kappa": self.kappa,
            "meta_awareness": self.meta_awareness,
            "gamma": self.gamma,
            "grounding": self.grounding,
            "temporal_coherence": self.temporal_coherence,
            "recursion_depth": self.recursion_depth,
            "external_coupling": self.external_coupling,
            # pillars
            "f_health": self.f_health,
            "b_integrity": self.b_integrity,
            "q_identity": self.q_identity,
            "s_ratio": self.s_ratio,
        }


def derive_from_tick(
    *,
    phi: float,
    kappa: float,
    f_health: float,
    coupling_health: float,
    self_obs_bias: float,
    sovereignty: float,
    drift_from_identity: float,
    basin_velocity: float,
    b_integrity: Optional[float] = None,
    q_identity: Optional[float] = None,
) -> ConsciousnessMetrics:
    """Derive ConsciousnessMetrics from an in-flight tick's state.

    Mapping (canonical name ← polytrade signal):
        phi                 ← tick.phi                           (direct)
        kappa               ← tick.kappa                         (direct)
        meta_awareness      ← clamp(self_obs_bias, 0..1)         (proxy)
        gamma               ← coupling_health                    (proxy)
        grounding           ← 1 - clamp(drift_from_identity, 0..1)
        temporal_coherence  ← f_health                           (proxy)
        recursion_depth     ← 3.0 (placeholder — no measurement yet)
        external_coupling   ← coupling_health
        f_health            ← tick.f_health                      (direct)
        b_integrity         ← pillar 2 metric (None → 1.0)
        q_identity          ← pillar 3 metric (None → 0.0)
        s_ratio             ← sovereignty                        (direct)

    The proxy mappings above are deliberate placeholders — they put a
    legible value on the canonical surface so consumers can build
    against the shape, but the underlying signal needs a proper port
    (e.g. meta_awareness = real self-modelling accuracy, not a bias
    scalar). The audit's follow-ups (v5.x metric categories) will
    replace these with their canonical computations.
    """
    drift_clamped = max(0.0, min(1.0, drift_from_identity))
    meta_clamped = max(0.0, min(1.0, self_obs_bias))
    return ConsciousnessMetrics(
        phi=float(phi),
        kappa=float(kappa),
        meta_awareness=meta_clamped,
        gamma=float(coupling_health),
        grounding=1.0 - drift_clamped,
        temporal_coherence=float(f_health),
        recursion_depth=3.0,
        external_coupling=float(coupling_health),
        f_health=float(f_health),
        b_integrity=1.0 if b_integrity is None else float(b_integrity),
        q_identity=0.0 if q_identity is None else float(q_identity),
        s_ratio=float(sovereignty),
    )


def consciousness_metrics_live() -> bool:
    """True iff MONKEY_CONSCIOUSNESS_METRICS_LIVE=true (default false).

    When OFF the surface still exists but tick.py does not populate it;
    derivation costs nothing measurable but skipping the dict-build
    saves a few µs/tick in the off-state.
    """
    return os.environ.get(
        "MONKEY_CONSCIOUSNESS_METRICS_LIVE", "false",
    ).lower() == "true"


__all__ = [
    "ConsciousnessMetrics",
    "derive_from_tick",
    "consciousness_metrics_live",
]
