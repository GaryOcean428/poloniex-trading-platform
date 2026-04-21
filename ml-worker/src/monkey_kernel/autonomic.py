"""
autonomic.py — Monkey's autonomic nervous system (v0.7 Python port).

Refactored from the TypeScript loop.ts pendingRewards + sleep_cycle.ts
experiments. Owns ONLY autonomic functions:

  - neurochemistry derivation (§29 six chemicals)
  - reward queue with time-decay (pantheon ActivityReward pattern)
  - sleep cycle state machine (vex SleepCycleManager)
  - wake-time orchestration hooks (consolidation callbacks)

Does NOT own: perception, decision-making, exchange IO, DB.

Canonical Principles v2.1 enforced:
  P5  Autonomy — all chemicals derived from state, never externally set
  P14 Variable Separation — rewards = STATE events, chemicals = DERIVED views
  §28 Autonomic Governance — nothing outside this module writes NC levels

Reference implementations:
  - /home/braden/Desktop/Dev/QIG_QFI/vex/kernel/consciousness/systems.py
    (SleepCycleManager, AutonomicSystem)
  - /home/braden/Desktop/Dev/QIG_QFI/vex/kernel/consciousness/neurochemistry.py
    (compute_neurochemicals — 5 chemicals base)
  - /home/braden/Desktop/Dev/QIG_QFI/qig-archive/pantheon-chat/qig-backend/
    autonomic_kernel.py (ActivityReward dataclass, decayed reward sums)
"""

from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Optional

import numpy as np

from .state import NeurochemicalState

logger = logging.getLogger("monkey_kernel.autonomic")


# ═══════════════════════════════════════════════════════════════
#  UCP v6.6 §29 frozen facts (mirror vex config/frozen_facts)
# ═══════════════════════════════════════════════════════════════

C_SOPHIA_THRESHOLD: float = 0.1
SIGMA_KAPPA: float = 10.0
KAPPA_STAR: float = 64.0


def _sigmoid(x: float) -> float:
    return float(1.0 / (1.0 + np.exp(-x)))


def _clip(x: float, lo: float, hi: float) -> float:
    return float(max(lo, min(hi, x)))


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
#  SLEEP CYCLE — vex SleepCycleManager (simplified to AWAKE / SLEEP)
# ═══════════════════════════════════════════════════════════════


class SleepPhase(StrEnum):
    AWAKE = "awake"
    SLEEP = "sleep"


@dataclass
class SleepCycleState:
    phase: SleepPhase = SleepPhase.AWAKE
    phase_started_at_ms: float = field(default_factory=lambda: time.time() * 1000.0)
    last_sleep_ended_at_ms: float = 0.0
    sleep_count: int = 0
    drift_streak: int = 0


class SleepCycleManager:
    """AWAKE ↔ SLEEP state machine.

    Triggers (geometric per L6 Structural Leg — no cycle counters gate
    sleep/wake):
      AWAKE → SLEEP: awake_duration > min_awake_ms
                     AND kernel is flat (no own open positions)
                     AND mode has been DRIFT for drift_trigger_ticks
                     (meaning: she's bored, safe to consolidate)
      SLEEP → AWAKE: sleep_duration >= sleep_duration_ms
    """

    MIN_AWAKE_MS: float = 2 * 60 * 60 * 1000.0     # 2 h
    SLEEP_DURATION_MS: float = 15 * 60 * 1000.0    # 15 min
    DRIFT_TRIGGER_TICKS: int = 10                  # ~5 min at 30s tick

    def __init__(self, label: str = "monkey-primary") -> None:
        self.label = label
        self.state = SleepCycleState()

    @property
    def phase(self) -> SleepPhase:
        return self.state.phase

    @property
    def is_awake(self) -> bool:
        return self.state.phase == SleepPhase.AWAKE

    def tick(
        self,
        current_mode: str,
        is_flat: bool,
        now_ms: Optional[float] = None,
    ) -> dict[str, Any]:
        now_ms = now_ms if now_ms is not None else time.time() * 1000.0
        prev_phase = self.state.phase

        if current_mode == "drift":
            self.state.drift_streak += 1
        else:
            self.state.drift_streak = 0

        if self.state.phase == SleepPhase.AWAKE:
            awake_duration = now_ms - self.state.phase_started_at_ms
            ready = (
                awake_duration > self.MIN_AWAKE_MS
                and is_flat
                and self.state.drift_streak >= self.DRIFT_TRIGGER_TICKS
            )
            if ready:
                self.state.phase = SleepPhase.SLEEP
                self.state.phase_started_at_ms = now_ms
                logger.info(
                    "[%s] entering sleep (awake=%.2fh driftStreak=%d)",
                    self.label,
                    awake_duration / 3600_000.0,
                    self.state.drift_streak,
                )
        else:
            sleep_duration = now_ms - self.state.phase_started_at_ms
            if sleep_duration >= self.SLEEP_DURATION_MS:
                self.state.phase = SleepPhase.AWAKE
                self.state.phase_started_at_ms = now_ms
                self.state.last_sleep_ended_at_ms = now_ms
                self.state.sleep_count += 1
                self.state.drift_streak = 0
                logger.info(
                    "[%s] waking (slept=%.1fm total=%d)",
                    self.label,
                    sleep_duration / 60_000.0,
                    self.state.sleep_count,
                )

        sleep_remaining_ms = (
            max(0.0, self.SLEEP_DURATION_MS - (now_ms - self.state.phase_started_at_ms))
            if self.state.phase == SleepPhase.SLEEP
            else 0.0
        )
        return {
            "phase": self.state.phase.value,
            "entered_sleep": prev_phase == SleepPhase.AWAKE
            and self.state.phase == SleepPhase.SLEEP,
            "woke": prev_phase == SleepPhase.SLEEP
            and self.state.phase == SleepPhase.AWAKE,
            "sleep_remaining_ms": sleep_remaining_ms,
        }

    def snapshot(self) -> dict[str, Any]:
        return {
            "phase": self.state.phase.value,
            "phase_started_at_ms": self.state.phase_started_at_ms,
            "last_sleep_ended_at_ms": self.state.last_sleep_ended_at_ms,
            "sleep_count": self.state.sleep_count,
            "drift_streak": self.state.drift_streak,
        }


# ═══════════════════════════════════════════════════════════════
#  AUTONOMIC KERNEL — orchestrates NC + rewards + sleep
# ═══════════════════════════════════════════════════════════════


@dataclass
class AutonomicTickInputs:
    """What the orchestrator passes in each tick."""

    # For neurochemistry (§29)
    phi_delta: float
    basin_velocity: float
    surprise: float
    quantum_weight: float
    kappa: float
    external_coupling: float
    # For sleep gating
    current_mode: str
    is_flat: bool
    now_ms: Optional[float] = None


@dataclass
class AutonomicTickResult:
    nc: NeurochemicalState
    phase: SleepPhase
    is_awake: bool
    entered_sleep: bool
    woke: bool
    sleep_remaining_ms: float
    reward_sums: dict[str, float]


class AutonomicKernel:
    """Autonomic nervous system — rewards, sleep, neurochemistry.

    One instance per Monkey sub-kernel (Position, Swing). State is
    process-local (not persisted) per vex/pantheon convention —
    autonomic state is "body state" that rebuilds from inputs after
    restart. The resonance bank persists across restarts; rewards do
    not.
    """

    def __init__(self, label: str = "monkey-primary") -> None:
        self.label = label
        self._pending_rewards: deque[ActivityReward] = deque(maxlen=REWARD_QUEUE_MAX)
        self._sleep = SleepCycleManager(label)

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

        if pnl_frac > 0:
            dop = float(np.tanh(pnl_frac * 1.5) * 0.5)
            ser = float(np.tanh(pnl_frac) * 0.15)
        else:
            dop = float(-np.tanh(-pnl_frac * 0.5) * 0.1)
            ser = 0.0

        kappa_proxim = (
            float(np.exp(-abs(kappa_at_exit - KAPPA_STAR) / 10.0))
            if kappa_at_exit is not None
            else 0.5
        )
        endo = (
            float(np.tanh(pnl_frac * 2.0) * 0.3 * kappa_proxim)
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
        logger.info(
            "[%s.autonomic] reward source=%s symbol=%s pnl=%.4f pnlFrac=%.2f%% dop=%.3f ser=%.3f endo=%.3f",
            self.label,
            source,
            symbol,
            realized_pnl_usdt,
            pnl_frac * 100.0,
            dop,
            ser,
            endo,
        )
        return reward

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

        Mirrors vex/kernel/consciousness/neurochemistry.py formulas with
        the pantheon reward-lift addition: Φ-gradient base + decayed
        lived-outcome stream.
        """
        ach = 0.8 if is_awake else 0.2

        dop_from_phi = _clip(_sigmoid(inputs.phi_delta * 10.0), 0.0, 1.0)
        dop_from_reward = _clip(reward_sums["dopamine"], 0.0, 1.0)
        dop = _clip(dop_from_phi + dop_from_reward, 0.0, 1.0)

        ser_base = _clip(1.0 / max(inputs.basin_velocity, 0.01), 0.0, 1.0)
        ser = _clip(ser_base + reward_sums["serotonin"], 0.0, 1.0)

        ne = _clip(inputs.surprise * 2.0, 0.0, 1.0)
        gaba = _clip(1.0 - inputs.quantum_weight, 0.0, 1.0)

        coupling_gate = _clip(inputs.external_coupling / C_SOPHIA_THRESHOLD, 0.0, 1.0)
        endo_base = float(np.exp(-abs(inputs.kappa - KAPPA_STAR) / SIGMA_KAPPA)) * coupling_gate
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
        """One autonomic cycle:
           1. update sleep phase from inputs
           2. sum decayed rewards
           3. derive neurochemistry = f(Φ gradient, basin velocity,
              surprise, quantum weight, κ, coupling, decayed rewards,
              is_awake)
        """
        sleep_result = self._sleep.tick(
            current_mode=inputs.current_mode,
            is_flat=inputs.is_flat,
            now_ms=inputs.now_ms,
        )
        is_awake = sleep_result["phase"] == SleepPhase.AWAKE.value

        reward_sums = self._decayed_reward_sums(inputs.now_ms)
        nc = self._compute_nc(inputs, reward_sums, is_awake)

        # Fresh mood on wake — clear stale reward events.
        if sleep_result["woke"]:
            self._pending_rewards.clear()

        return AutonomicTickResult(
            nc=nc,
            phase=SleepPhase(sleep_result["phase"]),
            is_awake=is_awake,
            entered_sleep=sleep_result["entered_sleep"],
            woke=sleep_result["woke"],
            sleep_remaining_ms=sleep_result["sleep_remaining_ms"],
            reward_sums=reward_sums,
        )

    # ───────────────────────── telemetry ─────────────────────────

    def snapshot(self) -> dict[str, Any]:
        return {
            "phase": self._sleep.phase.value,
            "sleep_state": self._sleep.snapshot(),
            "pending_reward_count": len(self._pending_rewards),
            "reward_sums": self._decayed_reward_sums(),
        }
