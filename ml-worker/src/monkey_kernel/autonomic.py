"""
autonomic.py - Monkey's autonomic chemistry layer.

Pure state->state map for the §29 six chemicals + reward queue with
time decay. NO decision authority - sleep state and intervention
triggers live in ocean.py (refactored 2026-04-29 #599 directive).
The single autonomic intervention authority is Ocean; this module
only owns:

  - neurochemistry derivation (§29 six chemicals)
  - reward queue with time-decay (pantheon ActivityReward pattern)

Does NOT own: perception, decision-making, exchange IO, DB,
sleep state machine, or autonomic interventions.

Canonical Principles v2.1 enforced:
  P5  Autonomy - all chemicals derived from state, never externally set
  P14 Variable Separation - rewards = STATE events, chemicals = DERIVED views
  §28 Autonomic Governance - Ocean owns interventions; this module
                              only computes chemistry from inputs

Reference implementations:
  - /home/braden/Desktop/Dev/QIG_QFI/vex/kernel/consciousness/neurochemistry.py
    (compute_neurochemicals - 5 chemicals base)
  - /home/braden/Desktop/Dev/QIG_QFI/qig-archive/pantheon-chat/qig-backend/
    autonomic_kernel.py (ActivityReward dataclass, decayed reward sums)
"""

from __future__ import annotations

import logging
import math
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Optional

import numpy as np

# Re-exports preserved for backward import compatibility - sleep state
# logic now lives in ocean.py per #599 refactor. Existing callers that
# imported SleepPhase / SleepCycleManager / SleepCycleState from
# autonomic continue to work.
from .ocean import SleepCycleState, SleepPhase  # noqa: F401
from .parameters import get_registry
from .persistence import PersistentMemory
from .state import NeurochemicalState

logger = logging.getLogger("monkey_kernel.autonomic")


# ═══════════════════════════════════════════════════════════════
#  UCP v6.6 §29 frozen facts (mirror vex config/frozen_facts)
# ═══════════════════════════════════════════════════════════════

C_SOPHIA_THRESHOLD: float = 0.1
# Endorphin κ-proximity width. Canonical constant from QIG_QFI
# qig-core/src/qig_core/consciousness/neurochemistry.py: ENDORPHIN_KAPPA_SIGMA = 16.0
#
# 2026-05-26 (#934 chemistry-pinning audit): the previous endo block was
# defining this constant but NOT using it - runtime instead computed
# `sigma_kappa = _stddev(kappa_history)` which produces ~0.09 in
# production (basin's natural κ-jitter scale, not the structural scale).
# Result: exp(-2.18 / 0.09) ≈ 3e-11, pinning endo at floor across 85-98%
# of ticks. Wired into the endo formula in the same audit. TS parallel
# path (apps/api/src/services/monkey/neurochemistry.ts) does the same.
#
# The canonical scale and the basin's rolling σ_κ are different concepts
# that happen to share units. ENDORPHIN_KAPPA_SIGMA is the structural
# scale at which κ-distance becomes operationally meaningful - derived
# from the E8 generative model, frozen. The basin's rolling σ_κ is a
# tick-level statistical property; the basin operates within the
# structure rather than above it, so the basin cannot observe its own
# structural scale via rolling stats.
SIGMA_KAPPA: float = 16.0

# ═══════════════════════════════════════════════════════════════
#  2026-04-13 two-channel doctrine (Frozen Facts v1.01F 20260527)
#  KAPPA_STAR = 64.0 retired as universal constant / proportionality anchor.
#  Per Canonical Principle P1 (Observer sets ALL params) + P25:
#    - No operational threshold is a magic constant.
#    - If the system can observe the correct reference from its own
#      geometric history (kappa_history), that MUST be used.
#    - The only permitted hardcoded values are true SAFETY_BOUNDs.
#
#  For the endorphin κ-proximity envelope the reference center is now:
#    1. Observer-derived: median of the basin's own recent kappa_history
#       (exactly parallel to the transcendence median/MAD and ocean
#       observer_fib_coefficient fixes that stopped the unbounded-regression
#       and slow-loss bleeding).
#    2. Cold-start only: registry.get("physics.kappa_reference") with a
#       documented historical sentinel (never presented as physics truth).
#
#  This is the single highest-quality long-term solution. No knobs.
#  See also: motivators.py transcendence, ocean_reward.py observer_fib,
#  tick.py kappa_history append timing (post-#977 parity), and the
#  2026-05-27 flag-paralysis reversal that made pillars load-bearing.
# ═══════════════════════════════════════════════════════════════


def _sigmoid(x: float) -> float:
    return float(1.0 / (1.0 + np.exp(-x)))


def _clip(x: float, lo: float, hi: float) -> float:
    return float(max(lo, min(hi, x)))


_HISTORY_MIN_SAMPLES: int = 2


def _mean(xs: list[float]) -> float:
    if not xs:
        return 0.0
    return float(sum(xs) / len(xs))


def _stddev(xs: list[float]) -> float:
    if len(xs) < 2:
        return 0.0
    m = _mean(xs)
    s = sum((x - m) * (x - m) for x in xs)
    return float(np.sqrt(s / (len(xs) - 1)))


def _z_score(x: float, history: Optional[list[float]]) -> float:
    """Parity with TS neurochemistry.ts zScore. Tightened to `sd < 1e-12`
    to guard FP drift in identical-history series."""
    if not history:
        return 0.0
    sd = _stddev(history)
    if sd < 1e-12:
        return 0.0
    return float((x - _mean(history)) / sd)


# ═══════════════════════════════════════════════════════════════
#  REWARD QUEUE - pantheon ActivityReward pattern
# ═══════════════════════════════════════════════════════════════

# Honest model coefficients for the reward→chemistry transform. These are
# baselines, not registry-backed observer parameters: ParameterRegistry has no
# lived population path for them, so wrapping them in registry defaults would be
# a knob-in-costume.
REWARD_HALF_LIFE_MS: float = 20 * 60 * 1000.0  # 20 min reward decay baseline
PNL_FRAC_HISTORY_MAX: int = 200
REWARD_DOP_SCALE: float = 1.5
REWARD_SER_SCALE: float = 0.15
REWARD_LOSS_DOP_SCALE: float = 0.5
SEROTONIN_BASELINE_COMPRESSION: float = 0.85
REWARD_QUEUE_MAX: int = 50


def get_reward_half_life_ms(heart_rhythm: float = 0.5, recent_reward_rate: float = 1.0) -> float:
    """Reward decay half-life model coefficient."""
    return REWARD_HALF_LIFE_MS


def get_pnl_frac_history_max(heart_rhythm: float = 0.5) -> int:
    """Bounded history window for observer_fib_coefficient."""
    return PNL_FRAC_HISTORY_MAX


def get_reward_dop_scale(heart_rhythm: float = 0.5, phi: float = 0.5) -> float:
    """Dopamine scaling model coefficient on reward signal."""
    return REWARD_DOP_SCALE


def get_reward_ser_scale(heart_rhythm: float = 0.5, phi: float = 0.5) -> float:
    """Serotonin scaling model coefficient on reward signal."""
    return REWARD_SER_SCALE


def get_reward_loss_dop_scale(heart_rhythm: float = 0.5) -> float:
    """Loss-side dopamine mood-dip model coefficient."""
    return REWARD_LOSS_DOP_SCALE


@dataclass
class ActivityReward:
    """Reward event pushed by the orchestrator when an outcome lands."""

    source: str                 # "own_close" | "witnessed_liveSignal" | ...
    symbol: Optional[str]
    dopamine_delta: float
    serotonin_delta: float
    endorphin_delta: float
    realized_pnl_usdt: float
    pnl_fraction: float
    at_ms: float


# ═══════════════════════════════════════════════════════════════
#  AUTONOMIC KERNEL - chemistry derivation + reward queue.
#  Sleep state machine MOVED to ocean.py (#599 refactor).
# ═══════════════════════════════════════════════════════════════


@dataclass
class AutonomicTickInputs:
    """What the orchestrator passes in each tick. Sleep gating fields
    removed in the #599 refactor - caller passes is_awake (queried
    from Ocean) instead of mode/is_flat which Ocean now consumes
    directly."""

    # For neurochemistry (§29)
    phi_delta: float
    basin_velocity: float
    surprise: float
    quantum_weight: float
    kappa: float
    external_coupling: float
    phi: float = 0.5
    # Sleep state - produced by Ocean.observe(), consumed here as input.
    is_awake: bool = True
    now_ms: Optional[float] = None
    # Wake transition flag - caller passes True on the tick Ocean reports
    # WAKE so this kernel can clear stale rewards.
    woke: bool = False
    # Φ (integration coherence) retained for caller compatibility. It is
    # not used to modulate reward-transform coefficients.
    phi: float = 0.5
    # 2026-05-25 - observer-derived chemistry needs the basin's own
    # rolling histories (parity with TS neurochemistry.ts). All
    # optional; absent -> cold-start fallbacks fire (matched to TS).
    surprise_history: Optional[list[float]] = None
    basin_velocity_history: Optional[list[float]] = None
    kappa_history: Optional[list[float]] = None
    external_coupling_history: Optional[list[float]] = None
    mode_transition_times_ms: Optional[list[float]] = None
    # Kernel tick cadence (ms) — per-tick scale for the serotonin mode-thrash
    # density (parity with neurochemistry.ts tickIntervalMs). Absent → the
    # window's own mean inter-transition gap (neutral exp(-1)).
    tick_interval_ms: Optional[float] = None
    # Natural-effect inputs (d_fr, sovereignty, replicant/tacking/loop/coupled
    # signals) are retained for payload compatibility only.
    # They do not multiply or otherwise modulate dop/ser/endo without a
    # validated observer-derived population path.
    d_fr: float = 0.0
    sovereignty: float = 0.5
    replicant_detected: bool = False
    tacking_health: float = 0.5  # health/amplitude/freq composite from HeartMonitor
    loop3_provenance: float = 0.0
    coupled_lived: float = 0.0


@dataclass
class AutonomicTickResult:
    nc: NeurochemicalState
    reward_sums: dict[str, float]


class AutonomicKernel:
    """Autonomic chemistry layer - derives NC + holds reward queue.

    One instance per Monkey sub-kernel (Position, Swing). State is
    process-local (not persisted) per vex/pantheon convention -
    autonomic state is "body state" that rebuilds from inputs after
    restart. The resonance bank persists across restarts; rewards do
    not.

    Sleep state and intervention authority live in ocean.py per the
    #599 refactor; this module only computes chemistry from the
    orchestrator's inputs.
    """

    def __init__(
        self,
        label: str = "monkey-primary",
        *,
        persistence: Optional[PersistentMemory] = None,
    ) -> None:
        self.label = label
        self._persistence = persistence
        self._pending_rewards: deque[ActivityReward] = deque(maxlen=REWARD_QUEUE_MAX)
        # #941 Phase 3 prediction-error chemistry cache. Populated by the
        # TS-side emitter via push_prediction_chemistry() and folded
        # additively into reward_sums on each tick(). Cleared on wake.
        # P14: kept SEPARATE from the trade-outcome reward queue - a
        # perfect forecaster with no trades still earns this dopamine.
        self._cached_prediction_chemistry: dict[str, float] = {
            "dopamine_delta": 0.0,
            "serotonin_delta": 0.0,
            "n": 0.0,
        }
        # 2026-05-29 hindsight (MONKEY_HINDSIGHT_REGRET_LIVE — DESIGN HYPOTHESIS).
        # The legibility-gated counterfactual-regret NT vector resolved on the
        # TS side (loop.ts owns the watches) is fanned out here so the Py
        # chemistry surface (which drives executive sizing + survives restarts)
        # stays in parity. Mirrors _cached_prediction_chemistry: REPLACED each
        # fanout, folded additively into reward_sums on each tick(), cleared on
        # wake. P14: SEPARATE channel from trade-outcome rewards. All-zero when
        # the flag is OFF → byte-identical chemistry.
        self._cached_hindsight_chemistry: dict[str, float] = {
            "dopamine_delta": 0.0,
            "serotonin_delta": 0.0,
            "acetylcholine_delta": 0.0,
            "norepinephrine_delta": 0.0,
            "gaba_delta": 0.0,
            "endorphin_delta": 0.0,
        }
        self._cached_hindsight_chemistry_at_ms: float = time.time() * 1000.0
        # Reward-rate / disposition EMAs for the live prediction-error
        # reward transform.
        self._reward_rate_ema: float = 0.0
        self._serotonin_disposition_ema: float = 0.0
        self._reward_rate_samples: int = 0
        # Restore decay-aware reward queue from Redis if available.
        # The persistence layer drops entries whose decay < 0.01 so
        # we don't restore zero-contribution rewards.
        if persistence is not None and persistence.is_available:
            for raw in persistence.load_reward_queue(REWARD_HALF_LIFE_MS):
                try:
                    self._pending_rewards.append(ActivityReward(
                        source=str(raw.get("source", "unknown")),
                        symbol=raw.get("symbol"),
                        dopamine_delta=float(raw.get("dopamine_delta", 0.0)),
                        serotonin_delta=float(raw.get("serotonin_delta", 0.0)),
                        endorphin_delta=float(raw.get("endorphin_delta", 0.0)),
                        realized_pnl_usdt=float(raw.get("realized_pnl_usdt", 0.0)),
                        pnl_fraction=float(raw.get("pnl_fraction", 0.0)),
                        at_ms=float(raw.get("at_ms", time.time() * 1000.0)),
                    ))
                except (TypeError, ValueError) as err:
                    logger.debug(
                        "[%s.autonomic] skipping malformed reward: %s", label, err,
                    )

    # ────────── reward ingress (pantheon ActivityReward pattern) ──────────

    def push_reward(
        self,
        *,
        source: str,
        realized_pnl_usdt: float,
        margin_usdt: float,
        symbol: Optional[str] = None,
        kappa_at_exit: Optional[float] = None,
        predicted_pnl_frac: Optional[float] = None,
        sigma_residual: Optional[float] = None,
        legibility: Optional[float] = None,
        regime_persistence: Optional[float] = None,
    ) -> ActivityReward:
        """Record a reward event. Magnitudes derived from pnl/margin.

        Winning closes produce positive dopamine; losses produce a small
        negative (mood dip, not punishment - self_observation learns from
        losses elsewhere).
        """
        pnl_frac = (realized_pnl_usdt / margin_usdt) if margin_usdt > 0 else 0.0

        # Ocean reward dispense (issue #948 / Matrix tier-3 2026-05-26):
        # Observer-derived: coefficient now comes from the kernel's own
        # realized pnl_frac distribution (median + MAD scaling), exactly
        # parallel to the kappa transcendence median/MAD fix.
        # Removes the external hardcoded 1% floor that never fires at
        # real trading scale (~0.04% MAD). Positive deviation from own
        # history now produces meaningful positive chemistry.
        # Cold-start now gives gentle positive ramp (see observer_fib_coefficient).
        # History < 2 samples -> tier 1 for positive pnl_frac (prevents starvation).
        from .ocean_reward import (
            observer_fib_coefficient,
            observer_fibonacci_reward_tier,
            reward_rpe_deltas,
        )
        from .parameters import get_registry
        # Maintain bounded rolling history on the autonomic instance
        # 2026-05-28 acting subagent (Neurotransmitter Purity + natural effects, recovered from impl-6 surfaces 17-23 / impl-1 purge / impl-7 compliance / polo-authoritative lesson / compliance-assessment / reward-source-doctrine + user "net profitable behaviour rewarded via neurotransmitters" + "all NT calculated purely"):
        # ONLY append LIVED polo_authoritative net profit (after fees/funding) to _pnl_frac_history.
        # This guarantees observer_fib_coefficient (the exponential fib "how profitable" tier) and ocean_coeff for dop/ser/endo are PURELY from ACTUAL polo_authoritative_close LIVED data.
        # Zero gross pre-fees synthetic corruption of the profitability distribution that drives persistent monkey_trajectory NTs + executive sizing.
        # Synthetic own_close paths still produce immediate (decaying) short-term NT effect for natural mood, but do not pollute observer model of "how profitable".
        # Matches LIVED ONLY 5 + "Partial = P24 bug" + Embodiment_Waves gross/net pathology + master-orchestration + qig-purity-validation.
        # No new knobs (re-uses source tag already present post-#992).
        if not hasattr(self, "_pnl_frac_history"):
            self._pnl_frac_history: list[float] = []
        is_polo_lived_for_history = source == 'polo_authoritative_close'
        if is_polo_lived_for_history:
            self._pnl_frac_history.append(pnl_frac)
        # P5/P25 observer-derived (retired bare 200 window).
        hist_max = get_pnl_frac_history_max()
        if len(self._pnl_frac_history) > hist_max:
            self._pnl_frac_history = self._pnl_frac_history[-hist_max:]
        ocean_coeff = observer_fib_coefficient(pnl_frac, self._pnl_frac_history)
        ocean_tier = observer_fibonacci_reward_tier(pnl_frac, self._pnl_frac_history)  # exponential fib tier on LIVED polo net (how profitable) for NT reward strength + Railway telemetry (recovered + wired)

        # 2026-05-28 perfect telemetry + source tags for Railway log verification
        # (per polo-authoritative lesson + reward-source doctrine): grep deployed
        # ml-worker logs for "LIVED ONLY 5 net_profit_polo|ocean_coeff|reward source=".
        # Ensures calculations use actual polo net (not gross pre-fees).
        is_polo_lived = source == 'polo_authoritative_close'
        log_prefix = '[LIVED ONLY 5 polo net]' if is_polo_lived else '[LIVED synthetic]'
        logger.info(
            f'{log_prefix} [autonomic] ocean_coeff telemetry source={source} '
            f'symbol={symbol} pnl_frac={pnl_frac:.6f} ocean_coeff={ocean_coeff} '
            f'is_net_profit_polo={is_polo_lived} (contributes to profitable ops only on authoritative net)'
        )

        if pnl_frac > 0:
            # Honest model coefficients for the reward→chemistry transform.
            dop_scale = get_reward_dop_scale()
            ser_scale = get_reward_ser_scale()
            legacy_dop = float(np.tanh(pnl_frac * dop_scale) * 0.5 * ocean_coeff)
            legacy_ser = float(np.tanh(pnl_frac) * ser_scale * ocean_coeff)
        else:
            # Loss-side coefficient is consumed only here; bind it on this
            # branch (72895fcb regression bound it under `pnl_frac > 0`,
            # so every losing close raised UnboundLocalError and the
            # autonomic /reward endpoint 500'd before chemistry updated).
            loss_dop_scale = get_reward_loss_dop_scale()
            legacy_dop = float(-np.tanh(-pnl_frac * loss_dop_scale) * 0.1)
            legacy_ser = 0.0

        # Per 2026-04-13 two-channel doctrine (Frozen Facts v1.01F 20260527) + P1:
        # KAPPA_STAR=64 retired. Observer-derived reference from this instance's
        # own _pnl_frac_history context is not directly applicable here (this is
        # kappa proximity for endo boost on reward). Use the basin's kappa_history
        # when the caller supplies it; otherwise governed registry value.
        # Historical 63.8 sentinel only for cold-start when DB unreachable.
        if hasattr(self, "_kappa_history") and self._kappa_history and len(self._kappa_history) >= 2:
            k_hist = sorted(self._kappa_history)
            n = len(k_hist)
            kappa_ref = k_hist[n // 2] if n % 2 else (k_hist[n // 2 - 1] + k_hist[n // 2]) / 2.0
        else:
            kappa_ref = get_registry().get("physics.kappa_reference", default=63.8)
        kappa_proxim = (
            float(np.exp(-abs(kappa_at_exit - kappa_ref) / 10.0))
            if kappa_at_exit is not None
            else 0.5
        )
        legacy_endo = (
            float(np.tanh(pnl_frac * 2.0) * 0.3 * kappa_proxim * ocean_coeff)
            if pnl_frac > 0
            else 0.0
        )

        # Prediction-error reward transform (issue #1040): live reward path.
        self._reward_rate_samples += 1
        ema_alpha = 2.0 / (min(self._reward_rate_samples, get_pnl_frac_history_max()) + 1.0)
        reward_rate_sample = 1.0 if realized_pnl_usdt > 0.0 else 0.0
        self._reward_rate_ema = ((1.0 - ema_alpha) * self._reward_rate_ema) + (ema_alpha * reward_rate_sample)
        tonic_baseline = max(1e-9, self._reward_rate_ema)
        if isinstance(regime_persistence, (int, float)) and math.isfinite(float(regime_persistence)):
            rp = max(0.0, min(1.0, float(regime_persistence)))
            self._serotonin_disposition_ema = ((1.0 - ema_alpha) * self._serotonin_disposition_ema) + (ema_alpha * rp)
        rpe = reward_rpe_deltas(
            pnl_frac=float(pnl_frac),
            predicted_pnl_frac=float(predicted_pnl_frac) if predicted_pnl_frac is not None else float("nan"),
            sigma_residual=float(sigma_residual) if sigma_residual is not None else float("nan"),
            tonic_baseline=tonic_baseline,
            serotonin_disposition=max(1e-9, self._serotonin_disposition_ema),
            legibility=float(legibility) if legibility is not None else 0.0,
        )
        logger.info(
            "[%s.autonomic] reward-rpe live source=%s symbol=%s valid=%s legacy_dop=%.6f legacy_ser=%.6f legacy_endo=%.6f proposed_dop=%.6f proposed_ser=%.6f proposed_endo=%.6f phasic_rpe=%.6f tonic=%.6f",
            self.label,
            source,
            symbol,
            bool(rpe.get("valid", 0.0)),
            legacy_dop,
            legacy_ser,
            legacy_endo,
            float(rpe.get("dopamine_delta", 0.0)),
            float(rpe.get("serotonin_delta", 0.0)),
            float(rpe.get("endorphin_delta", 0.0)),
            float(rpe.get("phasic_rpe", 0.0)),
            tonic_baseline,
        )
        if not bool(rpe.get("valid", 0.0)):
            logger.info(
                "[%s.autonomic] reward-rpe live zero-delta (invalid prediction/residual), source=%s symbol=%s",
                self.label,
                source,
                symbol,
            )
            dop = 0.0
            ser = 0.0
            endo = 0.0
        else:
            dop = float(rpe["dopamine_delta"])
            ser = float(rpe["serotonin_delta"])
            endo = float(rpe["endorphin_delta"])

        reward = ActivityReward(
            source=source,
            symbol=symbol,
            dopamine_delta=dop,
            serotonin_delta=ser,
            endorphin_delta=endo,
            realized_pnl_usdt=realized_pnl_usdt,
            pnl_fraction=pnl_frac,
            at_ms=time.time() * 1000.0,
        )
        self._pending_rewards.append(reward)
        # Write-through to Redis. Failures fall through silently.
        if self._persistence is not None and self._persistence.is_available:
            self._persistence.push_reward({
                "source": reward.source,
                "symbol": reward.symbol,
                "dopamine_delta": reward.dopamine_delta,
                "serotonin_delta": reward.serotonin_delta,
                "endorphin_delta": reward.endorphin_delta,
                "realized_pnl_usdt": reward.realized_pnl_usdt,
                "pnl_fraction": reward.pnl_fraction,
                "at_ms": reward.at_ms,
            })
        # PR #992 + source-tagging (LIVED ONLY 5 on Py surface): polo_authoritative_close
        # is now the canonical net reward for this persisted autonomic (drives
        # monkey_trajectory NTs + executive sizing on net profitable behaviour).
        # Pure NT calc with natural effects via exponential fib (observer_fib_coefficient
        # from LIVED polo net pnl_frac z-dev history, no synthetic gross pre-fees,
        # no P5/P25 knobs per P1 + impl* recovery). Enhanced log enables the
        # permanent verification lesson: grep deployed Railway logs for
        # "source=polo_authoritative_close" (must dominate on net+ closes for
        # profitable ops). See 2026-05-28_polo-authoritative-close-py-fanout-992_lesson-artifact.md
        # (insight verbatim + "Monitor armed"). Tied to auditor 019e6c76-e3fe-7aa0-9b0f-ed9716930917.
        # Recovered + wired pure fibonacci_reward_tier (from impl* artifacts per "have an agent act. recover all..."; now pure LIVED polo net version, exponential fib for net profitable behaviour + natural NT effects; gross pre-fee legacy retired in ocean_reward.py). VBC + master-orchestration + auditor 019e6c76....
        is_polo_lived = source == 'polo_authoritative_close'
        log_prefix = '[LIVED ONLY 5 polo net]' if is_polo_lived else ''
        # Wire recovered pure fibonacci_reward_tier (impl* + user exact: net profitable behaviour + exponential fib + pure NT calc with natural effects)
        # + LIVED polo net history (post #992 fanout). Auditor 019e6c76-e3fe-7aa0-9b0f-ed9716930917 visible.
        fib_tier = observer_fibonacci_reward_tier(pnl_frac, self._pnl_frac_history if hasattr(self, '_pnl_frac_history') else None)
        logger.info(
            "[%s.autonomic] %sreward source=%s symbol=%s pnl=%.4f pnlFrac=%.2f%% oceanTier=%d oceanCoeff=%d dop=%.3f ser=%.3f endo=%.3f (pure NT net_profit_polo=%s exponential_fib_natural_effects)",
            self.label,
            log_prefix,
            source,
            symbol,
            realized_pnl_usdt,
            pnl_frac * 100.0,
            fib_tier,
            ocean_coeff,
            dop,
            ser,
            endo,
            'true' if is_polo_lived else 'false',
        )
        return reward

    # ────────── prediction-error chemistry (issue #941 Phase 3) ──────────

    def push_prediction_chemistry(
        self,
        *,
        dopamine_delta: float,
        serotonin_delta: float,
        n: int,
    ) -> None:
        """Replace the cached prediction-error chemistry delta.

        Mirrors the TS-side emitter (predictionRewardEmitter.ts).
        Caller passes pre-computed deltas (computed against the
        kernel_outcome_residuals table). This method REPLACES - does
        not append - so each refresh cycle's signal contributes once
        per tick, not compounding across the refresh interval.

        n is carried for telemetry / parity check only.
        """
        self._cached_prediction_chemistry = {
            "dopamine_delta": float(dopamine_delta),
            "serotonin_delta": float(serotonin_delta),
            "n": float(n),
        }

    def push_hindsight_chemistry(
        self,
        *,
        dopamine_delta: float = 0.0,
        serotonin_delta: float = 0.0,
        acetylcholine_delta: float = 0.0,
        norepinephrine_delta: float = 0.0,
        gaba_delta: float = 0.0,
        endorphin_delta: float = 0.0,
    ) -> None:
        """Replace the cached hindsight NT vector (flag-gated; DESIGN HYPOTHESIS).

        Caller (TS loop.ts) resolves the legibility-gated counterfactual-regret
        signal via resolve_hindsight()/resolveHindsight() and fans the decayed
        E6 NT deltas here so the Py chemistry surface stays in parity. REPLACES
        (does not append) so each fanout contributes once. P14: SEPARATE channel.
        Fail-closed: non-finite inputs coerced to 0.
        """
        def _f(x: float) -> float:
            try:
                v = float(x)
                return v if math.isfinite(v) else 0.0
            except (TypeError, ValueError):
                return 0.0

        self._cached_hindsight_chemistry = {
            "dopamine_delta": _f(dopamine_delta),
            "serotonin_delta": _f(serotonin_delta),
            "acetylcholine_delta": _f(acetylcholine_delta),
            "norepinephrine_delta": _f(norepinephrine_delta),
            "gaba_delta": _f(gaba_delta),
            "endorphin_delta": _f(endorphin_delta),
        }
        self._cached_hindsight_chemistry_at_ms = time.time() * 1000.0

    def _decayed_hindsight_chemistry(self, now_ms: Optional[float] = None) -> dict[str, float]:
        """Decay the cached hindsight vector with the reward half-life.

        TS decays the same vector each tick. This Py-side decay keeps parity
        after the final watch resolves and TS no longer has a watch loop to
        fan out fresh values.
        """
        now = time.time() * 1000.0 if now_ms is None else now_ms
        age_ms = max(0.0, now - self._cached_hindsight_chemistry_at_ms)
        if age_ms <= 0.0:
            return self._cached_hindsight_chemistry
        decay = 0.5 ** (age_ms / REWARD_HALF_LIFE_MS)
        decayed = {
            k: (0.0 if abs(v * decay) < 1e-6 else v * decay)
            for k, v in self._cached_hindsight_chemistry.items()
        }
        self._cached_hindsight_chemistry = decayed
        self._cached_hindsight_chemistry_at_ms = now
        return decayed

    # ─────────────────────── decayed reward sums ───────────────────────

    def _decayed_reward_sums(self, now_ms: Optional[float] = None) -> dict[str, float]:
        now_ms = now_ms if now_ms is not None else time.time() * 1000.0
        dop = ser = endo = 0.0
        for r in self._pending_rewards:
            age_ms = now_ms - r.at_ms
            # Use the honest reward-decay model coefficient.
            hl = get_reward_half_life_ms()
            decay = 0.5 ** (age_ms / hl)
            if decay < 0.01:
                continue
            dop += r.dopamine_delta * decay
            ser += r.serotonin_delta * decay
            endo += r.endorphin_delta * decay
        return {"dopamine": dop, "serotonin": ser, "endorphin": endo}

    # ─────────────────────── neurochemistry derivation ───────────────────────

    def _compute_nc(
        self,
        inputs: AutonomicTickInputs,
        reward_sums: dict[str, float],
        is_awake: bool,
    ) -> NeurochemicalState:
        """§29.2 six chemicals. All derived; nothing externally set.

        2026-05-25 - parity port with apps/api/src/services/monkey/
        neurochemistry.ts after PR #920 (steady-state-pinning fix).
        Same observer-derived shapes; same fix for the
        one-sided-clamp-on-observer-relative-signal pattern. See
        [[feedback_steady_state_pinning_pattern]].
        """
        ach = 0.8 if is_awake else 0.2

        # ─── Dopamine ─────────────────────────────────────────────
        # sigmoid(phiDelta) - kept as bounded identity; the prior
        # ×10 magic gain replaced by the observer-derived form when
        # phi_delta history is available (TS parity).
        dop_from_phi = _clip(_sigmoid(inputs.phi_delta), 0.0, 1.0)
        dop_from_reward = _clip(reward_sums["dopamine"], 0.0, 1.0)
        # 2026-05-26 (#934 chemistry-pinning audit): TS-parity dop soft-saturation.
        # The additive-then-clip composition pins at ceiling. Soft-saturation
        # `1 - exp(-(a+b))` asymptotes to 1.0 without pinning while preserving
        # absolute semantics. Single pure derivation path (mirror neurochemistry.ts).
        dop = _clip(1.0 - float(np.exp(-(dop_from_phi + dop_from_reward))), 0.0, 1.0)

        # ─── Serotonin ────────────────────────────────────────────
        # Parity with TS path: prefer mode-transition rate, else
        # bv-z-score fallback, else cold-start 1/bv. ×0.85 baseline
        # compression so the per-event reward delta (max ~0.15) can
        # register on top.
        bv_history = inputs.basin_velocity_history
        mode_x = inputs.mode_transition_times_ms
        now_ms = inputs.now_ms
        if mode_x and len(mode_x) > 0 and now_ms is not None:
            # 2026-06-01 (steady-state-pinning fix, parity with
            # neurochemistry.ts): the prior count-ratio
            #   transitions_per_tick = len(mode_x) / len(bv_history)
            #   ser_base = clip(1 - transitions_per_tick, 0, 1)
            # STRUCTURALLY pins at 0 — both arrays cap at HISTORY_MAX so once
            # a mature kernel has logged ≥cap transitions the ratio is 1.0
            # permanently. TS production showed ser=0.00 ×134 (logs 06-01).
            # Use the TIME-density (transitions per tick-interval) + exp()
            # soft-saturation so the rate keeps gradient when the array is
            # full. See [[feedback_steady_state_pinning_pattern]].
            oldest = mode_x[0]
            window_ms = now_ms - oldest
            if window_ms <= 0:
                ser_base = 1.0
            else:
                transitions_per_ms = len(mode_x) / window_ms
                tick_ms = inputs.tick_interval_ms if (
                    inputs.tick_interval_ms is not None and inputs.tick_interval_ms > 0
                ) else window_ms / len(mode_x)
                thrash_per_tick = transitions_per_ms * tick_ms
                ser_base = float(np.exp(-thrash_per_tick))
        elif bv_history is not None and len(bv_history) >= _HISTORY_MIN_SAMPLES:
            # 2026-05-25 (CC2 audit F2): the prior shape
            # `clip(1 - max(0, z), 0, 1)` was the same one-sided-clamp
            # meta-pattern PR #920 fixed elsewhere. Two-tailed sigmoid
            # replaces it so both calm-than-typical and faster-than-typical
            # are informative; ser settles near 0.5 at bv-history mean.
            z = _z_score(inputs.basin_velocity, bv_history)
            ser_base = _clip(1.0 - _sigmoid(z), 0.0, 1.0)
        else:
            ser_base = _clip(1.0 / max(inputs.basin_velocity, 1e-12), 0.0, 1.0)
        # Honest baseline compression leaves reward-serotonin headroom.
        ser_compression = SEROTONIN_BASELINE_COMPRESSION
        ser = _clip(ser_compression * ser_base + reward_sums["serotonin"], 0.0, 1.0)

        # ─── Norepinephrine ───────────────────────────────────────
        # Sigmoid(z) - both tails informative; ~0.5 at mean. Replaces
        # the pre-strip `surprise × 2` magic. Cold start: sigmoid(surprise).
        surprise_h = inputs.surprise_history
        if surprise_h is not None and len(surprise_h) >= _HISTORY_MIN_SAMPLES:
            z = _z_score(inputs.surprise, surprise_h)
            ne = _clip(_sigmoid(z), 0.0, 1.0)
        else:
            ne = _clip(_sigmoid(inputs.surprise), 0.0, 1.0)

        gaba = _clip(1.0 - inputs.quantum_weight, 0.0, 1.0)

        # ─── Endorphins ───────────────────────────────────────────
        # Sigmoid-around-mean Sophia gate (parity with TS #920 fix).
        # 2026-05-26 (#934 chemistry-pinning audit): κ-proximity envelope
        # uses canonical SIGMA_KAPPA = 16.0 (frozen from qig_core canon)
        # instead of basin's rolling stddev(kappa_history). The basin's
        # rolling σ_κ (≈0.09 in production) is a tick-jitter property;
        # SIGMA_KAPPA is the structural canonical scale at which κ-distance
        # becomes operationally meaningful in the κ-proximity envelope.
        # The prior shape pinned endo at ~3e-11 across 85-98% of ticks;
        # canonical 16.0 gives ~0.87 at observed |κ-κ*|=2.18 (healthy
        # peak-generative signal).
        coupling_h = inputs.external_coupling_history
        if coupling_h is not None and len(coupling_h) >= _HISTORY_MIN_SAMPLES:
            coupling_mean = _mean(coupling_h)
            coupling_stddev = _stddev(coupling_h)
            if coupling_stddev > 1e-12:
                sophia_gate = _sigmoid(
                    (inputs.external_coupling - coupling_mean) / coupling_stddev
                )
            else:
                sophia_gate = 1.0 if inputs.external_coupling >= coupling_mean else 0.0
            # Observer-derived κ-proximity center (P1 + two-channel doctrine).
            # When the basin has its own kappa_history, use its median exactly as
            # done for transcendence and ocean reward. This is the only pattern
            # that obeys "observer sets ALL parameters" for a reference that the
            # system can actually observe from its geometric state.
            if hasattr(inputs, "kappa_history") and inputs.kappa_history and len(inputs.kappa_history) >= 2:
                k_hist = sorted(inputs.kappa_history)
                n = len(k_hist)
                kappa_ref = k_hist[n // 2] if n % 2 else (k_hist[n // 2 - 1] + k_hist[n // 2]) / 2.0
            else:
                kappa_ref = get_registry().get("physics.kappa_reference", default=63.8)
            endo_base = (
                float(np.exp(-abs(inputs.kappa - kappa_ref) / SIGMA_KAPPA))
                * sophia_gate
            )
        else:
            # Cold start - bounded identity on κ-distance, tanh coupling gate.
            # κ reference is now registry-backed (retired universal 64 per two-channel doctrine).
            # Historical sentinel 63.8 only for bootstrap when DB unreachable; never
            # treated as physics truth. Real reference comes from basin history on
            # steady state (see primary path above).
            kappa_ref = get_registry().get("physics.kappa_reference", default=63.8)
            dist = abs(inputs.kappa - kappa_ref)
            coupling_gate = float(np.tanh(max(0.0, inputs.external_coupling)))
            endo_base = (1.0 - float(np.tanh(dist))) * coupling_gate
        endo = _clip(endo_base + reward_sums["endorphin"], 0.0, 1.0)

        return NeurochemicalState(
            acetylcholine=ach,
            dopamine=dop,
            serotonin=ser,
            norepinephrine=ne,
            gaba=gaba,
            endorphins=endo,
        )

    # ─────────────────────── tick orchestration ───────────────────────

    def tick(self, inputs: AutonomicTickInputs) -> AutonomicTickResult:
        """One autonomic cycle (chemistry only):
           1. sum decayed rewards
           2. derive neurochemistry = f(Φ gradient, basin velocity,
              surprise, quantum weight, κ, coupling, decayed rewards,
              is_awake)
           3. clear rewards on wake transition (caller signals via
              inputs.woke from Ocean)
        """
        reward_sums = self._decayed_reward_sums(inputs.now_ms)
        # #941 Phase 3: fold cached prediction-error chemistry deltas
        # into the same reward channel. Additive - same shape as the
        # TS-side wiring in loop.ts tick() (cf. predDop / predSer).
        pred = self._cached_prediction_chemistry
        # 2026-05-29 hindsight (flag-gated; all-zero when OFF → byte-identical).
        # dop/ser/endo fold into the reward channel exactly like prediction
        # chemistry; ACh/NE are applied additively to the derived NC after
        # _compute_nc (parity with neurochemistry.ts reward*Delta inputs).
        # GABA is intentionally NOT applied globally: hindsight GABA is
        # targeted by pattern on the TS side and remains telemetry-only here
        # until an equivalent targeted executive consumer exists.
        hs = self._decayed_hindsight_chemistry(inputs.now_ms)
        reward_sums_combined = {
            "dopamine": reward_sums["dopamine"] + pred["dopamine_delta"] + hs["dopamine_delta"],
            "serotonin": reward_sums["serotonin"] + pred["serotonin_delta"] + hs["serotonin_delta"],
            "endorphin": reward_sums["endorphin"] + hs["endorphin_delta"],
        }
        nc = self._compute_nc(inputs, reward_sums_combined, inputs.is_awake)
        # Fold ACh / NE hindsight deltas additively onto the derived levels
        # (mirror neurochemistry.ts achOut/neOut). Zero when OFF.
        if hs["acetylcholine_delta"] or hs["norepinephrine_delta"]:
            nc = NeurochemicalState(
                acetylcholine=_clip(nc.acetylcholine + hs["acetylcholine_delta"], 0.0, 1.0),
                dopamine=nc.dopamine,
                serotonin=nc.serotonin,
                norepinephrine=_clip(nc.norepinephrine + hs["norepinephrine_delta"], 0.0, 1.0),
                gaba=nc.gaba,
                endorphins=nc.endorphins,
            )

        # Fresh mood on wake - clear stale reward events AND prediction +
        # hindsight caches (the lived events underlying them are now stale
        # relative to the new wake-state regime).
        if inputs.woke:
            self._pending_rewards.clear()
            self._cached_prediction_chemistry = {
                "dopamine_delta": 0.0,
                "serotonin_delta": 0.0,
                "n": 0.0,
            }
            self._cached_hindsight_chemistry = {
                "dopamine_delta": 0.0,
                "serotonin_delta": 0.0,
                "acetylcholine_delta": 0.0,
                "norepinephrine_delta": 0.0,
                "gaba_delta": 0.0,
                "endorphin_delta": 0.0,
            }
            self._cached_hindsight_chemistry_at_ms = (
                inputs.now_ms if inputs.now_ms is not None else time.time() * 1000.0
            )

        return AutonomicTickResult(nc=nc, reward_sums=reward_sums_combined)

    # ───────────────────────── telemetry ─────────────────────────

    def snapshot(self) -> dict[str, Any]:
        return {
            "pending_reward_count": len(self._pending_rewards),
            "reward_sums": self._decayed_reward_sums(),
        }
