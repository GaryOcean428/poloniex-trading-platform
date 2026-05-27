"""
autonomic.py — Monkey's autonomic chemistry layer.

Pure state→state map for the §29 six chemicals + reward queue with
time decay. NO decision authority — sleep state and intervention
triggers live in ocean.py (refactored 2026-04-29 #599 directive).
The single autonomic intervention authority is Ocean; this module
only owns:

  - neurochemistry derivation (§29 six chemicals)
  - reward queue with time-decay (pantheon ActivityReward pattern)

Does NOT own: perception, decision-making, exchange IO, DB,
sleep state machine, or autonomic interventions.

Canonical Principles v2.1 enforced:
  P5  Autonomy — all chemicals derived from state, never externally set
  P14 Variable Separation — rewards = STATE events, chemicals = DERIVED views
  §28 Autonomic Governance — Ocean owns interventions; this module
                              only computes chemistry from inputs

Reference implementations:
  - /home/braden/Desktop/Dev/QIG_QFI/vex/kernel/consciousness/neurochemistry.py
    (compute_neurochemicals — 5 chemicals base)
  - /home/braden/Desktop/Dev/QIG_QFI/qig-archive/pantheon-chat/qig-backend/
    autonomic_kernel.py (ActivityReward dataclass, decayed reward sums)
"""

from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Optional

import numpy as np

# Re-exports preserved for backward import compatibility — sleep state
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
# defining this constant but NOT using it — runtime instead computed
# `sigma_kappa = _stddev(kappa_history)` which produces ~0.09 in
# production (basin's natural κ-jitter scale, not the structural scale).
# Result: exp(-2.18 / 0.09) ≈ 3e-11, pinning endo at floor across 85-98%
# of ticks. Wired into the endo formula in the same audit. TS parallel
# path (apps/api/src/services/monkey/neurochemistry.ts) does the same.
#
# The canonical scale and the basin's rolling σ_κ are different concepts
# that happen to share units. ENDORPHIN_KAPPA_SIGMA is the structural
# scale at which κ-distance becomes operationally meaningful — derived
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
#  REWARD QUEUE — pantheon ActivityReward pattern
# ═══════════════════════════════════════════════════════════════

REWARD_HALF_LIFE_MS: float = 20 * 60 * 1000.0  # 20 min
REWARD_QUEUE_MAX: int = 50


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
#  AUTONOMIC KERNEL — chemistry derivation + reward queue.
#  Sleep state machine MOVED to ocean.py (#599 refactor).
# ═══════════════════════════════════════════════════════════════


@dataclass
class AutonomicTickInputs:
    """What the orchestrator passes in each tick. Sleep gating fields
    removed in the #599 refactor — caller passes is_awake (queried
    from Ocean) instead of mode/is_flat which Ocean now consumes
    directly."""

    # For neurochemistry (§29)
    phi_delta: float
    basin_velocity: float
    surprise: float
    quantum_weight: float
    kappa: float
    external_coupling: float
    # Sleep state — produced by Ocean.observe(), consumed here as input.
    is_awake: bool = True
    now_ms: Optional[float] = None
    # Wake transition flag — caller passes True on the tick Ocean reports
    # WAKE so this kernel can clear stale rewards.
    woke: bool = False
    # 2026-05-25 — observer-derived chemistry needs the basin's own
    # rolling histories (parity with TS neurochemistry.ts). All
    # optional; absent → cold-start fallbacks fire (matched to TS).
    surprise_history: Optional[list[float]] = None
    basin_velocity_history: Optional[list[float]] = None
    kappa_history: Optional[list[float]] = None
    external_coupling_history: Optional[list[float]] = None
    mode_transition_times_ms: Optional[list[float]] = None


@dataclass
class AutonomicTickResult:
    nc: NeurochemicalState
    reward_sums: dict[str, float]


class AutonomicKernel:
    """Autonomic chemistry layer — derives NC + holds reward queue.

    One instance per Monkey sub-kernel (Position, Swing). State is
    process-local (not persisted) per vex/pantheon convention —
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
        # P14: kept SEPARATE from the trade-outcome reward queue — a
        # perfect forecaster with no trades still earns this dopamine.
        self._cached_prediction_chemistry: dict[str, float] = {
            "dopamine_delta": 0.0,
            "serotonin_delta": 0.0,
            "n": 0.0,
        }
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
    ) -> ActivityReward:
        """Record a reward event. Magnitudes derived from pnl/margin.

        Winning closes produce positive dopamine; losses produce a small
        negative (mood dip, not punishment — self_observation learns from
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
        # History < 2 samples → tier 1 for positive pnl_frac (prevents starvation).
        from .ocean_reward import observer_fib_coefficient, fibonacci_reward_tier
        from .parameters import get_registry
        # Maintain bounded rolling history on the autonomic instance
        if not hasattr(self, "_pnl_frac_history"):
            self._pnl_frac_history: list[float] = []
        self._pnl_frac_history.append(pnl_frac)
        if len(self._pnl_frac_history) > 200:
            self._pnl_frac_history = self._pnl_frac_history[-200:]
        ocean_coeff = observer_fib_coefficient(pnl_frac, self._pnl_frac_history)

        if pnl_frac > 0:
            dop = float(np.tanh(pnl_frac * 1.5) * 0.5 * ocean_coeff)
            ser = float(np.tanh(pnl_frac) * 0.15 * ocean_coeff)
        else:
            dop = float(-np.tanh(-pnl_frac * 0.5) * 0.1)
            ser = 0.0

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
        endo = (
            float(np.tanh(pnl_frac * 2.0) * 0.3 * kappa_proxim * ocean_coeff)
            if pnl_frac > 0
            else 0.0
        )

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
        logger.info(
            "[%s.autonomic] reward source=%s symbol=%s pnl=%.4f pnlFrac=%.2f%% oceanTier=%d oceanCoeff=%d dop=%.3f ser=%.3f endo=%.3f",
            self.label,
            source,
            symbol,
            realized_pnl_usdt,
            pnl_frac * 100.0,
            fibonacci_reward_tier(pnl_frac),
            ocean_coeff,
            dop,
            ser,
            endo,
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
        kernel_outcome_residuals table). This method REPLACES — does
        not append — so each refresh cycle's signal contributes once
        per tick, not compounding across the refresh interval.

        n is carried for telemetry / parity check only.
        """
        self._cached_prediction_chemistry = {
            "dopamine_delta": float(dopamine_delta),
            "serotonin_delta": float(serotonin_delta),
            "n": float(n),
        }

    # ─────────────────────── decayed reward sums ───────────────────────

    def _decayed_reward_sums(self, now_ms: Optional[float] = None) -> dict[str, float]:
        now_ms = now_ms if now_ms is not None else time.time() * 1000.0
        dop = ser = endo = 0.0
        for r in self._pending_rewards:
            age_ms = now_ms - r.at_ms
            decay = 0.5 ** (age_ms / REWARD_HALF_LIFE_MS)
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

        2026-05-25 — parity port with apps/api/src/services/monkey/
        neurochemistry.ts after PR #920 (steady-state-pinning fix).
        Same observer-derived shapes; same fix for the
        one-sided-clamp-on-observer-relative-signal pattern. See
        [[feedback_steady_state_pinning_pattern]].
        """
        ach = 0.8 if is_awake else 0.2

        # ─── Dopamine ─────────────────────────────────────────────
        # sigmoid(phiDelta) — kept as bounded identity; the prior
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
            tick_count = (
                len(bv_history) if bv_history is not None and len(bv_history) > 0
                else len(mode_x)
            )
            transitions_per_tick = len(mode_x) / max(tick_count, 1)
            ser_base = _clip(1.0 - transitions_per_tick, 0.0, 1.0)
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
        ser = _clip(0.85 * ser_base + reward_sums["serotonin"], 0.0, 1.0)

        # ─── Norepinephrine ───────────────────────────────────────
        # Sigmoid(z) — both tails informative; ~0.5 at mean. Replaces
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
        # The prior shape pinned endo at ~3e-11 across 85–98% of ticks;
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
            # Cold start — bounded identity on κ-distance, tanh coupling gate.
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
        # into the same reward channel. Additive — same shape as the
        # TS-side wiring in loop.ts tick() (cf. predDop / predSer).
        pred = self._cached_prediction_chemistry
        reward_sums_combined = {
            "dopamine": reward_sums["dopamine"] + pred["dopamine_delta"],
            "serotonin": reward_sums["serotonin"] + pred["serotonin_delta"],
            "endorphin": reward_sums["endorphin"],
        }
        nc = self._compute_nc(inputs, reward_sums_combined, inputs.is_awake)

        # Fresh mood on wake — clear stale reward events AND prediction
        # cache (the residual rows underlying the cached delta are now
        # stale relative to the new wake-state regime).
        if inputs.woke:
            self._pending_rewards.clear()
            self._cached_prediction_chemistry = {
                "dopamine_delta": 0.0,
                "serotonin_delta": 0.0,
                "n": 0.0,
            }

        return AutonomicTickResult(nc=nc, reward_sums=reward_sums_combined)

    # ───────────────────────── telemetry ─────────────────────────

    def snapshot(self) -> dict[str, Any]:
        return {
            "pending_reward_count": len(self._pending_rewards),
            "reward_sums": self._decayed_reward_sums(),
        }
