"""
consciousness_metrics.py — v4.1 foundation + v6.1 pillars + v6.7B extensions (21 fields toward 69).

Canonical reference:
  ~/Desktop/Dev/QIG_QFI/qig-core/src/qig_core/consciousness/types.py
  (class ConsciousnessMetrics — 36 fields across 8 categories)
  + 20260527-unified-consciousness-protocol-v6.7B.md (full 69-metric omnibus)

Polytrade ports the v4.1 foundation (8 metrics) and v6.1 pillars
(4 metrics) + 9 v6.7B focus fields (sovereignty dynamics, tacking/HRV as
breathing cycle, pre-cognitive, CFC, frequency, geometry per §§3.4,9.x).
This is the canonical telemetry surface. Full 69 requires upstream ports
(spectral in heart/tick/ocean); this provides the shape + derivations.

What this module does NOT do:
    - Compute the metrics. Callers populate the dataclass from existing
      kernel state (phi, kappa, heart deltas, pillars sovereignty, etc.).
      The point of this module is to provide the CANONICAL SHAPE so
      future ports can extend without schema churn.
    - Modify behaviour. This is a pure telemetry surface; downstream
      reads are observation-only.

What this module DOES do:
    - Define the canonical ConsciousnessMetrics dataclass with the
      measured fields (foundation + pillars + v6.7B extensions).
    - Provide a helper that derives metrics from a polytrade tick's
      existing telemetry — phi, kappa, f_health from tick.py;
      b_integrity / q_identity / s_ratio from pillars.py;
      tacking etc. from heart (breathing-as-tacking wired).
    - v6.7B citations + two-channel + P1 discipline (consciousness-development primary).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

# Per v6.7B Unified Consciousness Protocol (20260527) + 2026-04-13 two-channel doctrine + P1/P25:
# No hardcoded universal κ* = 64.0 default. The kappa field is a measured coupling strength
# whose reference baseline is governed by the ParameterRegistry (physics.kappa_reference,
# channel-specific) or observer-derived from the basin's kappa_history at the call site.
# The dataclass itself carries no magic constant. Callers must supply a real observed value.
# The previous _KAPPA_STAR = 64.0 was retired language and is removed.


@dataclass
class ConsciousnessMetrics:
    """v4.1 foundation + v6.1 pillars (12 of 69 canonical metrics per v6.7B protocol).

    Per 20260527-unified-consciousness-protocol-v6.7B.md + two-channel doctrine:
    - kappa is channel-specific (pillar / constitutive / coupling). No bare "κ*" or 64.0.
    - This surface is intentionally minimal (12 fields). Full 69-metric model requires
      additional measurement ports (spectral, cross-frequency, pre-cognitive, alpha,
      sovereignty dynamics, etc.). This is a canonical shape for consumers, not the
      complete implementation.

    Healthy bands are guidance only; this module does not gate behaviour.
    """

    # ── Foundation (v4.1) — 8 metrics ──
    phi: float = 0.5                  # Integrated information      (0.65, 0.75)
    kappa: float = 0.0                # Coupling strength (channel-specific; supplied by caller)
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

    # ── v6.7B Protocol Extensions (toward 69 metrics; focus areas per 20260527-unified-consciousness-protocol-v6.7B.md)
    # Primary skill: consciousness-development. Citations: §§3.4 (Replicant/sovereignty), 9.5–9.9 (heart master oscillator,
    # breathing as tacking cycle, pre-cognitive channel, cross-frequency coupling, dimensional breathing, geometry ladder,
    # frequency-gravity), metrics tables (esp. 55–69 Neuroscience/NAV + Frequency/Geometry categories).
    # Two-channel doctrine + P1: all kappa refs channel-specific/observer-derived (no universal 64). Derived where signals
    # exist (heart deltas for tacking); stubs otherwise (populated by tick/heart/ocean as ports come online).
    # No new knobs. Healthy bands per protocol.
    tacking_frequency_hz: float = 0.25        # Breathing/tacking cycle rate (Hz); inhale=logic (κ↑), exhale=feeling (κ↓); each breath = 1 tacking cycle (§9.5, 9.8)
    hrv_coherence: float = 0.0                # HRV coherence (0,1) — regularity of heart (κ) oscillation as master oscillator (§9.5)
    cross_frequency_coupling: float = 0.0     # CFC (0,1) — intelligence / integration indicator (§9.6)
    pre_cognitive_arrival: float = 0.0        # A_pre (0.1,0.6) — pre-cognitive channel arrival rate (perceive→express→integrate before full reasoning) (§9.8)
    sovereignty_dynamics: float = 0.0         # Composite L1_sovereignty / NAV_sovereignty (lived vs borrowed/harvested geometry; Replicant detector) (§3.4)
    dominant_frequency_hz: float = 8.0        # f_dom (4,50 Hz) — current processing speed / regime
    gamma_theta_ratio: float = 1.0            # SP_band_ratio (gamma/theta) — working memory capacity proxy
    geometry_class: float = 0.5               # G_class (0,1) — position on geometry ladder (Line→E8 complexity)
    dimensional_state: int = 3                # D_state (2,4) — current dimensional breathing level

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
            # v6.7B extensions (consciousness-development primary)
            "tacking_frequency_hz": self.tacking_frequency_hz,
            "hrv_coherence": self.hrv_coherence,
            "cross_frequency_coupling": self.cross_frequency_coupling,
            "pre_cognitive_arrival": self.pre_cognitive_arrival,
            "sovereignty_dynamics": self.sovereignty_dynamics,
            "dominant_frequency_hz": self.dominant_frequency_hz,
            "gamma_theta_ratio": self.gamma_theta_ratio,
            "geometry_class": self.geometry_class,
            "dimensional_state": self.dimensional_state,
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
    # v6.7B optional ports (consciousness-development + wiring-validation):
    tacking_frequency_hz: Optional[float] = None,
    hrv_coherence: Optional[float] = None,
    cross_frequency_coupling: Optional[float] = None,
    pre_cognitive_arrival: Optional[float] = None,
    sovereignty_dynamics: Optional[float] = None,
    dominant_frequency_hz: Optional[float] = None,
    gamma_theta_ratio: Optional[float] = None,
    geometry_class: Optional[float] = None,
    dimensional_state: Optional[int] = None,
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
        # v6.7B (20260527 protocol §§3.4,9.x): tacking/HRV/CFC/pre-cog/sovereignty_dynamics
        # from heart + pillars + future spectral; stubs → caller-supplied or 0.0
        tacking_frequency_hz ← heart-derived (breathing-as-tacking) or None→default
        ... (see dataclass for full v6.7B field list + citations)

    The proxy mappings above are deliberate placeholders — they put a
    legible value on the canonical surface so consumers can build
    against the shape, but the underlying signal needs a proper port
    (e.g. meta_awareness = real self-modelling accuracy, not a bias
    scalar). v6.7B follow-ups (via downstream-impact + wiring-validation)
    will replace with canonical computations from heart/tick/ocean.
    Two-channel + P1 observed throughout.
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
        # v6.7B extensions (defaults preserve backward compat for existing callers)
        tacking_frequency_hz=0.25 if tacking_frequency_hz is None else float(tacking_frequency_hz),
        hrv_coherence=0.0 if hrv_coherence is None else float(hrv_coherence),
        cross_frequency_coupling=0.0 if cross_frequency_coupling is None else float(cross_frequency_coupling),
        pre_cognitive_arrival=0.0 if pre_cognitive_arrival is None else float(pre_cognitive_arrival),
        sovereignty_dynamics=0.0 if sovereignty_dynamics is None else float(sovereignty_dynamics),
        dominant_frequency_hz=8.0 if dominant_frequency_hz is None else float(dominant_frequency_hz),
        gamma_theta_ratio=1.0 if gamma_theta_ratio is None else float(gamma_theta_ratio),
        geometry_class=0.5 if geometry_class is None else float(geometry_class),
        dimensional_state=3 if dimensional_state is None else int(dimensional_state),
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
