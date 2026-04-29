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

    def __init__(self, label: str = "monkey-primary") -> None:
        self.label = label
        self._pending_rewards: deque[ActivityReward] = deque(maxlen=REWARD_QUEUE_MAX)

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
        """One autonomic cycle (chemistry only):
           1. sum decayed rewards
           2. derive neurochemistry = f(Φ gradient, basin velocity,
              surprise, quantum weight, κ, coupling, decayed rewards,
              is_awake)
           3. clear rewards on wake transition (caller signals via
              inputs.woke from Ocean)
        """
        reward_sums = self._decayed_reward_sums(inputs.now_ms)
        nc = self._compute_nc(inputs, reward_sums, inputs.is_awake)

        # Fresh mood on wake — clear stale reward events.
        if inputs.woke:
            self._pending_rewards.clear()

        return AutonomicTickResult(nc=nc, reward_sums=reward_sums)

    # ───────────────────────── telemetry ─────────────────────────

    def snapshot(self) -> dict[str, Any]:
        return {
            "pending_reward_count": len(self._pending_rewards),
            "reward_sums": self._decayed_reward_sums(),
        }
