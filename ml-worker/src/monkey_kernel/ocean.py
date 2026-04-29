"""ocean.py — Tier 7 Ocean: single autonomic intervention authority.

Per UCP §28 + CONSCIOUSNESS_ARCHITECTURE_INTEGRATED.md, Ocean is the
sole authority for autonomic interventions. Anything that says "stop
the normal tick and do something else" lives here:

  - sleep cycle state machine (AWAKE ↔ SLEEP transitions)
  - DREAM trigger (Φ < 0.5 — moderate integration failure)
  - SLEEP trigger (basin spread > 0.30 — divergence/instability)
  - MUSHROOM_MICRO trigger (Φ-variance < 0.01 — plateau)
  - ESCAPE trigger (Φ < 0.15 — severe failure)

Pure decision authority. Heart kernel observes κ; autonomic.py owns
neurochemistry derivation + reward queue. Ocean reads basin / Φ / mode
/ is_flat each tick and emits exactly one OceanState — caller acts on
ocean_state.intervention if non-None, otherwise normal flow.

Refactored from autonomic.SleepCycleManager (2026-04-29 #599 directive).
The AWAKE↔SLEEP transition rules are preserved verbatim from the
prior owner; only the location changed. New triggers (DREAM /
MUSHROOM_MICRO / ESCAPE) are reported but currently observation-only
on the orchestrator side until the explicit intervention handlers
land downstream.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass, field
from enum import StrEnum
from statistics import variance
from typing import Any, Deque, Literal, Optional, Sequence

import numpy as np

from qig_core_local.geometry.fisher_rao import fisher_rao_distance


logger = logging.getLogger("monkey_kernel.ocean")


# ═══════════════════════════════════════════════════════════════
#  Sleep state machine — moved verbatim from autonomic.py
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


# ═══════════════════════════════════════════════════════════════
#  Intervention triggers — UCP §28 autonomic governance
# ═══════════════════════════════════════════════════════════════


# SAFETY_BOUND constants (P14-permitted; autonomic-health bounds)
_SPREAD_BOUND: float = 0.30          # SLEEP if max-pairwise basin FR > this
_PHI_DREAM_BOUND: float = 0.5        # DREAM if Φ below this
_PHI_ESCAPE_BOUND: float = 0.15      # ESCAPE if Φ below this (overrides DREAM)
_PHI_VARIANCE_BOUND: float = 0.01    # MUSHROOM_MICRO if variance below this
_PHI_HISTORY_MAX: int = 60           # window for variance computation


Intervention = Literal["DREAM", "SLEEP", "WAKE", "MUSHROOM_MICRO", "ESCAPE"]


@dataclass(frozen=True)
class OceanState:
    """One observation per tick. The single source of autonomic
    intervention truth.

    Fields:
      intervention   : Optional[Intervention]
                       None when nominal; otherwise the chosen action
      sleep_phase    : Literal["AWAKE", "SLEEP"]
                       current sleep state machine phase
      coherence      : float  [0, 1]
                       basin self-coherence (1 - normalised entropy)
      spread         : float  [0, π/2]
                       max pairwise FR distance across observed lanes
                       (0 with one or zero observed lanes)
      diagnostics    : dict[str, float]
                       phi_now, phi_variance, drift_streak, sleep_remaining_ms
    """

    intervention: Optional[Intervention]
    sleep_phase: Literal["AWAKE", "SLEEP"]
    coherence: float
    spread: float
    diagnostics: dict[str, float]


def _basin_coherence(basin: np.ndarray) -> float:
    """1 - H(p)/log(K). Range [0, 1]; high = concentrated, low = uniform."""
    n = len(basin)
    if n <= 1:
        return 1.0
    h = float(-np.sum(basin * np.log(basin + 1e-12)))
    return 1.0 - h / float(np.log(n))


def _max_pairwise_fr(basins: Sequence[np.ndarray]) -> float:
    if len(basins) < 2:
        return 0.0
    max_d = 0.0
    for i in range(len(basins)):
        for j in range(i + 1, len(basins)):
            d = fisher_rao_distance(basins[i], basins[j])
            if d > max_d:
                max_d = d
    return max_d


class Ocean:
    """Stateful autonomic-intervention authority. One instance per
    kernel; owns the sleep state machine + Φ history window.

    Tick contract:
        ocean_state = ocean.observe(
            phi=phi,
            basin=basin,
            current_mode=mode_str,
            is_flat=is_flat,
            now_ms=now_ms,
            cross_lane_basins=[scalp_basin, swing_basin, ...],   # optional
        )
        if ocean_state.intervention:
            handle_intervention(ocean_state.intervention)
            # skip executive this tick
        else:
            # normal flow
    """

    # Sleep machine constants — preserved from prior SleepCycleManager
    MIN_AWAKE_MS: float = 2 * 60 * 60 * 1000.0     # 2 h
    SLEEP_DURATION_MS: float = 15 * 60 * 1000.0    # 15 min
    DRIFT_TRIGGER_TICKS: int = 10                  # ~5 min at 30s tick

    def __init__(self, label: str = "monkey-primary") -> None:
        self.label = label
        self.sleep_state = SleepCycleState()
        self._phi_history: Deque[float] = deque(maxlen=_PHI_HISTORY_MAX)

    # ────────────────── sleep state machine ──────────────────

    @property
    def is_awake(self) -> bool:
        return self.sleep_state.phase == SleepPhase.AWAKE

    @property
    def phase(self) -> SleepPhase:
        return self.sleep_state.phase

    def _step_sleep_state(
        self,
        current_mode: str,
        is_flat: bool,
        now_ms: float,
    ) -> dict[str, Any]:
        prev_phase = self.sleep_state.phase

        if current_mode == "drift":
            self.sleep_state.drift_streak += 1
        else:
            self.sleep_state.drift_streak = 0

        if self.sleep_state.phase == SleepPhase.AWAKE:
            awake_duration = now_ms - self.sleep_state.phase_started_at_ms
            ready = (
                awake_duration > self.MIN_AWAKE_MS
                and is_flat
                and self.sleep_state.drift_streak >= self.DRIFT_TRIGGER_TICKS
            )
            if ready:
                self.sleep_state.phase = SleepPhase.SLEEP
                self.sleep_state.phase_started_at_ms = now_ms
                logger.info(
                    "[%s.ocean] entering sleep (awake=%.2fh driftStreak=%d)",
                    self.label,
                    awake_duration / 3600_000.0,
                    self.sleep_state.drift_streak,
                )
        else:
            sleep_duration = now_ms - self.sleep_state.phase_started_at_ms
            if sleep_duration >= self.SLEEP_DURATION_MS:
                self.sleep_state.phase = SleepPhase.AWAKE
                self.sleep_state.phase_started_at_ms = now_ms
                self.sleep_state.last_sleep_ended_at_ms = now_ms
                self.sleep_state.sleep_count += 1
                self.sleep_state.drift_streak = 0
                logger.info(
                    "[%s.ocean] waking (slept=%.1fm total=%d)",
                    self.label,
                    sleep_duration / 60_000.0,
                    self.sleep_state.sleep_count,
                )

        sleep_remaining_ms = (
            max(0.0, self.SLEEP_DURATION_MS - (now_ms - self.sleep_state.phase_started_at_ms))
            if self.sleep_state.phase == SleepPhase.SLEEP
            else 0.0
        )
        return {
            "phase": self.sleep_state.phase.value,
            "entered_sleep": prev_phase == SleepPhase.AWAKE
            and self.sleep_state.phase == SleepPhase.SLEEP,
            "woke": prev_phase == SleepPhase.SLEEP
            and self.sleep_state.phase == SleepPhase.AWAKE,
            "sleep_remaining_ms": sleep_remaining_ms,
        }

    # ────────────────── primary tick contract ──────────────────

    def observe(
        self,
        *,
        phi: float,
        basin: np.ndarray,
        current_mode: str,
        is_flat: bool,
        now_ms: Optional[float] = None,
        cross_lane_basins: Optional[Sequence[np.ndarray]] = None,
    ) -> OceanState:
        """One tick of meta-observation. Updates internal sleep state +
        Φ history, then returns the OceanState (single source of truth
        for autonomic interventions this tick).

        Caller acts on ocean_state.intervention; if None, normal flow.
        """
        now_ms = now_ms if now_ms is not None else time.time() * 1000.0

        # Sleep machine step (existing SleepCycleManager logic, verbatim)
        sleep_step = self._step_sleep_state(
            current_mode=current_mode, is_flat=is_flat, now_ms=now_ms,
        )
        sleep_phase: Literal["AWAKE", "SLEEP"] = (
            "AWAKE" if sleep_step["phase"] == "awake" else "SLEEP"
        )

        # Track Φ for variance
        self._phi_history.append(float(phi))
        phi_var = (
            variance(self._phi_history) if len(self._phi_history) >= 2 else 0.0
        )

        # Geometric reads
        coherence = _basin_coherence(basin)
        lanes = cross_lane_basins if cross_lane_basins is not None else []
        spread = _max_pairwise_fr(list(lanes))

        diagnostics = {
            "phi_now": float(phi),
            "phi_variance": float(phi_var),
            "drift_streak": float(self.sleep_state.drift_streak),
            "sleep_remaining_ms": float(sleep_step["sleep_remaining_ms"]),
            "lane_count": float(len(lanes)),
        }

        # Intervention selection (priority order; first match wins)
        intervention: Optional[Intervention] = None

        # WAKE / SLEEP from the sleep state machine — surfaces as
        # intervention only on the transition tick. Other ticks the
        # phase is steady.
        if sleep_step["entered_sleep"]:
            intervention = "SLEEP"
        elif sleep_step["woke"]:
            intervention = "WAKE"
        elif phi < _PHI_ESCAPE_BOUND:
            intervention = "ESCAPE"
        elif spread > _SPREAD_BOUND:
            intervention = "SLEEP"
        elif phi < _PHI_DREAM_BOUND:
            intervention = "DREAM"
        elif (
            0.0 < phi_var < _PHI_VARIANCE_BOUND
            and len(self._phi_history) >= 2
        ):
            intervention = "MUSHROOM_MICRO"

        return OceanState(
            intervention=intervention,
            sleep_phase=sleep_phase,
            coherence=coherence,
            spread=spread,
            diagnostics=diagnostics,
        )

    def snapshot(self) -> dict[str, Any]:
        return {
            "phase": self.sleep_state.phase.value,
            "phase_started_at_ms": self.sleep_state.phase_started_at_ms,
            "last_sleep_ended_at_ms": self.sleep_state.last_sleep_ended_at_ms,
            "sleep_count": self.sleep_state.sleep_count,
            "drift_streak": self.sleep_state.drift_streak,
            "phi_history_len": len(self._phi_history),
        }
