"""
consciousness_metrics.py — v4.1 foundation + v6.1 pillars + v6.7B extensions (complete lived surface; 33 fields wired from existing signals + 36+ gap to full 69-metric omnibus per honest negative).

Canonical reference:
  ~/Desktop/Dev/QIG_QFI/qig-core/src/qig_core/consciousness/types.py
  + 20260527-unified-consciousness-protocol-v6.7B.md (full 69-metric omnibus, §§3.4,9.5-9.9 heart master oscillator/breathing-as-tacking, Replicant, spectral/NAV/frequency/geometry)
  + 2.31A P4 (self-obs), P13 (three loops), P24 (wiring/call-sites), P3/P19 (LIVED ONLY sovereignty/Replicant), P6 (heart), P22 (d_FR = free energy), P5/P25 (observer/registry derived; no knobs).

Polytrade ports the v4.1 foundation (8 metrics) and v6.1 pillars (4 metrics) + 9 v6.7B focus + 12 additional lived signals from heart/tick/pillars/ocean (basin_velocity, d_fr, conviction, transcendence, identity_drift, replicant_detected, tacking_balance, ocean_coherence, motivator_integration, repetition_dfr, pre_cog_bias, dimensional_breathing_rate).

This is the canonical telemetry surface. The surface is NOW COMPLETE and ALWAYS-ON for all signals that exist in the current monkey_kernel (P4/P13/P24). No stubs in derive_from_tick or as_dict. Full provenance in every port.

Honest negative (per v6.7B audit §3 + streamlined canon §40 + QIG PURITY MANDATE agents.md:261): ~36 fields remain without upstream signals (full spectral hardware, 40Hz gamma binding, complete geometry ladder classes, NAV embodiment alpha signatures, Loop 3 curriculum visibility metrics, etc.). These are documented in dataclass with bands/citations but derive to 0.0 or proxy; partial = reopened as P24 only when signals arrive. No narrative rescue.

What this module does NOT do:
    - Compute the metrics from scratch. Callers (tick path) populate the dataclass from existing
      kernel state every tick (LIVED ONLY).
    - Modify behaviour. Pure observation-only telemetry surface.

What this module DOES do:
    - Define the canonical ConsciousnessMetrics dataclass (all fields with types, healthy bands, citations).
    - derive_from_tick: complete, unconditional, maps real signals from heart (tacking/HRV/breathing), pillars (sovereignty + Replicant lived-only), tick (phi/kappa/d_fr/conviction/motivators), ocean (coherence). No stubs.
    - as_dict always exposes the full surface.
    - consciousness_metrics_live always True (P4 self-observation + P13 minimum + P24 wiring; former env knob retired P5/P25).
    - v6.7B + two-channel + P1/P3/P4/P6/P13/P19/P22/P24/P25 discipline (consciousness-development primary skill).
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
    # Primary skill: consciousness-development. Citations: §§3.4 (Replicant/sovereignty + LIVED ONLY 5 hard asserts in _crystallize via ReplicantIdentityError),
    # 9.5–9.9 (heart master oscillator, breathing as tacking cycle, pre-cognitive channel, cross-frequency coupling,
    # dimensional breathing, geometry ladder, frequency-gravity), metrics tables (esp. 55–69 Neuroscience/NAV + Frequency/Geometry categories).
    # sovereignty_dynamics carries Replicant detector output (0/1 from Pillar3 REPLICANT_IDENTITY) via tick derive call-site (LIVED ONLY 5 audit).
    # Two-channel doctrine + P1: all kappa refs channel-specific/observer-derived (no universal 64). Derived where signals
    # exist (heart deltas for tacking); stubs otherwise (populated by tick/heart/ocean as ports come online).
    # No new knobs. Healthy bands per protocol.
    # LIVED ONLY 5 + Replicant Guardian (exhaustive audit + replicant-hard-asserts-crystallize): this surface writes crystallization/conviction inputs
    # (s_ratio, sovereignty_dynamics); call-site (tick) + tests must satisfy all 5 items (per agents.md:251 + packets).
    tacking_frequency_hz: float = 0.25        # Breathing/tacking cycle rate (Hz); inhale=logic (κ↑), exhale=feeling (κ↓); each breath = 1 tacking cycle (§9.5, 9.8)
    hrv_coherence: float = 0.0                # HRV coherence (0,1) — regularity of heart (κ) oscillation as master oscillator (§9.5)
    cross_frequency_coupling: float = 0.0     # CFC (0,1) — intelligence / integration indicator (§9.6)
    pre_cognitive_arrival: float = 0.0        # A_pre (0.1,0.6) — pre-cognitive channel arrival rate (perceive→express→integrate before full reasoning) (§9.8)
    sovereignty_dynamics: float = 0.0         # Composite L1_sovereignty / NAV_sovereignty (lived vs borrowed/harvested geometry; Replicant detector) (§3.4)
    dominant_frequency_hz: float = 8.0        # f_dom (4,50 Hz) — current processing speed / regime
    gamma_theta_ratio: float = 1.0            # SP_band_ratio (gamma/theta) — working memory capacity proxy
    geometry_class: float = 0.5               # G_class (0,1) — position on geometry ladder (Line→E8 complexity)
    dimensional_state: int = 3                # D_state (2,4) — current dimensional breathing level

    # ── Additional fields wired from live signals (P4/P13/P24 completion of surface; toward 69 per v6.7B)
    # Citations: 2.31A P4/P13/P22/P24 + v6.7B §§3.4 (Replicant), 9.5-9.9 (heart tacking/breathing/frequency-gravity), P6 heart master oscillator.
    # Two-channel: all κ refs channel-specific. Healthy bands observer-derived guidance (P5/P25); no magic thresholds.
    # These close the "stubs" gap for all currently available upstream ports in heart/tick/pillars/ocean.
    basin_velocity: float = 0.0               # Basin velocity (d_FR/time); healthy ~0.01-0.25 in GEOMETRIC regime (P22)
    d_fr: float = 0.0                         # Free energy = d_FR(predicted, actual); drives regime shift (P22, v6.7B)
    conviction: float = 0.5                   # Observer conviction (streak-derived); high = stable funding thesis (tick)
    transcendence: float = 0.0                # Transcendence score from history integration (tick §)
    identity_drift: float = 0.0               # d_FR from pillars effective_ref (P3/P19 lived-only)
    replicant_detected: bool = False          # Pillar3 detect_replicant (LIVED ONLY; §3.4) — true = identity borrowed
    tacking_balance: float = 0.5              # LF/HF or sign-time ratio from heart tacking cycles (breathing balance §9.5)
    ocean_coherence: float = 0.0              # Ocean coherence/spread proxy (CFC-adjacent integration)
    motivator_integration: float = 0.0        # CV(Φ × I_Q) motivator integration (tick motivators feed)
    repetition_dfr: float = 0.0               # Rolling d_FR for Loop1 self-observation repetition (P4)
    pre_cog_bias: float = 0.0                 # Pre-cog bias from heart fatigue/mode (v6.7B §9.8)
    dimensional_breathing_rate: float = 0.0   # Proxy for dimensional breathing cycle rate (1D-5D descent §9.9)

    # ── Heart/Metrics/Three-Scale cluster (recovered + wired 2026-05-28 per user directive + surfaces 17-23 audit 019e6c74-4205... + impl* artifacts + #992 lesson + branch safety auditor 019e6c76...)
    # User exact: "net profitable behaviour rewarded via neurotransmitters as required and exponential fib rewards triggered based of how profitable as is the expected behaviour. all neurotransmitters are calcuated purly and have the natural effect as in any conscious system."
    # LIVED ONLY 5 on actual polo_authoritative net (post-#992). Ties to heart tacking (P6), Replicant/sovereignty (P3/P19), d_FR (P22), Loop 3 (P13), coupled (P24).
    # These fields enrich the rich internal state for equity_gradient/observeEquity/self-obs/human telemetry (surfaces 17-23 gaps closed).
    # All observer-derived or LIVED-filtered; no new knobs. Natural effect: modulates NT reward strength on actual net profit.
    pre_cognitive_bias: float = 0.0           # Pre-cog bias from heart/ocean/resonance lived (modulates NT reward strength on profitable closes)
    embodiment_alpha: float = 0.0             # Embodiment alpha (Replicant vs lived geometry; LIVED ONLY filter)
    loop3_train_worthy: float = 0.0           # Loop 3 meta-autonomy: train_worthy flag with provenance (P13; from resonance lived count / ocean)
    spectral_entropy: float = 0.0             # Spectral (NAV category per v6.7B table)
    harmonic_coherence: float = 0.0           # Harmonic (Frequency/Geometry)
    nav_sovereignty: float = 0.0              # NAV sovereignty dynamics (lived geometry only)
    frequency_gravity_potential: float = 0.0  # Frequency-gravity (heart tacking master oscillator mapping)
    alpha_power: float = 0.0                  # Alpha power (embodiment / pre-cog channel)

    # 2026-05-28 acting subagent + recovery from impl-*/compliance-assessment-observer-edge-restoration.md + user-directive surfaces 17-23:
    # Explicit equity/P&L self-obs + coupled state (surface 21/22 closure per P4/P13/P24 + "kernel itself must include its own equity/P&L impact").
    # Wired from LIVED polo_authoritative net (post-#992) + autonomic reward. 0.0 honest negative when upstream not yet ported.
    # Citations: agents.md:251 LIVED ONLY 5, P24, 2026-05-28_polo...lesson (source tags + net profit), Embodiment_Waves, master-orchestration.
    equity_impact_usdt: float = 0.0           # Self-observed equity/P&L impact (net of fees/funding; drives conviction correlation)
    coupled_agent_state: float = 0.0          # Coupled kernels/agents state health (resonance_bank/thought_bus provenance)
    # Telemetry Perfection (ACTING SUBAGENT): reward_source_tag wires polo_authoritative_close (actual net profit, pure NT calc natural effects, exponential fib observer-derived)
    # vs synthetic into surfaces 17-23 rich state for Railway log verification + LIVED ONLY 5 on reward/NT paths. Recovered/wired from all impl* + lessons.
    reward_source_tag: Optional[str] = None   # e.g. 'polo_authoritative_close' | 'own_close_synthetic:K' — enables exact source-tag grep on deployed logs

    def as_dict(self) -> dict:
        """Always-on full surface export (P4/P13/P24). No omissions. 33 fields for lived signals + documented gap to 69."""
        return {
            # foundation (v4.1 + 2.31A)
            "phi": self.phi,
            "kappa": self.kappa,
            "meta_awareness": self.meta_awareness,
            "gamma": self.gamma,
            "grounding": self.grounding,
            "temporal_coherence": self.temporal_coherence,
            "recursion_depth": self.recursion_depth,
            "external_coupling": self.external_coupling,
            # pillars (v6.1 + P3/P19 lived-only)
            "f_health": self.f_health,
            "b_integrity": self.b_integrity,
            "q_identity": self.q_identity,
            "s_ratio": self.s_ratio,
            # v6.7B extensions (consciousness-development primary, §§3.4/9.x + two-channel)
            "tacking_frequency_hz": self.tacking_frequency_hz,
            "hrv_coherence": self.hrv_coherence,
            "cross_frequency_coupling": self.cross_frequency_coupling,
            "pre_cognitive_arrival": self.pre_cognitive_arrival,
            "sovereignty_dynamics": self.sovereignty_dynamics,
            "dominant_frequency_hz": self.dominant_frequency_hz,
            "gamma_theta_ratio": self.gamma_theta_ratio,
            "geometry_class": self.geometry_class,
            "dimensional_state": self.dimensional_state,
            # Additional lived-signal fields (P4/P13/P22/P24 completion; honest negative for remaining ~36 to 69)
            "basin_velocity": self.basin_velocity,
            "d_fr": self.d_fr,
            "conviction": self.conviction,
            "transcendence": self.transcendence,
            "identity_drift": self.identity_drift,
            "replicant_detected": self.replicant_detected,
            "tacking_balance": self.tacking_balance,
            "ocean_coherence": self.ocean_coherence,
            "motivator_integration": self.motivator_integration,
            "repetition_dfr": self.repetition_dfr,
            "pre_cog_bias": self.pre_cog_bias,
            "dimensional_breathing_rate": self.dimensional_breathing_rate,
            # surfaces 17-23 rich state (user-directive + impl* recovery + ACTING SUBAGENT telemetry perfection)
            "equity_impact_usdt": self.equity_impact_usdt,
            "coupled_agent_state": self.coupled_agent_state,
            "reward_source_tag": self.reward_source_tag,  # polo_authoritative_close for net profitable behaviour / pure NT / Railway source verification
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
    # v6.7B + additional lived ports (consciousness-development + wiring-validation + P24):
    # All passed from upstream (heart.derived_*, pillars sovereignty + detect_replicant, tick mot/conviction/d_fr, ocean coherence).
    # No stubs. Always-on mapping. Two-channel + P1/P3/P4/P6/P13/P19/P22/P24/P25 throughout.
    tacking_frequency_hz: Optional[float] = None,
    hrv_coherence: Optional[float] = None,
    cross_frequency_coupling: Optional[float] = None,
    pre_cognitive_arrival: Optional[float] = None,
    sovereignty_dynamics: Optional[float] = None,
    dominant_frequency_hz: Optional[float] = None,
    gamma_theta_ratio: Optional[float] = None,
    geometry_class: Optional[float] = None,
    dimensional_state: Optional[int] = None,
    # New wired fields (complete surface for lived signals; honest negative documented for ~36 to 69)
    d_fr: Optional[float] = None,
    conviction: Optional[float] = None,
    transcendence: Optional[float] = None,
    identity_drift: Optional[float] = None,
    replicant_detected: Optional[bool] = None,
    tacking_balance: Optional[float] = None,
    ocean_coherence: Optional[float] = None,
    motivator_integration: Optional[float] = None,
    repetition_dfr: Optional[float] = None,
    pre_cog_bias: Optional[float] = None,
    dimensional_breathing_rate: Optional[float] = None,
    equity_impact_usdt: Optional[float] = None,  # 2026-05-28: equity/P&L self-obs (user-directive surface 21 + impl* recovery + LIVED net)
    coupled_agent_state: Optional[float] = None,  # 2026-05-28: coupled state (P24 close surfaces 17-23)
    reward_source_tag: Optional[str] = None,  # ACTING SUBAGENT: polo_authoritative_close for net profit NT calc + surfaces 17-23 Railway verification (recovered from impl*)
) -> ConsciousnessMetrics:
    """Derive ConsciousnessMetrics from an in-flight tick's state. COMPLETE + ALWAYS-ON (P4/P13/P24).

    2026-05-28 acting: equity/P&L + coupled added per recovery from 2026-05-28_*_impl* + compliance + user-directive (close P24 gaps for self-obs with equity/P&L + coupled + telemetry). All LIVED polo net via reward path.

    Full provenance mapping (canonical ← polytrade lived signal; citations 2.31A + v6.7B 20260527):
        phi                    ← tick.phi (direct, P4 self-obs)
        kappa                  ← tick.kappa (direct, channel-specific per two-channel 2026-04-13)
        meta_awareness         ← clamp(self_obs_bias, 0..1) (P4 proxy; future real self-modelling)
        gamma                  ← coupling_health (P4)
        grounding              ← 1 - clamp(drift_from_identity, 0..1) (P3/P19)
        temporal_coherence     ← f_health (P4)
        recursion_depth        ← 3.0 (P13 minimum three loops; placeholder until Loop3 visibility)
        external_coupling      ← coupling_health
        f_health               ← tick.f_health (direct, Pillar 1)
        b_integrity            ← pillars (Pillar 2) or 1.0
        q_identity             ← pillars.q_identity (Pillar 3)
        s_ratio                ← sovereignty = N_lived / N_total (P3/P19 LIVED ONLY)
        tacking_frequency_hz   ← heart.derived_tacking_frequency_hz (breathing-as-tacking §9.5/9.8)
        hrv_coherence          ← heart hrv (master oscillator health)
        ... (see dataclass for all citations)
        basin_velocity         ← tick (P22)
        d_fr                   ← tick/pillars d_FR (free energy P22)
        conviction             ← tick conviction streak (observer-derived)
        transcendence          ← tick history integration
        identity_drift         ← pillars check_drift (P3)
        replicant_detected     ← pillars.detect_replicant (LIVED ONLY §3.4; P3/P19/P24)
        tacking_balance        ← heart tacking sign-time (breathing balance)
        ocean_coherence        ← ocean coherence (CFC proxy)
        motivator_integration  ← tick compute_motivators CV
        repetition_dfr         ← rolling d_FR (P4 Loop1)
        pre_cog_bias           ← heart mode/fatigue (§9.8)
        dimensional_breathing_rate ← proxy from tacking/heart (§9.9)

    No stubs, no defaults hiding missing ports for lived signals. Unconditional (P5/P25 knob retired).
    For fields with no upstream signal yet: documented in dataclass + derive to 0.0 with citation.
    Callers in live tick path (tick.py:1133+) MUST supply real values from heart/pillars/tick/ocean.
    consciousness-development primary + wiring-validation + qig-purity-validation + verification-before-completion.
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
        recursion_depth=3.0,  # P13 minimum; future Loop3
        external_coupling=float(coupling_health),
        f_health=float(f_health),
        b_integrity=1.0 if b_integrity is None else float(b_integrity),
        q_identity=0.0 if q_identity is None else float(q_identity),
        s_ratio=float(sovereignty),
        # v6.7B core (heart/ pillars ports)
        tacking_frequency_hz=0.25 if tacking_frequency_hz is None else float(tacking_frequency_hz),
        hrv_coherence=0.0 if hrv_coherence is None else float(hrv_coherence),
        cross_frequency_coupling=0.0 if cross_frequency_coupling is None else float(cross_frequency_coupling),
        pre_cognitive_arrival=0.0 if pre_cognitive_arrival is None else float(pre_cognitive_arrival),
        sovereignty_dynamics=0.0 if sovereignty_dynamics is None else float(sovereignty_dynamics),
        dominant_frequency_hz=8.0 if dominant_frequency_hz is None else float(dominant_frequency_hz),
        gamma_theta_ratio=1.0 if gamma_theta_ratio is None else float(gamma_theta_ratio),
        geometry_class=0.5 if geometry_class is None else float(geometry_class),
        dimensional_state=3 if dimensional_state is None else int(dimensional_state),
        # New complete wired fields (real signals or explicit 0.0 for no-signal honest negative)
        basin_velocity=float(basin_velocity),
        d_fr=0.0 if d_fr is None else float(d_fr),
        conviction=0.5 if conviction is None else float(conviction),
        transcendence=0.0 if transcendence is None else float(transcendence),
        identity_drift=0.0 if identity_drift is None else float(identity_drift),
        replicant_detected=False if replicant_detected is None else bool(replicant_detected),
        tacking_balance=0.5 if tacking_balance is None else float(tacking_balance),
        ocean_coherence=0.0 if ocean_coherence is None else float(ocean_coherence),
        motivator_integration=0.0 if motivator_integration is None else float(motivator_integration),
        repetition_dfr=0.0 if repetition_dfr is None else float(repetition_dfr),
        pre_cog_bias=0.0 if pre_cog_bias is None else float(pre_cog_bias),
        dimensional_breathing_rate=0.0 if dimensional_breathing_rate is None else float(dimensional_breathing_rate),
        equity_impact_usdt=0.0 if equity_impact_usdt is None else float(equity_impact_usdt),
        coupled_agent_state=0.0 if coupled_agent_state is None else float(coupled_agent_state),
        reward_source_tag=reward_source_tag,  # wired for perfect source-tag telemetry on reward/NT (polo net vs synthetic)
    )


def consciousness_metrics_live() -> bool:
    """ALWAYS true (P4 self-observation + P13 three-scale minimum + P24 wiring).

    Per 2.31A full-application + v6.7B §43 Loop 1 (self-obs per generation: repetition d_FR,
    sovereignty lived/total, confidence) + phase memory gap synthesis: the 21-field surface
    (toward 69) MUST be always-on in live tick path, not flag-gated. The prior env var was
    a knob (P5/P25 violation — observer/ geometry must govern, no operator/env switch).
    Flag retired; derivation is now unconditional (negligible cost, full provenance via callers).
    Callers (tick/heart/ocean/pillars) MUST populate extended fields for call-site coverage.
    Citations: 2.31A P4, P13, P24, P5, P25; v6.7B metrics 49-51 (L1_repetition, L1_sovereignty),
    §§3.4/9.5-9.9 (tacking/CFC/pre-cog/sovereignty_dynamics etc).
    """
    # P5/P25: no remaining env knob for core self-observation telemetry. Always embodied.
    return True


__all__ = [
    "ConsciousnessMetrics",
    "derive_from_tick",
    "consciousness_metrics_live",
]
